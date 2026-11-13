const { parseDateOnly, parseDateTime } = require("./dateOnly");
const { buildNormalizedInspectionSizeState } = require("./inspectionSizeSnapshot");
const { hasComparableNumber } = require("./measurementMismatchRules");

const sizeFields = ["master_item_sizes", "master_box_sizes"];
const sizeLabels = ["Master Item Sizes", "Master Box Sizes"];
const measurementFields = ["L", "B", "H", "net_weight", "gross_weight", "item_count_in_inner", "box_count_in_master"];
const hasMeasurements = (sizes) => Array.isArray(sizes) && sizes.some((entry) =>
  measurementFields.some((field) => hasComparableNumber(entry?.[field])),
);

const getMasterComparisonSource = (master) => {
  if (!master) return null;
  const source = {
    master_item_sizes: master.master_item_sizes,
    master_box_sizes: master.master_box_sizes,
    master_box_mode: master.master_box_mode,
    inspected_item_sizes: master.master_item_sizes,
    inspected_box_sizes: master.master_box_sizes,
    inspected_box_mode: master.master_box_mode,
  };
  const normalized = buildNormalizedInspectionSizeState(source);
  return normalized.inspected_item_sizes.length || normalized.inspected_box_sizes.length ? source : null;
};

const isEmptyHistoryValue = (value) => value === null || (
  Array.isArray(value) && !hasMeasurements(value)
);

const isMasterCreationHistory = ({ action, before = {}, after = {} }) =>
  sizeFields.every((field) => isEmptyHistoryValue(before[field]) ||
    (action === "create" && before[field] === undefined)) &&
  sizeFields.some((field) => hasMeasurements(after[field]));

// The legacy audit stores formatted sizes, weights and carton counts as text.
const hasAuditMeasurements = (value) => [...String(value ?? "").matchAll(
  /:\s*(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)|(?:weight:|inner count|master count)\s*(-?\d+(?:\.\d+)?)/gi,
)].some((match) => match.slice(1).some(hasComparableNumber));

const isMasterCreationAudit = ({ changes = [], missing_fields = [] }) => {
  const sizeChanges = sizeLabels.map((label) =>
    changes.find((change) => change.scope === "Master" && change.field === label),
  );
  return sizeChanges.every((change, index) => change
    ? change.before === "Not Set"
    : missing_fields.some((field) => field.scope === "Master" && field.field === sizeFields[index])) &&
    sizeChanges.some((change) => hasAuditMeasurements(change?.after));
};

const getFirstMasterDate = (item, workflow, auditDates = []) => {
  const timestamps = [
    workflow.started_at,
    ...(item.update_history || []).filter(isMasterCreationHistory).map((entry) => entry.timestamp),
    ...auditDates,
  ].map(parseDateTime).filter(Boolean);
  return timestamps.length ? new Date(Math.min(...timestamps)) : null;
};

const isInspectionAfterMaster = (inspection, start) => {
  const recordedAt = parseDateTime(inspection.createdAt);
  const inspectedOn = parseDateOnly(inspection.inspection_date);
  return Boolean(start && recordedAt && recordedAt > start && inspection.inspection_date_recency_value &&
    inspectedOn && inspectedOn >= parseDateOnly(start));
};

module.exports = { getMasterComparisonSource, getFirstMasterDate, isMasterCreationAudit, isInspectionAfterMaster, sizeLabels };
