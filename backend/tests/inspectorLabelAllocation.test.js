const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { getAllocatedElsewhereDetails },
} = require("../controllers/inspector.controller");

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
