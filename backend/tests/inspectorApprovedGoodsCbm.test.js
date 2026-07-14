const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { buildApprovedGoodsQuantityByInspectionId },
} = require("../controllers/qc.controller");

test("approved goods are counted once and assigned to the latest passing inspection", () => {
  const aqlQc = {
    _id: "qc-aql",
    request_type: "AQL",
    quantities: { quantity_requested: 100 },
    request_history: [
      {
        _id: "request-aql",
        request_type: "AQL",
        quantity_requested: 100,
      },
    ],
  };
  const fullQc = {
    _id: "qc-full",
    request_type: "FULL",
    quantities: { quantity_requested: 50 },
    request_history: [
      {
        _id: "request-full",
        request_type: "FULL",
        quantity_requested: 50,
      },
    ],
  };

  const approved = buildApprovedGoodsQuantityByInspectionId([
    {
      _id: "aql-first",
      qc: aqlQc,
      request_history_id: "request-aql",
      inspection_date: "2026-01-01",
      vendor_requested: 100,
      passed: 2,
    },
    {
      _id: "aql-latest",
      qc: aqlQc,
      request_history_id: "request-aql",
      inspection_date: "2026-01-02",
      vendor_requested: 100,
      passed: 3,
    },
    {
      _id: "full-first",
      qc: fullQc,
      request_history_id: "request-full",
      inspection_date: "2026-01-01",
      passed: 4,
    },
    {
      _id: "full-latest",
      qc: fullQc,
      request_history_id: "request-full",
      inspection_date: "2026-01-03",
      passed: 6,
    },
    {
      _id: "transferred",
      qc: fullQc,
      request_history_id: "request-full",
      inspection_date: "2026-01-04",
      status: "transfered",
      passed: 20,
    },
  ]);

  assert.deepEqual(Object.fromEntries(approved), {
    "aql-latest": 100,
    "full-latest": 10,
  });
});
