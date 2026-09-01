const crypto = require("node:crypto");
const path = require("node:path");
const mongoose = require("mongoose");

mongoose.set("autoIndex", false);

const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Inspector = require("../models/inspector.model");
const Inspection = require("../models/inspection.model");
require("../models/qc.model");
const Label = require("../models/label.model");
const LabelTransaction = require("../models/labelTransaction.model");
const LabelUsage = require("../models/labelUsage.model");
const LabelStorageState = require("../models/labelStorageState.model");
const LabelMigrationConflict = require("../models/labelMigrationConflict.model");
const { coerceVendorValueForSchema } = require("../helpers/vendorRef");
const { isSafePreCutoverStorageState } = require("../services/labels/labelStorage.service");

const MIGRATION_SOURCE = "legacy-label-backfill-v2";
const ALLOCATION_ACTIONS = new Set([
  "allocate",
  "transfer_in",
  "transfer_out",
  "reject",
  "replace",
  "remove",
]);
const TRANSFERRED_STATUSES = new Set(["transfered", "transferred"]);

const id = (value) => String(value?._id || value || "").trim();
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(id(value));
const sorted = (values) => [...values].sort((left, right) => left - right);
const difference = (left, right) => left.filter((value) => !right.has(value));

const stableValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value?._bsontype === "ObjectId") return String(value);
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  if (value === undefined) return null;
  return value;
};

const fingerprint = (value) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
const equalStable = (left, right) =>
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));

const inspectSerials = (values = []) => {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  const duplicates = new Set();

  (Array.isArray(values) ? values : []).forEach((raw, index) => {
    const number = Number(raw);
    if (!Number.isInteger(number) || number <= 0) {
      invalid.push({ index, value: stableValue(raw) });
      return;
    }
    if (seen.has(number)) duplicates.add(number);
    seen.add(number);
    valid.push(number);
  });

  return {
    labels: sorted(new Set(valid)),
    invalid,
    duplicates: sorted(duplicates),
  };
};

const addConflict = (analysis, {
  conflictType,
  severity = "warning",
  labelNumber = null,
  legacyEvidence = null,
  modernEvidence = null,
  sourceDocumentIds = [],
}) => {
  const sourceIds = [...new Set(sourceDocumentIds.map(id).filter(isObjectId))].sort();
  const conflict = {
    inspector: analysis.inspector_id || null,
    label_number: labelNumber,
    conflict_type: conflictType,
    severity,
    legacy_evidence: stableValue(legacyEvidence),
    modern_evidence: stableValue(modernEvidence),
    source_document_ids: sourceIds,
  };
  conflict.fingerprint = fingerprint(conflict);
  if (!analysis._conflictFingerprints.has(conflict.fingerprint)) {
    analysis._conflictFingerprints.add(conflict.fingerprint);
    analysis.conflicts.push(conflict);
  }
};

const addSerialFindings = (
  analysis,
  serials,
  source,
  sourceDocumentIds = [],
  { invalidSeverity = "error" } = {},
) => {
  if (serials.invalid.length > 0) {
    addConflict(analysis, {
      conflictType: "invalid_serial",
      severity: invalidSeverity,
      legacyEvidence: { source, values: serials.invalid },
      sourceDocumentIds,
    });
  }
  if (serials.duplicates.length > 0) {
    addConflict(analysis, {
      conflictType: "duplicate_serial",
      legacyEvidence: { source, labels: serials.duplicates },
      sourceDocumentIds,
    });
  }
};

const validDate = (value, fallback = null) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : fallback;
};

const buildTransactions = (analysis, inspector) => {
  const occurrences = new Map();
  const transactions = [];

  (Array.isArray(inspector?.label_allocation_history)
    ? inspector.label_allocation_history
    : []
  ).forEach((entry, index) => {
    const sourceId = id(entry?._id);
    const entryDocumentIds = [inspector?._id, entry?._id];
    const labels = inspectSerials(entry?.labels);
    const previousLabels = inspectSerials(entry?.previous_labels);
    const nextLabels = inspectSerials(entry?.next_labels);
    addSerialFindings(
      analysis,
      labels,
      "label_allocation_history[" + index + "].labels",
      entryDocumentIds,
    );
    addSerialFindings(
      analysis,
      previousLabels,
      "label_allocation_history[" + index + "].previous_labels",
      entryDocumentIds,
    );
    addSerialFindings(
      analysis,
      nextLabels,
      "label_allocation_history[" + index + "].next_labels",
      entryDocumentIds,
    );

    const action = String(entry?.action || "").trim();
    if (!ALLOCATION_ACTIONS.has(action)) {
      addConflict(analysis, {
        conflictType: "invalid_allocation_history_action",
        severity: "error",
        legacyEvidence: { index, action },
        sourceDocumentIds: entryDocumentIds,
      });
      return;
    }

    const businessFields = {
      action,
      labels: labels.labels,
      previous_labels: previousLabels.labels,
      next_labels: nextLabels.labels,
      from_inspector: id(entry?.from_inspector) || null,
      to_inspector: id(entry?.to_inspector) || null,
      actor: {
        user: id(entry?.actor?.user) || null,
        name: String(entry?.actor?.name || ""),
      },
      recorded_at: validDate(entry?.recorded_at, new Date(0)),
      remarks: String(entry?.remarks || "").trim(),
    };
    const contentFingerprint = fingerprint(businessFields);
    const occurrence = (occurrences.get(contentFingerprint) || 0) + 1;
    occurrences.set(contentFingerprint, occurrence);
    const legacyKey = isObjectId(sourceId)
      ? "id:" + sourceId
      : "hash:" + contentFingerprint + ":" + occurrence;

    if (!isObjectId(sourceId)) {
      addConflict(analysis, {
        conflictType: "allocation_history_missing_stable_id",
        legacyEvidence: { index, legacy_key: legacyKey },
        sourceDocumentIds: [inspector?._id],
      });
    }

    transactions.push({
      inspector: inspector._id,
      ...businessFields,
      migration: {
        migrated: true,
        source: MIGRATION_SOURCE,
        legacy_inspector: inspector._id,
        legacy_history_id: isObjectId(sourceId) ? sourceId : null,
        legacy_key: legacyKey,
      },
    });
  });

  return transactions;
};

const buildUsages = (analysis, inspector, inspections) => {
  const usageEvidence = new Map();
  const usages = [];
  let transferredRecordCount = 0;

  for (const inspection of Array.isArray(inspections) ? inspections : []) {
    const serials = inspectSerials(inspection?.labels_added);
    addSerialFindings(
      analysis,
      serials,
      "Inspection(" + id(inspection?._id) + ").labels_added",
      [inspection?._id],
    );
    if (serials.labels.length === 0) continue;

    const normalizedStatus = String(inspection?.status || "").trim().toLowerCase();
    if (TRANSFERRED_STATUSES.has(normalizedStatus)) transferredRecordCount += 1;
    for (const number of serials.labels) {
      const evidence = usageEvidence.get(number) || [];
      evidence.push({
        inspection_record: id(inspection?._id),
        status: String(inspection?.status || ""),
      });
      usageEvidence.set(number, evidence);
    }

    const qc =
      inspection?.qc &&
      typeof inspection.qc === "object" &&
      (inspection.qc.order_meta || inspection.qc.item)
      ? inspection.qc
      : null;
    if (!qc) {
      addConflict(analysis, {
        conflictType: "usage_qc_metadata_unresolved",
        legacyEvidence: {
          inspection_record: id(inspection?._id),
          qc: id(inspection?.qc) || null,
        },
        sourceDocumentIds: [inspection?._id, inspection?.qc],
      });
    }

    usages.push({
      inspector: inspector._id,
      labels: serials.labels,
      inspection_record: inspection._id,
      qc: qc?._id || inspection?.qc || null,
      request_history_id: inspection?.request_history_id || null,
      qc_meta: {
        order_id: String(qc?.order_meta?.order_id || ""),
        brand: String(qc?.order_meta?.brand || ""),
        vendor: coerceVendorValueForSchema(qc?.order_meta?.vendor),
        item_code: String(qc?.item?.item_code || ""),
        description: String(qc?.item?.description || ""),
      },
      inspection_date: String(inspection?.inspection_date || ""),
      used_at: validDate(inspection?.createdAt, new Date(0)),
      source_updated_at: validDate(
        inspection?.updatedAt,
        validDate(inspection?.createdAt),
      ),
      migration: {
        migrated: true,
        source: MIGRATION_SOURCE,
      },
    });
  }

  for (const [number, evidence] of usageEvidence) {
    if (evidence.length <= 1) continue;
    addConflict(analysis, {
      conflictType: "duplicate_usage_evidence",
      labelNumber: number,
      legacyEvidence: evidence,
      sourceDocumentIds: evidence.map((entry) => entry.inspection_record),
    });
  }
  if (transferredRecordCount > 0) {
    addConflict(analysis, {
      conflictType: "transferred_inspection_evidence",
      legacyEvidence: {
        record_count: transferredRecordCount,
        behavior:
          "forensic projection includes transferred records; qc.controller rebuild excludes transfered records",
      },
      sourceDocumentIds: inspections
        .filter((entry) =>
          TRANSFERRED_STATUSES.has(String(entry?.status || "").trim().toLowerCase()),
        )
        .map((entry) => entry?._id),
    });
  }

  return { usages, usageEvidence };
};

const compareUsageHistory = (analysis, inspector, usages) => {
  const expected = new Map(
    usages.map((usage) => [
      id(usage.inspection_record),
      JSON.stringify(usage.labels),
    ]),
  );
  const actual = new Map();
  for (const entry of Array.isArray(inspector?.label_used_history)
    ? inspector.label_used_history
    : []) {
    const inspectionId = id(entry?.inspection_record);
    if (!inspectionId) continue;
    actual.set(inspectionId, JSON.stringify(inspectSerials(entry?.labels).labels));
  }
  const missing = [...expected].filter(([key, value]) => actual.get(key) !== value);
  const extra = [...actual].filter(([key, value]) => expected.get(key) !== value);
  if (missing.length > 0 || extra.length > 0) {
    addConflict(analysis, {
      conflictType: "usage_history_mismatch",
      legacyEvidence: {
        missing_or_changed_inspection_records: missing.map(([key]) => key),
        extra_or_changed_inspection_records: extra.map(([key]) => key),
      },
      sourceDocumentIds: [inspector?._id, ...missing.map(([key]) => key)],
    });
  }
};

const buildGlobalMaps = (analysis, relevant, globalInspectors, globalInspections) => {
  const allocated = new Map();
  const rejected = new Map();
  const userInspectors = new Map();

  for (const inspector of Array.isArray(globalInspectors) ? globalInspectors : []) {
    const inspectorId = id(inspector?._id);
    const userId = id(inspector?.user);
    if (userId) {
      const ids = userInspectors.get(userId) || [];
      ids.push(inspectorId);
      userInspectors.set(userId, [...new Set(ids)]);
    }
    for (const number of inspectSerials(inspector?.alloted_labels).labels) {
      if (!relevant.has(number)) continue;
      const owners = allocated.get(number) || new Set();
      owners.add(inspectorId);
      allocated.set(number, owners);
    }
    for (const number of inspectSerials(inspector?.rejected_labels).labels) {
      if (!relevant.has(number)) continue;
      const owners = rejected.get(number) || new Set();
      owners.add(inspectorId);
      rejected.set(number, owners);
    }
  }

  const used = new Map();
  for (const inspection of Array.isArray(globalInspections) ? globalInspections : []) {
    const inspectorUserId = id(inspection?.inspector);
    const inspectorIds = userInspectors.get(inspectorUserId) || [];
    const labels = inspectSerials(inspection?.labels_added).labels
      .filter((number) => relevant.has(number));
    if (labels.length === 0) continue;
    if (inspectorIds.length !== 1) {
      addConflict(analysis, {
        conflictType: inspectorIds.length === 0
          ? "usage_inspector_unresolved"
          : "usage_inspector_ambiguous",
        severity: "error",
        legacyEvidence: {
          inspection_record: id(inspection?._id),
          inspector_user: inspectorUserId,
          inspector_documents: inspectorIds,
          labels,
        },
        sourceDocumentIds: [inspection?._id, ...inspectorIds],
      });
      continue;
    }
    for (const number of labels) {
      const owners = used.get(number) || new Set();
      owners.add(inspectorIds[0]);
      used.set(number, owners);
    }
  }

  for (const number of relevant) {
    const allocationOwners = allocated.get(number) || new Set();
    const rejectionOwners = rejected.get(number) || new Set();
    const usageOwners = used.get(number) || new Set();
    const checks = [
      ["allocated_multiple_inspectors", allocationOwners],
      ["rejected_multiple_inspectors", rejectionOwners],
      ["used_multiple_inspectors", usageOwners],
    ];
    for (const [conflictType, owners] of checks) {
      if (owners.size <= 1) continue;
      addConflict(analysis, {
        conflictType,
        severity: "error",
        labelNumber: number,
        legacyEvidence: { inspector_documents: [...owners].sort() },
        sourceDocumentIds: [...owners],
      });
    }

    const allocationAndRejection = new Set([...allocationOwners, ...rejectionOwners]);
    if (
      allocationAndRejection.size > 1 &&
      allocationOwners.size > 0 &&
      rejectionOwners.size > 0
    ) {
      addConflict(analysis, {
        conflictType: "allocated_rejected_cross_inspector",
        severity: "error",
        labelNumber: number,
        legacyEvidence: {
          allocated_by: [...allocationOwners],
          rejected_by: [...rejectionOwners],
        },
        sourceDocumentIds: [...allocationAndRejection],
      });
    }
    const allocationAndUsage = new Set([...allocationOwners, ...usageOwners]);
    if (
      allocationAndUsage.size > 1 &&
      allocationOwners.size > 0 &&
      usageOwners.size > 0
    ) {
      addConflict(analysis, {
        conflictType: "allocated_used_cross_inspector",
        severity: "error",
        labelNumber: number,
        legacyEvidence: {
          allocated_by: [...allocationOwners],
          used_by: [...usageOwners],
        },
        sourceDocumentIds: [...allocationAndUsage],
      });
    }
    const rejectionAndUsage = new Set([...rejectionOwners, ...usageOwners]);
    if (
      rejectionAndUsage.size > 1 &&
      rejectionOwners.size > 0 &&
      usageOwners.size > 0
    ) {
      addConflict(analysis, {
        conflictType: "rejected_used_cross_inspector",
        severity: "error",
        labelNumber: number,
        legacyEvidence: {
          rejected_by: [...rejectionOwners],
          used_by: [...usageOwners],
        },
        sourceDocumentIds: [...rejectionAndUsage],
      });
    }
  }
};

const collectGlobalLabelMaps = (relevant, globalInspectors, globalInspections) => {
  const userInspectors = new Map();
  const allocated = new Map();
  const rejected = new Map();
  const used = new Map();
  for (const inspector of Array.isArray(globalInspectors) ? globalInspectors : []) {
    const inspectorId = id(inspector?._id);
    const userId = id(inspector?.user);
    if (!userId || !inspectorId) continue;
    const ids = userInspectors.get(userId) || [];
    ids.push(inspectorId);
    userInspectors.set(userId, [...new Set(ids)]);
    for (const number of inspectSerials(inspector?.alloted_labels).labels) {
      if (!relevant.has(number)) continue;
      const owners = allocated.get(number) || new Set();
      owners.add(inspectorId);
      allocated.set(number, owners);
    }
    for (const number of inspectSerials(inspector?.rejected_labels).labels) {
      if (!relevant.has(number)) continue;
      const owners = rejected.get(number) || new Set();
      owners.add(inspectorId);
      rejected.set(number, owners);
    }
  }
  for (const inspection of Array.isArray(globalInspections) ? globalInspections : []) {
    const inspectorIds = userInspectors.get(id(inspection?.inspector)) || [];
    if (inspectorIds.length !== 1) continue;
    for (const number of inspectSerials(inspection?.labels_added).labels) {
      if (!relevant.has(number)) continue;
      const owners = used.get(number) || new Set();
      owners.add(inspectorIds[0]);
      used.set(number, owners);
    }
  }
  return { allocated, rejected, used };
};

const classifyConflicts = (analysis) => {
  const resolvedOwners = new Map();
  for (const conflict of analysis.resolved_conflicts || []) {
    const number = Number(conflict?.label_number);
    const owner = id(
      conflict?.canonical_current_owner ||
        conflict?.resulting_canonical_state?.owner_inspector,
    );
    if (
      Number.isInteger(number) &&
      number > 0 &&
      owner &&
      conflict?.status === 'resolved' &&
      ['multiple_current_allocation_claims', 'allocated_multiple_inspectors']
        .includes(String(conflict?.conflict_type || ''))
    ) {
      resolvedOwners.set(number, owner);
    }
  }
  const aliases = new Map([
    ['allocated_multiple_inspectors', 'multiple_current_allocation_claims'],
    ['rejected_multiple_inspectors', 'multiple_current_rejection_claims'],
  ]);
  analysis.conflicts = analysis.conflicts
    .map((conflict) => {
      const conflictType = aliases.get(conflict.conflict_type) || conflict.conflict_type;
      const representable = new Set([
        'used_multiple_inspectors',
        'allocated_used_cross_inspector',
        'rejected_used_cross_inspector',
        'allocated_rejected_cross_inspector',
      ]).has(conflictType);
      return {
        ...conflict,
        conflict_type: conflictType,
        severity: representable ? 'warning' : conflict.severity,
      };
    })
    .filter((conflict) => {
      const number = Number(conflict.label_number);
      return !(
        conflict.conflict_type === 'multiple_current_allocation_claims' &&
        resolvedOwners.has(number)
      );
    });
  analysis.resolved_allocation_owners = resolvedOwners;
  analysis.blocking_label_numbers = getBlockingLabelNumbers(analysis.conflicts);
  analysis.quarantine_label_numbers = getQuarantineLabelNumbers(analysis.conflicts);
  analysis.non_label_blocking_conflicts = analysis.conflicts.filter(
    (conflict) =>
      String(conflict.severity || '') === 'error' &&
      !Number.isInteger(Number(conflict.label_number)),
  );
};

const compareExistingModern = (analysis, expectedLabels, transactions, usages, snapshot) => {
  const existingByNumber = new Map();
  for (const label of snapshot.existingLabels || []) {
    const records = existingByNumber.get(Number(label?.number)) || [];
    records.push(label);
    existingByNumber.set(Number(label?.number), records);
  }
  for (const [number, records] of existingByNumber) {
    if (records.length > 1) {
      addConflict(analysis, {
        conflictType: "duplicate_modern_label",
        severity: "error",
        labelNumber: number,
        modernEvidence: records.map((entry) => id(entry?._id)),
        sourceDocumentIds: records.map((entry) => entry?._id),
      });
    }
  }

  for (const [number, expected] of expectedLabels) {
    const existing = existingByNumber.get(number)?.[0];
    if (!existing) continue;
    const oldStatus = String(existing?.status || "").trim();
    if (oldStatus && oldStatus !== "unassigned") {
      addConflict(analysis, {
        conflictType: "phase1_status_record_requires_review",
        severity: "error",
        labelNumber: number,
        modernEvidence: {
          status: oldStatus,
          inspector: id(existing?.inspector) || null,
        },
        sourceDocumentIds: [existing?._id],
      });
    }
    const incompatible = [
      ["owner_inspector", id(existing?.owner_inspector), expected.owner_inspector],
      ["rejected_by_inspector", id(existing?.rejected_by_inspector), expected.rejected_by_inspector],
    ].filter(
      ([, actual, desired]) =>
        actual &&
        actual !== desired &&
        actual !== analysis.inspector_id,
    );
    if (Array.isArray(existing?.usage?.inspectors)) {
      const actualUsageInspectors = [...new Set(
        existing.usage.inspectors.map(id).filter(Boolean),
      )].sort();
      const expectedUsageInspectors = [...new Set(
        (expected.usage_inspectors || []).map(id).filter(Boolean),
      )].sort();
      if (!equalStable(actualUsageInspectors, expectedUsageInspectors)) {
        incompatible.push([
          "usage.inspectors",
          actualUsageInspectors,
          expectedUsageInspectors,
        ]);
      }
    }
    if (incompatible.length > 0) {
      addConflict(analysis, {
        conflictType: "modern_label_incompatible",
        severity: "error",
        labelNumber: number,
        modernEvidence: Object.fromEntries(
          incompatible.map(([field, actual, desired]) => [
            field,
            { actual, expected: desired },
          ]),
        ),
        sourceDocumentIds: [existing?._id],
      });
    }
  }

  const expectedTransactionByKey = new Map(
    transactions.map((entry) => [entry.migration.legacy_key, entry]),
  );
  const expectedTransactionById = new Map(
    transactions
      .filter((entry) => entry.migration.legacy_history_id)
      .map((entry) => [id(entry.migration.legacy_history_id), entry]),
  );
  for (const existing of snapshot.existingTransactions || []) {
    const key = String(existing?.migration?.legacy_key || "");
    const expected =
      expectedTransactionByKey.get(key) ||
      expectedTransactionById.get(id(existing?.migration?.legacy_history_id));
    if (!expected || id(existing?.inspector) !== analysis.inspector_id) continue;
    const existingBusiness = stableValue({
      action: existing?.action,
      labels: inspectSerials(existing?.labels).labels,
      previous_labels: inspectSerials(existing?.previous_labels).labels,
      next_labels: inspectSerials(existing?.next_labels).labels,
      from_inspector: id(existing?.from_inspector) || null,
      to_inspector: id(existing?.to_inspector) || null,
      actor: {
        user: id(existing?.actor?.user) || null,
        name: String(existing?.actor?.name || ""),
      },
      recorded_at: validDate(existing?.recorded_at, new Date(0)),
      remarks: String(existing?.remarks || "").trim(),
    });
    const expectedBusiness = stableValue({
      action: expected.action,
      labels: expected.labels,
      previous_labels: expected.previous_labels,
      next_labels: expected.next_labels,
      from_inspector: expected.from_inspector,
      to_inspector: expected.to_inspector,
      actor: expected.actor,
      recorded_at: expected.recorded_at,
      remarks: expected.remarks,
    });
    const migrationOwned =
      existing?.migration?.source === MIGRATION_SOURCE ||
      existing?.migration?.migrated === true;
    if (!migrationOwned && !equalStable(existingBusiness, expectedBusiness)) {
      addConflict(analysis, {
        conflictType: "modern_transaction_incompatible",
        severity: "error",
        modernEvidence: {
          legacy_key: key,
          source: existing?.migration?.source || "",
          business_fields: existingBusiness,
        },
        sourceDocumentIds: [existing?._id],
      });
    }
  }

  const expectedUsageByInspection = new Map(
    usages.map((entry) => [id(entry.inspection_record), entry]),
  );
  for (const existing of snapshot.existingUsages || []) {
    const inspectionId = id(existing?.inspection_record);
    const expected = expectedUsageByInspection.get(inspectionId);
    if (!expected) continue;
    const sameInspector = id(existing?.inspector) === analysis.inspector_id;
    const sameLabels =
      JSON.stringify(inspectSerials(existing?.labels).labels) ===
      JSON.stringify(expected.labels);
    const migrationOwned =
      existing?.migration?.source === MIGRATION_SOURCE ||
      existing?.migration?.migrated === true;
    if (!sameInspector || (!sameLabels && !migrationOwned)) {
      addConflict(analysis, {
        conflictType: "modern_usage_incompatible",
        severity: "error",
        modernEvidence: {
          inspection_record: inspectionId,
          inspector: id(existing?.inspector),
          labels: inspectSerials(existing?.labels).labels,
          source: existing?.migration?.source || "",
        },
        sourceDocumentIds: [existing?._id, existing?.inspection_record],
      });
    }
  }
};

const computeSourceFingerprint = (inspector, inspections) =>
  fingerprint({
    inspector: {
      _id: id(inspector?._id),
      user: id(inspector?.user),
      alloted_labels: inspector?.alloted_labels || [],
      used_labels: inspector?.used_labels || [],
      rejected_labels: inspector?.rejected_labels || [],
      label_allocation_history: inspector?.label_allocation_history || [],
      label_used_history: inspector?.label_used_history || [],
      updatedAt: inspector?.updatedAt || null,
    },
    inspections: (inspections || [])
      .map((entry) => ({
        _id: id(entry?._id),
        qc: id(entry?.qc),
        labels_added: entry?.labels_added || [],
        status: entry?.status || "",
        updatedAt: entry?.updatedAt || null,
      }))
      .sort((left, right) => left._id.localeCompare(right._id)),
  });

const buildMigrationAnalysis = (snapshot = {}) => {
  const inspector = snapshot.inspector || {};
  const analysis = {
    inspector_id: id(inspector?._id),
    inspector_user_id: id(inspector?.user),
    source_fingerprint: computeSourceFingerprint(
      inspector,
      snapshot.inspections || [],
    ),
    conflicts: [],
    resolved_conflicts: Array.isArray(snapshot.resolvedConflicts)
      ? snapshot.resolvedConflicts
      : [],
    blocking_label_numbers: new Set(),
    quarantine_label_numbers: new Set(),
    non_label_blocking_conflicts: [],
    observations: {},
    expected: {},
    _conflictFingerprints: new Set(),
  };

  if (!isObjectId(analysis.inspector_id) || !isObjectId(analysis.inspector_user_id)) {
    addConflict(analysis, {
      conflictType: "inspector_identity_unresolved",
      severity: "error",
      legacyEvidence: {
        inspector: analysis.inspector_id,
        user: analysis.inspector_user_id,
      },
      sourceDocumentIds: [inspector?._id, inspector?.user],
    });
  }

  const allocated = inspectSerials(inspector?.alloted_labels);
  const derivedUsed = inspectSerials(inspector?.used_labels);
  const rejected = inspectSerials(inspector?.rejected_labels);
  addSerialFindings(analysis, allocated, "Inspector.alloted_labels", [inspector?._id]);
  addSerialFindings(analysis, derivedUsed, "Inspector.used_labels", [inspector?._id]);
  addSerialFindings(analysis, rejected, "Inspector.rejected_labels", [inspector?._id]);

  const transactions = buildTransactions(analysis, inspector);
  const { usages, usageEvidence } = buildUsages(
    analysis,
    inspector,
    snapshot.inspections || [],
  );
  compareUsageHistory(analysis, inspector, usages);

  const forensicUsed = sorted(usageEvidence.keys());
  const forensicUsedSet = new Set(forensicUsed);
  const allocatedSet = new Set(allocated.labels);
  const rejectedSet = new Set(rejected.labels);
  const derivedUsedSet = new Set(derivedUsed.labels);
  const missingFromDerived = difference(forensicUsed, derivedUsedSet);
  const missingEvidence = difference(derivedUsed.labels, forensicUsedSet);
  if (missingFromDerived.length > 0 || missingEvidence.length > 0) {
    addConflict(analysis, {
      conflictType: "derived_used_labels_mismatch",
      legacyEvidence: {
        inspection_only: missingFromDerived,
        inspector_used_labels_only: missingEvidence,
      },
      sourceDocumentIds: [
        inspector?._id,
        ...(snapshot.inspections || []).map((entry) => entry?._id),
      ],
    });
  }

  const allocatedAndUsed = allocated.labels.filter((number) =>
    forensicUsedSet.has(number),
  );
  const usedNotAllocated = forensicUsed.filter((number) => !allocatedSet.has(number));
  const allocatedUnused = allocated.labels.filter(
    (number) => !forensicUsedSet.has(number),
  );
  const rejectedOverlaps = rejected.labels.filter(
    (number) => allocatedSet.has(number) || forensicUsedSet.has(number),
  );
  if (rejectedOverlaps.length > 0) {
    addConflict(analysis, {
      conflictType: "rejected_state_overlap",
      labelNumber: rejectedOverlaps.length === 1 ? rejectedOverlaps[0] : null,
      legacyEvidence: { labels: rejectedOverlaps },
      sourceDocumentIds: [inspector?._id],
    });
  }

  const expectedLabels = new Map();
  const relevant = new Set([
    ...allocated.labels,
    ...forensicUsed,
    ...rejected.labels,
  ]);
  for (const number of relevant) {
    const evidence = usageEvidence.get(number) || [];
    const latestSourceUpdate = evidence
      .map((entry) => {
        const inspection = (snapshot.inspections || []).find(
          (row) => id(row?._id) === entry.inspection_record,
        );
        return validDate(inspection?.updatedAt, validDate(inspection?.createdAt));
      })
      .filter(Boolean)
      .sort((left, right) => right - left)[0] || null;
    expectedLabels.set(number, {
      number,
      owner_inspector: allocatedSet.has(number) ? analysis.inspector_id : null,
      rejected_by_inspector: rejectedSet.has(number)
        ? analysis.inspector_id
        : null,
      usage_inspector: null,
      usage_inspectors: [],
      usage_source_updated_at: latestSourceUpdate,
    });
  }

  buildGlobalMaps(
    analysis,
    relevant,
    snapshot.globalInspectors || [],
    snapshot.globalInspections || [],
  );
  classifyConflicts(analysis);
  const globalLabelMaps = collectGlobalLabelMaps(
    relevant,
    snapshot.globalInspectors || [],
    snapshot.globalInspections || [],
  );
  for (const expected of expectedLabels.values()) {
    const allocationOwners = [
      ...(globalLabelMaps.allocated.get(expected.number) || new Set()),
    ].sort();
    const rejectionOwners = [
      ...(globalLabelMaps.rejected.get(expected.number) || new Set()),
    ].sort();
    expected.owner_inspector = allocationOwners.length === 1
      ? allocationOwners[0]
      : null;
    expected.rejected_by_inspector = rejectionOwners.length === 1
      ? rejectionOwners[0]
      : null;
    const resolvedOwner = analysis.resolved_allocation_owners.get(expected.number);
    if (resolvedOwner) expected.owner_inspector = resolvedOwner;
    if (analysis.quarantine_label_numbers.has(expected.number)) {
      const conflicts = analysis.conflicts.filter(
        (entry) => Number(entry.label_number) === expected.number,
      );
      if (conflicts.some((entry) => entry.conflict_type === 'multiple_current_allocation_claims')) {
        expected.owner_inspector = null;
      }
      if (conflicts.some((entry) => entry.conflict_type === 'multiple_current_rejection_claims')) {
        expected.rejected_by_inspector = null;
      }
      expected.allocation_state = 'conflicted';
    } else {
      expected.allocation_state = 'active';
    }
    expected.usage_inspectors = [
      ...(globalLabelMaps.used.get(expected.number) || new Set()),
    ].sort();
    expected.usage_inspector = expected.usage_inspectors.length === 1
      ? expected.usage_inspectors[0]
      : null;
  }
  compareExistingModern(
    analysis,
    expectedLabels,
    transactions,
    usages,
    snapshot,
  );

  const state = snapshot.storageState;
  if (state && !isSafePreCutoverStorageState(state)) {
    addConflict(analysis, {
      conflictType: "unsafe_storage_state",
      severity: "error",
      modernEvidence: {
        schema_version: state.schema_version,
        migration_status: state.migration_status,
        read_source: state.read_source,
        write_mode: state.write_mode,
      },
      sourceDocumentIds: [state?._id],
    });
  }

  classifyConflicts(analysis);
  for (const expected of expectedLabels.values()) {
    if (analysis.quarantine_label_numbers.has(expected.number)) {
      const conflicts = analysis.conflicts.filter(
        (entry) => Number(entry.label_number) === expected.number,
      );
      if (conflicts.some((entry) => entry.conflict_type === 'multiple_current_allocation_claims')) {
        expected.owner_inspector = null;
      }
      if (conflicts.some((entry) => entry.conflict_type === 'multiple_current_rejection_claims')) {
        expected.rejected_by_inspector = null;
      }
      expected.allocation_state = 'conflicted';
    }
  }

  analysis.observations = {
    allocated_and_used: allocatedAndUsed,
    used_not_allocated: usedNotAllocated,
    allocated_unused: allocatedUnused,
    rejected_overlaps: rejectedOverlaps,
    transferred_inspection_records: (snapshot.inspections || []).filter((entry) =>
      TRANSFERRED_STATUSES.has(String(entry?.status || "").trim().toLowerCase()),
    ).length,
  };
  analysis.expected = {
    labels: [...expectedLabels.values()],
    transactions,
    usages,
  };
  analysis.summary = {
    raw_allocated_count: Array.isArray(inspector?.alloted_labels)
      ? inspector.alloted_labels.length
      : 0,
    allocated_count: allocated.labels.length,
    forensic_used_count: forensicUsed.length,
    unused_count: allocatedUnused.length,
    rejected_count: rejected.labels.length,
    transaction_count: transactions.length,
    usage_record_count: usages.length,
    warning_count: analysis.conflicts.filter(
      (entry) => entry.severity === "warning",
    ).length,
    error_count: analysis.conflicts.filter(
      (entry) => entry.severity === "error",
    ).length,
    usage_percentage: allocated.labels.length > 0
      ? ((forensicUsed.length / allocated.labels.length) * 100).toFixed(2)
      : 0,
  };
  analysis.summary.blocking_conflict_count = analysis.conflicts.filter(
    (entry) => entry.severity === 'error',
  ).length;
  analysis.summary.blocking_label_count = analysis.blocking_label_numbers.size;
  analysis.summary.quarantine_label_count = analysis.quarantine_label_numbers.size;
  analysis.non_label_blocking_conflicts = analysis.conflicts.filter(
    (entry) =>
      entry.severity === 'error' &&
      !(Number.isInteger(Number(entry.label_number)) && Number(entry.label_number) > 0),
  );
  analysis.skip_label_numbers = new Set(
    analysis.conflicts
      .filter(
        (entry) =>
          entry.severity === 'error' &&
          Number.isInteger(Number(entry.label_number)) &&
          !QUARANTINE_CONFLICT_TYPES.has(entry.conflict_type),
      )
      .map((entry) => Number(entry.label_number)),
  );
  analysis.summary.partial_backfill =
    analysis.summary.blocking_conflict_count > 0 &&
    analysis.non_label_blocking_conflicts.length === 0;
  analysis.can_backfill = analysis.non_label_blocking_conflicts.length === 0;
  analysis.can_apply = analysis.summary.error_count === 0;
  analysis.migration_classification = analysis.summary.blocking_conflict_count > 0
    ? 'BLOCKED_CURRENT_STATE'
    : analysis.summary.warning_count > 0
      ? 'REPRESENTABLE_ANOMALIES'
      : 'CLEAN';
  analysis.resolved_conflicts = undefined;
  delete analysis._conflictFingerprints;
  return analysis;
};

const getInspectorArgument = (argv = process.argv.slice(2)) => {
  const equals = argv.find((entry) => entry.startsWith("--inspector="));
  if (equals) return equals.slice("--inspector=".length).trim();
  const index = argv.indexOf("--inspector");
  return index >= 0 ? String(argv[index + 1] || "").trim() : "";
};

const getBatchInspectorIds = async ({ includeVerified = false } = {}) => {
  const filter = { migration_status: { $in: ['verified', 'modern'] } };
  const states = await LabelStorageState.find(filter).select('inspector').lean();
  const stateIds = new Set(states.map((entry) => id(entry.inspector)));
  const inspectors = await Inspector.find({}).select('_id').sort({ _id: 1 }).lean();
  return inspectors
    .filter((entry) => includeVerified || !stateIds.has(id(entry._id)))
    .map((entry) => entry._id);
};

const loadSnapshot = async (inspectorId) => {
  if (!mongoose.Types.ObjectId.isValid(inspectorId)) {
    throw new Error("--inspector must be a valid Inspector document id");
  }
  const inspector = await Inspector.findById(inspectorId)
    .select(
      "user alloted_labels used_labels rejected_labels label_allocation_history label_used_history createdAt updatedAt",
    )
    .lean();
  if (!inspector) throw new Error("Inspector not found");
  if (!isObjectId(inspector.user)) {
    throw new Error("Inspector.user is missing or invalid");
  }

  const inspections = await Inspection.find({ inspector: inspector.user })
    .select(
      "qc inspector request_history_id inspection_date labels_added status createdAt updatedAt",
    )
    .populate("qc", "order_meta item request_date last_inspected_date")
    .lean();
  const relevant = new Set([
    ...inspectSerials(inspector.alloted_labels).labels,
    ...inspectSerials(inspector.used_labels).labels,
    ...inspectSerials(inspector.rejected_labels).labels,
    ...inspections.flatMap((entry) => inspectSerials(entry?.labels_added).labels),
  ]);
  const numbers = [...relevant];
  const globalInspections = numbers.length > 0
    ? await Inspection.find({ labels_added: { $in: numbers } })
        .select("_id inspector labels_added status qc createdAt updatedAt")
        .lean()
    : [];
  const usageUserIds = [
    ...new Set(globalInspections.map((entry) => id(entry?.inspector)).filter(isObjectId)),
  ];
  const inspectorMatch = [
    { _id: inspector._id },
    ...(numbers.length > 0
      ? [
          { alloted_labels: { $in: numbers } },
          { rejected_labels: { $in: numbers } },
        ]
      : []),
    ...(usageUserIds.length > 0 ? [{ user: { $in: usageUserIds } }] : []),
  ];
  const globalInspectors = await Inspector.find({ $or: inspectorMatch })
    .select("_id user alloted_labels rejected_labels")
    .lean();
  const existingLabelMatch = [
    { owner_inspector: inspector._id },
    { rejected_by_inspector: inspector._id },
    { "usage.inspector": inspector._id },
    { inspector: inspector._id },
    ...(numbers.length > 0 ? [{ number: { $in: numbers } }] : []),
  ];
  const inspectionIds = inspections.map((entry) => entry._id);

  const [
    existingLabels,
    existingTransactions,
    existingUsages,
    storageState,
    resolvedConflicts,
  ] = await Promise.all([
    Label.find({ $or: existingLabelMatch }).lean(),
    LabelTransaction.find({ inspector: inspector._id }).lean(),
    LabelUsage.find({
      $or: [
        { inspector: inspector._id },
        ...(inspectionIds.length > 0
          ? [{ inspection_record: { $in: inspectionIds } }]
          : []),
      ],
    }).lean(),
    LabelStorageState.findOne({ inspector: inspector._id }).lean(),
    LabelMigrationConflict.find({
      label_number: { $in: numbers },
      status: 'resolved',
    }).lean(),
  ]);

  return {
    inspector,
    inspections,
    globalInspectors,
    globalInspections,
    existingLabels,
    existingTransactions,
    existingUsages,
    storageState,
    resolvedConflicts,
  };
};

const recordConflicts = async (analysis) => {
  const now = new Date();
  if (analysis.conflicts.length > 0) {
    await LabelMigrationConflict.bulkWrite(
      analysis.conflicts.map((entry) => ({
        updateOne: {
          filter: { fingerprint: entry.fingerprint },
          update: {
            $set: {
              inspector: entry.inspector,
              label_number: entry.label_number,
              conflict_type: entry.conflict_type,
              severity: entry.severity,
              legacy_evidence: entry.legacy_evidence,
              modern_evidence: entry.modern_evidence,
              source_document_ids: entry.source_document_ids,
              status: "open",
              last_seen_at: now,
              resolved_at: null,
            },
            $setOnInsert: { detected_at: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  await LabelMigrationConflict.updateMany(
    {
      inspector: analysis.inspector_id,
      status: "open",
      fingerprint: {
        $nin: analysis.conflicts.map((entry) => entry.fingerprint),
      },
    },
    {
      $set: {
        status: "resolved",
        resolved_at: now,
        last_seen_at: now,
      },
    },
  );
};

const splitMigration = (entry) => {
  const { migration = {}, ...fields } = entry;
  return {
    fields: {
      ...fields,
      "migration.migrated": migration.migrated,
      "migration.source": migration.source,
      ...(migration.legacy_inspector
        ? { "migration.legacy_inspector": migration.legacy_inspector }
        : {}),
      ...(migration.legacy_history_id
        ? { "migration.legacy_history_id": migration.legacy_history_id }
        : {}),
      ...(migration.legacy_key
        ? { "migration.legacy_key": migration.legacy_key }
        : {}),
    },
  };
};

const buildUsageWriteOperations = (usages, migratedAt) =>
  usages.map((entry) => {
    const { fields } = splitMigration(entry);
    return {
      updateOne: {
        filter: { inspection_record: entry.inspection_record },
        update: {
          $set: fields,
          $setOnInsert: { "migration.migrated_at": migratedAt },
        },
        upsert: true,
      },
    };
  });

const applyMigration = async (analysis) => {
  await recordConflicts(analysis);
  if (analysis.can_backfill === false) {
    throw new Error(
      "Migration blocked by " + analysis.summary.error_count + " error conflict(s)",
    );
  }

  await Promise.all([
    Label.createIndexes(),
    LabelTransaction.createIndexes(),
    LabelUsage.createIndexes(),
    LabelStorageState.createIndexes(),
    LabelMigrationConflict.createIndexes(),
  ]);

  const inspectorId = new mongoose.Types.ObjectId(analysis.inspector_id);
  const now = new Date();
  await LabelStorageState.updateOne(
    { inspector: inspectorId },
    {
      $set: {
        schema_version: 2,
        migration_status: "backfilling",
        "last_error.message": "",
        "last_error.at": null,
      },
      $setOnInsert: {
        read_source: "legacy",
        write_mode: "legacy",
        legacy_fallback_enabled: true,
      },
    },
    { upsert: true },
  );

  try {
    const expectedNumbers = analysis.expected.labels.map((entry) => entry.number);
    const labelOps = analysis.expected.labels
      .filter((entry) => !analysis.skip_label_numbers.has(entry.number))
      .map((entry) => ({
      updateOne: {
        filter: { number: entry.number },
        update: {
          $set: {
            owner_inspector: entry.owner_inspector,
            rejected_by_inspector: entry.rejected_by_inspector,
            "usage.inspector": entry.usage_inspector,
            "usage.source_updated_at": entry.usage_source_updated_at,
            "migration.source": MIGRATION_SOURCE,
          },
          $setOnInsert: {
            number: entry.number,
            "migration.migrated_at": now,
          },
        },
        upsert: true,
      },
    }));
    labelOps.forEach((operation) => {
      const expected = analysis.expected.labels.find(
        (entry) => entry.number === operation.updateOne.filter.number,
      );
      operation.updateOne.update.$set.allocation_state =
        expected?.allocation_state || 'active';
      operation.updateOne.update.$set['usage.inspectors'] =
        expected?.usage_inspectors || [];
    });
    if (labelOps.length > 0) {
      await Label.bulkWrite(labelOps, { ordered: false });
    }
    await Label.updateMany(
      {
        number: { $nin: expectedNumbers },
        $or: [
          { owner_inspector: inspectorId },
          { rejected_by_inspector: inspectorId },
          { "usage.inspector": inspectorId },
        ],
      },
      [
        {
          $set: {
            owner_inspector: {
              $cond: [
                { $eq: ["$owner_inspector", inspectorId] },
                null,
                "$owner_inspector",
              ],
            },
            rejected_by_inspector: {
              $cond: [
                { $eq: ["$rejected_by_inspector", inspectorId] },
                null,
                "$rejected_by_inspector",
              ],
            },
            "usage.inspector": {
              $cond: [
                { $eq: ["$usage.inspector", inspectorId] },
                null,
                "$usage.inspector",
              ],
            },
            "usage.source_updated_at": {
              $cond: [
                { $eq: ["$usage.inspector", inspectorId] },
                null,
                "$usage.source_updated_at",
              ],
            },
          },
        },
      ],
      { updatePipeline: true },
    );
    await Label.updateMany(
      {
        number: { $nin: expectedNumbers },
        'usage.inspectors': inspectorId,
      },
      [
        {
          $set: {
            'usage.inspectors': {
              $let: {
                vars: {
                  remaining: {
                    $filter: {
                      input: { $ifNull: ['$usage.inspectors', []] },
                      as: 'owner',
                      cond: { $ne: ['$$owner', inspectorId] },
                    },
                  },
                },
                in: '$$remaining',
              },
            },
            'usage.inspector': {
              $let: {
                vars: {
                  remaining: {
                    $filter: {
                      input: { $ifNull: ['$usage.inspectors', []] },
                      as: 'owner',
                      cond: { $ne: ['$$owner', inspectorId] },
                    },
                  },
                },
                in: {
                  $cond: [
                    { $eq: [{ $size: '$$remaining' }, 1] },
                    { $arrayElemAt: ['$$remaining', 0] },
                    null,
                  ],
                },
              },
            },
          },
        },
      ],
      { updatePipeline: true },
    );

    const transactionKeys = analysis.expected.transactions.map(
      (entry) => entry.migration.legacy_key,
    );
    if (analysis.expected.transactions.length > 0) {
      await LabelTransaction.bulkWrite(
        analysis.expected.transactions.map((entry) => {
          const { fields } = splitMigration(entry);
          const identity = entry.migration.legacy_history_id
            ? {
                "migration.legacy_inspector": inspectorId,
                $or: [
                  { "migration.legacy_key": entry.migration.legacy_key },
                  {
                    "migration.legacy_history_id":
                      entry.migration.legacy_history_id,
                  },
                ],
              }
            : {
                "migration.legacy_inspector": inspectorId,
                "migration.legacy_key": entry.migration.legacy_key,
              };
          return {
            updateOne: {
              filter: identity,
              update: {
                $set: fields,
                $setOnInsert: { "migration.migrated_at": now },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }
    await LabelTransaction.deleteMany({
      inspector: inspectorId,
      "migration.source": MIGRATION_SOURCE,
      "migration.legacy_key": { $nin: transactionKeys },
    });

    const usageInspectionIds = analysis.expected.usages.map(
      (entry) => entry.inspection_record,
    );
    if (analysis.expected.usages.length > 0) {
      await LabelUsage.bulkWrite(
        buildUsageWriteOperations(analysis.expected.usages, now),
        { ordered: false },
      );
    }
    await LabelUsage.deleteMany({
      inspector: inspectorId,
      "migration.source": MIGRATION_SOURCE,
      inspection_record: { $nin: usageInspectionIds },
    });

    const currentInspector = await Inspector.findById(inspectorId)
      .select(
        "user alloted_labels used_labels rejected_labels label_allocation_history label_used_history updatedAt",
      )
      .lean();
    const currentInspections = await Inspection.find({
      inspector: analysis.inspector_user_id,
    })
      .select("_id qc labels_added status createdAt updatedAt")
      .populate("qc", "_id")
      .lean();
    if (
      computeSourceFingerprint(currentInspector, currentInspections) !==
      analysis.source_fingerprint
    ) {
      throw new Error(
        "Legacy label sources changed during apply; rerun dry-run before resuming",
      );
    }

    await LabelStorageState.updateOne(
      { inspector: inspectorId },
      {
        $set: {
          schema_version: 2,
          backfilled_at: now,
          migration_status: analysis.summary.partial_backfill
            ? 'backfilled_with_conflicts'
            : 'backfilled',
          "last_error.message": "",
          "last_error.at": null,
        },
      },
    );
    return {
      labels: analysis.expected.labels.length,
      transactions: analysis.expected.transactions.length,
      usages: analysis.expected.usages.length,
      migration_status: analysis.summary.partial_backfill
        ? 'backfilled_with_conflicts'
        : 'backfilled',
      read_source: "legacy",
      write_mode: "legacy",
    };
  } catch (error) {
    await LabelStorageState.updateOne(
      { inspector: inspectorId },
      {
        $set: {
          migration_status: "failed",
          "last_error.message": error?.message || String(error),
          "last_error.at": new Date(),
        },
      },
    ).catch(() => {});
    throw error;
  }
};

const printableAnalysis = (analysis, { mode, applyResult = null } = {}) => ({
  mode,
  inspector: {
    document_id: analysis.inspector_id,
    user_id: analysis.inspector_user_id,
  },
  authority: {
    allocation: "Inspector.alloted_labels",
    rejected: "Inspector.rejected_labels",
    usage: "Inspection.labels_added (all statuses, including transferred)",
    derived_only: ["Inspector.used_labels", "Inspector.label_used_history", "QC.labels"],
  },
  summary: analysis.summary,
  observations: Object.fromEntries(
    Object.entries(analysis.observations).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? { count: value.length, sample: value.slice(0, 50) }
        : value,
    ]),
  ),
  can_apply: analysis.can_apply,
  can_backfill: analysis.can_backfill,
  migration_classification: analysis.migration_classification,
  partial_backfill: Boolean(analysis.summary?.partial_backfill),
  conflicts: analysis.conflicts.slice(0, 100),
  conflict_output_truncated: analysis.conflicts.length > 100,
  apply_result: applyResult,
});

const main = async () => {
  const argv = process.argv.slice(2);
  const inspectorId = getInspectorArgument(argv);
  const all = argv.includes('--all');
  const includeVerified = argv.includes('--include-verified');
  const apply = argv.includes("--apply");
  const dryRun = argv.includes("--dry-run") || !apply;
  if (!inspectorId && !all) {
    throw new Error(
      "Usage: node scripts/migrateLabels.js --inspector <Inspector._id> [--dry-run|--apply]",
    );
  }
  if (inspectorId && all) {
    throw new Error('Use either --inspector or --all, not both');
  }
  if (apply && argv.includes("--dry-run")) {
    throw new Error("Use either --dry-run or --apply, not both");
  }

  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
    preserveExistingEnv: true,
  });
  await connectDB();
  if (all) {
    const inspectorIds = await getBatchInspectorIds({ includeVerified });
    const results = [];
    let failed = 0;
    for (const batchInspectorId of inspectorIds) {
      try {
        const analysis = buildMigrationAnalysis(
          await loadSnapshot(batchInspectorId),
        );
        let applyResult = null;
        if (!dryRun) applyResult = await applyMigration(analysis);
        results.push(printableAnalysis(analysis, {
          mode: dryRun ? 'dry-run' : 'apply',
          applyResult,
        }));
      } catch (error) {
        failed += 1;
        results.push({
          inspector: { document_id: String(batchInspectorId) },
          error: error?.message || String(error),
        });
      }
    }
    console.log(JSON.stringify({
      mode: dryRun ? 'dry-run' : 'apply',
      batch: true,
      inspector_count: inspectorIds.length,
      failed_count: failed,
      results,
    }, null, 2));
    if (dryRun) console.log('Batch dry-run complete: zero database writes were made.');
    if (failed > 0) process.exitCode = 1;
    return;
  }
  const analysis = buildMigrationAnalysis(await loadSnapshot(inspectorId));
  let applyResult = null;
  if (!dryRun) applyResult = await applyMigration(analysis);
  console.log(
    JSON.stringify(
      printableAnalysis(analysis, {
        mode: dryRun ? "dry-run" : "apply",
        applyResult,
      }),
      null,
      2,
    ),
  );
  if (dryRun) {
    console.log("Dry-run complete: zero database writes were made.");
  }
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("QC label migration failed:", error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.connection.close(false).catch(() => {});
    });
}

const {
  QUARANTINE_CONFLICT_TYPES,
  getBlockingLabelNumbers,
  getQuarantineLabelNumbers,
} = require('../services/labels/labelConflict.service');

module.exports = {
  MIGRATION_SOURCE,
  applyMigration,
  buildMigrationAnalysis,
  buildUsageWriteOperations,
  classifyConflicts,
  collectGlobalLabelMaps,
  computeSourceFingerprint,
  getBatchInspectorIds,
  getInspectorArgument,
  inspectSerials,
  loadSnapshot,
  printableAnalysis,
};
