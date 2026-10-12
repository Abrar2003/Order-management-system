const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: {
    LEGACY_KEY_INDEX,
    LEGACY_KEY_INDEX_NAME,
    LEGACY_KEY_INDEX_OPTIONS,
    repairLegacyKeyIndex,
  },
} = require("../scripts/repairLabelTransactionLegacyKeyIndex");

test("repairs the legacy-key index without touching label transactions", async () => {
  const calls = [];
  const collection = {
    async indexes() {
      return [{
        name: LEGACY_KEY_INDEX_NAME,
        key: LEGACY_KEY_INDEX,
        unique: true,
        partialFilterExpression: {
          "migration.legacy_inspector": { $type: "objectId" },
          "migration.legacy_key": { $type: "string" },
        },
      }];
    },
    async dropIndex(name) {
      calls.push(["drop", name]);
    },
    async createIndex(key, options) {
      calls.push(["create", key, options]);
    },
  };

  assert.equal(await repairLegacyKeyIndex(collection), true);
  assert.deepEqual(calls, [
    ["drop", LEGACY_KEY_INDEX_NAME],
    ["create", LEGACY_KEY_INDEX, LEGACY_KEY_INDEX_OPTIONS],
  ]);
});

test("leaves the corrected legacy-key index alone", async () => {
  const collection = {
    async indexes() {
      return [{
        name: LEGACY_KEY_INDEX_NAME,
        key: LEGACY_KEY_INDEX,
        unique: true,
        partialFilterExpression: LEGACY_KEY_INDEX_OPTIONS.partialFilterExpression,
      }];
    },
    async dropIndex() {
      assert.fail("should not drop the current index");
    },
    async createIndex() {
      assert.fail("should not recreate the current index");
    },
  };

  assert.equal(await repairLegacyKeyIndex(collection), false);
});
