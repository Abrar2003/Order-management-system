const assert = require("node:assert/strict");
const test = require("node:test");
const Item = require("../models/item.model");
const Inspection = require("../models/inspection.model");
const PisUpdateLog = require("../models/pisUpdateLog.model");
const { CYCLE_VERSION } = require("../helpers/masterWorkflow");
const { backfillQcMismatchReviews } = require("../scripts/backfillQcMismatchReviews");

const {
  getQcReportMismatch,
  getQcReportMismatchLevelTwo,
  completeQcMismatchReview,
  __test__: {
    limitRecentInspectionsByItem,
    selectPostMasterOneInspections,
    selectLatestInspectionPerLatestPo,
    canCreateQcMismatchComment,
  },
} = require("../controllers/reports.controller");

const makeInspection = ({
  id,
  itemCode = "ITEM-1",
  po,
  orderDate,
  inspectionDate,
  recencyDate = inspectionDate,
  createdAt,
} = {}) => ({
  _id: id,
  item_code: itemCode,
  order_id: po,
  order_date_value: orderDate ? new Date(`${orderDate}T00:00:00.000Z`) : null,
  inspection_date_value: inspectionDate ? new Date(`${inspectionDate}T00:00:00.000Z`) : null,
  inspection_date_recency_value: recencyDate ? new Date(`${recencyDate}T00:00:00.000Z`) : null,
  createdAt: createdAt ? new Date(`${createdAt}T00:00:00.000Z`) : null,
});

const ids = (rows = []) => rows.map((row) => row?._id);

test("QC mismatch selection returns latest inspection from latest 3 POs by order date", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-3", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-4", po: "PO-4", orderDate: "2026-04-01", inspectionDate: "2026-04-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-4", "po-3", "po-2"]);
});

test("QC mismatch selection keeps only latest inspection inside each PO", () => {
  const selected = selectLatestInspectionPerLatestPo([
    makeInspection({ id: "po-3-old", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-05" }),
    makeInspection({ id: "po-3-new", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-3-new", "po-2", "po-1"]);
});

test("QC mismatch selection excludes an item when fewer than 3 distinct POs exist", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), []);
});

test("QC mismatch comments allow every manager role and QC", () => {
  for (const role of [
    "admin",
    "super admin",
    "manager",
    "product manager",
    "inspection manager",
    "operation manager",
    "QC",
  ]) {
    assert.equal(canCreateQcMismatchComment({ role }), true, role);
  }
  assert.equal(canCreateQcMismatchComment({ role: "user" }), false);
});

test("QC mismatch selection places missing order dates after dated POs", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "no-date-latest", po: "PO-X", inspectionDate: "2026-05-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-2", "po-1", "no-date-latest"]);
});

test("QC mismatch selection does not count missing PO values toward eligibility", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-3", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "missing-old", inspectionDate: "2026-01-01" }),
    makeInspection({ id: "missing-new", inspectionDate: "2026-01-15" }),
  ]);

  assert.deepEqual(ids(selected), []);
});

test("QC mismatch selection includes one latest inspection from exactly 3 distinct POs", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-3", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-3", "po-2", "po-1"]);
});

test("level 2 uses the Master 2 PO set before and after the review", () => {
  const { CYCLE_VERSION, buildEvidence } = require("../helpers/masterWorkflow");
  const item = { master_workflow: {
    cycle_version: CYCLE_VERSION,
    stage: "master_1",
    revision: 2,
    consumed_pos: ["used"],
    reviews: [{ stage: "master_1", reviewed_at: "2026-10-03T08:00:00Z" }],
  } };
  const visit = (id, po, day, approved = true) => ({
    _id: id,
    po,
    inspector: "reviewer",
    is_approved: approved,
    inspection_date: day,
    createdAt: day + "T10:00:00Z",
    inspected_item_sizes: [{ L: 10 }],
  });
  const records = [
    visit("old", "old", "2026-10-02"),
    visit("used", "USED", "2026-10-04"),
    visit("unapproved", "unapproved", "2026-10-04", false),
    visit("first", "A", "2026-10-04"),
    visit("second", "B", "2026-10-05"),
    visit("third", "C", "2026-10-06"),
    visit("extra", "D", "2026-10-07"),
    visit("updated", " a ", "2026-10-08"),
  ];
  const expected = ["updated", "second", "third"];
  assert.deepEqual(ids(selectPostMasterOneInspections(item, records, records)), expected);
  assert.deepEqual(selectPostMasterOneInspections(item, records.slice(0, 5), records), []);
  assert.deepEqual(selectPostMasterOneInspections(item, records, records.slice(0, 5)), []);
  const evidence = buildEvidence(item, records).inspections;
  item.master_workflow.stage = "finalized";
  item.master_workflow.reviews.push({ stage: "master_2", evidence });
  records.at(-1).inspected_item_sizes[0].L = 99;
  const saved = selectPostMasterOneInspections(item, records, []);
  assert.deepEqual(ids(saved), expected);
  assert.equal(saved[0].inspected_item_sizes[0].L, 10);
  assert.deepEqual(selectPostMasterOneInspections({}, records, records), []);
});

const reportVisit = (itemCode, po, orderDate, day, recordedAt, sizes = [{ L: 20 }]) => ({
  ...makeInspection({ id: `${itemCode}-${po}`, itemCode, po, orderDate, inspectionDate: day }),
  inspection_date: day,
  createdAt: new Date(recordedAt),
  inspected_item_sizes: sizes,
  brand: itemCode,
});

const report = async (t, endpoint, { items, inspections, logs = [] }) => {
  t.mock.method(Inspection, "aggregate", () => ({ allowDiskUse: async () => inspections }));
  t.mock.method(Item, "find", () => ({ select: () => ({ lean: async () => items }) }));
  const findLogs = t.mock.method(PisUpdateLog, "find", () => ({ select: () => ({ lean: async () => logs }) }));
  const res = { status(code) { assert.equal(code, 200); return this; }, json(payload) { return payload; } };
  const result = await endpoint({ user: { role: "super_admin" }, query: { from: "2026-11-01", to: "2026-11-15" } }, res);
  return { result, findLogs };
};

test("level 1 uses verified Master dates before choosing POs and compares all three inspections", async (t) => {
  const created = "2026-11-04T20:00:00Z"; // 5 November in India
  const review = "2026-11-07T08:00:00Z";
  const master = { master_item_sizes: [{ L: 10, H: 30 }] };
  const items = [
    { _id: "history-id", code: "history", ...master, update_history: [{
      timestamp: created, before: { master_item_sizes: [], master_box_sizes: [] }, after: master,
    }] },
    { _id: "audit-id", code: "audit", ...master, master_workflow: {
      cycle_version: CYCLE_VERSION, stage: "master", reviews: [{ stage: "master", reviewed_at: review }],
    } },
    { _id: "workflow-id", code: "workflow", ...master, master_workflow: {
      cycle_version: CYCLE_VERSION, stage: "master", started_at: "2026-10-02T18:30:00Z",
      reviews: [{ stage: "master", reviewed_at: created }],
    } },
    { _id: "unknown-id", code: "unknown", ...master, createdAt: created, update_history: [{
      timestamp: created, before: { master_item_sizes: [{ L: 9 }] }, after: master,
    }] },
    { _id: "missing-id", code: "missing", master_item_sizes: [{ L: 0 }], pis_item_sizes: [{ L: 20 }] },
    { _id: "incomplete-id", code: "incomplete", ...master, master_workflow: {
      cycle_version: CYCLE_VERSION, stage: "master", reviews: [{ stage: "master", reviewed_at: review }],
    } },
    { _id: "reviewed-id", code: "reviewed", ...master, qc_mismatch_reviewed_at: new Date(review),
      master_workflow: { cycle_version: CYCLE_VERSION, stage: "master", reviews: [{ stage: "master", reviewed_at: created }] } },
  ];
  const inspections = items.flatMap(({ code }) => [
    reportVisit(code, "old-record", "2026-11-10", "2026-11-05", created),
    reportVisit(code, "backdated", "2026-11-09", "2026-11-04", "2026-11-08T08:00:00Z"),
    reportVisit(code, "same-day", "2026-11-03", "2026-11-05", "2026-11-04T20:01:00Z"),
    reportVisit(code, "next", "2026-11-02", "2026-11-06", "2026-11-06T08:00:00Z"),
    reportVisit(code, "last", "2026-11-01", "2026-11-07", "2026-11-07T09:00:00Z"),
  ]);
  const changes = [{ scope: "Master", field: "Master Item Sizes", before: "Not Set", after: "Item: 10 x 0 x 30 | Net Weight: 0" }];
  const logs = [
    { item: "audit-id", createdAt: created, changes, missing_fields: [{ scope: "Master", field: "master_box_sizes" }] },
    { item: "unknown-id", createdAt: created, changes }, // No evidence the other size group was empty.
  ];
  const { result, findLogs } = await report(t, getQcReportMismatch, { items, inspections, logs });
  assert.ok(findLogs.mock.calls[0].arguments[0].item.$in.includes("audit-id"));
  assert.equal(result.pagination.total, 3);
  assert.deepEqual(result.filters.brand_options, ["audit", "history", "workflow"]);
  assert.equal(result.summary.mismatch_inspections, 9);
  assert.equal(result.summary.clean_inspections, 0);
  for (const row of result.rows) {
    assert.deepEqual(row.order_ids, ["same-day", "next", "last"]);
    assert.equal(row.master_snapshot.inspected_item_sizes[0].L, 10);
    assert.deepEqual(row.inspection_records.map((visit) => visit.sheet_label), ["Inspection 1", "Inspection 2", "Inspection 3"]);
    for (const visit of row.inspection_records) {
      assert.deepEqual(visit.item_size_mismatches.map((field) => field.field), ["L"]);
    }
  }
});

test("only managers can complete an item review, and the original completion survives a retry", async (t) => {
  const reviewedAt = new Date("2026-11-14T08:00:00Z");
  const update = t.mock.method(Item, "findOneAndUpdate", () => ({
    select: () => ({ lean: async () => null }),
  }));
  t.mock.method(Item, "findOne", () => ({ select: () => ({ lean: async () => ({ qc_mismatch_reviewed_at: reviewedAt }) }) }));
  const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { return payload; } };
  const req = { params: { code: "ITEM-1" }, user: { role: "qc" } };
  await completeQcMismatchReview(req, res);
  assert.equal(res.code, 403);
  assert.equal(update.mock.callCount(), 0);
  req.user = { role: "admin", _id: "507f1f77bcf86cd799439011" };
  const result = await completeQcMismatchReview(req, res);
  const [filter, change] = update.mock.calls[0].arguments;
  assert.deepEqual(filter.$and[1], { qc_mismatch_reviewed_at: null });
  assert.equal(change.$set.qc_mismatch_reviewed_by, req.user._id);
  assert.equal(result.reviewed_at, reviewedAt);
});

test("backfill only marks unreviewed items with nonblank comments from the cutoff or earlier", async (t) => {
  const update = t.mock.method(Item, "updateMany", async () => ({ modifiedCount: 1 }));
  await backfillQcMismatchReviews();
  const [filter, change] = update.mock.calls[0].arguments;
  const comment = filter.qc_mismatch_comments.$elemMatch;
  assert.equal(filter.qc_mismatch_reviewed_at, null);
  assert.equal(comment.created_at.$lte, change.$set.qc_mismatch_reviewed_at);
  assert.equal(comment.comment.test(" "), false);
  assert.equal(comment.comment.test("Reviewed dimensions"), true);
});

test("level 2 compares saved evidence against saved Master 1 after later Master changes", async (t) => {
  const inspections = ["A", "B", "C"].map((po) =>
    reportVisit("ITEM-1", po, "2026-11-01", "2026-11-05", "2026-11-05T08:00:00Z"),
  );
  const evidence = inspections.map((visit, index) => ({
    inspection_id: visit._id,
    item_sizes: index === 2 ? [] : [{ L: 20 }],
  }));
  const item = {
    _id: "item-id", code: "ITEM-1", master_item_sizes: [{ L: 20 }],
    master_workflow: {
      cycle_version: CYCLE_VERSION, stage: "finalized",
      reviews: [
        { stage: "master_1", master: { master_item_sizes: [{ L: 10 }] } },
        { stage: "master_2", evidence },
      ],
    },
  };
  const withoutSnapshot = { ...item, _id: "other-id", code: "ITEM-2", master_workflow: {
    ...item.master_workflow,
    reviews: [{ stage: "master_1" }, { stage: "master_2", evidence: evidence.map((visit) => ({
      ...visit, inspection_id: visit.inspection_id.replace("ITEM-1", "ITEM-2"),
    })) }],
  } };
  const otherInspections = inspections.map((visit) => ({
    ...visit, item_code: "ITEM-2", _id: visit._id.replace("ITEM-1", "ITEM-2"),
  }));
  const { result, findLogs } = await report(t, getQcReportMismatchLevelTwo, {
    items: [item, withoutSnapshot], inspections: [...inspections, ...otherInspections],
  });
  assert.equal(findLogs.mock.callCount(), 0);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.rows[0].master_snapshot.inspected_item_sizes[0].L, 10);
  assert.equal(result.summary.total_inspections, 3);
  assert.equal(result.summary.mismatch_inspections, 2);
  assert.equal(result.summary.clean_inspections, 0);
  assert.equal(result.rows[0].inspection_records[2].has_comparable_data, false);
});
