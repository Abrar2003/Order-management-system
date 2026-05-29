const mongoose = require("mongoose");
const Item = require("../models/item.model");
const {
  BOX_PACKAGING_MODES,
  buildBoxMeasurementCbmSummary,
  detectBoxPackagingMode,
} = require("../helpers/boxMeasurement");
const {
  normalizeBoxSizes,
  normalizeItemSizes,
} = require("../helpers/inspectionSizeSnapshot");
const {
  cleanupLegacyItemSizeFields,
} = require("../helpers/itemLegacySizeCleanup");

const normalizeText = (value) => String(value ?? "").trim();

const escapeRegex = (value = "") =>
  normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const toDecimalString = (value, precision = 6) => {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const fixed = value.toFixed(precision);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const valuesEqual = (left, right) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const getQcItemCode = (qcDoc = {}) =>
  normalizeText(
    qcDoc?.item?.item_code ||
      qcDoc?.order?.item?.item_code ||
      qcDoc?.order_meta?.item_code ||
      "",
  );

const getInspectionSortTime = (inspection = {}) =>
  Math.max(
    inspection?.inspection_date ? new Date(inspection.inspection_date).getTime() : 0,
    inspection?.createdAt ? new Date(inspection.createdAt).getTime() : 0,
    inspection?.updatedAt ? new Date(inspection.updatedAt).getTime() : 0,
  ) || 0;

const pickLatestInspectionRecord = (records = []) =>
  [...(Array.isArray(records) ? records : [])].sort(
    (left, right) => getInspectionSortTime(right) - getInspectionSortTime(left),
  )[0] || null;

const buildInspectedCbmSnapshot = ({
  itemSizes = [],
  boxSizes = [],
  boxMode = BOX_PACKAGING_MODES.INDIVIDUAL,
} = {}) => {
  const boxSummary = buildBoxMeasurementCbmSummary({
    sizes: boxSizes,
    mode: boxMode,
  });
  const itemSummary = buildBoxMeasurementCbmSummary({
    sizes: itemSizes,
    mode: BOX_PACKAGING_MODES.INDIVIDUAL,
  });
  const resolvedSummary =
    toNumber(boxSummary?.total, 0) > 0
      ? boxSummary
      : toNumber(itemSummary?.total, 0) > 0
        ? itemSummary
        : { first: "0", second: "0", total: "0" };

  return {
    inspected_top: normalizeText(resolvedSummary.first || "0") || "0",
    inspected_bottom: normalizeText(resolvedSummary.second || "0") || "0",
    inspected_total: normalizeText(resolvedSummary.total || "0") || "0",
    calculated_inspected_total: normalizeText(resolvedSummary.total || "0") || "0",
    calculated_total: normalizeText(resolvedSummary.total || "0") || "0",
  };
};

const hasModernInspectionData = (inspection = {}) =>
  (Array.isArray(inspection?.inspected_item_sizes) &&
    inspection.inspected_item_sizes.length > 0) ||
  (Array.isArray(inspection?.inspected_box_sizes) &&
    inspection.inspected_box_sizes.length > 0);

const applyLatestInspectionToItem = ({
  itemDoc,
  inspectionRecord,
  qcDoc = null,
} = {}) => {
  if (!itemDoc || !inspectionRecord) return false;

  const itemSizes = normalizeItemSizes(inspectionRecord?.inspected_item_sizes);
  const rawBoxMode = detectBoxPackagingMode(
    inspectionRecord?.inspected_box_mode,
    inspectionRecord?.inspected_box_sizes,
  );
  const boxSizes = normalizeBoxSizes(
    inspectionRecord?.inspected_box_sizes,
    rawBoxMode,
  );
  const boxMode = detectBoxPackagingMode(rawBoxMode, boxSizes);
  const inspectedCbm = buildInspectedCbmSnapshot({
    itemSizes,
    boxSizes,
    boxMode,
  });

  let changed = false;
  const setIfChanged = (path, value) => {
    const currentValue = itemDoc.get ? itemDoc.get(path) : itemDoc?.[path];
    if (valuesEqual(currentValue, value)) return;
    itemDoc.set(path, value);
    itemDoc.markModified(path);
    changed = true;
  };

  setIfChanged("inspected_item_sizes", itemSizes);
  setIfChanged("inspected_box_sizes", boxSizes);
  setIfChanged("inspected_box_mode", boxMode);
  const cleanupResult = cleanupLegacyItemSizeFields(itemDoc, {
    groups: ["inspected_item", "inspected_box"],
  });
  changed = cleanupResult.changed || changed;
  setIfChanged(
    "kd",
    Boolean(
      inspectionRecord?.kd ??
        inspectionRecord?.inspected_k_d ??
        inspectionRecord?.pis_k_d,
    ),
  );

  const currentCbm = itemDoc?.cbm || {};
  const nextCbm = {
    ...currentCbm,
    ...inspectedCbm,
  };
  setIfChanged("cbm", nextCbm);

  const currentQcSnapshot = itemDoc?.qc || {};
  const nextQcSnapshot = {
    ...currentQcSnapshot,
    packed_size: Boolean(inspectionRecord?.packed_size),
    finishing: Boolean(inspectionRecord?.finishing),
    branding: Boolean(inspectionRecord?.branding),
    barcode: normalizeText(inspectionRecord?.master_barcode || inspectionRecord?.barcode),
    master_barcode: normalizeText(inspectionRecord?.master_barcode || inspectionRecord?.barcode),
    inner_barcode: normalizeText(inspectionRecord?.inner_barcode),
    last_inspected_date: normalizeText(
      inspectionRecord?.inspection_date ||
        qcDoc?.last_inspected_date ||
        "",
    ),
    quantities: {
      ...(currentQcSnapshot?.quantities || {}),
      checked: toNumber(qcDoc?.quantities?.qc_checked, currentQcSnapshot?.quantities?.checked || 0),
      passed: toNumber(qcDoc?.quantities?.qc_passed, currentQcSnapshot?.quantities?.passed || 0),
      pending: toNumber(qcDoc?.quantities?.pending, currentQcSnapshot?.quantities?.pending || 0),
    },
  };
  setIfChanged("qc", nextQcSnapshot);

  return changed;
};

const syncItemInspectedDataFromInspection = async ({
  qcDoc,
  inspectionRecord,
  itemDoc = null,
  save = true,
  requireModernInspectionData = false,
} = {}) => {
  if (!inspectionRecord) {
    return { matched: false, updated: false, skipped_reason: "missing_inspection" };
  }
  if (requireModernInspectionData && !hasModernInspectionData(inspectionRecord)) {
    return { matched: false, updated: false, skipped_reason: "missing_inspection_data" };
  }

  let resolvedItem = itemDoc;
  const itemCode = getQcItemCode(qcDoc);
  if (!resolvedItem) {
    if (!itemCode) {
      return { matched: false, updated: false, skipped_reason: "missing_item_code" };
    }
    resolvedItem = await Item.findOne({
      code: { $regex: `^${escapeRegex(itemCode)}$`, $options: "i" },
    });
  }

  if (!resolvedItem) {
    return { matched: false, updated: false, skipped_reason: "missing_item" };
  }

  const changed = applyLatestInspectionToItem({
    itemDoc: resolvedItem,
    inspectionRecord,
    qcDoc,
  });

  if (changed && save) {
    await resolvedItem.save();
  }

  return {
    matched: true,
    updated: changed,
    item_id: String(resolvedItem?._id || ""),
    item_code: normalizeText(resolvedItem?.code || itemCode),
    item_doc: resolvedItem,
  };
};

module.exports = {
  applyLatestInspectionToItem,
  getInspectionSortTime,
  getQcItemCode,
  hasModernInspectionData,
  pickLatestInspectionRecord,
  syncItemInspectedDataFromInspection,
};
