const { toDateOnlyIso } = require("./dateOnly");

const AQL_REQUEST_TYPE = "AQL";
const TRANSFERRED_STATUS = "transfered";
const NON_PACKED_STATUSES = new Set([
  "goods not ready",
  "rejected",
  "shifted for later",
  "transfered",
  "transferred",
]);

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeQcRequestType = (value) =>
  String(value || "").trim().toUpperCase() === AQL_REQUEST_TYPE
    ? AQL_REQUEST_TYPE
    : "FULL";

const normalizeInspectionStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "transferred" ? TRANSFERRED_STATUS : normalized;
};

const getEffectiveRequestPassedQuantity = ({
  requestType = "",
  samplePassed = 0,
  requestedQuantity = 0,
} = {}) => {
  const safeSamplePassed = toNonNegativeNumber(samplePassed, 0);
  if (normalizeQcRequestType(requestType) !== AQL_REQUEST_TYPE) {
    return safeSamplePassed;
  }
  return safeSamplePassed > 0
    ? toNonNegativeNumber(requestedQuantity, 0)
    : 0;
};

const resolveInspectionRequestGroupKey = (record = {}, fallbackKey = "") => {
  const requestHistoryId = String(record?.request_history_id || "").trim();
  if (requestHistoryId) return `request:${requestHistoryId}`;

  const requestedDateKey = toDateOnlyIso(
    record?.requested_date || record?.inspection_date || record?.createdAt,
  );
  const inspectorId = String(
    record?.inspector?._id || record?.inspector || "",
  ).trim();
  if (requestedDateKey && inspectorId) {
    return `date:${requestedDateKey}:inspector:${inspectorId}`;
  }
  if (requestedDateKey) return `date:${requestedDateKey}`;

  const recordId = String(record?._id || "").trim();
  if (recordId) return `record:${recordId}`;
  return fallbackKey || "record:unknown";
};

const resolveRequestedQuantityFromQc = (qcDoc = {}) => {
  const requestHistory = Array.isArray(qcDoc?.request_history)
    ? qcDoc.request_history
    : [];
  const latestRequestedQuantity = Number(
    requestHistory.at(-1)?.quantity_requested,
  );
  const storedRequestedQuantity = Number(
    qcDoc?.quantities?.quantity_requested,
  );

  if (Number.isFinite(latestRequestedQuantity) && latestRequestedQuantity > 0) {
    return latestRequestedQuantity;
  }
  if (Number.isFinite(storedRequestedQuantity) && storedRequestedQuantity > 0) {
    return storedRequestedQuantity;
  }

  for (let index = requestHistory.length - 1; index >= 0; index -= 1) {
    const historicalQuantity = Number(requestHistory[index]?.quantity_requested);
    if (Number.isFinite(historicalQuantity) && historicalQuantity > 0) {
      return historicalQuantity;
    }
  }

  if (Number.isFinite(latestRequestedQuantity) && latestRequestedQuantity >= 0) {
    return latestRequestedQuantity;
  }
  if (Number.isFinite(storedRequestedQuantity) && storedRequestedQuantity >= 0) {
    return storedRequestedQuantity;
  }

  const clientDemandQuantity = Number(qcDoc?.quantities?.client_demand);
  return Number.isFinite(clientDemandQuantity) && clientDemandQuantity > 0
    ? clientDemandQuantity
    : 0;
};

const calculateQcAggregateMetrics = (qcDoc, inspectionRecords = []) => {
  const records = (Array.isArray(inspectionRecords) ? inspectionRecords : [])
    .filter((record) => normalizeInspectionStatus(record?.status) !== TRANSFERRED_STATUS);
  const requestHistoryQuantityById = new Map(
    (Array.isArray(qcDoc?.request_history) ? qcDoc.request_history : [])
      .map((entry) => [
        String(entry?._id || "").trim(),
        toNonNegativeNumber(entry?.quantity_requested, 0),
      ])
      .filter(([requestHistoryId]) => requestHistoryId),
  );
  const requestType = normalizeQcRequestType(qcDoc?.request_type);
  const fallbackRequestedQuantity = resolveRequestedQuantityFromQc(qcDoc);
  const requestGroupMetrics = new Map();

  records.forEach((record, index) => {
    const requestGroupKey = resolveInspectionRequestGroupKey(
      record,
      `fallback:${index}`,
    );
    const requestHistoryId = String(record?.request_history_id || "").trim();
    const requestMetrics = requestGroupMetrics.get(requestGroupKey) || {
      requestedQuantity: 0,
      samplePassed: 0,
    };
    requestMetrics.requestedQuantity = Math.max(
      requestMetrics.requestedQuantity,
      toNonNegativeNumber(record?.vendor_requested, 0),
      requestHistoryId
        ? toNonNegativeNumber(requestHistoryQuantityById.get(requestHistoryId), 0)
        : 0,
    );
    requestMetrics.samplePassed += toNonNegativeNumber(record?.passed, 0);
    requestGroupMetrics.set(requestGroupKey, requestMetrics);
  });

  const totalEffectivePassed = [...requestGroupMetrics.values()].reduce(
    (sum, metrics) => sum + getEffectiveRequestPassedQuantity({
      requestType,
      samplePassed: metrics.samplePassed,
      requestedQuantity: metrics.requestedQuantity > 0
        ? metrics.requestedQuantity
        : fallbackRequestedQuantity,
    }),
    0,
  );

  return {
    totalChecked: records.reduce(
      (sum, record) => sum + toNonNegativeNumber(record?.checked, 0),
      0,
    ),
    totalVendorOffered: records.reduce(
      (sum, record) => sum + toNonNegativeNumber(record?.vendor_offered, 0),
      0,
    ),
    totalSamplePassed: records.reduce(
      (sum, record) => sum + toNonNegativeNumber(record?.passed, 0),
      0,
    ),
    totalRejected: records.reduce(
      (sum, record) => sum + toNonNegativeNumber(record?.rejected, 0),
      0,
    ),
    totalEffectivePassed,
  };
};

const toSortableTimestamp = (value) => {
  const isoDate = toDateOnlyIso(value);
  if (!isoDate) return 0;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const buildApprovedGoodsQuantityByInspectionId = (inspectionRecords = []) => {
  const requestGroups = new Map();

  (Array.isArray(inspectionRecords) ? inspectionRecords : []).forEach(
    (inspection, index) => {
      if (normalizeInspectionStatus(inspection?.status) === TRANSFERRED_STATUS) {
        return;
      }

      const inspectionId = String(inspection?._id || "").trim();
      const qcDoc = inspection?.qc;
      const qcId = String(qcDoc?._id || qcDoc || "").trim();
      if (!inspectionId || !qcId) return;

      const requestHistoryId = String(
        inspection?.request_history_id || "",
      ).trim();
      const requestHistoryEntry = requestHistoryId
        ? (Array.isArray(qcDoc?.request_history) ? qcDoc.request_history : [])
            .find((entry) => String(entry?._id || "").trim() === requestHistoryId)
        : null;
      const groupKey = `${qcId}:${resolveInspectionRequestGroupKey(
        inspection,
        `fallback:${index}`,
      )}`;
      const group = requestGroups.get(groupKey) || {
        requestType: requestHistoryEntry?.request_type || qcDoc?.request_type,
        requestedQuantity: 0,
        fallbackRequestedQuantity: resolveRequestedQuantityFromQc(qcDoc),
        samplePassed: 0,
        ownerId: "",
        ownerTime: 0,
      };

      group.requestedQuantity = Math.max(
        group.requestedQuantity,
        toNonNegativeNumber(inspection?.vendor_requested, 0),
        toNonNegativeNumber(requestHistoryEntry?.quantity_requested, 0),
      );
      const passedQuantity = toNonNegativeNumber(inspection?.passed, 0);
      group.samplePassed += passedQuantity;

      if (passedQuantity > 0) {
        const ownerTime = toSortableTimestamp(
          toDateOnlyIso(inspection?.inspection_date)
            || toDateOnlyIso(inspection?.createdAt),
        );
        if (
          !group.ownerId
          || ownerTime > group.ownerTime
          || (ownerTime === group.ownerTime && inspectionId > group.ownerId)
        ) {
          group.ownerId = inspectionId;
          group.ownerTime = ownerTime;
        }
      }

      requestGroups.set(groupKey, group);
    },
  );

  const approvedQuantityByInspectionId = new Map();
  for (const group of requestGroups.values()) {
    const approvedQuantity = getEffectiveRequestPassedQuantity({
      requestType: group.requestType,
      samplePassed: group.samplePassed,
      requestedQuantity: group.requestedQuantity > 0
        ? group.requestedQuantity
        : group.fallbackRequestedQuantity,
    });
    if (group.ownerId && approvedQuantity > 0) {
      approvedQuantityByInspectionId.set(group.ownerId, approvedQuantity);
    }
  }
  return approvedQuantityByInspectionId;
};

const isQualifyingPackedInspection = (inspection = {}) => {
  if (toNonNegativeNumber(inspection?.passed, 0) <= 0) return false;
  if (NON_PACKED_STATUSES.has(String(inspection?.status || "").trim().toLowerCase())) {
    return false;
  }
  const goodsNotReady = inspection?.goods_not_ready;
  return !(
    goodsNotReady === true
    || goodsNotReady?.ready === true
    || String(goodsNotReady?.reason || "").trim()
  );
};

module.exports = {
  buildApprovedGoodsQuantityByInspectionId,
  calculateQcAggregateMetrics,
  getEffectiveRequestPassedQuantity,
  isQualifyingPackedInspection,
  normalizeQcRequestType,
  resolveInspectionRequestGroupKey,
  resolveRequestedQuantityFromQc,
};
