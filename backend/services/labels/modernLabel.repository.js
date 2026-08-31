const Inspector = require('../../models/inspector.model');
const Label = require('../../models/label.model');
const LabelTransaction = require('../../models/labelTransaction.model');
const LabelUsage = require('../../models/labelUsage.model');
const LabelMigrationConflict = require('../../models/labelMigrationConflict.model');
const { isLabelAvailable } = require('./labelConflict.service');

const normalizeLabels = (records = []) =>
  [...new Set(
    (Array.isArray(records) ? records : [])
      .map((entry) => Number(entry?.number))
      .filter((label) => Number.isInteger(label) && label > 0),
  )].sort((left, right) => left - right);

const usageMatch = (inspectorId) => ({
  $or: [
    { 'usage.inspectors': inspectorId },
    {
      $and: [
        { 'usage.inspectors': { $exists: false } },
        { 'usage.inspector': inspectorId },
      ],
    },
  ],
});

class ModernLabelRepository {
  constructor({
    InspectorModel = Inspector,
    LabelModel = Label,
    LabelTransactionModel = LabelTransaction,
    LabelUsageModel = LabelUsage,
    LabelMigrationConflictModel = LabelMigrationConflict,
  } = {}) {
    this.Inspector = InspectorModel;
    this.Label = LabelModel;
    this.LabelTransaction = LabelTransactionModel;
    this.LabelUsage = LabelUsageModel;
    this.LabelMigrationConflict = LabelMigrationConflictModel;
  }

  async getLabels(inspectorId, field) {
    const records = await this.Label.find({ [field]: inspectorId })
      .select('number -_id')
      .sort({ number: 1 })
      .lean();
    return normalizeLabels(records);
  }

  getAllottedLabels(inspectorId) {
    return this.getLabels(inspectorId, 'owner_inspector');
  }

  async getUsedLabels(inspectorId) {
    const records = await this.Label.find(usageMatch(inspectorId))
      .select('number -_id')
      .sort({ number: 1 })
      .lean();
    return normalizeLabels(records);
  }

  getRejectedLabels(inspectorId) {
    return this.getLabels(inspectorId, 'rejected_by_inspector');
  }

  async getAvailableLabels(numbers = []) {
    const filter = {
      allocation_state: { $ne: 'conflicted' },
      owner_inspector: null,
      rejected_by_inspector: null,
    };
    if (Array.isArray(numbers) && numbers.length > 0) {
      filter.number = { $in: numbers };
    }
    const records = await this.Label.find(filter)
      .select('number -_id')
      .sort({ number: 1 })
      .lean();
    if (records.length === 0) return [];
    const conflicts = await this.LabelMigrationConflict.find({
      label_number: { $in: records.map((entry) => entry.number) },
      status: 'open',
    }).lean();
    return normalizeLabels(
      records.filter((entry) => isLabelAvailable(entry, conflicts)),
    );
  }

  getAllocationHistory(inspectorId) {
    return this.LabelTransaction.find({ inspector: inspectorId })
      .sort({ recorded_at: -1 })
      .lean();
  }

  getUsageHistory(inspectorId) {
    return this.LabelUsage.find({ inspector: inspectorId })
      .sort({ used_at: -1 })
      .lean();
  }

  async getSummary(inspectorId) {
    const inspector = await this.Inspector.findById(inspectorId)
      .select('user')
      .lean();
    if (!inspector) return null;

    const [totalAllocated, totalUsed, totalUnused, totalRejected] = await Promise.all([
      this.Label.countDocuments({ owner_inspector: inspectorId }),
      this.Label.countDocuments({
        ...usageMatch(inspectorId),
      }),
      this.Label.countDocuments({
        owner_inspector: inspectorId,
        $nor: [
          { 'usage.inspectors': inspectorId },
          {
            $and: [
              { 'usage.inspectors': { $exists: false } },
              { 'usage.inspector': inspectorId },
            ],
          },
        ],
      }),
      this.Label.countDocuments({ rejected_by_inspector: inspectorId }),
    ]);

    return {
      inspector: inspector.user,
      total_allocated: totalAllocated,
      total_used: totalUsed,
      total_unused: totalUnused,
      total_rejected: totalRejected,
      usage_percentage: totalAllocated > 0
        ? ((totalUsed / totalAllocated) * 100).toFixed(2)
        : 0,
    };
  }
}

module.exports = new ModernLabelRepository();
module.exports.ModernLabelRepository = ModernLabelRepository;
