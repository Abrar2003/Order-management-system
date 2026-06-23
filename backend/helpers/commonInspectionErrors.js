const COMPARISON_TOLERANCE = 0.01;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeRemark = (value) => normalizeText(value).toLowerCase();
const toPositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const findEntry = (entries = [], remarks = []) => {
  const allowed = new Set(remarks.map(normalizeRemark));
  return (Array.isArray(entries) ? entries : []).find((entry) =>
    allowed.has(normalizeRemark(entry?.remark || entry?.type || entry?.box_type)),
  ) || null;
};

const findFirstPositiveValue = (entries = [], key = "") => {
  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = toPositiveNumber(entry?.[key]);
    if (value !== null) return value;
  }
  return null;
};

const buildEntrySnapshot = (entry = {}) => ({
  remark: normalizeRemark(entry?.remark || entry?.type || entry?.box_type),
  L: Number(entry?.L || 0),
  B: Number(entry?.B || 0),
  H: Number(entry?.H || 0),
  net_weight: Number(entry?.net_weight || 0),
  gross_weight: Number(entry?.gross_weight || 0),
  item_count_in_inner: Number(entry?.item_count_in_inner || 0),
  box_count_in_master: Number(entry?.box_count_in_master || 0),
});

const evaluateCommonInspectionErrors = (inspection = {}) => {
  const itemEntries = Array.isArray(inspection?.inspected_item_sizes)
    ? inspection.inspected_item_sizes
    : [];
  const boxEntries = Array.isArray(inspection?.inspected_box_sizes)
    ? inspection.inspected_box_sizes
    : [];

  const itemEntry =
    findEntry(itemEntries, ["item"]) ||
    itemEntries.find((entry) => !normalizeRemark(entry?.remark || entry?.type)) ||
    null;
  const topEntry = findEntry(itemEntries, ["top"]);
  const baseEntry = findEntry(itemEntries, ["base"]);
  const pedestalEntry = findEntry(itemEntries, ["pedestal"]);
  const masterEntry = findEntry(boxEntries, ["master"]);

  const errors = [];
  const netWeight = toPositiveNumber(itemEntry?.net_weight);
  const piecesInInner = findFirstPositiveValue(boxEntries, "item_count_in_inner");
  const innerBoxesInMaster = findFirstPositiveValue(boxEntries, "box_count_in_master");
  const masterGrossWeight = toPositiveNumber(masterEntry?.gross_weight);

  if (
    netWeight !== null &&
    piecesInInner !== null &&
    innerBoxesInMaster !== null &&
    masterGrossWeight !== null
  ) {
    const calculatedNetWeight = netWeight * piecesInInner * innerBoxesInMaster;
    if (calculatedNetWeight + COMPARISON_TOLERANCE >= masterGrossWeight) {
      errors.push({
        type: "weight",
        label: "Net weight exceeds master gross weight",
        expected: masterGrossWeight,
        actual: calculatedNetWeight,
        difference: calculatedNetWeight - masterGrossWeight,
        formula: `${netWeight} × ${piecesInInner} × ${innerBoxesInMaster}`,
        details: {
          net_weight: netWeight,
          item_count_in_inner: piecesInInner,
          box_count_in_master: innerBoxesInMaster,
          master_gross_weight: masterGrossWeight,
        },
      });
    }
  }

  const itemHeight = toPositiveNumber(itemEntry?.H);
  const topHeight = toPositiveNumber(topEntry?.H);
  const baseHeight = toPositiveNumber(baseEntry?.H);
  const pedestalHeight = toPositiveNumber(pedestalEntry?.H) || 0;

  if (itemHeight !== null && topHeight !== null && baseHeight !== null) {
    const calculatedHeight = topHeight + baseHeight + pedestalHeight;
    if (calculatedHeight + COMPARISON_TOLERANCE < itemHeight) {
      errors.push({
        type: "height",
        label: "Combined component height is less than item height",
        expected: itemHeight,
        actual: calculatedHeight,
        difference: calculatedHeight - itemHeight,
        formula: `${topHeight} + ${baseHeight}${pedestalHeight ? ` + ${pedestalHeight}` : ""}`,
        details: {
          item_height: itemHeight,
          top_height: topHeight,
          base_height: baseHeight,
          pedestal_height: pedestalHeight,
        },
      });
    }
  }

  return {
    errors,
    has_error: errors.length > 0,
    item_sizes: itemEntries.map(buildEntrySnapshot),
    box_sizes: boxEntries.map(buildEntrySnapshot),
  };
};

module.exports = {
  COMPARISON_TOLERANCE,
  evaluateCommonInspectionErrors,
};
