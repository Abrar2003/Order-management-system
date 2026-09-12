const assert = require("node:assert/strict");
const test = require("node:test");

const { __test__ } = require("../services/cacheInvalidation.service");

test("item changes invalidate cached PIS diff responses", () => {
  assert.deepEqual(
    __test__.ITEM_CACHE_PATTERNS.filter((pattern) => pattern.startsWith("pis-diff")),
    ["pis-diffs-v2:*", "pis-diff-reports-v2:*"],
  );
});
