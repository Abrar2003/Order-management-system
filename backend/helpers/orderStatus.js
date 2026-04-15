const ORDER_STATUS_SEQUENCE = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const toSortableTimestamp = (value, fallback = 0) => {
  if (!value) return fallback;

  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? fallback : timestamp;
  }

  const normalized = String(value || "").trim();
  if (!normalized) return fallback;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsedIsoDate = new Date(`${normalized}T00:00:00Z`);
    return Number.isNaN(parsedIsoDate.getTime())
      ? fallback
      : parsedIsoDate.getTime();
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.getTime();
};

const normalizeRequestHistoryStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pending") return "open";
  if (normalized === "transferred") return "transfered";
  return normalized;
};

const resolveLatestRequestEntry = (requestHistory = []) => {
  const entries = Array.isArray(requestHistory) ? requestHistory : [];
  let latestEntry = null;
  let latestTimestamp = -1;

  entries.forEach((entry, index) => {
    const entryTimestamp = Math.max(
      toSortableTimestamp(entry?.request_date || entry?.requested_date),
      toSortableTimestamp(entry?.updatedAt || entry?.updated_at),
      toSortableTimestamp(entry?.createdAt || entry?.created_at),
      index,
    );

    if (entryTimestamp >= latestTimestamp) {
      latestEntry = entry;
      latestTimestamp = entryTimestamp;
    }
  });

  return latestEntry;
};

const normalizeOrderStatus = (value = "") => {
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

const getShipmentQuantityTotal = (shipmentEntries = []) =>
  (Array.isArray(shipmentEntries) ? shipmentEntries : []).reduce(
    (sum, entry) => sum + toNonNegativeNumber(entry?.quantity, 0),
    0,
  );

const resolveShippedQuantity = ({
  shipmentEntries = [],
  shippedQuantity = null,
  orderQuantity = 0,
} = {}) => {
  const totalQuantity = toNonNegativeNumber(orderQuantity, 0);
  const resolvedQuantity =
    shippedQuantity === null || shippedQuantity === undefined
      ? getShipmentQuantityTotal(shipmentEntries)
      : toNonNegativeNumber(shippedQuantity, 0);

  if (totalQuantity <= 0) return resolvedQuantity;
  return Math.min(totalQuantity, resolvedQuantity);
};

const hasOpenQcRequest = ({
  qcRecord = null,
  remainingInspectionQuantity = 0,
} = {}) => {
  if (!qcRecord || remainingInspectionQuantity <= 0) return false;

  const requestHistory = Array.isArray(qcRecord?.request_history)
    ? qcRecord.request_history
    : [];

  if (requestHistory.length > 0) {
    return requestHistory.some((entry) => {
      if (normalizeRequestHistoryStatus(entry?.status) !== "open") return false;
      return toNonNegativeNumber(entry?.quantity_requested, 0) > 0;
    });
  }

  return toNonNegativeNumber(qcRecord?.quantities?.quantity_requested, 0) > 0;
};

const deriveOrderProgress = ({
  orderEntry = null,
  orderQuantity = null,
  shipmentEntries = null,
  shippedQuantity = null,
  qcRecord = null,
} = {}) => {
  const resolvedOrderQuantity = toNonNegativeNumber(
    orderQuantity ?? orderEntry?.quantity,
    0,
  );
  const resolvedShipmentEntries =
    shipmentEntries ?? orderEntry?.shipment ?? [];
  const resolvedQcRecord = qcRecord ?? orderEntry?.qc_record ?? null;
  const resolvedShippedQuantity = resolveShippedQuantity({
    shipmentEntries: resolvedShipmentEntries,
    shippedQuantity,
    orderQuantity: resolvedOrderQuantity,
  });
  const passedQuantity = resolvedOrderQuantity > 0
    ? Math.min(
        resolvedOrderQuantity,
        toNonNegativeNumber(resolvedQcRecord?.quantities?.qc_passed, 0),
      )
    : toNonNegativeNumber(resolvedQcRecord?.quantities?.qc_passed, 0);
  const pendingInspectionQuantity = Math.max(
    0,
    resolvedOrderQuantity - passedQuantity,
  );
  const inspectedUnshippedQuantity = Math.max(
    0,
    Math.min(
      resolvedOrderQuantity - resolvedShippedQuantity,
      passedQuantity - resolvedShippedQuantity,
    ),
  );
  const hasOpenRequest = hasOpenQcRequest({
    qcRecord: resolvedQcRecord,
    remainingInspectionQuantity: pendingInspectionQuantity,
  });

  let status = "Pending";
  if (
    resolvedOrderQuantity > 0 &&
    resolvedShippedQuantity >= resolvedOrderQuantity
  ) {
    status = "Shipped";
  } else if (
    resolvedOrderQuantity > 0 &&
    passedQuantity >= resolvedOrderQuantity &&
    resolvedShippedQuantity > 0
  ) {
    status = "Partial Shipped";
  } else if (
    resolvedOrderQuantity > 0 &&
    passedQuantity >= resolvedOrderQuantity
  ) {
    status = "Inspection Done";
  } else if (hasOpenRequest) {
    status = "Under Inspection";
  }

  return {
    order_quantity: resolvedOrderQuantity,
    shipped_quantity: resolvedShippedQuantity,
    passed_quantity: passedQuantity,
    inspected_unshipped_quantity: inspectedUnshippedQuantity,
    pending_inspection_quantity: pendingInspectionQuantity,
    has_open_request: hasOpenRequest,
    status,
  };
};

const deriveOrderStatus = ({
  orderEntry = null,
  orderQuantity = null,
  shipmentEntries = null,
  shippedQuantity = null,
  qcRecord = null,
  allowCancelledOnZero = false,
} = {}) => {
  const resolvedOrderQuantity = toNonNegativeNumber(
    orderQuantity ?? orderEntry?.quantity,
    0,
  );

  if (allowCancelledOnZero && resolvedOrderQuantity <= 0) {
    return "Cancelled";
  }

  return deriveOrderProgress({
    orderEntry,
    orderQuantity: resolvedOrderQuantity,
    shipmentEntries,
    shippedQuantity,
    qcRecord,
  }).status;
};

const deriveGroupedOrderStatus = (statuses = []) => {
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

module.exports = {
  ORDER_STATUS_SEQUENCE,
  deriveGroupedOrderStatus,
  deriveOrderProgress,
  deriveOrderStatus,
  getShipmentQuantityTotal,
  hasOpenQcRequest,
  normalizeOrderStatus,
  normalizeRequestHistoryStatus,
  resolveLatestRequestEntry,
};
