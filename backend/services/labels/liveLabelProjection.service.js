const Label = require('../../models/label.model');
const LabelTransaction = require('../../models/labelTransaction.model');
const LabelUsage = require('../../models/labelUsage.model');
const { coerceVendorValueForSchema } = require('../../helpers/vendorRef');

const LIVE_USAGE_SOURCE = 'live_qc_usage';

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
  constructor({
    LabelModel = Label,
    LabelTransactionModel = LabelTransaction,
    LabelUsageModel = LabelUsage,
  } = {}) {
    this.Label = LabelModel;
    this.LabelTransaction = LabelTransactionModel;
    this.LabelUsage = LabelUsageModel;
  }

  async getValidationState(inspectorId, labels = []) {
    const numbers = normalizeLabels(labels);
    if (numbers.length === 0) {
      return { allocated: new Set(), used: new Set(), rejected: new Set() };
    }

    const records = await this.Label.find({ number: { $in: numbers } })
      .select('number allocation_state owner_inspector rejected_by_inspector usage')
      .lean();
    const sameId = (value) => String(value || '') === String(inspectorId || '');

    return {
      allocated: new Set(records
        .filter((record) => (
          record?.allocation_state !== 'conflicted'
          && sameId(record?.owner_inspector)
        ))
        .map((record) => Number(record.number))),
      used: new Set(records
        .filter((record) => (
          (Array.isArray(record?.usage?.inspectors)
            && record.usage.inspectors.length > 0)
          || record?.usage?.inspector
        ))
        .map((record) => Number(record.number))),
      rejected: new Set(records
        .filter((record) => sameId(record?.rejected_by_inspector))
        .map((record) => Number(record.number))),
    };
  }

  async claimAllocation({ inspectorId, labels = [], session = null, now = new Date() } = {}) {
    const numbers = normalizeLabels(labels);
    if (!inspectorId || numbers.length === 0) {
      throw new Error('Inspector and labels are required for allocation');
    }

    const result = await this.Label.bulkWrite(numbers.map((number) => ({
      updateOne: {
        // Claim only an unallocated, unused label. The unique number index also
        // turns a concurrent claim into a duplicate-key error rather than a takeover.
        filter: {
          number,
          owner_inspector: { $in: [null, inspectorId] },
          rejected_by_inspector: null,
          'usage.inspector': null,
          'usage.inspectors.0': { $exists: false },
          allocation_state: { $ne: 'conflicted' },
        },
        update: {
          $set: {
            owner_inspector: inspectorId,
            rejected_by_inspector: null,
            rejected_at: null,
          },
          $setOnInsert: {
            number,
            allocation_state: 'active',
            'migration.source': 'live_atomic_allocation',
            'migration.migrated_at': now,
          },
        },
        upsert: true,
      },
    })), {
      ordered: true,
      ...(session ? { session } : {}),
    });

    const claimed = Number(result?.matchedCount || 0) + Number(result?.upsertedCount || 0);
    if (claimed !== numbers.length) {
      const error = new Error('One or more labels are no longer available. Refresh and try again.');
      error.code = 'LABEL_CLAIM_CONFLICT';
      throw error;
    }
  }

  async refreshUsageLabels(labels = [], now = new Date()) {
    const numbers = normalizeLabels(labels);
    if (numbers.length === 0) return;

    const evidence = await this.LabelUsage.aggregate([
      { $match: { labels: { $in: numbers } } },
      { $unwind: '$labels' },
      { $match: { labels: { $in: numbers } } },
      {
        $group: {
          _id: '$labels',
          inspectors: { $addToSet: '$inspector' },
          source_updated_at: { $max: '$source_updated_at' },
        },
      },
    ]);
    const evidenceByNumber = new Map(
      evidence.map((entry) => [Number(entry._id), entry]),
    );

    await this.Label.bulkWrite(numbers.map((number) => {
      const entry = evidenceByNumber.get(number);
      const inspectors = Array.isArray(entry?.inspectors) ? entry.inspectors : [];
      return {
        updateOne: {
          filter: { number },
          update: {
            $set: {
              'usage.inspector': inspectors.length === 1 ? inspectors[0] : null,
              'usage.inspectors': inspectors,
              'usage.source_updated_at': entry?.source_updated_at || null,
            },
            $setOnInsert: {
              number,
              allocation_state: 'active',
              'migration.source': LIVE_USAGE_SOURCE,
              'migration.migrated_at': now,
            },
          },
          upsert: true,
        },
      };
    }), { ordered: false });
  }

  async syncInspectionUsage({ inspectorId, inspection = {}, qc = null } = {}) {
    if (!inspectorId || !inspection?._id) {
      throw new Error('Inspector and inspection record are required for usage projection');
    }

    const labels = normalizeLabels(inspection.labels_added);
    const previous = await this.LabelUsage.findOne({
      inspection_record: inspection._id,
    }).select('labels').lean();
    const affectedLabels = normalizeLabels([...(previous?.labels || []), ...labels]);
    const now = new Date();

    if (labels.length === 0) {
      await this.LabelUsage.deleteOne({ inspection_record: inspection._id });
    } else {
      const qcDoc = qc && typeof qc === 'object' ? qc : null;
      await this.LabelUsage.updateOne(
        { inspection_record: inspection._id },
        {
          $set: {
            inspector: inspectorId,
            labels,
            inspection_record: inspection._id,
            qc: qcDoc?._id || inspection.qc || null,
            request_history_id: inspection.request_history_id || null,
            qc_meta: {
              order_id: String(qcDoc?.order_meta?.order_id || ''),
              brand: String(qcDoc?.order_meta?.brand || ''),
              vendor: coerceVendorValueForSchema(qcDoc?.order_meta?.vendor),
              item_code: String(qcDoc?.item?.item_code || ''),
              description: String(qcDoc?.item?.description || ''),
            },
            inspection_date: String(inspection.inspection_date || ''),
            used_at: inspection.createdAt || now,
            source_updated_at: inspection.updatedAt || now,
            'migration.migrated': false,
            'migration.source': LIVE_USAGE_SOURCE,
            'migration.migrated_at': null,
          },
        },
        { upsert: true },
      );
    }

    await this.refreshUsageLabels(affectedLabels, now);
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
module.exports.LIVE_USAGE_SOURCE = LIVE_USAGE_SOURCE;
module.exports.difference = difference;
module.exports.normalizeLabels = normalizeLabels;
