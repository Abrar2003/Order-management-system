const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  parseTimberCft, shipmentMilliCft, financialYear, invoiceKey,
} = require("../helpers/timberCft");
const {
  loadContainer, receiverMatches, nextStageKind, externalInvalidation, assertStageAvailable, assertFinalCft, validateStage, collectInvoiceKeys,
} = require("../services/eudrChain.service");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Vendor = require("../models/vendor.model");
const Item = require("../models/item.model");
const { getShipmentTimberCft } = require("../controllers/order.controller");
const EudrChain = require("../models/eudrChain.model");
const eudrController = require("../controllers/eudrChain.controller");
const storage = require("../services/wasabiStorage.service");

test("invoice and container/vendor uniqueness are enforced by database indexes", () => {
  const indexes = EudrChain.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.invoice_keys === 1 && options.unique));
  assert.ok(indexes.some(([fields, options]) => fields.container_key === 1 && fields.vendor === 1 && options.unique));
  assert.equal(EudrChain.schema.options.optimisticConcurrency, true);
});

test("chain uploads reject duplicate filenames and content, including renamed and superseded files", async (t) => {
  const vendorId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const chainId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
  t.mock.method(Order, "find", () => query([{ _id: "o1", vendor: { vendor_id: vendorId }, item: { item_code: "I1" }, shipment: [{ _id: "s1", container: "C1", quantity: 1 }] }]));
  t.mock.method(Sample, "find", () => query([]));
  t.mock.method(Vendor, "find", () => query([{ _id: vendorId, name: "Vendor", gst: "GST", pan: "PAN" }]));
  t.mock.method(Item, "find", () => query([{ code: "I1", timber_cft: 1 }]));
  const original = Buffer.from("same file bytes");
  const originalHash = crypto.createHash("sha256").update(original).digest("hex");
  const chain = {
    _id: chainId, container: "C1", vendor: vendorId, stages: [{ _id: "stage1", kind: "sawmill", documents: [{ type: "license", key: "old", name: "original.pdf", size: original.length, sha256: originalHash }] }], history: [],
    isModified: () => false, save: async () => {}, toObject: () => ({}),
  };
  t.mock.method(EudrChain, "findById", async () => chain);
  let uploads = 0;
  let downloads = 0;
  let deleted = 0;
  let conflict = false;
  t.mock.method(storage, "createStorageKey", () => "new");
  t.mock.method(storage, "uploadBuffer", async () => { uploads += 1; });
  t.mock.method(storage, "getObjectBuffer", async () => { downloads += 1; return { buffer: original }; });
  t.mock.method(storage, "deleteObject", async () => { deleted += 1; });
  chain.save = async () => { if (conflict) throw Object.assign(new Error("stale"), { name: "VersionError" }); };
  const request = (buffer, name = "renamed.pdf") => ({ params: { id: chainId, stageId: "stage1" }, body: { type: "permission" }, file: { buffer, originalname: name, mimetype: "application/pdf", size: buffer.length }, user: {} });
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

  const current = response();
  await eudrController.upload(request(original), current);
  assert.equal(current.code, 409);
  assert.match(current.body.message, /already uploaded/);
  assert.equal(uploads, 0);
  assert.equal(downloads, 0);

  delete chain.stages[0].documents[0].sha256;
  const legacy = response();
  await eudrController.upload(request(original), legacy);
  assert.equal(legacy.code, 409);
  assert.equal(downloads, 1);
  assert.equal(uploads, 0);

  chain.history = [{ event: "later_stages_superseded", detail: { stages: [{ documents: [{ key: "old", name: "original.pdf", size: original.length, sha256: originalHash }] }] } }];
  chain.stages[0].documents = [];
  const historical = response();
  await eudrController.upload(request(original), historical);
  assert.equal(historical.code, 409);
  assert.equal(uploads, 0);
  const historicalName = response();
  await eudrController.upload(request(Buffer.from("different bytes"), "ORIGINAL.PDF"), historicalName);
  assert.equal(historicalName.code, 409);
  assert.match(historicalName.body.message, /named ORIGINAL\.PDF/);
  assert.equal(uploads, 0);

  chain.history = [{ event: "document_uploaded", detail: { replaced: { key: "old", name: "original.pdf", size: original.length, sha256: originalHash } } }];
  const replaced = response();
  await eudrController.upload(request(original), replaced);
  assert.equal(replaced.code, 409);
  assert.equal(uploads, 0);

  chain.history = [];
  chain.stages[0].documents = [{ type: "license", key: "old", name: "original.pdf", size: original.length, sha256: originalHash }];
  const different = Buffer.from("different bytes");
  const sameName = response();
  await eudrController.upload(request(different, "ORIGINAL.PDF"), sameName);
  assert.equal(sameName.code, 409);
  assert.match(sameName.body.message, /named ORIGINAL\.PDF/);
  assert.equal(uploads, 0);
  assert.equal(downloads, 1);

  const accepted = response();
  await eudrController.upload(request(different, "different.pdf"), accepted);
  assert.ok(accepted.body.data);
  assert.equal(uploads, 1);
  assert.equal(chain.stages[0].documents.find((document) => document.type === "permission").sha256, crypto.createHash("sha256").update(different).digest("hex"));

  chain.stages[0].documents = [];
  conflict = true;
  const stale = response();
  await eudrController.upload(request(different), stale);
  assert.equal(stale.code, 409);
  assert.equal(deleted, 1);
});

test("three-decimal timber CFT is optional and rounded per shipment line", () => {
  assert.equal(parseTimberCft(""), null);
  assert.equal(parseTimberCft("1.234"), 1.234);
  assert.throws(() => parseTimberCft("1.2345"), /three decimals/);
  assert.equal(shipmentMilliCft(1.234, 3), 3702);
  assert.equal(shipmentMilliCft(0.333, 0.5), 167);
});

test("invoice keys use issuer GST and the invoice's April-March financial year", () => {
  assert.equal(financialYear("2026-03-31"), 2025);
  assert.equal(financialYear("2026-04-01"), 2026);
  assert.equal(invoiceKey({ issuer_gst: "22-abc", invoice_number: " Inv-1 ", invoice_date: "2026-04-01" }), "22ABC|2026|INV1");
  assert.notEqual(invoiceKey({ issuer_gst: "22-abc", invoice_number: "Inv-1", invoice_date: "2026-03-31" }), invoiceKey({ issuer_gst: "22-abc", invoice_number: "Inv-1", invoice_date: "2026-04-01" }));
  assert.notEqual(invoiceKey({ issuer_gst: "22-abc", invoice_number: "Inv-1", invoice_date: "2026-04-01" }), invoiceKey({ issuer_gst: "33-abc", invoice_number: "Inv-1", invoice_date: "2026-04-01" }));
  assert.throws(() => financialYear("2026-02-30"), /valid invoice date/);
  assert.throws(() => collectInvoiceKeys([
    { kind: "sawmill", fields: { gst: "22abc", invoice_number: "Inv-1", invoice_date: "2026-04-01" } },
    { kind: "receiver", fields: { issuer_gst: "22abc", invoice_number: "INV1", invoice_date: "2026-05-01" } },
  ]), /already used/);
  assert.deepEqual(collectInvoiceKeys([{ kind: "sawmill", fields: { invoice_number: "Inv-2", invoice_date: "2026-05-01" } }]), []);
});

test("a receiver ends the chain only when both GST and PAN match", () => {
  const vendor = { gst: "22 ABC", pan: "ABCDE1234F" };
  assert.equal(receiverMatches({ gst: "22-abc", pan: "abcde1234f" }, vendor), true);
  assert.equal(receiverMatches({ gst: "22-abc", pan: "other" }, vendor), false);
  assert.equal(nextStageKind({ kind: "receiver", fields: { gst: "22-abc", pan: "other" } }, vendor), "transport");
  assert.equal(nextStageKind({ kind: "receiver", fields: { gst: "22-abc", pan: "ABCDE1234F" } }, vendor), "declaration");
});

test("transport requires all evidence and conditional truck registration", () => {
  const stage = {
    kind: "transport",
    fields: { transporter_name: "T", truck_number: "T1", driver_license_number: "D1", ewaybill_number: "E1", billty_number: "B1", truck_registration_number: "R1" },
    documents: ["weight_slip", "billty", "driver_license", "ewaybill"].map((type) => ({ type })),
  };
  assert.throws(() => validateStage(stage), /Truck registration document/);
  delete stage.fields.truck_registration_number;
  assert.doesNotThrow(() => validateStage(stage));
  stage.fields.truck_registration_number = "R1";
  stage.documents.push({ type: "truck_registration" });
  assert.doesNotThrow(() => validateStage(stage));
});

test("sawmill verification requires permission evidence as well as invoice and license", () => {
  const stage = {
    kind: "sawmill",
    fields: { name: "Mill", gst: "GST", pan: "PAN", permission_number: "P-1", invoice_number: "I-1", invoice_date: "2026-05-01" },
    documents: ["cutting_invoice", "license"].map((type) => ({ type })),
  };
  assert.throws(() => validateStage(stage), /permission document is required/);
  stage.documents.push({ type: "permission" });
  assert.doesNotThrow(() => validateStage(stage));
});

test("shipment and vendor edits invalidate the appropriate verified stages", () => {
  const stages = [
    { kind: "sawmill", verified_at: new Date() },
    { kind: "transport", verified_at: new Date() },
    { kind: "receiver", verified_at: new Date(), vendor_signature: "old-vendor" },
    { kind: "declaration", verified_at: new Date(), shipment_signature: "old-shipment" },
  ];
  assert.deepEqual(externalInvalidation(stages, { vendor_signature: "old-vendor", shipment_signature: "new-shipment" }), { index: 3, reason: "Stuffed shipment or Timber_CFT changed" });
  assert.deepEqual(externalInvalidation(stages, { vendor_signature: "new-vendor", shipment_signature: "old-shipment" }), { index: 2, reason: "Vendor GST/PAN changed" });
});

test("verification cannot skip a stage or complete with mismatched CFT", () => {
  const stages = [{ verified_at: null }, { verified_at: null }];
  assert.throws(() => assertStageAvailable(stages, 1), /preceding stage/);
  stages[0].verified_at = new Date();
  assert.doesNotThrow(() => assertStageAvailable(stages, 1));
  assert.throws(() => assertFinalCft({ declared_milli_cft: 1000 }, { stuffed_milli_cft: 999, stuffed_cft: 0.999 }, []), /does not match/);
  assert.throws(() => assertFinalCft({ declared_milli_cft: 1000 }, { stuffed_milli_cft: 1000, stuffed_cft: 1 }, [{}]), /Unassigned shipments/);
  assert.doesNotThrow(() => assertFinalCft({ declared_milli_cft: 1000 }, { stuffed_milli_cft: 1000, stuffed_cft: 1 }, []));
});

test("a chain cannot start or change its declaration unless CFT matches the shipment", async (t) => {
  const vendorId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const chainId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
  t.mock.method(Order, "find", () => query([{ _id: "o1", vendor: { vendor_id: vendorId }, item: { item_code: "I1" }, shipment: [{ _id: "s1", container: "C1", quantity: 2 }] }]));
  t.mock.method(Sample, "find", () => query([]));
  t.mock.method(Vendor, "find", () => query([{ _id: vendorId, name: "Vendor", gst: "GST", pan: "PAN" }]));
  t.mock.method(Item, "find", () => query([{ code: "I1", timber_cft: 1.25 }]));
  t.mock.method(EudrChain, "createIndexes", async () => {});
  let created = 0;
  t.mock.method(EudrChain, "create", async () => { created += 1; return { _id: chainId, stages: [{ _id: "stage1", kind: "sawmill" }], toObject: () => ({ _id: chainId }) }; });
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

  for (const [declared, direction] of [[2, "below"], [3, "above"]]) {
    const res = response();
    await eudrController.create({ body: { container: "C1", vendor_id: vendorId, declared_cft: declared }, user: {} }, res);
    assert.equal(res.code, 409);
    assert.match(res.body.message, new RegExp(direction));
  }
  assert.equal(created, 0);

  const accepted = response();
  await eudrController.create({ body: { container: "C1", vendor_id: vendorId, declared_cft: 2.5 }, user: {} }, accepted);
  assert.equal(accepted.code, 201);
  assert.equal(created, 1);

  const existing = { container: "C1", vendor: vendorId, declared_milli_cft: 2500, stages: [], history: [], isModified: () => false, save: async () => {}, toObject: () => ({}) };
  t.mock.method(EudrChain, "findById", async () => existing);
  const changed = response();
  await eudrController.updateDeclared({ params: { id: chainId }, body: { declared_cft: 2 }, user: {} }, changed);
  assert.equal(changed.code, 409);
  assert.equal(existing.declared_milli_cft, 2500);

  existing.declared_milli_cft = 2000;
  existing.stages = [{ _id: "stage1", kind: "sawmill", verified_at: null }];
  const verify = response();
  await eudrController.verify({ params: { id: chainId, stageId: "stage1" }, user: {} }, verify);
  assert.equal(verify.code, 409);
  assert.match(verify.body.message, /does not match stuffed CFT/);
  assert.equal(existing.stages[0].verified_at, null);

  const corrected = response();
  await eudrController.updateDeclared({ params: { id: chainId }, body: { declared_cft: 2.5 }, user: {} }, corrected);
  assert.ok(corrected.body.data);
  assert.equal(existing.declared_milli_cft, 2500);
});

test("mixed-vendor containers include samples and expose excluded and unassigned lines", async () => {
  const original = [Order.find, Sample.find, Vendor.find, Item.find];
  const a = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const b = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
  try {
    Order.find = () => query([
      { _id: "o1", vendor: { vendor_id: a }, item: { item_code: "I1" }, shipment: [{ _id: "s1", container: "C-1", quantity: 2 }] },
      { _id: "o2", vendor: { vendor_id: b }, item: { item_code: "I2" }, shipment: [{ _id: "s2", container: "C-1", quantity: 4 }] },
    ]);
    Sample.find = () => query([
      { _id: "p1", code: "P1", vendor: [{ vendor_id: a }], timber_cft: 0.5, shipment: [{ _id: "s3", container: "C-1", quantity: 1 }] },
      { _id: "p2", code: "P2", vendor: [{ vendor_id: a }, { vendor_id: b }], timber_cft: 0.5, shipment: [{ _id: "s4", container: "C-1", quantity: 1 }] },
    ]);
    Vendor.find = () => query([{ _id: a, name: "A", gst: "GST-A", pan: "PAN-A" }, { _id: b, name: "B", gst: "GST-B", pan: "PAN-B" }]);
    Item.find = () => query([{ code: "I1", timber_cft: 1.25 }, { code: "I2", timber_cft: null }]);
    const result = await loadContainer("C-1");
    assert.equal(result.vendors.find((entry) => entry.vendor._id === a).stuffed_cft, 3);
    assert.equal(result.vendors.find((entry) => entry.vendor._id === b).excluded.length, 1);
    assert.equal(result.unassigned.length, 1);
  } finally {
    [Order.find, Sample.find, Vendor.find, Item.find] = original;
  }
});

test("single-shipment stuffing preview reads an item's Timber_CFT", async () => {
  const original = Item.findOne;
  try {
    Item.findOne = () => ({ select: () => ({ lean: async () => ({ timber_cft: 1.125 }) }) });
    let payload;
    await getShipmentTimberCft({ params: { itemCode: "I1" } }, { json: (value) => { payload = value; } });
    assert.deepEqual(payload, { timber_cft: 1.125 });
  } finally { Item.findOne = original; }
});
