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
const {
  getVendorCountry,
  getVendorId,
  getVendorName,
} = require("../helpers/vendorRef");

const id = (value) => String(value?._id || value || "").trim();
const normalizeSerials = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(Number)
        .filter((number) => Number.isInteger(number) && number > 0),
    ),
  ].sort((left, right) => left - right);
const setDifference = (left, right) => {
  const rightSet = new Set(right);
  return left.filter((number) => !rightSet.has(number));
};
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const iso = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const normalizeVendor = (value) => ({
  name: getVendorName(value),
  vendor_id: getVendorId(value) || null,
  country: getVendorCountry(value),
});

const normalizeTransaction = (entry = {}) => ({
  action: String(entry?.action || ""),
  labels: normalizeSerials(entry?.labels),
  previous_labels: normalizeSerials(entry?.previous_labels),
  next_labels: normalizeSerials(entry?.next_labels),
  from_inspector: id(entry?.from_inspector) || null,
  to_inspector: id(entry?.to_inspector) || null,
  actor: {
    user: id(entry?.actor?.user) || null,
    name: String(entry?.actor?.name || ""),
  },
  recorded_at: iso(entry?.recorded_at),
  remarks: String(entry?.remarks || "").trim(),
});

const normalizeUsage = (entry = {}, inspectorId) => {
  const isInspection = Array.isArray(entry?.labels_added);
  const qc =
    entry?.qc &&
    typeof entry.qc === "object" &&
    (entry.qc.order_meta || entry.qc.item)
      ? entry.qc
      : null;
  const qcMeta = qc
    ? {
        order_id: String(qc?.order_meta?.order_id || ""),
        brand: String(qc?.order_meta?.brand || ""),
        vendor: normalizeVendor(qc?.order_meta?.vendor),
        item_code: String(qc?.item?.item_code || ""),
        description: String(qc?.item?.description || ""),
      }
    : {
        order_id: String(entry?.qc_meta?.order_id || ""),
        brand: String(entry?.qc_meta?.brand || ""),
        vendor: normalizeVendor(entry?.qc_meta?.vendor),
        item_code: String(entry?.qc_meta?.item_code || ""),
        description: String(entry?.qc_meta?.description || ""),
      };
  return {
    inspector: inspectorId || id(entry?.inspector),
    labels: normalizeSerials(entry?.labels_added || entry?.labels),
    inspection_record: id(
      isInspection ? entry?._id : entry?.inspection_record,
    ),
    qc: id(qc?._id || entry?.qc) || null,
    request_history_id: id(entry?.request_history_id) || null,
    qc_meta: qcMeta,
    inspection_date: String(entry?.inspection_date || ""),
    used_at: iso(isInspection ? entry?.createdAt : entry?.used_at),
    source_updated_at: iso(
      isInspection
        ? entry?.updatedAt || entry?.createdAt
        : entry?.source_updated_at,
    ),
  };
};

const sortBusinessRows = (rows) =>
  rows
    .map((entry) => JSON.stringify(entry))
    .sort()
    .map((entry) => JSON.parse(entry));

const buildSummary = ({ allocated, used, rejected, rawAllocatedCount, rawRejectedCount }) => ({
  total_allocated: rawAllocatedCount ?? allocated.length,
  total_used: used.length,
  total_unused: setDifference(allocated, used).length,
  total_rejected: rawRejectedCount ?? rejected.length,
  usage_percentage: (rawAllocatedCount ?? allocated.length) > 0
    ? ((used.length / (rawAllocatedCount ?? allocated.length)) * 100).toFixed(2)
    : 0,
});

const check = (expected, actual) => ({
  passed: equal(expected, actual),
  expected,
  actual,
});

const buildVerificationReport = ({
  inspector = {},
  inspections = [],
  labels = [],
  transactions = [],
  usages = [],
  conflicts = [],
  storageState = null,
} = {}) => {
  const inspectorId = id(inspector?._id);
  const inspectorUserId = id(inspector?.user);
  const legacyAllocated = normalizeSerials(inspector?.alloted_labels);
  const forensicUsed = normalizeSerials(
    inspections.flatMap((entry) =>
      Array.isArray(entry?.labels_added) ? entry.labels_added : [],
    ),
  );
  const legacyRejected = normalizeSerials(inspector?.rejected_labels);
  const modernAllocated = normalizeSerials(
    labels
      .filter((entry) => id(entry?.owner_inspector) === inspectorId)
      .map((entry) => entry.number),
  );
  const modernUsed = normalizeSerials(
    labels
      .filter((entry) => id(entry?.usage?.inspector) === inspectorId)
      .map((entry) => entry.number),
  );
  const modernRejected = normalizeSerials(
    labels
      .filter((entry) => id(entry?.rejected_by_inspector) === inspectorId)
      .map((entry) => entry.number),
  );

  const legacyTransactions = sortBusinessRows(
    (Array.isArray(inspector?.label_allocation_history)
      ? inspector.label_allocation_history
      : []
    ).map(normalizeTransaction),
  );
  const modernTransactions = sortBusinessRows(
    transactions
      .filter((entry) => id(entry?.inspector) === inspectorId)
      .map(normalizeTransaction),
  );
  const forensicUsages = sortBusinessRows(
    inspections
      .filter((entry) => normalizeSerials(entry?.labels_added).length > 0)
      .map((entry) => normalizeUsage(entry, inspectorId)),
  );
  const modernUsages = sortBusinessRows(
    usages
      .filter((entry) => id(entry?.inspector) === inspectorId)
      .map((entry) => normalizeUsage(entry)),
  );
  const legacySummary = buildSummary({
    allocated: legacyAllocated,
    used: forensicUsed,
    rejected: legacyRejected,
    rawAllocatedCount: Array.isArray(inspector?.alloted_labels)
      ? inspector.alloted_labels.length
      : 0,
    rawRejectedCount: Array.isArray(inspector?.rejected_labels)
      ? inspector.rejected_labels.length
      : 0,
  });
  const modernSummary = buildSummary({
    allocated: modernAllocated,
    used: modernUsed,
    rejected: modernRejected,
  });
  const errorConflicts = conflicts.filter(
    (entry) =>
      String(entry?.status || "open") === "open" &&
      String(entry?.severity || "") === "error",
  );

  const checks = {
    inspector_identity: {
      passed:
        mongoose.Types.ObjectId.isValid(inspectorId) &&
        mongoose.Types.ObjectId.isValid(inspectorUserId) &&
        inspectorId !== inspectorUserId,
      expected: "distinct valid Inspector._id and User._id",
      actual: {
        inspector_id: inspectorId,
        inspector_user_id: inspectorUserId,
      },
    },
    allocation: check(legacyAllocated, modernAllocated),
    usage: check(forensicUsed, modernUsed),
    rejected: check(legacyRejected, modernRejected),
    unused: check(
      setDifference(legacyAllocated, forensicUsed),
      setDifference(modernAllocated, modernUsed),
    ),
    summary: check(legacySummary, modernSummary),
    allocation_history: check(legacyTransactions, modernTransactions),
    usage_history: check(forensicUsages, modernUsages),
    storage_safety: {
      passed:
        Number(storageState?.schema_version) >= 2 &&
        ["backfilled", "verifying", "verified"].includes(
          String(storageState?.migration_status || ""),
        ) &&
        String(storageState?.read_source || "") === "legacy" &&
        String(storageState?.write_mode || "") === "legacy",
      expected: {
        schema_version: 2,
        migration_status: "backfilled|verifying|verified",
        read_source: "legacy",
        write_mode: "legacy",
      },
      actual: storageState
        ? {
            schema_version: storageState.schema_version,
            migration_status: storageState.migration_status,
            read_source: storageState.read_source,
            write_mode: storageState.write_mode,
          }
        : null,
    },
    open_error_conflicts: {
      passed: errorConflicts.length === 0,
      expected: [],
      actual: errorConflicts.map((entry) => ({
        fingerprint: entry.fingerprint,
        conflict_type: entry.conflict_type,
        label_number: entry.label_number,
      })),
    },
  };
  const derivedUsedLabels = normalizeSerials(inspector?.used_labels);

  return {
    inspector: {
      document_id: inspectorId,
      user_id: inspectorUserId,
    },
    authority: {
      allocation: "Inspector.alloted_labels",
      rejected: "Inspector.rejected_labels",
      usage: "Inspection.labels_added (all statuses, including transferred)",
    },
    checks,
    derived_legacy_used_labels: {
      matches_forensic: equal(derivedUsedLabels, forensicUsed),
      inspector_used_labels: derivedUsedLabels,
      inspection_labels_added: forensicUsed,
    },
    passed: Object.values(checks).every((entry) => entry.passed),
  };
};

const getInspectorArgument = (argv = process.argv.slice(2)) => {
  const equals = argv.find((entry) => entry.startsWith("--inspector="));
  if (equals) return equals.slice("--inspector=".length).trim();
  const index = argv.indexOf("--inspector");
  return index >= 0 ? String(argv[index + 1] || "").trim() : "";
};

const loadVerificationSnapshot = async (inspectorId) => {
  if (!mongoose.Types.ObjectId.isValid(inspectorId)) {
    throw new Error("--inspector must be a valid Inspector document id");
  }
  const inspector = await Inspector.findById(inspectorId)
    .select(
      "user alloted_labels used_labels rejected_labels label_allocation_history label_used_history",
    )
    .lean();
  if (!inspector) throw new Error("Inspector not found");
  const inspections = await Inspection.find({ inspector: inspector.user })
    .select(
      "qc inspector request_history_id inspection_date labels_added status createdAt updatedAt",
    )
    .populate("qc", "order_meta item request_date last_inspected_date")
    .lean();
  const inspectionIds = inspections.map((entry) => entry._id);
  const [labels, transactions, usages, conflicts, storageState] =
    await Promise.all([
      Label.find({
        $or: [
          { owner_inspector: inspector._id },
          { rejected_by_inspector: inspector._id },
          { "usage.inspector": inspector._id },
        ],
      }).lean(),
      LabelTransaction.find({ inspector: inspector._id }).lean(),
      LabelUsage.find({
        $or: [
          { inspector: inspector._id },
          ...(inspectionIds.length > 0
            ? [{ inspection_record: { $in: inspectionIds } }]
            : []),
        ],
      }).lean(),
      LabelMigrationConflict.find({
        inspector: inspector._id,
        status: "open",
      }).lean(),
      LabelStorageState.findOne({ inspector: inspector._id }).lean(),
    ]);
  return {
    inspector,
    inspections,
    labels,
    transactions,
    usages,
    conflicts,
    storageState,
  };
};

const markVerified = async (report) => {
  if (!report.passed) {
    throw new Error("Verification failed; migration state was not changed");
  }
  const result = await LabelStorageState.updateOne(
    {
      inspector: report.inspector.document_id,
      schema_version: { $gte: 2 },
      migration_status: { $in: ["backfilled", "verifying", "verified"] },
      read_source: "legacy",
      write_mode: "legacy",
    },
    {
      $set: {
        migration_status: "verified",
        verified_at: new Date(),
        "last_error.message": "",
        "last_error.at": null,
      },
    },
  );
  if (result.matchedCount !== 1) {
    throw new Error("Safe legacy routing state changed during verification");
  }
};

const main = async () => {
  const argv = process.argv.slice(2);
  const inspectorId = getInspectorArgument(argv);
  const shouldMarkVerified = argv.includes("--mark-verified");
  if (!inspectorId) {
    throw new Error(
      "Usage: node scripts/verifyLabelMigration.js --inspector <Inspector._id> [--mark-verified]",
    );
  }

  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
    preserveExistingEnv: true,
  });
  await connectDB();
  const report = buildVerificationReport(
    await loadVerificationSnapshot(inspectorId),
  );
  if (shouldMarkVerified) await markVerified(report);
  console.log(
    JSON.stringify(
      {
        mode: shouldMarkVerified ? "verify-and-mark" : "verify",
        ...report,
        state_changed: shouldMarkVerified,
        read_source: "legacy",
        write_mode: "legacy",
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 2;
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("QC label verification failed:", error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.connection.close(false).catch(() => {});
    });
}

module.exports = {
  buildSummary,
  buildVerificationReport,
  getInspectorArgument,
  loadVerificationSnapshot,
  markVerified,
  normalizeSerials,
};
