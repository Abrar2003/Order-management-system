const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: { buildJobId, sanitizeJobIdPart },
} = require("../queues");

test("queue job ids avoid BullMQ's reserved colon separator", () => {
  const jobId = buildJobId("qc-image", "inspection", "abc:def", "qc_images");

  assert.equal(jobId.includes(":"), false);
  assert.equal(jobId, "qc-image--inspection--abc-def--qc_images");
});

test("queue job id parts stay non-empty after sanitizing", () => {
  assert.equal(sanitizeJobIdPart(" : "), "unknown");
});
