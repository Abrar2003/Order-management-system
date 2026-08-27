const assert = require("node:assert/strict");
const test = require("node:test");
const { isDeepStrictEqual } = require("node:util");
const mongoose = require("mongoose");

const Label = require("../models/label.model");
const LabelTransaction = require("../models/labelTransaction.model");
const LabelUsage = require("../models/labelUsage.model");
const LabelStorageState = require("../models/labelStorageState.model");
const LabelSyncFailure = require("../models/labelSyncFailure.model");
const LabelMigrationConflict = require("../models/labelMigrationConflict.model");

const objectId = () => new mongoose.Types.ObjectId();
const hasIndex = (model, fields, options = {}) =>
  model.schema.indexes().some(([indexFields, indexOptions]) =>
    isDeepStrictEqual(indexFields, fields) &&
    Object.entries(options).every(([key, value]) =>
      isDeepStrictEqual(indexOptions[key], value),
    ),
  );

test("Label keeps allocation, rejection, and usage independent", async () => {
  const inspector = objectId();
  const label = new Label({
    number: 0,
    owner_inspector: inspector,
    rejected_by_inspector: inspector,
    usage: { inspector },
  });
  await label.validate();
  await assert.rejects(new Label({ number: -1 }).validate(), /minimum allowed value/);

  assert.equal(hasIndex(Label, { number: 1 }, { unique: true }), true);
  assert.equal(
    hasIndex(Label, { owner_inspector: 1, number: 1 }),
    true,
  );
  assert.equal(hasIndex(Label, { "usage.inspector": 1, number: 1 }), true);
  assert.equal(
    hasIndex(Label, { rejected_by_inspector: 1, number: 1 }),
    true,
  );
  assert.equal(Label.schema.path("status"), undefined);
});

test("LabelTransaction preserves legacy actions and migration idempotency", async () => {
  const inspector = objectId();
  await new LabelTransaction({ inspector, action: "transfer_out" }).validate();
  await assert.rejects(
    new LabelTransaction({ inspector, action: "renumber" }).validate(),
    /not a valid enum value/,
  );

  const migrationIndex = LabelTransaction.schema.indexes().find(
    ([fields]) => fields["migration.legacy_history_id"] === 1,
  );
  assert.equal(migrationIndex?.[1]?.unique, true);
  assert.deepEqual(migrationIndex?.[1]?.partialFilterExpression, {
    "migration.legacy_inspector": { $type: "objectId" },
    "migration.legacy_history_id": { $type: "objectId" },
  });
  const keyIndex = LabelTransaction.schema.indexes().find(
    ([fields]) => fields["migration.legacy_key"] === 1,
  );
  assert.equal(keyIndex?.[1]?.unique, true);
});

test("LabelUsage is one document per Inspection and reuses embedded vendors", async () => {
  const vendorId = objectId();
  const usage = new LabelUsage({
    inspector: objectId(),
    inspection_record: objectId(),
    labels: [0, 12],
    qc_meta: {
      vendor: { name: "Vendor A", vendor_id: vendorId, country: "India" },
    },
  });

  await usage.validate();
  assert.equal(String(usage.qc_meta.vendor.vendor_id), String(vendorId));
  assert.equal(
    hasIndex(LabelUsage, { inspection_record: 1 }, { unique: true }),
    true,
  );
});

test("LabelStorageState defaults safely without enabling modern storage", async () => {
  const state = new LabelStorageState({ inspector: objectId() });
  await state.validate();

  assert.equal(state.migration_status, "legacy");
  assert.equal(state.schema_version, 2);
  assert.equal(state.read_source, "legacy");
  assert.equal(state.write_mode, "legacy");
  assert.equal(state.legacy_fallback_enabled, true);
  assert.equal(
    hasIndex(LabelStorageState, { inspector: 1 }, { unique: true }),
    true,
  );
});

test("LabelMigrationConflict has deterministic lookup and investigation indexes", async () => {
  const conflict = new LabelMigrationConflict({
    fingerprint: "fixture-conflict",
    inspector: objectId(),
    label_number: 42,
    conflict_type: "allocated_multiple_inspectors",
    severity: "error",
  });
  await conflict.validate();

  assert.equal(conflict.status, "open");
  assert.equal(
    hasIndex(LabelMigrationConflict, { fingerprint: 1 }, { unique: true }),
    true,
  );
  assert.equal(
    hasIndex(LabelMigrationConflict, {
      inspector: 1,
      status: 1,
      conflict_type: 1,
    }),
    true,
  );
});

test("LabelSyncFailure defaults to an unresolved first attempt", async () => {
  const failure = new LabelSyncFailure({
    inspector: objectId(),
    operation: "allocate",
    error: { message: "mirror failed" },
  });
  await failure.validate();

  assert.equal(failure.attempts, 1);
  assert.equal(failure.resolved, false);
  assert.equal(hasIndex(LabelSyncFailure, { resolved: 1, createdAt: 1 }), true);
});
