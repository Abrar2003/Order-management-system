const assert = require("node:assert/strict");
const test = require("node:test");

const TimberInventoryBalance = require("../models/timberInventoryBalance.model");
const TimberInventoryLedger = require("../models/timberInventoryLedger.model");
const TimberContainerConsumption = require("../models/timberContainerConsumption.model");
const {
  buildBalanceTotals,
  consumptionGroupKey,
  normalizeContainerNumber,
  receiptCreditDeltas,
  shipmentRefKey,
} = require("../helpers/eudrInventory");

test("an approved receipt credits only its verified received quantity", () => {
  const deltas = receiptCreditDeltas({
    deliveryEntries: [{ _id: "receipt-1", received_cft_milli: 70000 }],
    ledgerEntries: [],
  });
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].deltaUnits, 70000);
});

test("a later receipt credits only the new stable receipt entry", () => {
  const deltas = receiptCreditDeltas({
    deliveryEntries: [
      { _id: "receipt-1", received_cft_milli: 70000 },
      { _id: "receipt-2", received_cft_milli: 30000 },
    ],
    ledgerEntries: [{ timber_receipt_id: "receipt-1", signed_delta_units: 70000 }],
  });
  assert.deepEqual(deltas.map((entry) => [entry.receiptId, entry.deltaUnits]), [["receipt-2", 30000]]);
});

test("replaying the same approved receipt produces no additional credit", () => {
  const deltas = receiptCreditDeltas({
    deliveryEntries: [{ _id: "receipt-1", received_cft_milli: 100000 }],
    ledgerEntries: [{ timber_receipt_id: "receipt-1", signed_delta_units: 100000 }],
  });
  assert.equal(deltas.length, 0);
});

test("draft consumption has no ledger effect and confirmed consumption reduces the exact balance", () => {
  const before = buildBalanceTotals([{ transaction_type: "RECEIPT_CREDIT", signed_delta_units: 100000 }]);
  const after = buildBalanceTotals([
    { transaction_type: "RECEIPT_CREDIT", signed_delta_units: 100000 },
    { transaction_type: "CONTAINER_DEBIT", signed_delta_units: -30000 },
  ]);
  assert.equal(before.available_units, 100000);
  assert.equal(after.available_units, 70000);
  assert.equal(after.consumed_units, 30000);
});

test("a container reversal restores the balance once without source attribution", () => {
  const totals = buildBalanceTotals([
    { transaction_type: "RECEIPT_CREDIT", signed_delta_units: 100000 },
    { transaction_type: "CONTAINER_DEBIT", signed_delta_units: -30000 },
    { transaction_type: "CONTAINER_REVERSAL", signed_delta_units: 30000 },
  ]);
  assert.equal(totals.available_units, 100000);
  assert.equal(totals.consumed_units, 0);
});

test("OMS shipment rows stay distinct even when the physical container number repeats", () => {
  assert.equal(normalizeContainerNumber(" abcd 1234567 "), "ABCD1234567");
  assert.notEqual(shipmentRefKey("order-1", "shipment-1"), shipmentRefKey("order-2", "shipment-1"));
  assert.notEqual(
    consumptionGroupKey("manufacturer-1", "ABCD1234567", "2026-01-01"),
    consumptionGroupKey("manufacturer-1", "ABCD1234567", "2026-01-02"),
  );
});

test("inventory collections enforce one balance, immutable event keys, and active shipment uniqueness", () => {
  assert.ok(TimberInventoryBalance.schema.indexes().some(([fields, options]) => fields.manufacturer_vendor_id === 1 && options.unique));
  assert.ok(TimberInventoryLedger.schema.indexes().some(([fields, options]) => fields.source_event_key === 1 && options.unique));
  assert.ok(TimberContainerConsumption.schema.indexes().some(([fields, options]) => fields.oms_shipment_ref_keys === 1 && options.unique));
  assert.ok(TimberContainerConsumption.schema.indexes().some(([fields, options]) => fields.active_shipment_group_key === 1 && options.unique));
});
