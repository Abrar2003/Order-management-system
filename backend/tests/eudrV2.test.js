const test = require("node:test");
const assert = require("node:assert/strict");
const { volumeInput } = require("../helpers/woodVolume");
const { composition } = require("../helpers/timberSpecies");
const S = require("../integrations/eudrV2.source");
const A = require("../integrations/eudrV2.auth");
const oid = n => String(n).padStart(24, "0");

test("finished volume uses exact conversion and rounds only at six canonical CFT decimals", () => {
  assert.equal(volumeInput({ value: "0.014158423296", unit: "m3" }).cft, 0.5);
  assert.equal(volumeInput({ value: "1", unit: "m3" }).cft, 35.314667);
  assert.equal(volumeInput({ value: "0.123456", unit: "cft" }).cft, 0.123456);
  assert.equal(volumeInput({ value: "", unit: "cft" }).cft, null);
  assert.equal(volumeInput({ value: "0", unit: "m3" }).cft, 0);
  const { shipmentMilliCft, parseTimberCft } = require("../helpers/timberCft");
  assert.equal(parseTimberCft("0.123456"), 0.123456);
  assert.equal(shipmentMilliCft(0.0005, 100), 50);
  for (const input of [{ value: "-1", unit: "cft" }, { value: "1.0000001", unit: "cft" }, { value: "NaN", unit: "m3" }, { value: "1", unit: "kg" }, { value: "9999999999999999", unit: "cft" }]) assert.throws(() => volumeInput(input), { code: "WOOD_VOLUME_INVALID" });
});
test("composition stores exact basis points and allows explicit non-wood products", () => {
  assert.deepEqual(composition([]), []);
  assert.equal(composition([{ species: oid(1), share_bp: 6000 }, { species: oid(2), share_bp: 4000 }]).length, 2);
  for (const rows of [[{ species: oid(1), share_bp: 9999 }], [{ species: oid(1), share_bp: 5000 }, { species: oid(1), share_bp: 5000 }], [{ species: oid(1), share_bp: 10000.1 }]]) assert.throws(() => composition(rows));
});
test("snapshots retain exporters, invoices and split identities; deduplicate only identical contributions", () => {
  const user = { allowed_brands: [], allowed_vendors: ["all"], brand_scope: "all" };
  const vendor = { _id: oid(1), name: "Manufacturer", gst: "GST", pan: "PAN" };
  const item = { _id: oid(2), code: "96517", description: "Chair", timber_cft: 0.5, hs_code: "940360", species_composition: [{ species: oid(3), share_bp: 10000 }] };
  const row = { source: "order", sourceId: oid(4), brand: "Giga", vendor: { vendor_id: vendor._id, name: vendor.name }, itemCode: item.code,
    shipment: { _id: oid(5), container: "CONT-1", invoice_number: "INV-1", stuffing_date: new Date("2026-10-20"), quantity: 100 } };
  const build = rows => S.normalizeSnapshot(S.key("CONT-1"), "CONT-1", rows, [vendor], [item], user);
  const base = build([row]);
  assert.equal(base.groups[0].items[0].quantity, 100);
  assert.equal(base.groups[0].items[0].finishedCftPerUnit, "0.500000");
  assert.equal(base.groups[0].vendor.gstin, "GST");
  assert.equal(base.hash, build([row, row]).hash);
  const second = { ...row, shipment: { ...row.shipment, _id: oid(6), invoice_number: "INV-2", quantity: 25 } };
  assert.equal(build([second, row]).hash, build([row, second]).hash);
  assert.equal(build([row, second]).groups.length, 2);
  assert.notEqual(base.hash, build([{ ...row, shipment: { ...row.shipment, quantity: 101 } }]).hash);
  item.species_composition = [{ species: oid(7), share_bp: 10000 }];
  assert.notEqual(base.hash, build([row]).hash);
  assert.equal(base.groups[0].items[0].shipmentKey, build([row]).groups[0].items[0].shipmentKey);
  assert.throws(() => build([row, { ...row, shipment: { ...row.shipment, quantity: 2 } }]), { code: "SOURCE_SHIPMENT_CONFLICT" });
  assert.throws(() => build([{ ...row, shipment: { ...row.shipment, quantity: 0.5 } }]), { code: "SOURCE_QUANTITY_INVALID" });
  assert.throws(() => build([{ ...row, vendor: [vendor, { _id: oid(99), name: "Missing" }] }]), { code: "SOURCE_VENDOR_UNRESOLVED" });
  assert.equal(S.numberFromKey(S.key("cont-1")), "CONT-1");
  assert.throws(() => S.numberFromKey("../orders"));
});
test("scope contexts are bound to an account and cannot be edited", t => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = "isolated-scope-test-secret";
  t.after(() => previous === undefined ? delete process.env.JWT_SECRET : process.env.JWT_SECRET = previous);
  const token = A.scopeToken(oid(1), "giga");
  assert.equal(A.readScope(token, oid(1)), "giga");
  assert.throws(() => A.readScope(token, oid(2)), { code: "SCOPE_INVALID" });
  assert.throws(() => A.readScope(token + "x", oid(1)), { code: "SCOPE_INVALID" });
});
