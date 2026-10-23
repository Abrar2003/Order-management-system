const test = require("node:test");
const assert = require("node:assert/strict");
const Order = require("../models/order.model");
const Sample = require("../models/sample.model");
const Item = require("../models/item.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const Species = require("../models/woodSpecies.model");
const OrderEditLog = require("../models/orderEditLog.model");
const { finalizeOrder } = require("../controllers/order.controller");
const { finalizeSampleShipment } = require("../controllers/sample.controller");
const { eudrNeeded, applyShipmentWoodMetadata } = require("../helpers/shipmentEudr");

const id = "507f1f77bcf86cd799439011";
const species = "507f1f77bcf86cd799439012";
const user = { _id: id, role: "admin", name: "Shipping Admin" };
const shipping = { container: "MSCU-123456-7", stuffing_date: "2026-10-23", quantity: 1,
  stuffed_by: { id: "shipped_by_vendor", name: "Shipped By Vendor" } };
const metadata = { finished_wood_volume: { value: "0.5", unit: "cft" }, hs_code: "9403 60",
  species_composition: [{ species, share_bp: 10000 }] };
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const query = value => ({ select() { return this; }, lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

test("EUDR checkbox is strict and unchecked shipping leaves item metadata untouched", async () => {
  assert.equal(eudrNeeded(undefined), false);
  for (const input of ["false", "true", null, 1]) assert.throws(() => eudrNeeded(input));
  const record = { timber_cft: 2 };
  await applyShipmentWoodMetadata(record, { eudr_needed: false, timber_cft: "bad" }, user);
  assert.deepEqual(record, { timber_cft: 2 });
});

test("EUDR validates all item fields and retains the existing canonical volume and species rules", async t => {
  t.mock.method(Species, "countDocuments", async () => 1);
  for (const missing of [{ finished_wood_volume: { value: "", unit: "cft" } },
    { finished_wood_volume: { value: "0", unit: "cft" } }, { hs_code: "" }, { hs_code: "bad" },
    { species_composition: [] }, { species_composition: [{ species, share_bp: 9999 }] }]) {
    await assert.rejects(applyShipmentWoodMetadata({}, { ...metadata, ...missing, eudr_needed: true }, user), { statusCode: 400 });
  }
  const record = {};
  await applyShipmentWoodMetadata(record, { ...metadata, eudr_needed: true, timber_cft_history: [{ to: 99 }] }, user);
  assert.equal(record.timber_cft, 0.5);
  assert.equal(record.hs_code, "940360");
  assert.equal(record.timber_cft_history.length, 1);
  assert.equal(record.timber_cft_history[0].to, 0.5);
  t.mock.method(Species, "countDocuments", async () => 0);
  await assert.rejects(applyShipmentWoodMetadata({}, { ...metadata, eudr_needed: true }, user), /active recorded wood species/);
});

test("order shipping rejects incomplete EUDR details, saves valid item fields and checkbox, and permits unchecked shipping", async t => {
  const order = new Order({ _id: id, order_id: "PO-EUDR", item: { item_code: "TABLE" }, quantity: 10, status: "Inspection Done" });
  const item = new Item({ code: "TABLE", barcode_exempted: true });
  t.mock.method(Order, "findOne", async () => order);
  t.mock.method(QC, "findOne", () => query({ _id: id, quantities: { qc_passed: 10 } }));
  t.mock.method(Inspection, "find", () => query([]));
  t.mock.method(Item, "findOne", () => query(item));
  t.mock.method(Species, "countDocuments", async () => 1);
  t.mock.method(OrderEditLog, "create", async () => {});
  const itemSave = t.mock.method(item, "save", async () => item);
  const orderSave = t.mock.method(order, "save", async () => order);
  const req = body => ({ params: { id }, user, body: { ...shipping, ...body } });
  let res = response();
  await finalizeOrder(req({ eudr_needed: true }), res);
  assert.equal(res.code, 400);
  assert.match(res.body.message, /CFT.*wood type.*HSN/);
  assert.equal(orderSave.mock.calls.length, 0);
  assert.equal(itemSave.mock.calls.length, 0);
  res = response();
  await finalizeOrder(req({ eudr_needed: true, ...metadata }), res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(order.shipment[0].eudr_needed, true);
  assert.equal(item.hs_code, "940360");
  assert.equal(item.timber_cft, 0.5);
  assert.equal(item.update_history.at(-1).actor.name, user.name);
  res = response();
  await finalizeOrder(req({ eudr_needed: false }), res);
  assert.equal(res.code, 200);
  assert.equal(order.shipment[1].eudr_needed, false);
  assert.equal(itemSave.mock.calls.length, 1);
});

test("sample shipping validates and saves EUDR details on the same sample", async t => {
  const sample = new Sample({ _id: id, code: "SAMPLE-EUDR" });
  t.mock.method(Sample, "findOne", async () => sample);
  t.mock.method(Species, "countDocuments", async () => 1);
  const save = t.mock.method(sample, "save", async () => sample);
  let res = response();
  await finalizeSampleShipment({ params: { id }, user, body: { ...shipping, eudr_needed: true } }, res);
  assert.equal(res.code, 400);
  assert.equal(save.mock.calls.length, 0);
  res = response();
  await finalizeSampleShipment({ params: { id }, user, body: { ...shipping, eudr_needed: true, ...metadata } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(sample.shipment[0].eudr_needed, true);
  assert.equal(sample.timber_cft, 0.5);
  assert.equal(sample.hs_code, "940360");
  assert.equal(String(sample.species_composition[0].species), species);
});
