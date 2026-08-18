const assert = require("node:assert/strict");
const test = require("node:test");

const { deriveOrderProgress } = require("../helpers/orderStatus");

test("a completed latest inspection takes priority over an older open request", () => {
  const progress = deriveOrderProgress({
    orderEntry: {
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
    },
  });

  assert.equal(progress.status, "Pending");
});

test("a pending latest inspection remains under inspection", () => {
  const progress = deriveOrderProgress({
    orderEntry: {
      quantity: 30,
      qc_record: {
        quantities: { qc_passed: 10 },
        inspection_record: [
          { inspection_date: "2026-08-05", status: "pending" },
        ],
      },
    },
  });

  assert.equal(progress.status, "Under Inspection");
});
