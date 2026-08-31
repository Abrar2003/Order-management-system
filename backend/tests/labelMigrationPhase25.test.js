const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const {
  MIGRATION_SOURCE,
  buildMigrationAnalysis,
} = require('../scripts/migrateLabels');
const { buildVerificationReport } = require('../scripts/verifyLabelMigration');
const LabelMigrationConflict = require('../models/labelMigrationConflict.model');
const {
  buildInventoryReport,
  classifyInspector,
} = require('../scripts/auditLabelMigration');
const {
  isLabelAvailable,
  isLabelReserved,
} = require('../services/labels/labelConflict.service');

const objectId = () => new mongoose.Types.ObjectId();
const date = new Date('2026-01-02T03:04:05.000Z');

const inspection = ({ user, labels, id = objectId(), status = 'Inspection Done' }) => ({
  _id: id,
  inspector: user,
  labels_added: labels,
  status,
  inspection_date: '2026-01-02',
  createdAt: date,
  updatedAt: date,
  qc: { _id: objectId(), order_meta: { order_id: 'PO-1', brand: 'Brand A' }, item: { item_code: 'I-1' } },
});

const snapshot = ({
  inspectorId = objectId(),
  userId = objectId(),
  allocated = [],
  rejected = [],
  inspections = [],
  globalInspectors,
  globalInspections,
  existingLabels = [],
  resolvedConflicts = [],
  storageState = null,
} = {}) => ({
  inspector: {
    _id: inspectorId,
    user: userId,
    alloted_labels: allocated,
    used_labels: [...new Set(inspections.flatMap((entry) => entry.labels_added || []))],
    rejected_labels: rejected,
    label_allocation_history: [],
    label_used_history: inspections.map((entry) => ({
      inspection_record: entry._id,
      labels: entry.labels_added,
    })),
    updatedAt: date,
  },
  inspections,
  globalInspectors: globalInspectors || [{
    _id: inspectorId,
    user: userId,
    alloted_labels: allocated,
    rejected_labels: rejected,
  }],
  globalInspections: globalInspections || inspections,
  existingLabels,
  existingTransactions: [],
  existingUsages: [],
  resolvedConflicts,
  storageState,
});

const label = (analysis, number) => analysis.expected.labels.find((entry) => entry.number === number);

test('same-inspector duplicate usage is a warning and preserves both records', () => {
  const user = objectId();
  const rows = [inspection({ user, labels: [101] }), inspection({ user, labels: [101] })];
  const result = buildMigrationAnalysis(snapshot({ userId: user, inspections: rows }));
  assert.equal(result.can_apply, true);
  assert.equal(result.expected.usages.length, 2);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'duplicate_usage_evidence'), true);
});

test('historical use by multiple inspectors is representable', () => {
  const userA = objectId();
  const userB = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const rows = [inspection({ user: userA, labels: [102] }), inspection({ user: userB, labels: [102] })];
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    inspections: [rows[0]],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorB, user: userB, alloted_labels: [], rejected_labels: [] },
    ],
    globalInspections: rows,
  }));
  assert.equal(result.can_apply, true);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'used_multiple_inspectors' && entry.severity === 'warning'), true);
  assert.deepEqual(result.expected.labels[0].usage_inspectors.sort(), [String(inspectorA), String(inspectorB)].sort());
  assert.equal(result.expected.labels[0].usage_inspector, null);
});

test('one current owner plus historical use by another inspector is a warning', () => {
  const userA = objectId();
  const userB = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const row = inspection({ user: userA, labels: [103] });
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    inspections: [row],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorB, user: userB, alloted_labels: [103], rejected_labels: [] },
    ],
    globalInspections: [row],
  }));
  assert.equal(result.can_apply, true);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'allocated_used_cross_inspector' && entry.severity === 'warning'), true);
  assert.deepEqual(result.expected.labels[0].usage_inspectors, [String(inspectorA)]);
  assert.equal(result.expected.labels[0].usage_inspector, String(inspectorA));
});

test('historical use plus current rejection by another inspector is representable', () => {
  const userA = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const row = inspection({ user: userA, labels: [104] });
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    inspections: [row],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorB, user: objectId(), alloted_labels: [], rejected_labels: [104] },
    ],
    globalInspections: [row],
  }));
  assert.equal(result.can_apply, true);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'rejected_used_cross_inspector' && entry.severity === 'warning'), true);
  assert.deepEqual(result.expected.labels[0].usage_inspectors, [String(inspectorA)]);
  assert.equal(result.expected.labels[0].usage_inspector, String(inspectorA));
});

test('usage projection is deduplicated and sorted across repeated historical evidence', () => {
  const userA = objectId();
  const userB = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const rowA = inspection({ user: userA, labels: [126] });
  const rowB = inspection({ user: userB, labels: [126] });
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    inspections: [rowA],
    globalInspectors: [
      { _id: inspectorB, user: userB, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
    ],
    globalInspections: [rowB, rowA, rowA],
  }));
  const expected = [String(inspectorA), String(inspectorB)].sort();
  assert.deepEqual(label(result, 126).usage_inspectors, expected);
  assert.equal(label(result, 126).usage_inspector, null);
});

test('A then B and B then A produce the same usage projection', () => {
  const userA = objectId();
  const userB = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const rowA = inspection({ user: userA, labels: [127] });
  const rowB = inspection({ user: userB, labels: [127] });
  const globalInspectors = [
    { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
    { _id: inspectorB, user: userB, alloted_labels: [], rejected_labels: [] },
  ];
  const first = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    inspections: [rowA],
    globalInspectors,
    globalInspections: [rowA, rowB],
  }));
  const second = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorB,
    userId: userB,
    inspections: [rowB],
    globalInspectors: [...globalInspectors].reverse(),
    globalInspections: [rowB, rowA],
  }));
  const project = (analysis) => {
    const entry = label(analysis, 127);
    return {
      owner_inspector: entry.owner_inspector,
      rejected_by_inspector: entry.rejected_by_inspector,
      allocation_state: entry.allocation_state,
      usage_inspectors: entry.usage_inspectors,
      usage_inspector: entry.usage_inspector,
    };
  };
  assert.deepEqual(project(first), project(second));
});

test('rerun repairs a stale scalar without treating matching aggregate evidence as incompatible', () => {
  const userA = objectId();
  const userB = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const rowA = inspection({ user: userA, labels: [128] });
  const rowB = inspection({ user: userB, labels: [128] });
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    inspections: [rowA],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorB, user: userB, alloted_labels: [], rejected_labels: [] },
    ],
    globalInspections: [rowA, rowB],
    existingLabels: [{
      _id: objectId(),
      number: 128,
      owner_inspector: null,
      rejected_by_inspector: null,
      usage: { inspector: inspectorA, inspectors: [inspectorA, inspectorB] },
      migration: { source: MIGRATION_SOURCE },
    }],
  }));
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'modern_label_incompatible'), false);
  assert.deepEqual(label(result, 128).usage_inspectors, [String(inspectorA), String(inspectorB)].sort());
  assert.equal(label(result, 128).usage_inspector, null);
});

test('historical use by A coexists with current ownership by B', () => {
  const userA = objectId();
  const userB = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const rowA = inspection({ user: userA, labels: [131] });
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorB,
    userId: userB,
    allocated: [131],
    inspections: [],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorB, user: userB, alloted_labels: [131], rejected_labels: [] },
    ],
    globalInspections: [rowA],
  }));
  assert.equal(String(label(result, 131).owner_inspector), String(inspectorB));
  assert.deepEqual(label(result, 131).usage_inspectors, [String(inspectorA)]);
  assert.equal(label(result, 131).usage_inspector, String(inspectorA));
  assert.equal(result.can_apply, true);
});

test('historical use by A and B coexists with current ownership by C', () => {
  const userA = objectId();
  const userB = objectId();
  const userC = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const inspectorC = objectId();
  const rows = [
    inspection({ user: userA, labels: [132] }),
    inspection({ user: userB, labels: [132] }),
  ];
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorC,
    userId: userC,
    allocated: [132],
    inspections: [],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorB, user: userB, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorC, user: userC, alloted_labels: [132], rejected_labels: [] },
    ],
    globalInspections: rows,
  }));
  assert.equal(String(label(result, 132).owner_inspector), String(inspectorC));
  assert.deepEqual(label(result, 132).usage_inspectors, [String(inspectorA), String(inspectorB)].sort());
  assert.equal(label(result, 132).usage_inspector, null);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'modern_label_incompatible'), false);
});

test('historical use by A coexists with current rejection by B', () => {
  const userA = objectId();
  const userB = objectId();
  const inspectorA = objectId();
  const inspectorB = objectId();
  const rowA = inspection({ user: userA, labels: [133] });
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorB,
    userId: userB,
    rejected: [133],
    inspections: [],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [] },
      { _id: inspectorB, user: userB, alloted_labels: [], rejected_labels: [133] },
    ],
    globalInspections: [rowA],
  }));
  assert.equal(String(label(result, 133).rejected_by_inspector), String(inspectorB));
  assert.deepEqual(label(result, 133).usage_inspectors, [String(inspectorA)]);
  assert.equal(label(result, 133).usage_inspector, String(inspectorA));
  assert.equal(result.can_apply, true);
});

test('genuine modern owner mismatch remains blocking', () => {
  const inspectorA = objectId();
  const inspectorC = objectId();
  const userA = objectId();
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    allocated: [129],
    existingLabels: [{
      _id: objectId(),
      number: 129,
      owner_inspector: inspectorC,
      rejected_by_inspector: null,
      usage: { inspector: null, inspectors: [] },
      migration: { source: MIGRATION_SOURCE },
    }],
  }));
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'modern_label_incompatible' && entry.severity === 'error'), true);
  assert.equal(result.can_apply, false);
  assert.equal(result.can_backfill, true);
  assert.equal(result.skip_label_numbers.has(129), true);
});

test('verifier accepts the scalar compatibility value only for a sole aggregate Inspector', () => {
  const inspectorA = objectId();
  const userA = objectId();
  const inspectorB = objectId();
  const row = inspection({ user: userA, labels: [130] });
  const base = {
    inspector: { _id: inspectorA, user: userA, alloted_labels: [], used_labels: [130], rejected_labels: [], label_allocation_history: [] },
    inspections: [row],
    usages: [],
    conflicts: [],
    storageState: { schema_version: 2, migration_status: 'backfilled', read_source: 'legacy', write_mode: 'legacy' },
  };
  const sole = buildVerificationReport({
    ...base,
    labels: [{ number: 130, owner_inspector: null, usage: { inspectors: [inspectorA], inspector: inspectorA } }],
    usageInspectorsByNumber: new Map([[130, [inspectorA]]]),
  });
  const multiple = buildVerificationReport({
    ...base,
    labels: [{ number: 130, owner_inspector: null, usage: { inspectors: [inspectorB, inspectorA], inspector: null } }],
    usageInspectorsByNumber: new Map([[130, [inspectorA, inspectorB]]]),
  });
  const stale = buildVerificationReport({
    ...base,
    labels: [{ number: 130, owner_inspector: null, usage: { inspectors: [inspectorA, inspectorB], inspector: inspectorA } }],
    usageInspectorsByNumber: new Map([[130, [inspectorA, inspectorB]]]),
  });
  assert.equal(sole.checks.usage_projection.passed, true);
  assert.equal(multiple.checks.usage_projection.passed, true);
  assert.equal(stale.checks.usage_projection.passed, false);
});

test('current double allocation is blocking but allows unrelated partial backfill', () => {
  const inspectorA = objectId();
  const inspectorB = objectId();
  const userA = objectId();
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    allocated: [105, 106],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [105, 106], rejected_labels: [] },
      { _id: inspectorB, user: objectId(), alloted_labels: [105], rejected_labels: [] },
    ],
  }));
  assert.equal(result.can_apply, false);
  assert.equal(result.can_backfill, true);
  assert.equal(result.summary.partial_backfill, true);
  assert.equal(result.summary.blocking_label_count, 1);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'multiple_current_allocation_claims' && entry.severity === 'error'), true);
  assert.equal(label(result, 105).allocation_state, 'conflicted');
  assert.equal(label(result, 105).owner_inspector, null);
  assert.equal(label(result, 106).allocation_state, 'active');
});

test('current double rejection is blocking and never selects a rejection owner', () => {
  const inspectorA = objectId();
  const inspectorB = objectId();
  const userA = objectId();
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    rejected: [107],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [], rejected_labels: [107] },
      { _id: inspectorB, user: objectId(), alloted_labels: [], rejected_labels: [107] },
    ],
  }));
  assert.equal(result.can_backfill, true);
  assert.equal(label(result, 107).allocation_state, 'conflicted');
  assert.equal(label(result, 107).rejected_by_inspector, null);
});

test('conflicted serials remain unavailable even with no canonical owner', () => {
  const conflict = { conflict_type: 'multiple_current_allocation_claims', severity: 'error', status: 'open', label_number: 108 };
  assert.equal(isLabelReserved({ number: 108, owner_inspector: null }, [conflict]), true);
  assert.equal(isLabelAvailable({ number: 108, owner_inspector: null }, [conflict]), false);
  assert.equal(isLabelAvailable({ number: 109, owner_inspector: null }, []), true);
});

test('resolved allocation evidence permits a deterministic rerun without legacy repair', () => {
  const inspectorA = objectId();
  const inspectorB = objectId();
  const userA = objectId();
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    allocated: [110],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [110], rejected_labels: [] },
      { _id: inspectorB, user: objectId(), alloted_labels: [110], rejected_labels: [] },
    ],
    resolvedConflicts: [{
      status: 'resolved',
      conflict_type: 'multiple_current_allocation_claims',
      label_number: 110,
      canonical_current_owner: inspectorB,
    }],
  }));
  assert.equal(result.can_backfill, true);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'multiple_current_allocation_claims'), false);
  assert.equal(String(label(result, 110).owner_inspector), String(inspectorB));
  assert.equal(label(result, 110).allocation_state, 'active');
});

test('warnings do not prevent a fully representable verifier result', () => {
  const inspectorId = objectId();
  const userId = objectId();
  const row = inspection({ user: userId, labels: [111] });
  const report = buildVerificationReport({
    inspector: { _id: inspectorId, user: userId, alloted_labels: [111], used_labels: [111], rejected_labels: [], label_allocation_history: [] },
    inspections: [row],
    labels: [{ number: 111, owner_inspector: inspectorId, usage: { inspector: inspectorId } }],
    usages: [{ inspector: inspectorId, labels: [111], inspection_record: row._id, qc: row.qc._id, qc_meta: { order_id: 'PO-1', brand: 'Brand A', vendor: null, item_code: 'I-1', description: '' }, inspection_date: row.inspection_date, used_at: row.createdAt, source_updated_at: row.updatedAt }],
    conflicts: [{ conflict_type: 'duplicate_usage_evidence', severity: 'warning', status: 'open' }],
    storageState: { schema_version: 2, migration_status: 'backfilled', read_source: 'legacy', write_mode: 'legacy' },
  });
  assert.equal(report.passed, true);
  assert.equal(report.fully_verified, true);
});

test('blocking verifier result proves quarantine but cannot be marked verified', () => {
  const inspectorId = objectId();
  const userId = objectId();
  const report = buildVerificationReport({
    inspector: { _id: inspectorId, user: userId, alloted_labels: [112], used_labels: [], rejected_labels: [], label_allocation_history: [] },
    labels: [{ number: 112, owner_inspector: null, allocation_state: 'conflicted', usage: { inspector: null } }],
    conflicts: [{ conflict_type: 'multiple_current_allocation_claims', severity: 'error', status: 'open', label_number: 112 }],
    storageState: { schema_version: 2, migration_status: 'backfilled_with_conflicts', read_source: 'legacy', write_mode: 'legacy' },
  });
  assert.equal(report.checks.quarantine.passed, true);
  assert.equal(report.passed, false);
  assert.equal(report.backfilled_with_unresolved_conflicts, true);
});

test('inventory summarizes clean, warning-only, and blocked Inspectors', () => {
  const rows = [
    { classification: 'CLEAN', analysis: { expected: { labels: [{ number: 1 }] }, conflicts: [], summary: {} } },
    { classification: 'REPRESENTABLE_ANOMALIES', analysis: { expected: { labels: [{ number: 2 }] }, conflicts: [{ conflict_type: 'duplicate_usage_evidence', severity: 'warning' }], summary: {} } },
    { classification: 'BLOCKED_CURRENT_STATE', analysis: { expected: { labels: [{ number: 3 }] }, conflicts: [{ conflict_type: 'multiple_current_allocation_claims', severity: 'error', label_number: 3 }], summary: {} } },
  ];
  const report = buildInventoryReport(rows);
  assert.deepEqual(report.totals, {
    total_inspectors: 3,
    clean_inspectors: 1,
    warning_only_inspectors: 1,
    blocked_inspectors: 1,
    total_unique_serials: 3,
    total_blocking_serials: 1,
    total_historical_warnings: 1,
    conflicts_by_type: { duplicate_usage_evidence: 1, multiple_current_allocation_claims: 1 },
  });
  assert.equal(classifyInspector(rows[2].analysis), 'BLOCKED_CURRENT_STATE');
});

test('resolution records retain prior evidence and resulting state', async () => {
  const conflict = new LabelMigrationConflict({
    fingerprint: 'phase25-resolution-test',
    conflict_type: 'multiple_current_allocation_claims',
    severity: 'error',
    label_number: 113,
    resolution_type: 'owner_confirmed',
    canonical_current_owner: objectId(),
    resolved_by: 'operator',
    resolution_reason: 'transfer history confirmed owner',
    previous_evidence: { claims: ['A', 'B'] },
    resulting_canonical_state: { allocation_state: 'active' },
    resolution_history: [{ resolution_type: 'owner_confirmed' }],
  });
  await conflict.validate();
  assert.equal(conflict.resolution_history.length, 1);
  assert.equal(conflict.resolution_reason.includes('confirmed'), true);
});

test('Inspector and User identities remain distinct in migration output', () => {
  const inspectorId = objectId();
  const userId = objectId();
  const result = buildMigrationAnalysis(snapshot({ inspectorId, userId, allocated: [114] }));
  assert.notEqual(result.inspector_id, result.inspector_user_id);
  assert.equal(String(label(result, 114).owner_inspector), String(inspectorId));
});

test('transferred Inspection evidence remains in usage projections', () => {
  const userId = objectId();
  const result = buildMigrationAnalysis(snapshot({
    userId,
    inspections: [inspection({ user: userId, labels: [115], status: 'transferred' })],
  }));
  assert.equal(result.expected.usages.length, 1);
  assert.equal(result.summary.usage_record_count, 1);
});

test('summary remains compatible with independent allocation and usage counts', () => {
  const result = buildMigrationAnalysis(snapshot({ allocated: [116, 117], rejected: [118] }));
  assert.equal(result.summary.allocated_count, 2);
  assert.equal(result.summary.rejected_count, 1);
  assert.equal(result.summary.usage_percentage, '0.00');
  assert.equal(MIGRATION_SOURCE, 'legacy-label-backfill-v2');
});

test('allocation and rejection contradiction remains independently representable', () => {
  const result = buildMigrationAnalysis(snapshot({ allocated: [119], rejected: [119] }));
  assert.equal(result.can_apply, true);
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'rejected_state_overlap' && entry.severity === 'warning'), true);
  assert.equal(String(label(result, 119).owner_inspector), result.inspector_id);
  assert.equal(String(label(result, 119).rejected_by_inspector), result.inspector_id);
});

test('partial analysis keeps clean serials eligible and only quarantines conflict serials', () => {
  const inspectorA = objectId();
  const inspectorB = objectId();
  const userA = objectId();
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    allocated: [120, 121],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [120, 121], rejected_labels: [] },
      { _id: inspectorB, user: objectId(), alloted_labels: [120], rejected_labels: [] },
    ],
  }));
  assert.equal(result.can_backfill, true);
  assert.equal(result.skip_label_numbers.has(120), false);
  assert.equal(result.skip_label_numbers.has(121), false);
  assert.equal(label(result, 120).allocation_state, 'conflicted');
  assert.equal(label(result, 121).allocation_state, 'active');
});

test('rebuilding the same snapshot is deterministic for restart safety', () => {
  const source = snapshot({ allocated: [122], rejected: [123] });
  const first = buildMigrationAnalysis(source);
  const second = buildMigrationAnalysis(source);
  assert.deepEqual(first.conflicts, second.conflicts);
  assert.deepEqual(first.expected, second.expected);
  assert.deepEqual(first.summary, second.summary);
});

test('partial migration never changes legacy read or write mode', () => {
  const storageState = {
    schema_version: 2,
    migration_status: 'backfilled_with_conflicts',
    read_source: 'legacy',
    write_mode: 'legacy',
  };
  const result = buildMigrationAnalysis(snapshot({ storageState, allocated: [124] }));
  assert.equal(result.conflicts.some((entry) => entry.conflict_type === 'unsafe_storage_state'), false);
  assert.deepEqual(storageState, {
    schema_version: 2,
    migration_status: 'backfilled_with_conflicts',
    read_source: 'legacy',
    write_mode: 'legacy',
  });
});

test('resolved ownership affects only canonical projection, not legacy claims', () => {
  const inspectorA = objectId();
  const inspectorB = objectId();
  const userA = objectId();
  const result = buildMigrationAnalysis(snapshot({
    inspectorId: inspectorA,
    userId: userA,
    allocated: [125],
    globalInspectors: [
      { _id: inspectorA, user: userA, alloted_labels: [125], rejected_labels: [] },
      { _id: inspectorB, user: objectId(), alloted_labels: [125], rejected_labels: [] },
    ],
    resolvedConflicts: [{
      status: 'resolved',
      conflict_type: 'multiple_current_allocation_claims',
      label_number: 125,
      canonical_current_owner: inspectorB,
    }],
  }));
  assert.deepEqual(result.inspector_id, String(inspectorA));
  assert.equal(String(label(result, 125).owner_inspector), String(inspectorB));
});
