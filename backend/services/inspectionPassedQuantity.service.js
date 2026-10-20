const Inspection = require("../models/inspection.model");
const QC = require("../models/qc.model");

const loadInspectionPassedHistory = async (records) => {
  const qcIds = [...new Set(records.map((record) => String(record.qc?._id || record.qc || "")).filter(Boolean))];
  if (!qcIds.length) return [];
  const [qcs, visits] = await Promise.all([
    QC.find({ _id: { $in: qcIds } }).select("request_type request_history").lean(),
    Inspection.find({ qc: { $in: qcIds } })
      .select("qc inspector inspection_date requested_date request_history_id createdAt status passed vendor_requested").lean(),
  ]);
  const qcById = new Map(qcs.map((qc) => [String(qc._id), qc]));
  return visits.map((record) => ({ ...record, qc: qcById.get(String(record.qc)) || {} }));
};

module.exports = { loadInspectionPassedHistory };
