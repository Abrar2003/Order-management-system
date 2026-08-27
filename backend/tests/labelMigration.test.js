const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const {
  MIGRATION_SOURCE,
  buildMigrationAnalysis,
} = require("../scripts/migrateLabels");
const {
  buildSummary,
  buildVerificationReport,
} = require("../scripts/verifyLabelMigration");

const objectId = () => new mongoose.Types.ObjectId();
const fixedDate = new Date("2026-01-02T03:04:05.000Z");

const makeInspection = ({
  user,
  labels = [],
  status = "Inspection Done",
  inspectionId = objectId(),
  qcId = objectId(),
} = {}) => ({
  _id: inspectionId,
  inspector: user,
  labels_added: labels,
  status,
  inspection_date: "2026-01-02",
  request_history_id: objectId(),
  createdAt: fixedDate,
  updatedAt: fixedDate,
  qc: {
    _id: qcId,
    order_meta: {
      order_id: "PO-1",
      brand: "Brand A",
      vendor: {
        name: "Vendor A",
        vendor_id: objectId(),
        country: "India",
      },
    },
    item: { item_code: "ITEM-1", description: "Fixture item" },
  },
});

const makeSnapshot = ({
  inspectorId = objectId(),
  userId = objectId(),
  allocated = [],
  derivedUsed,
  rejected = [],
  inspections,
  histories = [],
  globalInspectors,
  globalInspections,
  existingLabels = [],
  existingTransactions = [],
  existingUsages = [],
  storageState = null,
} = {}) => {
  const inspectionRows = inspections || [];
  const forensicUsed = [
    ...new Set(inspectionRows.flatMap((entry) => entry.labels_added || [])),
  ];
  const inspector = {
    _id: inspectorId,
    user: userId,
    alloted_labels: allocated,
    used_labels: derivedUsed ?? forensicUsed,
    rejected_labels: rejected,
    label_allocation_history: histories,
    label_used_history: inspectionRows
      .filter((entry) => (entry.labels_added || []).length > 0)
      .map((entry) => ({
        _id: objectId(),
        inspection_record: entry._id,
        labels: entry.labels_added,
      })),
    updatedAt: fixedDate,
  };
  return {
    inspector,
    inspections: inspectionRows,
    globalInspectors: globalInspectors || [
      {
        _id: inspectorId,
        user: userId,
        alloted_labels: allocated,
        rejected_labels: rejected,
      },
    ],
    globalInspections: globalInspections || inspectionRows,
    existingLabels,
    existingTransactions,
    existingUsages,
    storageState,
  };
};

const expectedLabel = (analysis, number) =>
  analysis.expected.labels.find((entry) => entry.number === number);

test("allocated and unused label keeps ownership without usage", () => {
  const analysis = buildMigrationAnalysis(makeSnapshot({ allocated: [1] }));

  assert.equal(analysis.can_apply, true);
  assert.equal(String(expectedLabel(analysis, 1).owner_inspector), analysis.inspector_id);
  assert.equal(expectedLabel(analysis, 1).usage_inspector, null);
  assert.deepEqual(analysis.observations.allocated_unused, [1]);
});

test("allocated and used label preserves both independent concepts", () => {
  const userId = objectId();
  const inspection = makeInspection({ user: userId, labels: [2] });
  const analysis = buildMigrationAnalysis(
    makeSnapshot({ userId, allocated: [2], inspections: [inspection] }),
  );

  assert.equal(expectedLabel(analysis, 2).owner_inspector, analysis.inspector_id);
  assert.equal(expectedLabel(analysis, 2).usage_inspector, analysis.inspector_id);
  assert.deepEqual(analysis.observations.allocated_and_used, [2]);
});

test("used label survives current deallocation", () => {
  const userId = objectId();
  const inspection = makeInspection({ user: userId, labels: [3] });
  const analysis = buildMigrationAnalysis(
    makeSnapshot({ userId, inspections: [inspection] }),
  );

  assert.equal(expectedLabel(analysis, 3).owner_inspector, null);
  assert.equal(expectedLabel(analysis, 3).usage_inspector, analysis.inspector_id);
  assert.deepEqual(analysis.observations.used_not_allocated, [3]);
});

test("rejected label is represented independently from ownership and usage", () => {
  const analysis = buildMigrationAnalysis(makeSnapshot({ rejected: [4] }));

  assert.equal(expectedLabel(analysis, 4).owner_inspector, null);
  assert.equal(
    expectedLabel(analysis, 4).rejected_by_inspector,
    analysis.inspector_id,
  );
});

test("transfer source and target histories retain paired actions", () => {
  const sourceId = objectId();
  const targetId = objectId();
  const source = buildMigrationAnalysis(
    makeSnapshot({
      inspectorId: sourceId,
      histories: [{
        _id: objectId(),
        action: "transfer_out",
        labels: [5],
        previous_labels: [5],
        next_labels: [],
        to_inspector: targetId,
        recorded_at: fixedDate,
      }],
    }),
  );
  const target = buildMigrationAnalysis(
    makeSnapshot({
      inspectorId: targetId,
      allocated: [5],
      histories: [{
        _id: objectId(),
        action: "transfer_in",
        labels: [5],
        previous_labels: [],
        next_labels: [5],
        from_inspector: sourceId,
        recorded_at: fixedDate,
      }],
    }),
  );

  assert.equal(source.expected.transactions[0].action, "transfer_out");
  assert.equal(String(source.expected.transactions[0].to_inspector), String(targetId));
  assert.equal(target.expected.transactions[0].action, "transfer_in");
  assert.equal(String(target.expected.transactions[0].from_inspector), String(sourceId));
});

for (const action of ["reject", "replace", "remove"]) {
  test(action + " allocation history is preserved without redesign", () => {
    const analysis = buildMigrationAnalysis(
      makeSnapshot({
        histories: [{
          _id: objectId(),
          action,
          labels: [6],
          previous_labels: [6],
          next_labels: action === "replace" ? [7] : [],
          recorded_at: fixedDate,
        }],
      }),
    );

    assert.equal(analysis.expected.transactions[0].action, action);
    assert.deepEqual(analysis.expected.transactions[0].previous_labels, [6]);
  });
}

test("historical Inspection edit deterministically changes usage projection", () => {
  const userId = objectId();
  const inspectionId = objectId();
  const before = buildMigrationAnalysis(
    makeSnapshot({
      userId,
      allocated: [7, 8],
      inspections: [
        makeInspection({ user: userId, inspectionId, labels: [7] }),
      ],
    }),
  );
  const after = buildMigrationAnalysis(
    makeSnapshot({
      userId,
      allocated: [7, 8],
      inspections: [
        makeInspection({ user: userId, inspectionId, labels: [8] }),
      ],
    }),
  );

  assert.equal(expectedLabel(before, 7).usage_inspector, before.inspector_id);
  assert.equal(expectedLabel(after, 7).usage_inspector, null);
  assert.equal(expectedLabel(after, 8).usage_inspector, after.inspector_id);
});

test("Inspection deletion prepares stale migrated usage for removal", () => {
  const inspectorId = objectId();
  const inspectionId = objectId();
  const analysis = buildMigrationAnalysis(
    makeSnapshot({
      inspectorId,
      allocated: [9],
      existingLabels: [{
        _id: objectId(),
        number: 9,
        owner_inspector: inspectorId,
        usage: { inspector: inspectorId },
        migration: { source: MIGRATION_SOURCE },
      }],
      existingUsages: [{
        _id: objectId(),
        inspector: inspectorId,
        inspection_record: inspectionId,
        labels: [9],
        migration: { source: MIGRATION_SOURCE, migrated: true },
      }],
    }),
  );

  assert.equal(analysis.can_apply, true);
  assert.equal(expectedLabel(analysis, 9).usage_inspector, null);
  assert.deepEqual(analysis.expected.usages, []);
});

test("Inspection transfer keeps both forensic records and one used serial projection", () => {
  const userId = objectId();
  const inspections = [
    makeInspection({
      user: userId,
      labels: [10],
      status: "transfered",
    }),
    makeInspection({
      user: userId,
      labels: [10],
      status: "Inspection Done",
    }),
  ];
  const analysis = buildMigrationAnalysis(
    makeSnapshot({ userId, allocated: [10], inspections }),
  );

  assert.equal(analysis.expected.usages.length, 2);
  assert.equal(
    analysis.expected.labels.filter((entry) => entry.number === 10).length,
    1,
  );
  assert.equal(analysis.observations.transferred_inspection_records, 1);
  assert.equal(
    analysis.conflicts.some(
      (entry) => entry.conflict_type === "transferred_inspection_evidence",
    ),
    true,
  );
});

test("duplicate labels in legacy arrays are reported", () => {
  const analysis = buildMigrationAnalysis(makeSnapshot({ allocated: [11, 11] }));

  assert.equal(
    analysis.conflicts.some(
      (entry) =>
        entry.conflict_type === "duplicate_serial" &&
        entry.legacy_evidence.source === "Inspector.alloted_labels",
    ),
    true,
  );
});

test("duplicate labels inside Inspection evidence are reported", () => {
  const userId = objectId();
  const inspection = makeInspection({ user: userId, labels: [12, 12] });
  const analysis = buildMigrationAnalysis(
    makeSnapshot({ userId, allocated: [12], inspections: [inspection] }),
  );

  assert.equal(
    analysis.conflicts.some(
      (entry) =>
        entry.conflict_type === "duplicate_serial" &&
        entry.legacy_evidence.source.includes("Inspection("),
    ),
    true,
  );
});

test("global serial ownership conflict blocks apply", () => {
  const inspectorId = objectId();
  const userId = objectId();
  const otherInspectorId = objectId();
  const analysis = buildMigrationAnalysis(
    makeSnapshot({
      inspectorId,
      userId,
      allocated: [13],
      globalInspectors: [
        {
          _id: inspectorId,
          user: userId,
          alloted_labels: [13],
          rejected_labels: [],
        },
        {
          _id: otherInspectorId,
          user: objectId(),
          alloted_labels: [13],
          rejected_labels: [],
        },
      ],
    }),
  );

  assert.equal(analysis.can_apply, false);
  assert.equal(
    analysis.conflicts.some(
      (entry) => entry.conflict_type === "allocated_multiple_inspectors",
    ),
    true,
  );
});

test("re-running analysis is deterministic", () => {
  const userId = objectId();
  const snapshot = makeSnapshot({
    userId,
    allocated: [14, 15],
    inspections: [makeInspection({ user: userId, labels: [14] })],
  });

  assert.deepEqual(
    buildMigrationAnalysis(snapshot),
    buildMigrationAnalysis(snapshot),
  );
});

test("compatible partial modern data is safe to resume", () => {
  const userId = objectId();
  const snapshot = makeSnapshot({
    userId,
    allocated: [16],
    inspections: [makeInspection({ user: userId, labels: [16] })],
    histories: [{
      _id: objectId(),
      action: "allocate",
      labels: [16],
      previous_labels: [],
      next_labels: [16],
      recorded_at: fixedDate,
    }],
  });
  const first = buildMigrationAnalysis(snapshot);
  const resumed = buildMigrationAnalysis({
    ...snapshot,
    existingLabels: first.expected.labels.map((entry) => ({
      _id: objectId(),
      number: entry.number,
      owner_inspector: entry.owner_inspector,
      rejected_by_inspector: entry.rejected_by_inspector,
      usage: { inspector: entry.usage_inspector },
      migration: { source: MIGRATION_SOURCE },
    })),
    existingTransactions: first.expected.transactions.map((entry) => ({
      ...entry,
      _id: objectId(),
      migration: {
        migrated: true,
        legacy_inspector: entry.migration.legacy_inspector,
        legacy_history_id: entry.migration.legacy_history_id,
      },
    })),
    existingUsages: first.expected.usages,
  });

  assert.equal(resumed.can_apply, true);
  assert.deepEqual(resumed.expected.labels, first.expected.labels);
});

test("empty migrated inspector verifies as a valid empty modern result", () => {
  const inspectorId = objectId();
  const userId = objectId();
  const report = buildVerificationReport({
    inspector: {
      _id: inspectorId,
      user: userId,
      alloted_labels: [],
      used_labels: [],
      rejected_labels: [],
      label_allocation_history: [],
    },
    storageState: {
      schema_version: 2,
      migration_status: "backfilled",
      read_source: "legacy",
      write_mode: "legacy",
    },
  });

  assert.equal(report.passed, true);
  assert.deepEqual(report.checks.summary.actual, {
    total_allocated: 0,
    total_used: 0,
    total_unused: 0,
    total_rejected: 0,
    usage_percentage: 0,
  });
});

test("modern foreign keys use Inspector._id, never populated User._id", () => {
  const inspectorId = objectId();
  const userId = objectId();
  const inspection = makeInspection({ user: userId, labels: [17] });
  const analysis = buildMigrationAnalysis(
    makeSnapshot({
      inspectorId,
      userId,
      allocated: [17],
      inspections: [inspection],
    }),
  );

  assert.equal(expectedLabel(analysis, 17).owner_inspector, String(inspectorId));
  assert.equal(expectedLabel(analysis, 17).usage_inspector, String(inspectorId));
  assert.notEqual(expectedLabel(analysis, 17).owner_inspector, String(userId));
  assert.equal(String(analysis.expected.usages[0].inspector), String(inspectorId));
});

test("legacy summary keeps used outside allocation and unused set difference", () => {
  const summary = buildSummary({
    allocated: [1, 2, 3],
    used: [1, 2, 10],
    rejected: [],
  });

  assert.deepEqual(summary, {
    total_allocated: 3,
    total_used: 3,
    total_unused: 1,
    total_rejected: 0,
    usage_percentage: "100.00",
  });
});

test("independent verifier matches populated allocation, usage, and summary", () => {
  const inspectorId = objectId();
  const userId = objectId();
  const inspection = makeInspection({
    user: userId,
    labels: [1, 2, 10],
  });
  const vendor = inspection.qc.order_meta.vendor;
  const report = buildVerificationReport({
    inspector: {
      _id: inspectorId,
      user: userId,
      alloted_labels: [1, 2, 3],
      used_labels: [1, 2, 10],
      rejected_labels: [],
      label_allocation_history: [],
    },
    inspections: [inspection],
    labels: [
      { number: 1, owner_inspector: inspectorId, usage: { inspector: inspectorId } },
      { number: 2, owner_inspector: inspectorId, usage: { inspector: inspectorId } },
      { number: 3, owner_inspector: inspectorId, usage: { inspector: null } },
      { number: 10, owner_inspector: null, usage: { inspector: inspectorId } },
    ],
    usages: [{
      inspector: inspectorId,
      labels: [1, 2, 10],
      inspection_record: inspection._id,
      qc: inspection.qc._id,
      request_history_id: inspection.request_history_id,
      qc_meta: {
        order_id: "PO-1",
        brand: "Brand A",
        vendor,
        item_code: "ITEM-1",
        description: "Fixture item",
      },
      inspection_date: "2026-01-02",
      used_at: fixedDate,
      source_updated_at: fixedDate,
    }],
    storageState: {
      schema_version: 2,
      migration_status: "backfilled",
      read_source: "legacy",
      write_mode: "legacy",
    },
  });

  assert.equal(report.passed, true);
  assert.equal(report.checks.summary.actual.total_unused, 1);
});

test("usage percentage remains total used divided by total allocated", () => {
  assert.equal(
    buildSummary({
      allocated: [20],
      used: [20, 21],
      rejected: [],
    }).usage_percentage,
    "200.00",
  );
});
