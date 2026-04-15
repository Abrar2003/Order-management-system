export const ORDER_STATUS_SEQUENCE = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

export const toSafeOrderNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

export const normalizeOrderStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "partially shipped") return "Partial Shipped";
  if (normalized === "finalized") return "Inspection Done";

  return (
    ORDER_STATUS_SEQUENCE.find(
      (statusValue) => statusValue.toLowerCase() === normalized,
    ) || ""
  );
};

const normalizeRequestHistoryStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pending") return "open";
  if (normalized === "transferred") return "transfered";
  return normalized;
};

export const getShipmentQuantityTotal = (orderOrShipment = {}) => {
  const shipmentEntries = Array.isArray(orderOrShipment)
    ? orderOrShipment
    : orderOrShipment?.shipment;

  return (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce(
    (sum, entry) => sum + toSafeOrderNumber(entry?.quantity, 0),
    0,
  );
};

export const hasShipmentRecords = (order = {}) =>
  Array.isArray(order?.shipment) && order.shipment.length > 0;

export const hasOpenQcRequest = (qc = {}, remainingInspectionQuantity = 0) => {
  if (!qc || remainingInspectionQuantity <= 0) return false;

  const requestHistory = Array.isArray(qc?.request_history)
    ? qc.request_history
    : [];

  if (requestHistory.length > 0) {
    return requestHistory.some((entry) => {
      if (normalizeRequestHistoryStatus(entry?.status) !== "open") return false;
      return toSafeOrderNumber(entry?.quantity_requested, 0) > 0;
    });
  }

  return toSafeOrderNumber(qc?.quantities?.quantity_requested, 0) > 0;
};

export const getOrderProgress = ({ order = {}, qc = null } = {}) => {
  const qcRecord = qc ?? order?.qc_record ?? null;
  const orderQuantity = toSafeOrderNumber(
    order?.quantity ?? qcRecord?.quantities?.client_demand,
    0,
  );
  const shippedQuantity = orderQuantity > 0
    ? Math.min(orderQuantity, getShipmentQuantityTotal(order))
    : getShipmentQuantityTotal(order);
  const passedQuantity = orderQuantity > 0
    ? Math.min(orderQuantity, toSafeOrderNumber(qcRecord?.quantities?.qc_passed, 0))
    : toSafeOrderNumber(qcRecord?.quantities?.qc_passed, 0);
  const pendingInspectionQuantity = Math.max(0, orderQuantity - passedQuantity);
  const inspectedUnshippedQuantity = Math.max(
    0,
    Math.min(orderQuantity - shippedQuantity, passedQuantity - shippedQuantity),
  );
  const hasOpenRequest = hasOpenQcRequest(qcRecord, pendingInspectionQuantity);

  let status = "Pending";
  if (orderQuantity > 0 && shippedQuantity >= orderQuantity) {
    status = "Shipped";
  } else if (
    orderQuantity > 0 &&
    passedQuantity >= orderQuantity &&
    shippedQuantity > 0
  ) {
    status = "Partial Shipped";
  } else if (orderQuantity > 0 && passedQuantity >= orderQuantity) {
    status = "Inspection Done";
  } else if (hasOpenRequest) {
    status = "Under Inspection";
  }

  return {
    order_quantity: orderQuantity,
    shipped_quantity: shippedQuantity,
    passed_quantity: passedQuantity,
    pending_inspection_quantity: pendingInspectionQuantity,
    inspected_unshipped_quantity: inspectedUnshippedQuantity,
    has_open_request: hasOpenRequest,
    status,
  };
};

export const getDerivedOrderStatus = ({ order = {}, qc = null } = {}) =>
  getOrderProgress({ order, qc }).status;

export const getGroupedOrderStatus = (statuses = []) => {
  const normalizedStatuses = [
    ...new Set(
      (Array.isArray(statuses) ? statuses : [])
        .map(normalizeOrderStatus)
        .filter(Boolean),
    ),
  ];

  if (normalizedStatuses.length === 0) return "Pending";
  if (normalizedStatuses.includes("Pending")) return "Pending";
  if (normalizedStatuses.includes("Under Inspection")) return "Under Inspection";
  if (normalizedStatuses.every((statusValue) => statusValue === "Shipped")) {
    return "Shipped";
  }
  if (
    normalizedStatuses.includes("Partial Shipped") ||
    normalizedStatuses.includes("Shipped")
  ) {
    return "Partial Shipped";
  }
  if (normalizedStatuses.includes("Inspection Done")) {
    return "Inspection Done";
  }

  return normalizedStatuses[0] || "Pending";
};

export const hasShippableQuantity = ({ order = {}, qc = null } = {}) => {
  const progress = getOrderProgress({ order, qc });
  return progress.passed_quantity > progress.shipped_quantity;
};
