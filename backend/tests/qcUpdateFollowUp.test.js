const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEASE_MS,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  retryDelayForAttempt,
} = require("../services/qcUpdateFollowUp.service");

test("QC update follow-ups retry five times across the configured hour", () => {
  assert.ok(LEASE_MS > 0);
  assert.equal(MAX_ATTEMPTS, 5);
  assert.deepEqual(RETRY_DELAYS_MS, [60_000, 300_000, 900_000, 1_800_000]);
  assert.equal(retryDelayForAttempt(1), 60_000);
  assert.equal(retryDelayForAttempt(4), 1_800_000);
  assert.equal(retryDelayForAttempt(5), 1_800_000);
});
