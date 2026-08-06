const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { buildTaskListMatch, hasTaskListNarrowingFilter },
} = require("../services/workflow/workflowStatusService");

test("task source filters keep batch and individual taskboard views separate", () => {
  const user = { role: "admin" };
  const batchMatch = buildTaskListMatch({ query: { source: "batch" }, user }).match;
  const individualMatch = buildTaskListMatch({ query: { source: "individual" }, user }).match;

  assert.deepEqual(batchMatch.batch, { $ne: null });
  assert.equal(individualMatch.batch, null);
  assert.equal(hasTaskListNarrowingFilter({ source: "batch" }), true);
});
