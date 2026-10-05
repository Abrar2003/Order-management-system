const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Item = require("../models/item.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const PisUpdateLog = require("../models/pisUpdateLog.model");
const {
  CYCLE_VERSION, clone, getWorkflow, masterSnapshot, buildEvidence, buildPdComparison, compareSizes, sourceValues, transition,
} = require("../helpers/masterWorkflow");
const { buildRow, getWorkflowRows, parseMasterValues, performAction, buildWriteFilter, getApprovedRecords } = require("../services/masterWorkflow.service");
const { masterWorkflowGuard, updateTouchesMaster } = require("../helpers/masterWorkflowGuard");
const { updateItemPis, updateFinalPisCheckMasterValues } = require("../controllers/item.controller");

const USER = { _id: "507f1f77bcf86cd799439011", role: "super admin", name: "Reviewer" };
const NOW = new Date("2026-10-20T10:00:00Z");
const size = { L: 100, B: 50, H: 75, net_weight: 10, remark: "item" };
const box = { L: 110, B: 60, H: 85, gross_weight: 12, remark: "box", box_type: "individual", item_count_in_inner: 0, box_count_in_master: 0 };
const baseline = () => ({
  _id: "507f1f77bcf86cd799439012", code: "ITEM-1", name: "Table", description: "Table", brand: "Test", vendors: [],
  master_item_sizes: [clone(size)], master_box_sizes: [clone(box)], master_box_mode: "individual",
  master_barcode: "old", master_master_barcode: "old", master_inner_barcode: "inner", master_country_of_origin: "India",
  pis_item_sizes: [{ ...size, L: 90 }], pis_box_sizes: [{ ...box, L: 99 }], pis_barcode: "vendor", pis_inner_barcode: "vendor-inner", country_of_origin: "India",
  pis_checked_flag: true, is_rectify_imported: true,
  pd_item_sizes: [clone(size)], pd_box_sizes: [clone(box)], pd_box_mode: "individual",
  cbm: { calculated_master_total: "0.561", calculated_pis_total: "0.5", calculated_inspected_total: "0.6" },
});
const visit = (po, day = "2026-10-03", overrides = {}) => ({
  _id: `507f1f77bcf86cd79943${String(po).replace(/\D/g, "").padStart(5, "0")}`, qc: "507f1f77bcf86cd799439013",
  po, inspector: USER._id, inspection_date: day, createdAt: `${day}T06:00:00Z`, updatedAt: `${day}T07:00:00Z`,
  is_approved: true, inspected_item_sizes: [clone(size)], inspected_box_sizes: [clone(box)], inspected_box_mode: "individual",
  ...overrides,
});
const advance = (item, records, now) => {
  const evidence = buildEvidence(item, records, now);
  return transition({ item, user: USER, action: "review", evidence, values: parseMasterValues(item, {}), payload: { revision: getWorkflow(item).revision, evidence_token: evidence.token }, now });
};
const throughFinalMaster = () => {
  let item = advance(baseline(), [visit("PO-1", "2026-09-01")], new Date("2026-10-03T03:00:00Z"));
  item = advance(item, [visit("PO-2"), visit("PO-3", "2026-10-04"), visit("PO-4", "2026-10-05")], new Date("2026-10-06T03:00:00Z"));
  return advance(item, [visit("PO-5", "2026-10-06"), visit("PO-6", "2026-10-07"), visit("PO-7", "2026-10-08")], new Date("2026-10-09T03:00:00Z"));
};
const signoff = (item, reasons = {}) => transition({ item, user: USER, action: "pd-review", payload: { revision: getWorkflow(item).revision, comparison_token: buildPdComparison(item).token, reasons }, now: NOW });

test("legacy masters and imported, checked, matching items requeue using approved inspection evidence", () => {
  const item = baseline();
  const row = buildRow(item, [visit("PO-1")], USER);
  assert.equal(row.master_workflow.cycle_version, CYCLE_VERSION);
  assert.equal(row.master_workflow.stage, "awaiting_master_1");
  assert.equal(row.status, "ready");
  assert.equal(row.actions.review, true);
  assert.equal(row.inspection_comparisons[0].rows.filter((r) => r.status !== "match").length, 0);
  assert.equal(buildRow(item, [visit("PO-1")], { role: "admin" }).actions.review, false);
});

test("complete 1 + 3 + 3 sequence preserves PIS and legacy master, permits unchanged reviews, and freezes evidence", () => {
  const before = baseline();
  const item = throughFinalMaster();
  assert.equal(item.master_workflow.stage, "final_master");
  assert.equal(item.master_workflow.revision, 3);
  assert.equal(item.master_workflow.consumed_pos.length, 7);
  assert.deepEqual(item.master_workflow.reviews.map((r) => r.evidence.length), [1, 3, 3]);
  assert.deepEqual(item.master_workflow.legacy_master, masterSnapshot(before));
  for (const field of Object.keys(before).filter((k) => k.startsWith("pis_") || k === "country_of_origin")) assert.deepEqual(item[field], before[field]);
  assert.equal(item.cbm.calculated_pis_total, before.cbm.calculated_pis_total);
  const record = visit("PO-2");
  const first = advance(before, [record], NOW);
  record.inspected_item_sizes[0].L = 12345;
  assert.equal(first.master_workflow.reviews[0].evidence[0].item_sizes[0].L, 100);
});

test("PO counting rejects reused, duplicate, unapproved, older, backdated and future visits but counts fresh same-day records", () => {
  const item = advance(baseline(), [visit("PO-1", "2026-09-01")], new Date("2026-10-03T03:00:00Z"));
  const records = [visit("PO-1"), visit("PO-2"), visit(" po-2 ", "2026-10-04"), visit("PO-3"),
    visit("PO-4", "2026-10-03", { is_approved: false }), visit("PO-5", "2026-10-02"),
    visit("PO-6", "2026-10-03", { createdAt: "2026-10-03T02:00:00Z" }),
    visit("PO-7", "2026-09-29", { createdAt: "2026-10-04T06:00:00Z" }), visit("PO-8", "2027-01-01"),
    visit("PO-9", "2026-10-04", { inspector: null })];
  const evidence = buildEvidence(item, records, NOW);
  assert.equal(evidence.count, 2); assert.equal(evidence.ready, false);
  assert.equal(evidence.inspections.find((r) => r.po.trim().toLowerCase() === "po-2").inspection_date, "2026-10-04");
  records.push(visit("PO-10", "2026-10-05"));
  assert.equal(buildEvidence(item, records, NOW).ready, true);
});

test("first three eligible POs are chosen deterministically, with latest approved measurements per PO", () => {
  const item = advance(baseline(), [visit("PO-1", "2026-09-01")], new Date("2026-10-03T03:00:00Z"));
  const records = [visit("PO-5", "2026-10-07"), visit("PO-2"), visit("PO-4", "2026-10-05"), visit("PO-3", "2026-10-04"), visit("PO-2", "2026-10-08", { inspected_item_sizes: [{ ...size, L: 101 }] })];
  const evidence = buildEvidence(item, records, NOW);
  assert.deepEqual(evidence.inspections.map((r) => r.po), ["PO-2", "PO-3", "PO-4"]);
  assert.equal(evidence.inspections[0].item_sizes[0].L, 101);
  assert.equal(buildEvidence(item, records.reverse(), NOW).token, evidence.token);
});

test("stale revision, stale inspection evidence, insufficient inspections and unauthorized stage writes fail", () => {
  const item = baseline(), evidence = buildEvidence(item, [visit("PO-1")], NOW);
  const args = { item, user: USER, action: "review", evidence, values: parseMasterValues(item, {}), payload: { revision: 0, evidence_token: evidence.token }, now: NOW };
  assert.throws(() => transition({ ...args, user: { role: "admin" } }), /Super Admin/);
  assert.throws(() => transition({ ...args, payload: { ...args.payload, revision: 1 } }), /stale/);
  assert.throws(() => transition({ ...args, payload: { ...args.payload, evidence_token: "old" } }), /evidence changed/);
  assert.throws(() => transition({ ...args, evidence: buildEvidence(item, [], NOW) }), /required approved/);
});

test("Master vs PD respects tolerance boundaries, flags missing values and exact packaging/count mismatches", () => {
  const item = throughFinalMaster();
  item.pd_item_sizes[0].L += .5; item.pd_box_sizes[0].L += 1; item.pd_item_sizes[0].net_weight = 11;
  assert.equal(buildPdComparison(item).issue_count, 0);
  item.pd_item_sizes[0].L += .01; item.pd_box_sizes[0].L += .01; item.pd_item_sizes[0].net_weight = 11.01;
  assert.equal(buildPdComparison(item).issue_count, 3);
  item.pd_item_sizes = []; assert.ok(buildPdComparison(item).rows.some((r) => r.status === "missing"));
  const master = { item_sizes: [size], box_sizes: [{ ...box, remark: "master", box_type: "master", box_count_in_master: 3 }], box_mode: "individual_master" };
  const other = clone(master); other.box_sizes[0].box_count_in_master = 4;
  assert.equal(compareSizes(master, other).filter((r) => r.status !== "match").length, 1);
  other.box_mode = "individual";
  assert.equal(compareSizes(master, other).find((r) => r.key === "box_mode").status, "mismatch");
});

test("multiple remarks and carton rows align by part and preserve missing rows", () => {
  const master = { item_sizes: [{ ...size, remark: "top" }, { ...size, remark: "base" }], box_mode: "carton", box_sizes: [{ ...box, remark: "inner", box_type: "inner", item_count_in_inner: 2 }, { ...box, remark: "master", box_type: "master", box_count_in_master: 3 }] };
  const other = clone(master); other.item_sizes.reverse(); other.box_sizes.reverse();
  assert.equal(compareSizes(master, other).filter((r) => r.status !== "match").length, 0);
  other.item_sizes.pop(); assert.equal(compareSizes(master, other).filter((r) => r.group === "item" && r.status === "missing").length, 4);
  other.box_sizes.find((r) => r.box_type === "inner").item_count_in_inner = 4;
  assert.equal(compareSizes(master, other).find((r) => r.field === "item_count_in_inner").status, "mismatch");
});

test("sign-off requires every issue reason, becomes stale on either side changing, and finalization locks all further actions", () => {
  let item = throughFinalMaster(); item.pd_item_sizes[0].L = 999;
  assert.throws(() => signoff(item), /acceptance reason/);
  const comparison = buildPdComparison(item), reasons = Object.fromEntries(comparison.rows.filter((r) => r.status !== "match").map((r) => [r.key, "Reviewed and accepted for this model."]));
  item = signoff(item, reasons); assert.equal(buildPdComparison(item).reviewed, true);
  const changed = clone(item); changed.pd_item_sizes[0].L = 100;
  assert.equal(buildPdComparison(changed).reviewed, false);
  assert.throws(() => transition({ item: changed, user: USER, action: "finalize", payload: { revision: changed.master_workflow.revision, comparison_token: buildPdComparison(changed).token } }), /Sign off/);
  changed.pd_item_sizes[0].L = 999; changed.pd_measurement_revision = 2;
  assert.equal(buildPdComparison(changed).reviewed, false, "changing PD back still requires a fresh review");
  const corrected = transition({ item, user: USER, action: "correct", values: parseMasterValues(item, { master_country_of_origin: "Other" }), payload: { revision: item.master_workflow.revision }, now: NOW });
  assert.equal(buildPdComparison(corrected).reviewed, false);
  const locked = transition({ item, user: USER, action: "finalize", payload: { revision: item.master_workflow.revision, comparison_token: buildPdComparison(item).token }, now: NOW });
  assert.deepEqual(locked.master_workflow.final_snapshot, masterSnapshot(item));
  for (const action of ["review", "correct", "pd-review", "finalize"]) assert.throws(() => transition({ item: locked, user: USER, action, payload: { revision: locked.master_workflow.revision } }), /permanently locked/);
});

test("master payload validation reuses size rules and never accepts PIS or workflow fields", () => {
  const item = baseline();
  assert.throws(() => parseMasterValues(item, { pis_barcode: "changed" }), /Only master/);
  assert.throws(() => parseMasterValues(item, { master_workflow: {} }), /Only master/);
  assert.throws(() => parseMasterValues(item, { master_item_sizes: [{ ...size, L: -1 }] }), /non-negative/);
  assert.throws(() => parseMasterValues(item, { master_item_sizes: [{ ...size, L: "bad" }] }), /non-negative/);
  assert.throws(() => parseMasterValues(item, { master_item_sizes: Array(6).fill(size) }), /cannot exceed/);
  assert.throws(() => parseMasterValues(item, { master_box_mode: "carton" }), /two box rows/);
  const parsed = parseMasterValues(item, { master_item_sizes: [{ remark: "" }], master_box_sizes: [] });
  assert.equal(parsed.master_item_sizes[0].remark, "item");
  assert.equal(parsed.calculated_master_total, "0");
});

// Exercise real Mongoose middleware without a live database.
const guardSchema = new mongoose.Schema({ master_item_sizes: Array, master_barcode: String, master_workflow: mongoose.Schema.Types.Mixed, cbm: mongoose.Schema.Types.Mixed, pd_item_sizes: Array, pd_measurement_revision: { type: Number, default: 0 }, pis_barcode: String });
guardSchema.plugin(masterWorkflowGuard);
const GuardModel = mongoose.model("master_workflow_guard_test", guardSchema);
test("model save middleware blocks locked and stale master writes, while PIS and PD remain writable", async () => {
  const locked = GuardModel.hydrate({ _id: baseline()._id, master_barcode: "frozen", master_workflow: { stage: "finalized" }, cbm: { calculated_master_total: "1" } });
  locked.master_barcode = "changed";
  await assert.rejects(GuardModel.hooks.execPre("save", locked, []), /permanently locked/);
  const allowed = GuardModel.hydrate({ _id: baseline()._id, master_barcode: "frozen", master_workflow: { stage: "finalized" }, pd_item_sizes: [size] });
  allowed.pis_barcode = "new vendor value"; allowed.pd_item_sizes = [{ ...size, L: 101 }];
  await GuardModel.hooks.execPre("save", allowed, []);
  assert.equal(allowed.pd_measurement_revision, 1);
  assert.equal(allowed.$where, undefined);
  const stale = GuardModel.hydrate({ _id: baseline()._id, master_barcode: "old" }); stale.master_barcode = "new";
  await GuardModel.hooks.execPre("save", stale, []);
  assert.deepEqual(stale.$where, { "master_workflow.stage": { $ne: "finalized" } });
});

test("query and bulk middleware guard parent CBM replacements and nested master fields without blocking unrelated writes", async (t) => {
  t.mock.method(GuardModel.collection, "updateOne", async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }));
  for (const update of [{ $set: { "master_item_sizes.0.L": 9 } }, { $unset: { master_workflow: 1 } }, { $set: { cbm: { total: "1" } } }, [{ $replaceWith: {} }]]) assert.equal(updateTouchesMaster(update), true);
  assert.equal(updateTouchesMaster([{ $set: { form_drafts: [], updatedAt: NOW } }]), false);
  const query = GuardModel.updateOne({ _id: baseline()._id }, { $set: { master_barcode: "changed" } });
  await query;
  assert.deepEqual(query.getFilter().$and[1], { "master_workflow.stage": { $ne: "finalized" } });
  const pdQuery = GuardModel.updateOne({ _id: baseline()._id }, { $set: { pd_item_sizes: [size] } });
  await pdQuery;
  assert.equal(pdQuery.getUpdate().$inc.pd_measurement_revision, 1); assert.equal(pdQuery.getFilter().$and, undefined);
  const operations = [{ updateOne: { filter: {}, update: { $set: { master_barcode: "x" } } } }, { updateOne: { filter: {}, update: { $set: { pis_barcode: "y" } } } }];
  await GuardModel.hooks.execPre("bulkWrite", GuardModel, [operations, {}]);
  assert.ok(operations[0].updateOne.filter.$and); assert.deepEqual(operations[1].updateOne.filter, {});
});

const queryResult = (fn) => ({ select() { return this; }, sort() { return this; }, populate() { return this; }, lean: async () => fn() });
const pathValue = (value, path) => path.split(".").reduce((a, k) => a?.[k], value);
const matches = (item, filter) => Object.entries(filter).every(([path, expected]) => path === "$expr" ? expected.$and.every(({ $eq: [field, value] }) => JSON.stringify(pathValue(item, field.$ifNull[0].slice(1)) ?? null) === JSON.stringify(value.$literal)) : JSON.stringify(pathValue(item, path) ?? null) === JSON.stringify(expected));
const mockDatabase = (t, initial) => {
  let stored = clone(initial);
  let records = [visit("PO-1", "2026-09-01")];
  let beforeWrite = () => {};
  t.mock.method(Item, "findOne", () => queryResult(() => clone(stored)));
  t.mock.method(Item, "find", () => queryResult(() => [clone(stored)]));
  t.mock.method(QC, "find", () => queryResult(() => [{ _id: records[0].qc, item: { item_code: stored.code }, order: { order_id: records[0].po } }]));
  t.mock.method(Inspection, "find", () => queryResult(() => clone(records)));
  t.mock.method(PisUpdateLog, "create", async () => ({}));
  t.mock.method(Item, "findOneAndUpdate", (filter, update) => queryResult(() => {
    beforeWrite();
    if (!matches(stored, filter)) return null;
    for (const [path, value] of Object.entries(update.$set)) {
      if (path === "cbm.calculated_master_total") stored.cbm.calculated_master_total = value;
      else stored[path] = clone(value);
    }
    return clone(stored);
  }));
  return { get: () => stored, setRecords: (next) => { records = next; }, beforeWrite: (fn) => { beforeWrite = fn; } };
};

test("service requeues legacy items, preserves PIS byte-for-byte, and accepts only one concurrent review", async (t) => {
  const db = mockDatabase(t, baseline());
  const rows = await getWorkflowRows({ view: "pis-diffs", user: USER });
  assert.equal(rows.length, 1);
  const payload = { revision: 0, evidence_token: rows[0].evidence.token, values: { master_item_sizes: [{ ...size, L: 102 }] } };
  const args = { id: baseline()._id, user: USER, action: "review", payload };
  const results = await Promise.allSettled([performAction(args), performAction(args)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(db.get().master_workflow.reviews.length, 1);
  assert.equal(db.get().master_item_sizes[0].L, 102);
  for (const field of ["pis_barcode", "pis_inner_barcode", "pis_item_sizes", "pis_box_sizes", "country_of_origin"]) assert.deepEqual(db.get()[field], baseline()[field]);
});

test("service refuses newly changed evidence and refuses a PD change racing finalization", async (t) => {
  const db = mockDatabase(t, baseline());
  const [row] = await getWorkflowRows({ view: "pis-diffs", user: USER });
  db.setRecords([visit("PO-1", "2026-09-01", { inspected_item_sizes: [{ ...size, L: 222 }] })]);
  await assert.rejects(performAction({ id: baseline()._id, user: USER, action: "review", payload: { revision: 0, evidence_token: row.evidence.token, values: {} } }), /evidence changed/);
  t.mock.restoreAll();
  const final = signoff(throughFinalMaster());
  const race = mockDatabase(t, final);
  race.beforeWrite(() => { race.get().pd_item_sizes[0].L = 777; });
  await assert.rejects(performAction({ id: final._id, user: USER, action: "finalize", payload: { revision: final.master_workflow.revision, comparison_token: buildPdComparison(final).token } }), /changed while/);
  assert.equal(race.get().master_workflow.stage, "final_master");
});

test("legacy modal and inline routes cannot bypass master review", async (t) => {
  t.mock.method(Item, "findOne", () => { throw new Error("Legacy master write should not reach the database"); });
  for (const [handler, body] of [[updateItemPis, { sync_master_data: true }], [updateItemPis, { pis_update_source: "final_pis_check" }], [updateFinalPisCheckMasterValues, { updates: [{ key: "anything", value: 1 }] }]]) {
    const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { id: baseline()._id }, body, user: USER }, res);
    assert.equal(res.code, 409); assert.match(res.body.message, /master workflow/);
  }
});

test("CAS preserves sparse legacy measurements through real Mongoose query casting", () => {
  const legacy = baseline(); legacy.master_item_sizes = [{ L: 10, remark: "item" }];
  const filter = buildWriteFilter(legacy), query = Item.findOne(filter);
  query.cast(Item);
  assert.deepEqual(query.getFilter().$expr, filter.$expr);
  assert.equal(matches(legacy, filter), true);
  legacy.master_item_sizes[0].L = 11;
  assert.equal(matches(legacy, filter), false);
});
test("approved evidence applies QC brand and vendor scopes at their stored paths", async (t) => {
  let query;
  t.mock.method(QC, "find", (filter) => { query = filter; return queryResult(() => []); });
  await getApprovedRecords([baseline()], { allowed_brands: [{ name: "Giga" }], allowed_vendors: ["Jodhana"] });
  assert.match(JSON.stringify(query), /order_meta.brand/);
  assert.match(JSON.stringify(query), /order_meta.vendor/);
});
test("comparison keeps duplicate remarks visible and aligns reordered parts before orienting dimensions", () => {
  const master = { item_sizes: [{ ...size, remark: "top" }, { ...size, L: 20, B: 30, H: 40, remark: "base" }], box_sizes: [box], box_mode: "individual" };
  const other = clone(master); other.item_sizes.reverse(); other.item_sizes[1] = { ...other.item_sizes[1], L: 75, B: 100, H: 50 };
  assert.equal(compareSizes(master, other).filter((r) => r.status !== "match").length, 0);
  other.item_sizes.push({ ...other.item_sizes[0], L: 99 });
  assert.ok(compareSizes(master, other).some((r) => r.key === "item:base#2:L" && r.status === "missing"));
  const carton = { ...master, box_mode: "individual_master", box_sizes: [{ ...box, box_type: "master", remark: "", box_count_in_master: 6 }] };
  const pd = clone(carton); pd.box_sizes[0].remark = "master";
  assert.equal(compareSizes(carton, pd).filter((r) => r.status !== "match").length, 0);
  pd.box_mode = "";
  assert.equal(compareSizes(carton, pd)[0].status, "missing");
});

test("finalized Item normalization preserves every master field and allows ordinary PIS and inspection writes", async () => {
  const source = throughFinalMaster();
  source.master_workflow.stage = "finalized";
  source.master_item_sizes[0].remark = "";
  source.master_barcode = "legacy alias";
  const locked = Item.hydrate(source);
  const before = masterSnapshot(locked.toObject());
  locked.pis_barcode = "vendor edit";
  locked.inspected_item_sizes = [{ ...size, L: 101 }];
  await Item.hooks.execPre("validate", locked, []);
  assert.deepEqual(masterSnapshot(locked.toObject()), before);
  // Run the shared save guard without triggering unrelated document validation.
  const guard = Item.schema.s.hooks._pres.get("save").find((entry) => entry.fn.name === "guardMasterSave");
  guard.fn.call(locked);
  assert.equal(locked.$where, undefined);
  locked.set("cbm.calculated_master_total", "999");
  assert.throws(() => guard.fn.call(locked), /permanently locked/);
});
