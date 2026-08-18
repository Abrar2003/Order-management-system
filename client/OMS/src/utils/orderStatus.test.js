import assert from "node:assert/strict";
import test from "node:test";
import { getOrderProgress } from "./orderStatus.js";

test("a legacy QC request date without an active request remains pending", () => {
  assert.equal(getOrderProgress({
    order: {
      quantity: 30,
      qc_record: {
        request_date: "2026-05-03",
        quantities: { quantity_requested: 0, qc_passed: 10 },
      },
    },
  }).status, "Pending");
});

test("a completed latest inspection takes priority over an older open request", () => {
  const order = {
    quantity: 30,
    qc_record: {
      quantities: { qc_passed: 10 },
      request_history: [
        { request_date: "2026-08-01", quantity_requested: 30, status: "open" },
        { request_date: "2026-08-05", quantity_requested: 30, status: "inspected" },
      ],
      inspection_record: [
        { inspection_date: "2026-08-01", status: "pending" },
        { inspection_date: "2026-08-05", status: "Inspection Done", checked: 15, passed: 10 },
      ],
    },
  };

  assert.equal(getOrderProgress({ order }).status, "Pending");
});

test("a pending latest inspection remains under inspection", () => {
  assert.equal(getOrderProgress({
    order: {
      quantity: 30,
      qc_record: {
        quantities: { qc_passed: 10 },
        inspection_record: [
          { inspection_date: "2026-08-05", status: "pending" },
        ],
      },
    },
  }).status, "Under Inspection");
});
