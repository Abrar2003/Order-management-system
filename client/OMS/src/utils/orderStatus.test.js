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
