const test = require("node:test");
const assert = require("node:assert/strict");
const EudrChain = require("../models/eudrChain.model");
const Party = require("../models/eudrParty.model");
const controller = require("../controllers/eudrChain.controller");
const { validateStage, requiredDocuments, receiverFromSeller, assertReceiverLink, collectInvoiceKeys } = require("../services/eudrChain.service");
const { snapshots, saveStageDirectory, evidenceMatches } = require("../services/eudrDirectory.service");
const storage = require("../services/wasabiStorage.service");
const { sha256 } = require("../services/eudrFiles.service");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const Vendor = require("../models/vendor.model");

const vendor = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Shipping vendor", gst: "GST-V", pan: "PAN-V" };
const context = { vendor, declaredMilliCft: 10000 };
const evidence = (type, name = `${type}.pdf`) => ({ type, key: `private/${name}`, name, content_type: "application/pdf" });
const mill = () => ({ kind: "sawmill", workflow_version: 2, fields: { name: "Mill", gst: "GST-M", pan: "PAN-M", permission_number: "P1", invoice_number: "SALE-1", invoice_date: "2026-10-12", sold_to: vendor.name, buyer_gst: vendor.gst, buyer_pan: vendor.pan, sold_cft: "10" }, documents: ["cutting_invoice", "license", "permission", "buyer_gst", "buyer_pan"].map((type) => evidence(type)) });
const transport = () => ({ kind: "transport", workflow_version: 2, fields: { transporter_name: "Transport", truck_number: "RJ-001", driver_license_number: "DL-001", billty_number: "B1", ewaybill_number: "EW1" }, documents: ["weight_slip", "billty", "driver_license", "ewaybill"].map((type) => evidence(type)) });
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const setup = (t, stages) => {
  const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
  t.mock.method(Order, "find", () => query([{ _id: "o", vendor: { vendor_id: vendor._id }, item: { item_code: "I1" }, shipment: [{ _id: "s", container: "C1", quantity: 10 }] }]));
  t.mock.method(Sample, "find", () => query([]));
  t.mock.method(Item, "find", () => query([{ code: "I1", timber_cft: 1 }]));
  t.mock.method(Vendor, "find", () => query([vendor]));
  t.mock.method(EudrChain, "createIndexes", async () => {});
  t.mock.method(Party, "findOneAndUpdate", async () => ({}));
  const chain = new EudrChain({ container: "C1", container_key: "c1", vendor: vendor._id, declared_milli_cft: 10000, stages });
  t.mock.method(chain, "save", async () => chain);
  t.mock.method(EudrChain, "findById", async () => chain);
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
