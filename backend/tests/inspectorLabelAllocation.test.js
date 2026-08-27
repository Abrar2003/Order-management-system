const assert = require("node:assert/strict");
const test = require("node:test");

const inspectorController = require("../controllers/inspector.controller");
const labelStorageService = require("../services/labels/labelStorage.service");
const {
  __test__: { getAllocatedElsewhereDetails, getInspectorUserId },
} = inspectorController;

test("uses the inspector user id without stringifying a populated user object", () => {
  const userId = "66e5f2a0be4b1b8d4f841234";

  assert.equal(getInspectorUserId({ user: { _id: userId, name: "Ashwini" } }), userId);
  assert.equal(getInspectorUserId({ user: { name: "Ashwini" } }), "");
});

test("allocated-label conflicts identify the QC holding each label", () => {
  const result = getAllocatedElsewhereDetails(
    [1001, 1002, 1001],
    new Map([
      [1001, [{ inspector_id: "qc-ada", qc_name: "Ada" }]],
      [1002, [{ inspector_id: "qc-ben", qc_name: "Ben" }]],
    ]),
  );

  assert.equal(
    result.message,
    "Some labels are already allocated to another QC: 1001 (Ada); 1002 (Ben)",
  );
  assert.deepEqual(result.allocated_to, [
    { label: 1001, inspectors: [{ inspector_id: "qc-ada", qc_name: "Ada" }] },
    { label: 1002, inspectors: [{ inspector_id: "qc-ben", qc_name: "Ben" }] },
  ]);
});

test("label-usage summary preserves the existing response envelope", async () => {
  const expected = {
    inspector: "66e5f2a0be4b1b8d4f841234",
    total_allocated: 4,
    total_used: 2,
    total_unused: 2,
    total_rejected: 1,
    usage_percentage: "50.00",
  };
  const originalGetSummary = labelStorageService.getSummary;
  labelStorageService.getSummary = async () => expected;

  const response = { statusCode: 200, body: null };
  const res = {
    status(statusCode) {
      response.statusCode = statusCode;
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };

  try {
    await inspectorController.getLabelUsageStats(
      {
        params: { id: "66e5f2a0be4b1b8d4f841235" },
        query: { detail: "summary" },
      },
      res,
    );
  } finally {
    labelStorageService.getSummary = originalGetSummary;
  }

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { data: expected });
});
