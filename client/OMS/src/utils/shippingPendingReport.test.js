import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShippingPendingPoRows,
  getShippingPendingPoRowClass,
} from "./shippingPendingReport.js";

test("shipping pending PO rows group items and retain a partial-shipment status", () => {
  const rows = buildShippingPendingPoRows([
    { order_id: "PO-2", brand: "A", vendor: "V", status: "Inspection Done" },
    { order_id: "PO-2", brand: "A", vendor: "V", status: "Partial Shipped" },
    { order_id: "PO-1", brand: "A", vendor: "V", status: "Inspection Done" },
    { order_id: "PO-3", brand: "A", vendor: "V", status: "Partial Shipped" },
    { order_id: "PO-3", brand: "A", vendor: "V", status: "Pending" },
  ]);

  assert.deepEqual(rows.map((row) => [
    row.order_id,
    row.total_item_count,
    row.status,
  ]), [
    ["PO-1", 1, "Inspection Done"],
    ["PO-2", 2, "Partial Shipped"],
    ["PO-3", 2, "Pending"],
  ]);
});

test("shipping pending PO rows flag completely packed and overdue pending POs", () => {
  const rows = buildShippingPendingPoRows([
    {
      order_id: "PO-GREEN",
      etd: "2030-03-10",
      pending_quantity: 0,
      packed_quantity: 10,
    },
    {
      order_id: "PO-RED",
      etd: "2030-03-09",
      pending_quantity: 10,
      packed_quantity: 0,
      shipped_quantity: 0,
    },
  ], new Date("2030-03-10T12:00:00"));

  assert.deepEqual(rows.map((row) => [
    row.order_id,
    getShippingPendingPoRowClass(row),
  ]), [
    ["PO-GREEN", "om-report-success-row"],
    ["PO-RED", "om-report-danger-row"],
  ]);
});
