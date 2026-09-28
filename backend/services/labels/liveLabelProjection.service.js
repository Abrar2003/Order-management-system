const Label = require('../../models/label.model');
const LabelTransaction = require('../../models/labelTransaction.model');

const normalizeLabels = (labels = []) => [...new Set(
  (Array.isArray(labels) ? labels : [])
    .map(Number)
    .filter((label) => Number.isInteger(label) && label > 0),
)].sort((left, right) => left - right);

const difference = (left = [], right = []) => {
  const rightSet = new Set(normalizeLabels(right));
  return normalizeLabels(left).filter((label) => !rightSet.has(label));
};

class LiveLabelProjectionService {
  constructor({ LabelModel = Label, LabelTransactionModel = LabelTransaction } = {}) {
    this.Label = LabelModel;
    this.LabelTransaction = LabelTransactionModel;
  }

  async upsertTransaction(inspectorId, history = {}, now = new Date()) {
    const action = String(history?.action || '').trim();
    const historyId = history?._id;
    if (!inspectorId || !historyId || !action) {
      throw new Error('A saved inspector label history entry is required for live mirroring');
    }

    const labels = normalizeLabels(history.labels);
    const previousLabels = normalizeLabels(history.previous_labels);
    const nextLabels = normalizeLabels(history.next_labels);
    await this.LabelTransaction.updateOne(
      {
        'migration.legacy_inspector': inspectorId,
        'migration.legacy_history_id': historyId,
      },
      {
        $set: {
          inspector: inspectorId,
          action,
          labels: normalizeLabels(history.labels),
          previous_labels: normalizeLabels(history.previous_labels),
          next_labels: normalizeLabels(history.next_labels),
          from_inspector: history.from_inspector || null,
          to_inspector: history.to_inspector || null,
          actor: history.actor || {},
          recorded_at: history.recorded_at || now,
          remarks: String(history.remarks || '').trim(),
          migration: {
            migrated: false,
            source: 'live_legacy_mirror',
            migrated_at: now,
            legacy_inspector: inspectorId,
            legacy_history_id: historyId,
          },
        },
      },
      { upsert: true },
    );
  }

  async mirrorInspectorChange({ inspectorId, history = {} } = {}) {
    const action = String(history?.action || '').trim();
    const historyId = history?._id;
    if (!inspectorId || !historyId || !action) {
      throw new Error('A saved inspector label history entry is required for live mirroring');
    }

    const labels = normalizeLabels(history.labels);
    const previousLabels = normalizeLabels(history.previous_labels);
    const nextLabels = normalizeLabels(history.next_labels);
    const now = new Date();
    const operations = [];

    if (action === 'reject') {
      labels.forEach((number) => {
        operations.push({
          updateOne: {
            filter: { number },
            update: {
              $set: {
                owner_inspector: null,
                rejected_by_inspector: inspectorId,
                rejected_at: now,
              },
              $setOnInsert: { number, allocation_state: 'active' },
            },
            upsert: true,
          },
        });
      });
    } else {
      difference(nextLabels, previousLabels).forEach((number) => {
        operations.push({
          updateOne: {
            filter: { number },
            update: {
              $set: { owner_inspector: inspectorId },
              $setOnInsert: { number, allocation_state: 'active' },
            },
            upsert: true,
          },
        });
      });
      difference(previousLabels, nextLabels).forEach((number) => {
        operations.push({
          updateOne: {
            filter: { number, owner_inspector: inspectorId },
            update: { $set: { owner_inspector: null } },
          },
        });
      });
    }

    // ponytail: idempotent upserts allow sync-failure replay; use a Mongo transaction if modern-only writes need atomicity.
    if (operations.length > 0) await this.Label.bulkWrite(operations, { ordered: true });

    await this.upsertTransaction(inspectorId, history, now);
  }

  async mirrorTransfer({
    sourceInspectorId,
    targetInspectorId,
    sourceHistory = {},
    targetHistory = {},
  } = {}) {
    const labels = normalizeLabels(sourceHistory.labels);
    if (!sourceInspectorId || !targetInspectorId || labels.length === 0) {
      throw new Error('Source, target, and labels are required for a live transfer mirror');
    }

    // ponytail: one conditional update makes replay safe; use a Mongo transaction for modern-only transfer authority.
    const result = await this.Label.updateMany(
      { number: { $in: labels }, owner_inspector: sourceInspectorId },
      { $set: { owner_inspector: targetInspectorId } },
    );
    if (Number(result?.matchedCount) !== labels.length) {
      throw new Error('Modern transfer ownership no longer matches the legacy source');
    }

    const now = new Date();
    await Promise.all([
      this.upsertTransaction(sourceInspectorId, sourceHistory, now),
      this.upsertTransaction(targetInspectorId, targetHistory, now),
    ]);
  }
}

module.exports = new LiveLabelProjectionService();
module.exports.LiveLabelProjectionService = LiveLabelProjectionService;
module.exports.difference = difference;
module.exports.normalizeLabels = normalizeLabels;
