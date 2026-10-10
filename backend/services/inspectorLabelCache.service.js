const mongoose = require("mongoose");
const Inspection = require("../models/inspection.model");
const Inspector = require("../models/inspector.model");

const TRANSFERRED_INSPECTION_STATUS = "transfered";

const normalizeLabels = (labels = []) =>
  [...new Set(
    (Array.isArray(labels) ? labels : [])
      .map(Number)
      .filter(Number.isFinite),
  )].sort((left, right) => left - right);

const buildInspectorUsedLabelState = (labelUsageRecords = []) => ({
  used_labels: normalizeLabels(
    labelUsageRecords.flatMap((entry) =>
      Array.isArray(entry?.labels_added) ? entry.labels_added : [],
    ),
  ),
  label_used_history: labelUsageRecords
    .map((entry) => {
      const labels = normalizeLabels(entry?.labels_added || []);
      if (labels.length === 0) return null;
      const qcDoc = entry?.qc && typeof entry.qc === "object" ? entry.qc : null;

      return {
        labels,
        inspection_record: entry?._id,
        qc: qcDoc?._id || entry?.qc || null,
        request_history_id: entry?.request_history_id || null,
        qc_meta: {
          order_id: String(qcDoc?.order_meta?.order_id || ""),
          brand: String(qcDoc?.order_meta?.brand || ""),
          vendor: qcDoc?.order_meta?.vendor || undefined,
          item_code: String(qcDoc?.item?.item_code || ""),
          description: String(qcDoc?.item?.description || ""),
        },
        inspection_date: String(entry?.inspection_date || ""),
        used_at: entry?.createdAt || new Date(),
        updated_at: entry?.updatedAt || entry?.createdAt || new Date(),
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        new Date(right?.used_at || 0) - new Date(left?.used_at || 0),
    ),
});

const recalculateInspectorUsedLabels = async (inspectorIds = []) => {
  const normalizedInspectorIds = [...new Set(
    (Array.isArray(inspectorIds) ? inspectorIds : [])
      .map((value) => String(value || "").trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value)),
  )];

  for (const inspectorUserId of normalizedInspectorIds) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const inspectorDoc = await Inspector.findOne({ user: inspectorUserId });
      if (!inspectorDoc) break;

      const labelUsageRecords = await Inspection.find({
        inspector: inspectorUserId,
        status: { $ne: TRANSFERRED_INSPECTION_STATUS },
        "labels_added.0": { $exists: true },
      })
        .select("qc request_history_id inspection_date labels_added createdAt updatedAt")
        .populate("qc", "order_meta item request_date last_inspected_date")
        .lean();

      Object.assign(inspectorDoc, buildInspectorUsedLabelState(labelUsageRecords));
      try {
        await inspectorDoc.save();
        break;
      } catch (error) {
        if (error?.name !== "VersionError" || attempt === 2) throw error;
      }
    }
  }
};

module.exports = {
  buildInspectorUsedLabelState,
  recalculateInspectorUsedLabels,
};
