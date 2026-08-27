const Inspector = require("../../models/inspector.model");
const Inspection = require("../../models/inspection.model");
const { getVendorName } = require("../../helpers/vendorRef");
const { applyDataAccessMatch } = require("../userDataAccess.service");

const normalizeLabels = (labels = []) =>
  [...new Set(
    (Array.isArray(labels) ? labels : [])
      .map(Number)
      .filter((label) => Number.isInteger(label) && label > 0),
  )].sort((left, right) => left - right);

const sortNewestFirst = (field) => (left, right) =>
  new Date(right?.[field] || 0) - new Date(left?.[field] || 0);

const buildUsageHistory = (records = []) =>
  (Array.isArray(records) ? records : [])
    .map((entry) => {
      const labels = normalizeLabels(entry?.labels_added);
      if (labels.length === 0) return null;

      const qc = entry?.qc && typeof entry.qc === "object" ? entry.qc : null;
      return {
        labels,
        inspection_record: entry?._id,
        qc: qc?._id || entry?.qc || null,
        request_history_id: entry?.request_history_id || null,
        qc_meta: {
          order_id: String(qc?.order_meta?.order_id || ""),
          brand: String(qc?.order_meta?.brand || ""),
          vendor: getVendorName(qc?.order_meta?.vendor),
          item_code: String(qc?.item?.item_code || ""),
          description: String(qc?.item?.description || ""),
        },
        inspection_date: String(entry?.inspection_date || ""),
        used_at: entry?.createdAt || new Date(),
        updated_at: entry?.updatedAt || entry?.createdAt || new Date(),
      };
    })
    .filter(Boolean)
    .sort(sortNewestFirst("used_at"));

class LegacyLabelRepository {
  constructor({ InspectorModel = Inspector, InspectionModel = Inspection } = {}) {
    this.Inspector = InspectorModel;
    this.Inspection = InspectionModel;
  }

  async getInspector(inspectorId, fields) {
    const query = this.Inspector.findById(inspectorId);
    if (fields) query.select(fields);
    return query.lean();
  }

  async getAllottedLabels(inspectorId) {
    const inspector = await this.getInspector(inspectorId, "alloted_labels");
    return normalizeLabels(inspector?.alloted_labels);
  }

  async getUsedLabels(inspectorId) {
    const inspector = await this.getInspector(inspectorId, "user");
    if (!inspector?.user) return [];

    const records = await this.Inspection.find({ inspector: inspector.user })
      .select("labels_added")
      .lean();
    return normalizeLabels(records.flatMap((entry) => entry?.labels_added || []));
  }

  async getRejectedLabels(inspectorId) {
    const inspector = await this.getInspector(inspectorId, "rejected_labels");
    return normalizeLabels(inspector?.rejected_labels);
  }

  async getAllocationHistory(inspectorId) {
    const inspector = await this.getInspector(
      inspectorId,
      "label_allocation_history",
    );
    return (Array.isArray(inspector?.label_allocation_history)
      ? inspector.label_allocation_history
      : []
    ).sort(sortNewestFirst("recorded_at"));
  }

  async getUsageHistory(inspectorId, { user = null } = {}) {
    const inspector = await this.getInspector(inspectorId, "user");
    if (!inspector?.user) return [];

    const qcMatch = user
      ? applyDataAccessMatch({}, user, {
          brandFields: ["order_meta.brand"],
          vendorFields: ["order_meta.vendor"],
        })
      : null;
    const records = await this.Inspection.find({ inspector: inspector.user })
      .select("qc request_history_id inspection_date labels_added createdAt updatedAt")
      .populate({
        path: "qc",
        select: "order_meta item request_date last_inspected_date",
        ...(qcMatch ? { match: qcMatch } : {}),
      })
      .lean();

    return buildUsageHistory(user ? records.filter((entry) => entry?.qc) : records);
  }

  async getSummary(inspectorId) {
    const [summary = null] = await this.Inspector.aggregate([
      { $match: { _id: new this.Inspector.base.Types.ObjectId(inspectorId) } },
      {
        $lookup: {
          from: this.Inspection.collection?.name || "inspections",
          let: { inspectorUser: "$user" },
          pipeline: [
            { $match: { $expr: { $eq: ["$inspector", "$$inspectorUser"] } } },
            { $unwind: "$labels_added" },
            { $match: { labels_added: { $type: "number", $gt: 0 } } },
            { $group: { _id: "$labels_added" } },
          ],
          as: "used_label_rows",
        },
      },
      {
        $project: {
          user: 1,
          allocated_labels: { $ifNull: ["$alloted_labels", []] },
          rejected_labels: { $ifNull: ["$rejected_labels", []] },
          used_labels: "$used_label_rows._id",
        },
      },
      {
        $project: {
          user: 1,
          total_allocated: { $size: "$allocated_labels" },
          total_used: { $size: "$used_labels" },
          total_unused: {
            $size: { $setDifference: ["$allocated_labels", "$used_labels"] },
          },
          total_rejected: { $size: "$rejected_labels" },
        },
      },
    ]);
    if (!summary) return null;

    const totalAllocated = Number(summary.total_allocated || 0);
    const totalUsed = Number(summary.total_used || 0);
    return {
      inspector: summary.user,
      total_allocated: totalAllocated,
      total_used: totalUsed,
      total_unused: Number(summary.total_unused || 0),
      total_rejected: Number(summary.total_rejected || 0),
      usage_percentage: totalAllocated > 0
        ? ((totalUsed / totalAllocated) * 100).toFixed(2)
        : 0,
    };
  }
}

module.exports = new LegacyLabelRepository();
module.exports.LegacyLabelRepository = LegacyLabelRepository;
module.exports.buildUsageHistory = buildUsageHistory;
module.exports.normalizeLabels = normalizeLabels;
