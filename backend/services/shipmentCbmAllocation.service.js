const {
  calculateTotalPoCbm,
} = require("./orderCbm.service");
const {
  calculateEffectiveBoxEntriesCbmTotal,
  detectBoxPackagingMode,
} = require("../helpers/boxMeasurement");

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

const resolveOrderRowCbmSummary = (itemDoc = null, orderQuantity = 0) => {
  if (!itemDoc || typeof itemDoc !== "object") {
    return {
      source: null,
      per_item: null,
      total: null,
    };
  }

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

  let totalPoCbm = calculateTotalPoCbm({
    orderQuantity,
    inspectedBoxSizes: itemDoc?.inspected_box_sizes,
    inspectedBoxMode: itemDoc?.inspected_box_mode,
  });
  let totalSource = "inspected_box";

  if (totalPoCbm <= 0) {
    const pisBoxMode = detectBoxPackagingMode(
      itemDoc?.pis_box_mode,
      itemDoc?.pis_box_sizes,
    );
    const pisBoxEntriesCbm = calculateEffectiveBoxEntriesCbmTotal(
      itemDoc?.pis_box_sizes,
      pisBoxMode,
    );
    if (pisBoxEntriesCbm > 0) {
      totalPoCbm = toRoundedCbmValue(
        Math.max(0, Number(orderQuantity || 0)) * pisBoxEntriesCbm,
      );
      totalSource = "pis_box";
    }
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
    per_item: perItem > 0 ? toRoundedCbmValue(perItem) : null,
    total: totalPoCbm > 0 ? toRoundedCbmValue(totalPoCbm) : null,
  };
};

const resolveOrderRowCbmSummaryWithStoredFallback = ({
  itemDoc = null,
  quantity = 0,
  storedTotalCbm = 0,
} = {}) => {
  const calculatedSummary = resolveOrderRowCbmSummary(itemDoc, quantity);
  if (toPositiveCbmNumber(calculatedSummary?.total) > 0) {
    return calculatedSummary;
  }

  const total = toPositiveCbmNumber(storedTotalCbm);
  if (total <= 0) return calculatedSummary;

  const quantityValue = Math.max(0, Number(quantity || 0));
  return {
    source: "total_po_cbm",
    per_item: quantityValue > 0 ? toRoundedCbmValue(total / quantityValue) : 0,
    total,
  };
};

const resolveShipmentRowCbm = ({
  itemDoc = null,
  orderQuantity = 0,
  storedPoCbm = 0,
  shipmentQuantity = 0,
} = {}) => {
  const shippedQuantity = Math.max(0, Number(shipmentQuantity || 0));
  if (shippedQuantity <= 0) return 0;

  const shipmentCbmSummary = resolveOrderRowCbmSummary(itemDoc, shippedQuantity);
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
  resolveOrderRowCbmSummary,
  resolveOrderRowCbmSummaryWithStoredFallback,
  resolveShipmentRowCbm,
  toPositiveCbmNumber,
  toRoundedCbmValue,
};
