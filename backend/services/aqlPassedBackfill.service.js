const {
  applyInspectionRecordPendingAfter,
  calculateQcAggregateMetrics,
  getInspectionPassedFields,
} = require("../helpers/inspectionPassedQuantity");

const buildAqlPassedBackfill = (qc, records) => {
  const visits = records.map((record) => ({ ...record, ...getInspectionPassedFields(record, qc) }));
  applyInspectionRecordPendingAfter(qc, visits);
  const metrics = calculateQcAggregateMetrics(qc, visits);
  return {
    visits,
    quantities: {
      ...qc.quantities,
      qc_checked: metrics.totalChecked,
      vendor_provision: metrics.totalVendorOffered,
      qc_rejected: metrics.totalRejected,
      qc_passed: metrics.totalEffectivePassed,
      pending: Math.max(0, Number(qc.quantities?.client_demand || 0) - metrics.totalEffectivePassed),
    },
    unresolved: visits.filter((record) => record.request_type === "AQL" && record.passed > 0 && !record.aql_passed).map((record) => String(record._id)),
  };
};

module.exports = { buildAqlPassedBackfill };
