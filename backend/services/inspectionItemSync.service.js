const mongoose = require("mongoose");
const Item = require("../models/item.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const {
  BOX_PACKAGING_MODES,
  buildBoxMeasurementCbmSummary,
  detectBoxPackagingMode,
} = require("../helpers/boxMeasurement");
const {
  parseDateOnly,
  parseDateTime,
  toDateOnlyIso,
} = require("../helpers/dateOnly");
const {
  normalizeBoxSizes,
  normalizeItemSizes,
} = require("../helpers/inspectionSizeSnapshot");
const {
  cleanupLegacyItemSizeFields,
} = require("../helpers/itemLegacySizeCleanup");
const { appendItemUpdateHistory } = require("../helpers/itemUpdateHistory");
const {
  formatSizeArrayToReference,
  pickReferenceSizeArray,
} = require("../helpers/sizeDimensionFormatter");

const normalizeText = (value) => String(value ?? "").trim();
const normalizeStatus = (value) => normalizeText(value).toLowerCase();

const NON_MEASUREMENT_INSPECTION_STATUSES = new Set([
  "goods not ready",
  "rejected",
  "transfered",
  "transferred",
]);

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

const toObjectId = (value) => {
  const normalized = normalizeText(value?._id || value?.id || value);
  return mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : null;
};

const getDocValue = (doc = {}, path = "") =>
  doc && typeof doc.get === "function" ? doc.get(path) : doc?.[path];

const setDocValue = (doc = {}, path = "", value) => {
  if (doc && typeof doc.set === "function") {
    doc.set(path, value);
    if (typeof doc.markModified === "function") doc.markModified(path);
    return;
  }
  doc[path] = value;
};

const getInspectionDateSortTime = (inspection = {}) => {
  const parsed = parseDateOnly(inspection?.inspection_date);
  return parsed ? parsed.getTime() : 0;
};

const getInspectionCreatedSortTime = (inspection = {}) => {
  const parsed = parseDateTime(inspection?.createdAt);
  return parsed ? parsed.getTime() : 0;
};

// Latest item sync intentionally follows the inspection visit date, not edit time.
const getInspectionSortTime = (inspection = {}) => getInspectionDateSortTime(inspection);

const compareInspectionsByLatestDate = (left = {}, right = {}) => {
  const dateDelta = getInspectionDateSortTime(right) - getInspectionDateSortTime(left);
  if (dateDelta !== 0) return dateDelta;
  return getInspectionCreatedSortTime(right) - getInspectionCreatedSortTime(left);
};

const pickLatestInspectionRecord = (records = []) =>
  [...(Array.isArray(records) ? records : [])].sort(
    compareInspectionsByLatestDate,
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

const isNonMeasurementInspectionStatus = (status = "") =>
  NON_MEASUREMENT_INSPECTION_STATUSES.has(normalizeStatus(status));

const isEligibleInspectionForItemSync = (inspection = {}) => {
  const status = normalizeStatus(inspection?.status);
  if (!status || status === "pending" || isNonMeasurementInspectionStatus(status)) {
    return false;
  }
  return (
    status === "inspection done" ||
    toNumber(inspection?.checked, 0) > 0 ||
    toNumber(inspection?.passed, 0) > 0 ||
    hasModernInspectionData(inspection)
  );
};

const formatItemInspectedSizes = (itemDocOrPlainObject = {}) => {
  if (!itemDocOrPlainObject) return false;

  let changed = false;
  [
    {
      path: "inspected_item_sizes",
      type: "item",
    },
    {
      path: "inspected_box_sizes",
      type: "box",
    },
  ].forEach(({ path, type }) => {
    const incoming = getDocValue(itemDocOrPlainObject, path);
    if (!Array.isArray(incoming)) return;
    const reference = pickReferenceSizeArray(itemDocOrPlainObject, type);
    if (!Array.isArray(reference) || reference.length === 0) return;

    const formatted = formatSizeArrayToReference(incoming, reference, { type });
    if (valuesEqual(incoming, formatted)) return;
    setDocValue(itemDocOrPlainObject, path, formatted);
    changed = true;
  });

  return changed;
};

const formatInspectionInspectedSizes = (inspectionDocOrPlainObject = {}, itemDoc = {}) => {
  if (!inspectionDocOrPlainObject || !itemDoc) return false;

  let changed = false;
  [
    {
      path: "inspected_item_sizes",
      type: "item",
    },
    {
      path: "inspected_box_sizes",
      type: "box",
    },
  ].forEach(({ path, type }) => {
    const incoming = getDocValue(inspectionDocOrPlainObject, path);
    if (!Array.isArray(incoming)) return;
    const reference = pickReferenceSizeArray(itemDoc, type);
    if (!Array.isArray(reference) || reference.length === 0) return;

    const formatted = formatSizeArrayToReference(incoming, reference, { type });
    if (valuesEqual(incoming, formatted)) return;
    setDocValue(inspectionDocOrPlainObject, path, formatted);
    changed = true;
  });

  return changed;
};

const saveFormattedInspectionIfNeeded = async ({
  inspectionRecord,
  itemDoc,
  save = true,
} = {}) => {
  const formatted = formatInspectionInspectedSizes(inspectionRecord, itemDoc);
  if (!formatted || !save) return formatted;

  if (inspectionRecord && typeof inspectionRecord.save === "function") {
    await inspectionRecord.save();
    return formatted;
  }

  const inspectionId = normalizeText(inspectionRecord?._id);
  if (mongoose.Types.ObjectId.isValid(inspectionId)) {
    await Inspection.findByIdAndUpdate(inspectionId, {
      $set: {
        inspected_item_sizes: inspectionRecord?.inspected_item_sizes || [],
        inspected_box_sizes: inspectionRecord?.inspected_box_sizes || [],
      },
    });
  }

  return formatted;
};

const buildItemCodeRegex = (itemCode = "") => ({
  $regex: `^${escapeRegex(itemCode)}$`,
  $options: "i",
});

const findItemByCode = (itemCode = "") =>
  Item.findOne({ code: buildItemCodeRegex(itemCode) });

const getItemCodeFromItem = (itemDoc = {}) =>
  normalizeText(getDocValue(itemDoc, "code"));

const loadItemForQc = async (qcDoc = {}, itemDoc = null) => {
  if (itemDoc) return itemDoc;
  const itemCode = getQcItemCode(qcDoc);
  if (!itemCode) return null;
  return findItemByCode(itemCode);
};

const findQcRecordsForItemCode = async (itemCode = "") => {
  if (!itemCode) return [];
  return QC.find({
    "item.item_code": buildItemCodeRegex(itemCode),
  })
    .select("_id item.item_code order.item_code order_meta.item_code quantities last_inspected_date")
    .lean();
};

const findLatestEligibleInspectionForItemCode = async (itemCode = "") => {
  const qcRows = await findQcRecordsForItemCode(itemCode);
  const qcIds = qcRows
    .map((qcDoc) => toObjectId(qcDoc?._id))
    .filter(Boolean);
  if (qcIds.length === 0) {
    return { inspection: null, qcDoc: null, qcRows };
  }

  const inspections = await Inspection.find({ qc: { $in: qcIds } })
    .select(
      [
        "_id",
        "qc",
        "inspection_date",
        "createdAt",
        "status",
        "checked",
        "passed",
        "barcode",
        "master_barcode",
        "inner_barcode",
        "packed_size",
        "finishing",
        "branding",
        "kd",
        "cbm",
        "inspected_item_sizes",
        "inspected_box_sizes",
        "inspected_box_mode",
      ].join(" "),
    )
    .lean();

  const latestInspection = pickLatestInspectionRecord(
    inspections.filter(isEligibleInspectionForItemSync),
  );
  const latestQcDoc = latestInspection
    ? qcRows.find((qcDoc) => String(qcDoc?._id || "") === String(latestInspection.qc || ""))
    : null;

  return {
    inspection: latestInspection,
    qcDoc: latestQcDoc,
    qcRows,
  };
};

const applyLatestInspectionToItem = ({
  itemDoc,
  inspectionRecord,
  qcDoc = null,
} = {}) => {
  if (!itemDoc || !inspectionRecord) return false;
  if (isNonMeasurementInspectionStatus(inspectionRecord?.status)) return false;
  formatInspectionInspectedSizes(inspectionRecord, itemDoc);

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
    last_inspected_date: toDateOnlyIso(inspectionRecord?.inspection_date) ||
      normalizeText(
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
  formatItemInspectedSizes(itemDoc);

  return changed;
};

const syncItemInspectedDataFromInspection = async ({
  qcDoc,
  inspectionRecord,
  itemDoc = null,
  save = true,
  requireModernInspectionData = false,
  user = null,
  route = "",
  source = "qc_inspection_sync",
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

  // Inspection measurements are user-entered and are the source of truth.
  // Formatting them against a possibly stale item master can silently swap B/H.
  const formattedInspection = false;
  if (isNonMeasurementInspectionStatus(inspectionRecord?.status)) {
    return {
      matched: true,
      updated: false,
      formatted_inspection: formattedInspection,
      skipped_reason: "non_measurement_inspection_status",
      inspection_status: normalizeText(inspectionRecord?.status),
      item_id: String(resolvedItem?._id || ""),
      item_code: normalizeText(resolvedItem?.code || itemCode),
      item_doc: resolvedItem,
    };
  }
  if (!isEligibleInspectionForItemSync(inspectionRecord)) {
    return {
      matched: true,
      updated: false,
      formatted_inspection: formattedInspection,
      skipped_reason: "inspection_not_eligible_for_item_sync",
      inspection_status: normalizeText(inspectionRecord?.status),
      item_id: String(resolvedItem?._id || ""),
      item_code: normalizeText(resolvedItem?.code || itemCode),
      item_doc: resolvedItem,
    };
  }
  const latestEntry = await findLatestEligibleInspectionForItemCode(
    normalizeText(resolvedItem?.code || itemCode),
  );
  const latestInspectionId = normalizeText(latestEntry?.inspection?._id);
  const currentInspectionId = normalizeText(inspectionRecord?._id);
  if (!latestInspectionId) {
    return {
      matched: true,
      updated: false,
      formatted_inspection: formattedInspection,
      skipped_reason: "missing_latest_inspection",
      item_id: String(resolvedItem?._id || ""),
      item_code: normalizeText(resolvedItem?.code || itemCode),
      item_doc: resolvedItem,
    };
  }
  if (
    latestInspectionId &&
    currentInspectionId &&
    latestInspectionId !== currentInspectionId
  ) {
    return {
      matched: true,
      updated: false,
      formatted_inspection: formattedInspection,
      skipped_reason: "not_latest_inspection",
      latest_inspection_id: latestInspectionId,
      item_id: String(resolvedItem?._id || ""),
      item_code: normalizeText(resolvedItem?.code || itemCode),
      item_doc: resolvedItem,
    };
  }

  const beforeItemSnapshot = resolvedItem.toObject();
  const changed = applyLatestInspectionToItem({
    itemDoc: resolvedItem,
    inspectionRecord,
    qcDoc: latestEntry?.qcDoc || qcDoc,
  });

  if (changed && save) {
    appendItemUpdateHistory(resolvedItem, {
      before: beforeItemSnapshot,
      after: resolvedItem.toObject(),
      reqUser: user,
      action: "inspection_sync",
      source,
      route,
      metadata: {
        qc_id: String((latestEntry?.qcDoc || qcDoc)?._id || ""),
        inspection_record_id: String(inspectionRecord?._id || ""),
      },
    });
    await resolvedItem.save();
  }

  return {
    matched: true,
    updated: changed,
    formatted_inspection: formattedInspection,
    item_id: String(resolvedItem?._id || ""),
    item_code: normalizeText(resolvedItem?.code || itemCode),
    item_doc: resolvedItem,
  };
};

const syncLatestInspectionToItem = async (
  inspectionId,
  {
    save = true,
    user = null,
    route = "",
    source = "inspection_latest_sync",
  } = {},
) => {
  const objectId = toObjectId(inspectionId);
  if (!objectId) {
    return { matched: false, updated: false, skipped_reason: "invalid_inspection_id" };
  }

  const inspectionRecord = await Inspection.findById(objectId);
  if (!inspectionRecord) {
    return { matched: false, updated: false, skipped_reason: "missing_inspection" };
  }

  const qcDoc = await QC.findById(inspectionRecord.qc)
    .select("_id item.item_code order.item_code order_meta.item_code quantities last_inspected_date");
  if (!qcDoc) {
    return { matched: false, updated: false, skipped_reason: "missing_qc" };
  }

  return syncItemInspectedDataFromInspection({
    qcDoc,
    inspectionRecord,
    save,
    user,
    route,
    source,
  });
};

const recomputeLatestInspectionForItem = async (
  itemIdOrCode,
  {
    save = true,
    user = null,
    route = "",
    source = "inspection_latest_recompute",
  } = {},
) => {
  const normalizedInput = normalizeText(itemIdOrCode);
  if (!normalizedInput) {
    return { matched: false, updated: false, skipped_reason: "missing_item" };
  }

  const itemDoc = mongoose.Types.ObjectId.isValid(normalizedInput)
    ? await Item.findById(normalizedInput)
    : await findItemByCode(normalizedInput);
  if (!itemDoc) {
    return { matched: false, updated: false, skipped_reason: "missing_item" };
  }

  const itemCode = getItemCodeFromItem(itemDoc);
  const latestEntry = await findLatestEligibleInspectionForItemCode(itemCode);
  if (!latestEntry?.inspection) {
    return {
      matched: true,
      updated: false,
      skipped_reason: "missing_latest_inspection",
      item_id: String(itemDoc?._id || ""),
      item_code: itemCode,
      item_doc: itemDoc,
    };
  }

  const inspectionRecord = await Inspection.findById(latestEntry.inspection._id);
  if (!inspectionRecord) {
    return {
      matched: true,
      updated: false,
      skipped_reason: "missing_latest_inspection",
      item_id: String(itemDoc?._id || ""),
      item_code: itemCode,
      item_doc: itemDoc,
    };
  }

  return syncItemInspectedDataFromInspection({
    qcDoc: latestEntry.qcDoc,
    inspectionRecord,
    itemDoc,
    save,
    user,
    route,
    source,
  });
};

module.exports = {
  applyLatestInspectionToItem,
  compareInspectionsByLatestDate,
  findLatestEligibleInspectionForItemCode,
  formatInspectionInspectedSizes,
  formatItemInspectedSizes,
  getInspectionSortTime,
  getQcItemCode,
  hasModernInspectionData,
  isEligibleInspectionForItemSync,
  isNonMeasurementInspectionStatus,
  pickLatestInspectionRecord,
  recomputeLatestInspectionForItem,
  syncLatestInspectionToItem,
  syncItemInspectedDataFromInspection,
};
