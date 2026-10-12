const test = require("node:test");
const assert = require("node:assert/strict");
const EudrChain = require("../models/eudrChain.model");
const Party = require("../models/eudrParty.model");
const controller = require("../controllers/eudrChain.controller");
const { validateStage, requiredDocuments, receiverFromSeller, assertReceiverLink, collectInvoiceKeys } = require("../services/eudrChain.service");
const { snapshots, saveStageDirectory, evidenceMatches } = require("../services/eudrDirectory.service");
const storage = require("../services/wasabiStorage.service");
const { sha256 } = require("../services/eudrFiles.service");
const allocation = require("../services/eudrAllocation.service");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const Vendor = require("../models/vendor.model");

const vendor = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Shipping vendor", gst: "GST-V", pan: "PAN-V" };
const context = { vendor, declaredMilliCft: 10000 };
const evidence = (type, name = `${type}.${type === "forest_image" ? "png" : "pdf"}`) => ({ type, key: `private/${name}`, name, content_type: type === "forest_image" ? "image/png" : "application/pdf" });
const mill = () => ({ kind: "sawmill", workflow_version: 2, fields: { name: "Mill", gst: "GST-M", pan: "PAN-M", permission_number: "P1", forest_latitude: "26.238947", forest_longitude: "73.024309", invoice_number: "SALE-1", invoice_date: "2026-10-12", sold_to: vendor.name, buyer_gst: vendor.gst, buyer_pan: vendor.pan, sold_cft: "10" }, documents: ["cutting_invoice", "license", "permission", "forest_image", "buyer_gst", "buyer_pan"].map((type) => evidence(type)) });
const transport = () => ({ kind: "transport", workflow_version: 2, fields: { transporter_name: "Transport", truck_number: "RJ-001", driver_license_number: "DL-001", billty_number: "B1", ewaybill_number: "EW1" }, documents: ["weight_slip", "billty", "driver_license", "ewaybill"].map((type) => evidence(type)) });
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const setup = (t, stages) => {
  const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
  t.mock.method(Order, "find", () => query([{ _id: "o", vendor: { vendor_id: vendor._id }, item: { item_code: "I1" }, shipment: [{ _id: "s", container: "C1", quantity: 10 }] }]));
  t.mock.method(Sample, "find", () => query([]));
  t.mock.method(Item, "find", () => query([{ code: "I1", timber_cft: 1 }]));
  t.mock.method(Vendor, "find", () => query([vendor]));
  t.mock.method(EudrChain, "createIndexes", async () => {});
  t.mock.method(allocation, "ensureIndexes", async () => {});
  t.mock.method(Party, "findOneAndUpdate", async () => ({}));
  const chain = new EudrChain({ container: "C1", container_key: "c1", vendor: vendor._id, declared_milli_cft: 10000, stages });
  t.mock.method(chain, "save", async () => chain);
  t.mock.method(EudrChain, "findById", async () => chain);
  t.mock.method(EudrChain, "find", () => ({ lean: async () => [chain] }));
  t.mock.method(allocation, "withAllocation", async (_container, _vendor, operation) => operation([chain], {}));
  const request = (stage, body = {}) => ({ params: { id: String(chain._id), stageId: String(stage._id) }, body, user: { _id: vendor._id, name: "Manager" } });
  return { chain, request };
};

test("sale verification requires buyer tax files and positive three-decimal CFT coverage", () => {
  const stage = mill();
  assert.doesNotThrow(() => validateStage(stage, context));
  for (const value of ["0", "9.999", "10.0001", "bad", "-1"]) {
    stage.fields.sold_cft = value; assert.throws(() => validateStage(stage, context));
  }
  stage.fields.sold_cft = "11.001"; assert.doesNotThrow(() => validateStage(stage, context));
  stage.documents = stage.documents.filter((doc) => doc.type !== "buyer_pan");
  assert.throws(() => validateStage(stage, context), /buyer pan document/);
});

test("forest coordinates and image are mandatory before the sawmill can open transport", async (t) => {
  const { chain, request } = setup(t, [mill()]); const stage = chain.stages[0];
  for (const [field, values] of [["forest_latitude", ["", "91", "-90.000001", "NaN", "26 north", "0x10"]], ["forest_longitude", ["", "180.000001", "-181", "Infinity", "bad"]]]) {
    const original = stage.fields[field];
    for (const value of values) {
      stage.fields = { ...stage.fields, [field]: value };
      const res = response(); await controller.verify(request(stage), res);
      assert.equal(res.code, 400); assert.match(res.body.message, new RegExp(field.replace(/_/g, " ")));
      assert.equal(chain.stages.length, 1); assert.equal(stage.verified_at, null);
    }
    stage.fields = { ...stage.fields, [field]: original };
  }
  const forest = stage.documents.find((document) => document.type === "forest_image").toObject();
  stage.documents = stage.documents.filter((document) => document.type !== "forest_image");
  const missing = response(); await controller.verify(request(stage), missing);
  assert.equal(missing.code, 400); assert.match(missing.body.message, /forest image document is required/);
  stage.documents.push(forest);
  for (const [latitude, longitude] of [["0", "0"], ["-90", "-180"], ["90", "180"], ["-26.1234567", "73.1234567"]]) {
    stage.fields = { ...stage.fields, forest_latitude: latitude, forest_longitude: longitude };
    assert.doesNotThrow(() => validateStage(stage, context));
  }
  const accepted = response(); await controller.verify(request(stage), accepted);
  assert.ok(accepted.body.data, accepted.body.message); assert.equal(chain.stages[1].kind, "transport");
  const edited = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, forest_longitude: "74" } }), edited);
  assert.ok(edited.body.data, edited.body.message); assert.equal(chain.stages.length, 1); assert.equal(stage.verified_at, null);
  assert.ok(chain.history.some((entry) => entry.event === "verification_invalidated"));
});

test("forest uploads accept actual images, reject disguised/non-image files, and retain duplicate checks", async (t) => {
  const { chain, request } = setup(t, [mill()]); const stage = chain.stages[0];
  stage.documents = stage.documents.filter((document) => document.type !== "forest_image");
  for (const document of stage.documents) document.sha256 = sha256(Buffer.from(document.type));
  let uploads = 0;
  t.mock.method(storage, "createStorageKey", () => "private/forest");
  t.mock.method(storage, "uploadBuffer", async () => { uploads += 1; });
  const upload = async (buffer, name) => {
    const res = response(); await controller.upload({ ...request(stage, { type: "forest_image" }), file: { buffer, originalname: name, size: buffer.length } }, res); return res;
  };
  const image = await require("sharp")({ create: { width: 2, height: 2, channels: 3, background: "green" } }).png().toBuffer();
  for (const [bytes, name] of [[Buffer.from("%PDF-1.7"), "forest.pdf"], [Buffer.from("not a picture"), "forest.png"], [image, "forest.jpg"]]) {
    const rejected = await upload(bytes, name); assert.equal(rejected.code, 400); assert.match(rejected.body.message, /valid PNG, JPEG or WebP/);
  }
  assert.equal(uploads, 0);
  const accepted = await upload(image, "forest.png"); assert.ok(accepted.body.data, accepted.body.message); assert.equal(uploads, 1);
  assert.equal(stage.documents.find((document) => document.type === "forest_image").content_type, "image/png");
  const duplicate = await upload(image, "other-forest.png"); assert.equal(duplicate.code, 409); assert.equal(uploads, 1);
});

test("direct sale creates a locked receiver from buyer and references one invoice only", async (t) => {
  const { chain, request } = setup(t, [mill()]);
  const first = response(); await controller.verify(request(chain.stages[0]), first); assert.ok(first.body.data);
  assert.equal(chain.stages[1].kind, "transport");
  const tr = transport(); chain.stages[1].fields = tr.fields; chain.stages[1].documents = tr.documents;
  const second = response(); await controller.verify(request(chain.stages[1]), second); assert.ok(second.body.data);
  const receiver = chain.stages[2];
  assert.deepEqual(receiver.fields, { name: vendor.name, gst: vendor.gst, pan: vendor.pan });
  assert.equal(receiver.incoming_invoice_stage_id, String(chain.stages[0]._id));
  assert.deepEqual(receiver.documents.toObject(), []);
  assert.equal(collectInvoiceKeys(chain.stages).length, 1);
  const missingReceipt = response(); await controller.verify(request(receiver), missingReceipt); assert.match(missingReceipt.body.message, /received cft is required/);
  const forged = response(); await controller.saveStage(request(receiver, { fields: { ...receiver.fields, gst: "OTHER" } }), forged); assert.equal(forged.code, 409);
  const extraFile = response(); await controller.upload({ ...request(receiver, { type: "invoice" }), file: { originalname: "extra.pdf", buffer: Buffer.from("extra"), size: 5 } }, extraFile);
  assert.equal(extraFile.code, 400); assert.match(extraFile.body.message, /does not accept onward-sale uploads/);
  receiver.fields = { ...receiver.fields, received_cft: "9.5" };
  const accepted = response(); await controller.verify(request(receiver), accepted); assert.ok(accepted.body.data);
  assert.equal(chain.stages[3].kind, "declaration");
  assert.equal(chain.stages.filter((stage) => stage.kind === "transport").length, 1);
});

test("intermediary records onward sale and opens another transport until both vendor IDs match", async (t) => {
  const sawmill = mill(); sawmill.fields.sold_to = "Trader"; sawmill.fields.buyer_gst = "GST-T"; sawmill.fields.buyer_pan = "PAN-T";
  const { chain, request } = setup(t, [sawmill]);
  for (const index of [0, 1]) {
    if (index === 1) Object.assign(chain.stages[index], transport());
    const res = response(); await controller.verify(request(chain.stages[index]), res); assert.ok(res.body.data, res.body.message);
  }
  const trader = chain.stages[2]; trader.fields = { ...trader.fields, received_cft: "8" };
  assert.deepEqual(requiredDocuments(trader, vendor), ["invoice", "buyer_gst", "buyer_pan"]);
  const blocked = response(); await controller.verify(request(trader), blocked); assert.match(blocked.body.message, /invoice number/);
  trader.fields = { ...trader.fields, invoice_number: "SALE-1", invoice_date: "2026-10-12", sold_to: vendor.name, buyer_gst: vendor.gst, buyer_pan: vendor.pan, sold_cft: "10" };
  trader.documents = ["invoice", "buyer_gst", "buyer_pan"].map((type) => evidence(type, `trader-${type}.pdf`));
  const onward = response(); await controller.verify(request(trader), onward); assert.ok(onward.body.data, onward.body.message);
  assert.equal(chain.stages[3].kind, "transport");
  Object.assign(chain.stages[3], transport());
  const shipped = response(); await controller.verify(request(chain.stages[3]), shipped); assert.ok(shipped.body.data, shipped.body.message);
  assert.equal(chain.stages[4].fields.gst, vendor.gst);
  assert.equal(chain.stages[4].incoming_invoice_stage_id, String(trader._id));
  assert.equal(collectInvoiceKeys(chain.stages).length, 2); // Same number, different issuers.
  trader.fields.invoice_number = chain.stages[0].fields.invoice_number; trader.fields.gst = chain.stages[0].fields.gst;
  assert.throws(() => collectInvoiceKeys(chain.stages), /already used/);
});

test("legacy approvals persist until edit; upgraded seller invalidates downstream and retains audit", async (t) => {
  const old = mill(); delete old.workflow_version;
  const { chain, request } = setup(t, [old, transport()]);
  chain.stages[0].verified_at = new Date(); chain.stages[1].verified_at = new Date();
  assert.equal(chain.stages[0].workflow_version, 1);
  const unchanged = response(); await controller.saveStage(request(chain.stages[0], { fields: chain.stages[0].fields }), unchanged);
  assert.equal(chain.stages[0].workflow_version, 1); assert.ok(chain.stages[0].verified_at);
  const edited = response(); await controller.saveStage(request(chain.stages[0], { fields: { ...chain.stages[0].fields, name: "Updated mill" } }), edited);
  assert.ok(edited.body.data, edited.body.message); assert.equal(chain.stages.length, 1); assert.equal(chain.stages[0].workflow_version, 2); assert.equal(chain.stages[0].verified_at, null);
  assert.ok(chain.history.some((entry) => entry.event === "later_stages_superseded" && entry.detail.stages.length === 1));
  assert.throws(() => receiverFromSeller({ _id: "old", fields: {} }), /Complete and reverify/);
});

test("directory stores only reusable snapshots, not transactions, and does not mutate chains", async (t) => {
  const stage = transport(); stage.fields.gst = "GST-TR"; stage.fields.truck_registration_number = "REG1"; stage.documents.push(evidence("truck_registration"));
  const before = JSON.stringify(stage); const writes = [];
  t.mock.method(Party, "findOneAndUpdate", async (...args) => { writes.push(args); });
  await saveStageDirectory(stage);
  assert.equal(writes.length, 2); assert.equal(JSON.stringify(stage), before);
  assert.deepEqual(Object.keys(writes[0][1].$set.fields), ["transporter_name", "gst"]);
  assert.deepEqual(Object.keys(writes[1][1].$set.fields), ["truck_number", "truck_registration_number", "driver_license_number"]);
  assert.equal(writes[1][1].$addToSet.evidence.$each.length, 2);
  const firstEvidence = writes[1][1].$addToSet.evidence.$each;
  await saveStageDirectory(stage);
  assert.deepEqual(writes[3][1].$addToSet.evidence.$each, firstEvidence);
  const saved = snapshots(mill())[0]; assert.equal(saved.fields.invoice_number, undefined); assert.equal(saved.fields.sold_cft, undefined);
  assert.equal(evidenceMatches({ kind: "vehicle", fields: stage.fields }, stage, "driver_license"), true);
  assert.equal(evidenceMatches({ kind: "vehicle", fields: { ...stage.fields, driver_license_number: "WRONG" } }, stage, "driver_license"), false);
});

test("editing a legacy receiver archives its old incoming invoice and links the seller without another invoice key", async (t) => {
  const receiver = { kind: "receiver", fields: { name: vendor.name, gst: vendor.gst, pan: vendor.pan, received_cft: "10", invoice_number: "OLD-INCOMING", invoice_date: "2026-10-12", issuer_name: "Mill", issuer_gst: "GST-M", issuer_pan: "PAN-M" }, documents: [evidence("invoice", "legacy-incoming.pdf")] };
  const { chain, request } = setup(t, [mill(), transport(), receiver]);
  chain.stages[0].verified_at = new Date(); chain.stages[1].verified_at = new Date();
  const stage = chain.stages[2];
  const edited = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, received_cft: "9" } }), edited);
  assert.ok(edited.body.data, edited.body.message);
  assert.equal(stage.workflow_version, 2); assert.equal(stage.incoming_invoice_stage_id, String(chain.stages[0]._id));
  assert.equal(stage.documents.length, 0); assert.equal(stage.fields.invoice_number, undefined); assert.equal(stage.fields.issuer_gst, undefined);
  assert.equal(collectInvoiceKeys(chain.stages).length, 1);
  const archived = chain.history.find((entry) => entry.event === "legacy_receiver_upgraded");
  assert.equal(archived.detail.stage.documents[0].name, "legacy-incoming.pdf");
});

test("a larger declaration revokes seller and downstream verifications when the sold amount no longer covers it", async (t) => {
  const { chain, request } = setup(t, [mill(), transport()]);
  chain.stages.forEach((stage) => { stage.verified_at = new Date(); });
  t.mock.method(Item, "find", () => ({ select: () => ({ lean: async () => [{ code: "I1", timber_cft: 1.2 }] }) }));
  const updated = response(); await controller.updateDeclared(request(chain.stages[0], { declared_cft: "12" }), updated);
  assert.ok(updated.body.data, updated.body.message);
  assert.equal(chain.declared_milli_cft, 12000); assert.ok(chain.stages.every((stage) => stage.verified_at === null));
  assert.equal(chain.history.filter((entry) => entry.event === "verification_invalidated").length, 2);
});

test("saved evidence requires confirmation and matching identity, and shares filename/hash protections", async (t) => {
  const { chain, request } = setup(t, [mill()]); chain.stages[0].documents = [];
  const bytes = Buffer.from("valid saved evidence");
  const party = new Party({ kind: "sawmill", identity_key: "GST-M|PAN-M", name: "Mill", fields: mill().fields, evidence: [{ ...evidence("license"), sha256: sha256(bytes), size: bytes.length }] });
  t.mock.method(Party, "findById", async () => party);
  t.mock.method(storage, "getObjectBuffer", async () => ({ buffer: bytes }));
  const body = { party_id: String(party._id), evidence_id: String(party.evidence[0]._id) };
  const unconfirmed = response(); await controller.reuseEvidence(request(chain.stages[0], body), unconfirmed); assert.equal(unconfirmed.code, 400);
  const accepted = response(); await controller.reuseEvidence(request(chain.stages[0], { ...body, confirmed: true }), accepted); assert.ok(accepted.body.data, accepted.body.message);
  assert.equal(chain.stages[0].documents[0].key, party.evidence[0].key);
  const duplicate = response(); await controller.reuseEvidence(request(chain.stages[0], { ...body, confirmed: true }), duplicate); assert.equal(duplicate.code, 409);
  party.fields = { ...party.fields, gst: "WRONG" };
  const wrong = response(); await controller.reuseEvidence(request(chain.stages[0], { ...body, confirmed: true }), wrong); assert.equal(wrong.code, 409); assert.match(wrong.body.message, /identity/);
});

test("vendor buyer selection uses server identity and keeps saved snapshots on later transaction edits", async (t) => {
  const { chain, request } = setup(t, [mill()]); const stage = chain.stages[0];
  let currentVendor = { ...vendor }; let reads = 0;
  t.mock.method(Vendor, "findOne", (query) => {
    reads += 1; assert.equal(query.deleted_at, null); assert.deepEqual(query.is_active, { $ne: false });
    return { select: () => ({ lean: async () => currentVendor }) };
  });
  const selected = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, buyer_type: "vendor", buyer_vendor_id: vendor._id, sold_to: "FORGED", buyer_gst: "FORGED", buyer_pan: "FORGED" } }), selected);
  assert.ok(selected.body.data, selected.body.message);
  assert.equal(stage.fields.sold_to, vendor.name); assert.equal(stage.fields.buyer_gst, vendor.gst); assert.equal(stage.fields.buyer_pan, vendor.pan);
  assert.equal(stage.fields.sold_cft, "10"); assert.ok(!snapshots(stage).some((entry) => entry.kind === "buyer"));
  currentVendor = { ...vendor, name: "Renamed vendor", gst: "NEW-GST" };
  const edited = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, sold_cft: "11" } }), edited);
  assert.ok(edited.body.data, edited.body.message); assert.equal(reads, 1); assert.equal(stage.fields.buyer_gst, vendor.gst);
  const reselected = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, sold_to: currentVendor.name, buyer_gst: currentVendor.gst } }), reselected);
  assert.ok(reselected.body.data, reselected.body.message); assert.equal(reads, 2); assert.equal(stage.fields.buyer_gst, "NEW-GST");
  currentVendor = { ...vendor, pan: "" };
  const missingTax = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, buyer_gst: "changed" } }), missingTax); assert.equal(missingTax.code, 409);
  currentVendor = null;
  const unavailable = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, buyer_gst: "changed" } }), unavailable); assert.equal(unavailable.code, 409);
  const invalid = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, buyer_vendor_id: "invalid" } }), invalid); assert.equal(invalid.code, 400);
});

test("other buyer identities persist from sawmill and onward sales without invoices, quantities or evidence", async (t) => {
  const { chain, request } = setup(t, [mill()]); const stage = chain.stages[0]; const writes = [];
  t.mock.method(Party, "findOneAndUpdate", async (filter, update) => { writes.push({ filter, update }); });
  const fields = { ...stage.fields, buyer_type: "other", buyer_vendor_id: vendor._id, sold_to: "Timber trader", buyer_gst: "GST T", buyer_pan: "PAN-T" };
  const saved = response(); await controller.saveStage(request(stage, { fields }), saved); assert.ok(saved.body.data, saved.body.message);
  assert.equal(stage.fields.buyer_vendor_id, undefined);
  const entry = writes.find(({ filter }) => filter.kind === "buyer");
  assert.equal(entry.filter.identity_key, "GSTT|PANT");
  assert.deepEqual(entry.update.$set.fields, { sold_to: "Timber trader", buyer_gst: "GST T", buyer_pan: "PAN-T" });
  assert.equal(entry.update.$addToSet, undefined);
  const before = JSON.stringify(stage.toObject());
  const onward = { kind: "receiver", fields: { name: "Intermediate", gst: "I-GST", pan: "I-PAN", ...entry.update.$set.fields, sold_cft: "20", invoice_number: "NEW-SALE" }, documents: [] };
  await saveStageDirectory(onward);
  assert.equal(writes.at(-1).filter.identity_key, entry.filter.identity_key); assert.equal(JSON.stringify(stage.toObject()), before);
  const incomplete = snapshots({ kind: "receiver", fields: { sold_to: "Incomplete", buyer_gst: "GST" } }); assert.deepEqual(incomplete, []);
  const draft = response(); await controller.saveStage(request(stage, { fields: { ...stage.fields, buyer_type: "vendor", buyer_vendor_id: "", sold_to: "", buyer_gst: "", buyer_pan: "" } }), draft); assert.ok(draft.body.data, draft.body.message);
});

test("two smaller purchase chains verify independently and complete only their combined allocated CFT", async (t) => {
  const { chain, request } = setup(t, [mill()]);
  chain.contribution_milli_cft = 6000;
  chain.stages[0].fields.sold_cft = "6";
  const verified = response(); await controller.verify(request(chain.stages[0]), verified);
  assert.ok(verified.body.data, verified.body.message);
  assert.equal(verified.body.data.coverage.allocated_cft, 6);
  assert.equal(verified.body.data.coverage.complete, false);
  const group = await require("../services/eudrChain.service").loadContainer("C1");
  const finalStages = [
    { kind: "receiver", fields: { name: vendor.name, gst: vendor.gst, pan: vendor.pan }, verified_at: new Date(), vendor_signature: group.vendors[0].vendor_signature, documents: [] },
    { kind: "declaration", documents: [evidence("declaration")], verified_at: null },
  ];
  chain.stages.push(...finalStages); chain.stages[1].verified_at = new Date();
  const firstDone = response(); await controller.verify(request(chain.stages.at(-1)), firstDone);
  assert.ok(firstDone.body.data, firstDone.body.message); assert.equal(firstDone.body.data.complete, true);
  assert.equal(firstDone.body.data.coverage.verified_cft, 6); assert.equal(firstDone.body.data.coverage.complete, false);
  const second = new EudrChain({ container: "C1", container_key: "c1", vendor: vendor._id, declared_milli_cft: 10000, contribution_milli_cft: 4000, stages: chain.stages.toObject() });
  t.mock.method(second, "save", async () => second);
  t.mock.method(EudrChain, "find", () => ({ lean: async () => [chain, second] }));
  const loaded = response(); await controller.get(request(chain.stages[0]), loaded);
  assert.equal(loaded.body.data.coverage.verified_cft, 10); assert.equal(loaded.body.data.coverage.complete, true);
  second.stages[0].verified_at = null;
  const edited = response(); await controller.get(request(chain.stages[0]), edited);
  assert.equal(edited.body.data.coverage.complete, false); assert.equal(edited.body.data.coverage.verified_cft, 6);
});

test("create accepts a second smaller purchase but rejects excess and invalid contributions server-side", async (t) => {
  const { chain } = setup(t, [mill()]); chain.contribution_milli_cft = 6000;
  const chains = [chain];
  t.mock.method(EudrChain.prototype, "save", async function () { chains.push(this); return this; });
  t.mock.method(EudrChain, "find", () => ({ lean: async () => chains }));
  t.mock.method(allocation, "withAllocation", async (_container, _vendor, operation) => operation(chains, {}));
  const request = (contribution_cft) => ({ body: { container: "C1", vendor_id: vendor._id, declared_cft: "10", contribution_cft }, user: { _id: vendor._id } });
  const accepted = response(); await controller.create(request("4"), accepted);
  assert.equal(accepted.code, 201); assert.equal(chains.length, 2);
  assert.equal(accepted.body.data.contribution_milli_cft, 4000); assert.equal(accepted.body.data.declared_milli_cft, 10000);
  assert.equal(accepted.body.data.coverage.allocated_cft, 10); assert.equal(accepted.body.data.coverage.complete, false);
  const excess = response(); await controller.create(request("0.001"), excess);
  assert.equal(excess.code, 409); assert.equal(chains.length, 2);
  for (const value of ["", "0", "-1", "1.0001", "bad"]) {
    const invalid = response(); await controller.create(request(value), invalid); assert.equal(invalid.code, 400);
  }
  const otherVendorChain = new EudrChain({ container: "C1", vendor: "cccccccccccccccccccccccc", declared_milli_cft: 99000, contribution_milli_cft: 99000 });
  t.mock.method(EudrChain, "find", () => ({ select: () => ({ lean: async () => [...chains, otherVendorChain] }) }));
  const lookup = response(); await controller.lookupContainer({ query: { container: "C1" } }, lookup);
  assert.equal(lookup.body.vendors[0].coverage.chain_count, 2); assert.equal(lookup.body.vendors[0].coverage.allocated_cft, 10);
});

test("contribution edits preserve documents/history, revoke this chain, and cannot over-allocate", async (t) => {
  const { chain, request } = setup(t, [mill(), transport()]);
  chain.stages.forEach((stage) => { stage.verified_at = new Date(); });
  const beforeDocuments = JSON.stringify(chain.stages.map((stage) => stage.documents));
  const lower = response(); await controller.updateContribution(request(chain.stages[0], { contribution_cft: "6" }), lower);
  assert.ok(lower.body.data, lower.body.message); assert.equal(chain.contribution_milli_cft, 6000); assert.equal(chain.declared_milli_cft, 10000);
  assert.ok(chain.stages.every((stage) => !stage.verified_at)); assert.equal(JSON.stringify(chain.stages.map((stage) => stage.documents)), beforeDocuments);
  assert.ok(chain.history.some((entry) => entry.event === "contribution_cft_changed"));
  const sibling = new EudrChain({ container: "C1", vendor: vendor._id, declared_milli_cft: 10000, contribution_milli_cft: 4000 });
  t.mock.method(allocation, "withAllocation", async (_container, _vendor, operation) => operation([chain, sibling], {}));
  const tooMuch = response(); await controller.updateContribution(request(chain.stages[0], { contribution_cft: "6.001" }), tooMuch);
  assert.equal(tooMuch.code, 409); assert.equal(chain.contribution_milli_cft, 6000);
  for (const contribution_cft of ["", "0", "-1", "1.0001", "bad"]) {
    const invalid = response(); await controller.updateContribution(request(chain.stages[0], { contribution_cft }), invalid); assert.equal(invalid.code, 400);
  }
});

test("a container declaration update synchronizes sibling totals without inflating explicit contributions", async (t) => {
  const { chain, request } = setup(t, [mill()]); chain.contribution_milli_cft = 6000;
  const sibling = new EudrChain({ container: "C1", vendor: vendor._id, declared_milli_cft: 10000, contribution_milli_cft: 4000, stages: [mill()] });
  t.mock.method(sibling, "save", async () => sibling);
  t.mock.method(allocation, "withAllocation", async (_container, _vendor, operation) => operation([chain, sibling], {}));
  t.mock.method(EudrChain, "find", () => ({ lean: async () => [chain, sibling] }));
  t.mock.method(Item, "find", () => ({ select: () => ({ lean: async () => [{ code: "I1", timber_cft: 1.2 }] }) }));
  const updated = response(); await controller.updateDeclared(request(chain.stages[0], { declared_cft: "12" }), updated);
  assert.ok(updated.body.data, updated.body.message);
  assert.equal(chain.declared_milli_cft, 12000); assert.equal(sibling.declared_milli_cft, 12000);
  assert.equal(chain.contribution_milli_cft, 6000); assert.equal(sibling.contribution_milli_cft, 4000);
  assert.equal(updated.body.data.coverage.remaining_cft, 2); assert.equal(updated.body.data.coverage.complete, false);
});
