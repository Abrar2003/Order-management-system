const assert = require("node:assert/strict");
const test = require("node:test");
const QcFormDraft = require("../models/qcFormDraft.model");

test("QC drafts expire independently and are unique per editing context", () => {
  const indexes = QcFormDraft.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.qc === 1
    && keys.user === 1
    && keys.mode === 1
    && keys.record_id === 1
    && options.unique === true,
  ));
  assert.ok(indexes.some(([keys, options]) =>
    keys.expires_at === 1 && options.expireAfterSeconds === 0,
  ));
});
