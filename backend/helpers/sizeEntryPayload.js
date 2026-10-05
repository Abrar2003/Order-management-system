const { BOX_PACKAGING_MODES, detectBoxPackagingMode } = require("./boxMeasurement");
const normalizeTextField = (value) => String(value ?? "").trim();
const ITEM_SIZE_ENTRY_LIMIT = 5;
const BOX_SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  "item",
  "top",
  "base",
  "base2",
  "pedestal",
  "stretcher",
  "item1",
  "item2",
  "item3",
]);
const toNonNegativeNumber = (value, fieldLabel) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} must be a non-negative number`);
  }
  return parsed;
};

const isBoxSizeFieldLabel = (fieldLabel = "") =>
  fieldLabel === "inspected_box_sizes" ||
  fieldLabel === "pis_box_sizes" ||
  fieldLabel === "master_box_sizes" ||
  fieldLabel === "pd_box_sizes";

const getSizeEntryLimitForField = (fieldLabel = "") =>
  isBoxSizeFieldLabel(fieldLabel) ? BOX_SIZE_ENTRY_LIMIT : ITEM_SIZE_ENTRY_LIMIT;

const parseSizeEntriesPayload = (
  entries = [],
  {
    fieldLabel = "size entries",
    remarkOptions = [],
    weightKey = "",
    weightLabel = "weight",
    mode = "",
    allowIncomplete = false,
  } = {},
) => {
  if (!Array.isArray(entries)) {
    throw new Error(`${fieldLabel} must be an array`);
  }

  const sizeEntryLimit = getSizeEntryLimitForField(fieldLabel);
  if (entries.length > sizeEntryLimit) {
    throw new Error(`${fieldLabel} cannot exceed ${sizeEntryLimit} entries`);
  }

  const seenRemarks = new Set();
  const isBoxSizeField = isBoxSizeFieldLabel(fieldLabel);
  const resolvedBoxMode =
    isBoxSizeField
      ? detectBoxPackagingMode(mode, entries)
      : BOX_PACKAGING_MODES.INDIVIDUAL;
  const allowedRemarkValues = new Set(
    (Array.isArray(remarkOptions) ? remarkOptions : [])
      .map((option) => normalizeTextField(option).toLowerCase())
      .filter(Boolean),
  );
  const allowedRemarkList = [...allowedRemarkValues].join(", ");

  return entries.map((entry, index) => {
    const entryLabel = `${fieldLabel} ${index + 1}`;
    const L = toNonNegativeNumber(entry?.L, `${entryLabel}.L`);
    const B = toNonNegativeNumber(entry?.B, `${entryLabel}.B`);
    const H = toNonNegativeNumber(entry?.H, `${entryLabel}.H`);

    if (!allowIncomplete && (L <= 0 || B <= 0 || H <= 0)) {
      throw new Error(`${entryLabel} must have positive L, B, and H values`);
    }

    const isCartonBoxEntry =
      isBoxSizeField && resolvedBoxMode === BOX_PACKAGING_MODES.CARTON;
    const cartonRemark = isCartonBoxEntry ? (index === 0 ? "inner" : "master") : "";
    const defaultSingleRemark = isBoxSizeField ? "box" : "item";
    const normalizedRemark = isCartonBoxEntry
      ? cartonRemark
      : normalizeTextField(entry?.remark || "").toLowerCase();
    if (entries.length > 1 && !isCartonBoxEntry) {
      if (!normalizedRemark) {
        if (!allowIncomplete) {
          throw new Error(`${entryLabel}.remark is required`);
        }
      }
      if (
        normalizedRemark &&
        allowedRemarkValues.size > 0 &&
        !allowedRemarkValues.has(normalizedRemark)
      ) {
        throw new Error(`${entryLabel}.remark must be one of: ${allowedRemarkList}`);
      }
      if (seenRemarks.has(normalizedRemark)) {
        throw new Error(`${fieldLabel} remarks must be unique`);
      }
      if (normalizedRemark) {
        seenRemarks.add(normalizedRemark);
      }
    }

    const parsedEntry = {
      L,
      B,
      H,
      remark: entries.length > 1 ? normalizedRemark : normalizedRemark || defaultSingleRemark,
    };

    if (weightKey) {
      const parsedWeight = toNonNegativeNumber(
        entry?.[weightKey],
        `${entryLabel}.${weightLabel}`,
      );
      if (!allowIncomplete && parsedWeight <= 0) {
        throw new Error(`${entryLabel}.${weightLabel} must be greater than 0`);
      }
      parsedEntry[weightKey] = parsedWeight;
    }

    if (isBoxSizeField) {
      if (resolvedBoxMode === BOX_PACKAGING_MODES.CARTON) {
        const entryType = cartonRemark;
        parsedEntry.remark = entryType;
        parsedEntry.box_type = entryType;
        parsedEntry.item_count_in_inner =
          entryType === "inner"
            ? toNonNegativeNumber(entry?.item_count_in_inner, `${entryLabel}.item_count_in_inner`)
            : 0;
        parsedEntry.box_count_in_master =
          entryType === "master"
            ? toNonNegativeNumber(
                entry?.box_count_in_master,
                `${entryLabel}.box_count_in_master`,
              )
            : 0;

        if (
          !allowIncomplete &&
          entryType === "inner" &&
          parsedEntry.item_count_in_inner <= 0
        ) {
          throw new Error(`${entryLabel}.item_count_in_inner must be greater than 0`);
        }
        if (
          !allowIncomplete &&
          entryType === "master" &&
          parsedEntry.box_count_in_master <= 0
        ) {
          throw new Error(`${entryLabel}.box_count_in_master must be greater than 0`);
        }
      } else if (resolvedBoxMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER) {
        parsedEntry.remark = "master";
        parsedEntry.box_type = "master";
        parsedEntry.item_count_in_inner = 0;
        parsedEntry.box_count_in_master = toNonNegativeNumber(
          entry?.box_count_in_master,
          `${entryLabel}.box_count_in_master`,
        );

        if (!allowIncomplete && parsedEntry.box_count_in_master <= 0) {
          throw new Error(`${entryLabel}.box_count_in_master must be greater than 0`);
        }
      } else {
        parsedEntry.box_type = "individual";
        parsedEntry.item_count_in_inner = 0;
        parsedEntry.box_count_in_master = 0;
      }
    }

    return parsedEntry;
  });
};


module.exports = { parseSizeEntriesPayload, ITEM_SIZE_REMARK_OPTIONS };
