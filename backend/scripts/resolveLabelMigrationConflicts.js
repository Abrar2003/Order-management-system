const path = require('node:path');
const mongoose = require('mongoose');

mongoose.set('autoIndex', false);

const { loadEnvFiles } = require('../config/loadEnv');
const connectDB = require('../config/connectDB');
const Inspector = require('../models/inspector.model');
const Inspection = require('../models/inspection.model');
const Label = require('../models/label.model');
const LabelUsage = require('../models/labelUsage.model');
const LabelTransaction = require('../models/labelTransaction.model');
const LabelMigrationConflict = require('../models/labelMigrationConflict.model');
const { isBlockingConflict } = require('../services/labels/labelConflict.service');

const getOption = (argv, name) => {
  const prefix = `--${name}=`;
  const equals = argv.find((entry) => entry.startsWith(prefix));
  if (equals) return equals.slice(prefix.length).trim();
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
};

const parseLabelNumber = (value) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error('--label must be a positive serial number');
  }
  return number;
};

const loadConflictEvidence = async (labelNumber) => {
  const [label, inspectors, inspections, usages, transactions, conflicts] =
    await Promise.all([
      Label.findOne({ number: labelNumber }).lean(),
      Inspector.find({
        $or: [
          { alloted_labels: labelNumber },
          { rejected_labels: labelNumber },
        ],
      }).select('_id user alloted_labels rejected_labels').populate('user', 'name email').lean(),
      Inspection.find({ labels_added: labelNumber })
        .select('_id inspector qc labels_added status createdAt updatedAt inspection_date')
        .populate('qc', 'order_meta item request_date')
        .sort({ createdAt: 1, _id: 1 })
        .lean(),
      LabelUsage.find({ labels: labelNumber }).sort({ used_at: 1, _id: 1 }).lean(),
      LabelTransaction.find({
        $or: [
          { labels: labelNumber },
          { previous_labels: labelNumber },
          { next_labels: labelNumber },
        ],
      }).sort({ recorded_at: 1, _id: 1 }).lean(),
      LabelMigrationConflict.find({ label_number: labelNumber })
        .sort({ status: 1, detected_at: 1, _id: 1 })
        .lean(),
    ]);
  return { label, inspectors, inspections, usages, transactions, conflicts };
};

const buildListing = (labelNumber, evidence) => ({
  serial: labelNumber,
  modern_label: evidence.label
    ? {
        id: evidence.label._id,
        owner_inspector: evidence.label.owner_inspector || null,
        allocation_state: evidence.label.allocation_state || 'active',
        rejected_by_inspector: evidence.label.rejected_by_inspector || null,
      }
    : null,
  current_allocation_claims: evidence.inspectors
    .filter((entry) => (entry.alloted_labels || []).map(Number).includes(labelNumber))
    .map((entry) => ({
      inspector: entry._id,
      user: entry.user?._id || entry.user || null,
      name: entry.user?.name || entry.user?.email || '',
    })),
  current_rejected_claims: evidence.inspectors
    .filter((entry) => (entry.rejected_labels || []).map(Number).includes(labelNumber))
    .map((entry) => ({ inspector: entry._id, user: entry.user?._id || entry.user || null })),
  usage_evidence: evidence.inspections.map((entry) => ({
    inspection_record: entry._id,
    inspector_user: entry.inspector,
    status: entry.status,
    used_at: entry.createdAt || null,
    source_updated_at: entry.updatedAt || entry.createdAt || null,
    qc: entry.qc
      ? {
          id: entry.qc._id,
          order_id: entry.qc.order_meta?.order_id || '',
          brand: entry.qc.order_meta?.brand || '',
        }
      : null,
  })),
  modern_usage_evidence: evidence.usages.map((entry) => ({
    inspection_record: entry.inspection_record,
    inspector: entry.inspector,
    used_at: entry.used_at,
    source_updated_at: entry.source_updated_at,
  })),
  allocation_history: evidence.transactions.map((entry) => ({
    id: entry._id,
    inspector: entry.inspector,
    action: entry.action,
    recorded_at: entry.recorded_at,
    from_inspector: entry.from_inspector || null,
    to_inspector: entry.to_inspector || null,
  })),
  conflicts: evidence.conflicts.map((entry) => ({
    id: entry._id,
    conflict_type: entry.conflict_type,
    severity: entry.severity,
    status: entry.status,
    resolution_type: entry.resolution_type || '',
    reason: entry.resolution_reason || '',
  })),
  suggested_interpretation: 'Informational only; operator must confirm source evidence.',
  auto_resolution: 'NO',
});

const resolveLabelConflict = async ({ labelNumber, owner, reason, operator }) => {
  if (!mongoose.Types.ObjectId.isValid(owner)) {
    throw new Error('--owner must be a valid Inspector document id');
  }
  if (!reason) throw new Error('--reason is required for manual resolution');
  const evidence = await loadConflictEvidence(labelNumber);
  const claims = evidence.inspectors
    .filter((entry) => (entry.alloted_labels || []).map(Number).includes(labelNumber))
    .map((entry) => String(entry._id));
  if (!claims.includes(String(owner))) {
    throw new Error('--owner must be one of the current allocation claim Inspectors');
  }
  const openConflicts = evidence.conflicts.filter(
    (entry) => entry.status === 'open' && isBlockingConflict(entry),
  );
  if (openConflicts.length === 0) {
    throw new Error('No open blocking conflict exists for this serial');
  }
  const allocationConflicts = openConflicts.filter((entry) =>
    ['multiple_current_allocation_claims', 'allocated_multiple_inspectors']
      .includes(String(entry.conflict_type || '')),
  );
  if (allocationConflicts.length === 0) {
    throw new Error('No open current-allocation conflict exists for this serial');
  }
  const now = new Date();
  const conflictIds = openConflicts.map((entry) => entry._id).filter(Boolean);
  const hasRemainingBlocking = openConflicts.some(
    (entry) => !allocationConflicts.includes(entry),
  );
  const resultingState = {
    number: labelNumber,
    owner_inspector: new mongoose.Types.ObjectId(owner),
    allocation_state: hasRemainingBlocking ? 'conflicted' : 'active',
  };
  const historyEntry = {
    resolution_type: 'owner_confirmed',
    canonical_current_owner: new mongoose.Types.ObjectId(owner),
    resolved_by: operator || process.env.USERNAME || process.env.USER || 'operator',
    resolved_at: now,
    reason,
    label_number: labelNumber,
    conflict_ids: conflictIds,
    previous_evidence: openConflicts.map((entry) => entry.legacy_evidence),
    resulting_canonical_state: resultingState,
  };
  const result = await LabelMigrationConflict.updateMany(
    {
      label_number: labelNumber,
      status: 'open',
      conflict_type: {
        $in: ['multiple_current_allocation_claims', 'allocated_multiple_inspectors'],
      },
    },
    {
      $set: {
        status: 'resolved',
        resolved_at: now,
        resolution_type: historyEntry.resolution_type,
        canonical_current_owner: historyEntry.canonical_current_owner,
        resolved_by: historyEntry.resolved_by,
        resolution_reason: reason,
        previous_evidence: historyEntry.previous_evidence,
        resulting_canonical_state: resultingState,
      },
      $push: { resolution_history: historyEntry },
    },
  );
  const labelResult = await Label.updateOne(
    { number: labelNumber },
    {
      $set: {
        owner_inspector: new mongoose.Types.ObjectId(owner),
        allocation_state: resultingState.allocation_state,
      },
    },
  );
  return {
    ...buildListing(labelNumber, await loadConflictEvidence(labelNumber)),
    resolution: {
      ...historyEntry,
      conflicts_updated: result.modifiedCount,
      label_updated: labelResult.modifiedCount,
      legacy_arrays_changed: false,
    },
  };
};

const main = async () => {
  const argv = process.argv.slice(2);
  const labelNumber = parseLabelNumber(getOption(argv, 'label'));
  const owner = getOption(argv, 'owner');
  const reason = getOption(argv, 'reason');
  const operator = getOption(argv, 'operator');
  loadEnvFiles({ cwd: path.resolve(__dirname, '..'), preserveExistingEnv: true });
  await connectDB();
  if (!owner) {
    console.log(JSON.stringify(buildListing(labelNumber, await loadConflictEvidence(labelNumber)), null, 2));
    return;
  }
  console.log(JSON.stringify(
    await resolveLabelConflict({ labelNumber, owner, reason, operator }),
    null,
    2,
  ));
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('QC label conflict resolution failed:', error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.connection.close(false).catch(() => {});
    });
}

module.exports = {
  buildListing,
  getOption,
  loadConflictEvidence,
  parseLabelNumber,
  resolveLabelConflict,
};
