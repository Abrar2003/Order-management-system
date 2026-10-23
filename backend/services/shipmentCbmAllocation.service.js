const {
  calculateTotalPoCbm,
  dimensionToCbm,
  findCartonEntry,
  getValidNormalBoxEntries,
} = require("./orderCbm.service");
const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  calculateEffectiveBoxEntriesCbmTotal,
  detectBoxPackagingMode,
  normalizeStoredBoxEntries,
} = require("../helpers/boxMeasurement");
const { deriveOrderStatus, normalizeOrderStatus } = require("../helpers/orderStatus");

const CBM_PRECISION = 6;
const CBM_UNIT_DIVISOR = 1000000;

const toPositiveCbmNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

const toRoundedCbmValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(CBM_PRECISION));
};

const calculateCbmFromLbh = (dimensions = {}) => {
  const length = Math.max(0, Number(dimensions?.L || 0));
  const breadth = Math.max(0, Number(dimensions?.B || 0));
  const height = Math.max(0, Number(dimensions?.H || 0));
  if (
    !Number.isFinite(length) ||
    !Number.isFinite(breadth) ||
    !Number.isFinite(height)
  ) {
    return 0;
  }
  if (length <= 0 || breadth <= 0 || height <= 0) return 0;
  return (length * breadth * height) / CBM_UNIT_DIVISOR;
};

const getItemSizeCbm = (sizes) => {
  const itemEntries = (Array.isArray(sizes) ? sizes : []).filter((entry) =>
    String(entry?.remark || entry?.type || "")
      .trim()
      .toLowerCase()
      .startsWith("item"),
  );
  return itemEntries.reduce(
    (sum, entry) => sum + toPositiveCbmNumber(calculateCbmFromLbh(entry)),
    0,
  );
};

const hasCompletedInspection = (orderEntry = null) => {
  const inspectionRecords = orderEntry?.qc_record?.inspection_record;
  const hasInspectionRecord = Array.isArray(inspectionRecords)
    ? inspectionRecords.length > 0
    : Boolean(inspectionRecords);
  if (!hasInspectionRecord) return false;

  const explicitStatus = normalizeOrderStatus(orderEntry?.status);
  const derivedStatus = deriveOrderStatus({ orderEntry });
  const status = ["Inspection Done", "Partial Shipped", "Shipped"].includes(derivedStatus)
    ? derivedStatus
    : explicitStatus;
  return ["Inspection Done", "Partial Shipped", "Shipped"].includes(status);
};

const resolvePackingCbm = (itemDoc, orderEntry = null) => {
  const sources = hasCompletedInspection(orderEntry)
    ? ["inspected", "pis"]
    : ["pis", "inspected"];
  for (const source of sources) {
    const sizes = itemDoc?.[`${source}_box_sizes`];
    const mode = detectBoxPackagingMode(itemDoc?.[`${source}_box_mode`], sizes);
    const perItem = source === "inspected"
      ? calculateTotalPoCbm({ orderQuantity: 1, inspectedBoxSizes: sizes, inspectedBoxMode: mode })
      : calculateEffectiveBoxEntriesCbmTotal(sizes, mode);
    if (perItem <= 0) continue;

    const entries = source === "pis"
      ? normalizeStoredBoxEntries(sizes, { mode })
      : sizes;
    const master = findCartonEntry(entries, BOX_ENTRY_TYPES.MASTER);
    const inner = findCartonEntry(entries, BOX_ENTRY_TYPES.INNER);
    const isIndividual = mode === BOX_PACKAGING_MODES.INDIVIDUAL;
    const individualEntries = source === "pis" ? entries : getValidNormalBoxEntries(entries);
    const boxes = (isIndividual ? individualEntries : [master]).map((entry) => ({
      label: entry.remark || entry.type || entry.box_type || "box",
      L: Number(entry.L),
      B: Number(entry.B),
      H: Number(entry.H),
      cbm: dimensionToCbm(entry),
    }));
    const itemsPerInner = mode === BOX_PACKAGING_MODES.CARTON
      ? Number(inner.item_count_in_inner) : null;
    const piecesPerMaster = isIndividual ? null : Number(master.box_count_in_master);
    const divisor = isIndividual ? 1 : (itemsPerInner || 1) * piecesPerMaster;

    return {
      source: `${source}_box`,
      mode,
      boxes,
      items_per_inner: itemsPerInner,
      boxes_per_master: piecesPerMaster,
      per_item: perItem,
      unrounded_per_item: boxes.reduce((sum, box) => sum + box.cbm, 0) / divisor,
    };
  }
  return null;
};

const resolveOrderRowCbmSummary = (itemDoc = null, orderQuantity = 0, orderEntry = null) => {
  if (!itemDoc || typeof itemDoc !== "object") {
    return {
      source: null,
      per_item: null,
      total: null,
      packing: null,
    };
  }

  const packing = resolvePackingCbm(itemDoc, orderEntry);
  // Preserve product-volume fallbacks for legacy totals only, never for Item CBM.
  let perItem = getItemSizeCbm(itemDoc?.inspected_item_sizes);
  let perItemSource = "inspected_item";

  if (perItem <= 0) {
    perItem = getItemSizeCbm(itemDoc?.pis_item_sizes);
    perItemSource = "pis_item";
  }

  if (perItem <= 0) {
    const inspectedStoredCbm = [
      itemDoc?.cbm?.calculated_inspected_total,
      itemDoc?.cbm?.inspected_total,
    ]
      .map((value) => toPositiveCbmNumber(value))
      .find((value) => value > 0);
    if (inspectedStoredCbm > 0) {
      perItem = inspectedStoredCbm;
      perItemSource = "inspected";
    }
  }

  if (perItem <= 0) {
    const pisTopCbm = toPositiveCbmNumber(itemDoc?.cbm?.top);
    const pisBottomCbm = toPositiveCbmNumber(itemDoc?.cbm?.bottom);
    if (pisTopCbm > 0 && pisBottomCbm > 0) {
      perItem = pisTopCbm + pisBottomCbm;
      perItemSource = "pis";
    }
  }

  if (perItem <= 0) {
    const pisStoredCbm = [
      itemDoc?.cbm?.calculated_pis_total,
      itemDoc?.cbm?.total,
    ]
      .map((value) => toPositiveCbmNumber(value))
      .find((value) => value > 0);
    if (pisStoredCbm > 0) {
      perItem = pisStoredCbm;
      perItemSource = "pis";
    }
  }

  let totalPoCbm = packing?.source === "inspected_box"
    ? calculateTotalPoCbm({
      orderQuantity,
      inspectedBoxSizes: itemDoc?.inspected_box_sizes,
      inspectedBoxMode: itemDoc?.inspected_box_mode,
    })
    : packing
      ? toRoundedCbmValue(Math.max(0, Number(orderQuantity || 0)) * packing.per_item)
      : 0;
  let totalSource = packing?.source || null;

  if (totalPoCbm <= 0) {
    totalPoCbm = calculateTotalPoCbm({
      orderQuantity,
      inspectedBoxSizes: itemDoc?.inspected_box_sizes,
      inspectedBoxMode: itemDoc?.inspected_box_mode,
    });
    totalSource = "inspected_box";
  }

  if (perItem <= 0 && totalPoCbm > 0) {
    const quantity = Math.max(0, Number(orderQuantity || 0));
    perItem = quantity > 0 ? totalPoCbm / quantity : 0;
    perItemSource = totalSource;
  }

  if (totalPoCbm <= 0 && perItem > 0) {
    totalPoCbm = Math.max(0, Number(orderQuantity || 0)) * perItem;
    totalSource = perItemSource;
  }

  return {
    source: totalSource,
    per_item: packing ? toRoundedCbmValue(packing.per_item) : null,
    total: totalPoCbm > 0 ? toRoundedCbmValue(totalPoCbm) : null,
    packing,
  };
};

const resolveOrderRowCbmSummaryWithStoredFallback = ({
  itemDoc = null,
  quantity = 0,
  storedTotalCbm = 0,
  orderEntry = null,
} = {}) => {
  const calculatedSummary = resolveOrderRowCbmSummary(itemDoc, quantity, orderEntry);
  if (toPositiveCbmNumber(calculatedSummary?.total) > 0) {
    return calculatedSummary;
  }

  const total = toPositiveCbmNumber(storedTotalCbm);
  if (total <= 0) return calculatedSummary;

  return {
    ...calculatedSummary,
    source: "total_po_cbm",
    total,
  };
};

const resolveShipmentRowCbm = ({
  itemDoc = null,
  orderQuantity = 0,
  storedPoCbm = 0,
  shipmentQuantity = 0,
  inspectedBoxSizes = [],
  inspectedBoxMode = "",
  orderEntry = null,
} = {}) => {
  const shippedQuantity = Math.max(0, Number(shipmentQuantity || 0));
  if (shippedQuantity <= 0) return 0;

  if (hasCompletedInspection(orderEntry)) {
    const inspectionCbm = calculateTotalPoCbm({
      orderQuantity: shippedQuantity,
      inspectedBoxSizes,
      inspectedBoxMode,
    });
    if (inspectionCbm > 0) return toRoundedCbmValue(inspectionCbm);
  }

  const shipmentCbmSummary = resolveOrderRowCbmSummary(itemDoc, shippedQuantity, orderEntry);
  if (Number(shipmentCbmSummary?.total || 0) > 0) {
    return toRoundedCbmValue(shipmentCbmSummary.total);
  }

  const orderQuantityValue = Math.max(0, Number(orderQuantity || 0));
  const storedTotalPoCbm = toPositiveCbmNumber(storedPoCbm);
  if (storedTotalPoCbm > 0 && orderQuantityValue > 0) {
    return toRoundedCbmValue(
      (storedTotalPoCbm / orderQuantityValue) * shippedQuantity,
    );
  }

  return 0;
};

module.exports = {
  calculateCbmFromLbh,
  getItemSizeCbm,
  hasCompletedInspection,
  resolveOrderRowCbmSummary,
  resolveOrderRowCbmSummaryWithStoredFallback,
  resolveShipmentRowCbm,
  toPositiveCbmNumber,
  toRoundedCbmValue,
};
