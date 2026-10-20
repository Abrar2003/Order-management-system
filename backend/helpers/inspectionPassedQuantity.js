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

const idString = (value) => String(value?._id || value || "").trim();

const resolveInspectionRequest = (record = {}, qcDoc = {}) => {
  const history = Array.isArray(qcDoc.request_history) ? qcDoc.request_history : [];
  const linked = history.find((entry) => idString(entry) === idString(record.request_history_id));
  if (linked) return linked;
  const date = toDateOnlyIso(record.requested_date);
  const dated = history.filter((entry) => date && toDateOnlyIso(entry.request_date) === date);
  const inspectorMatch = dated.filter((entry) => idString(entry.inspector) === idString(record.inspector));
  if (inspectorMatch.length === 1) return inspectorMatch[0];
  if (dated.length === 1) return dated[0];
  // Ambiguous legacy visits must not be assigned to a different request's batch.
  return null;
};

const getInspectionPassedFields = (record = {}, qcDoc = record.qc || {}) => {
  const request = resolveInspectionRequest(record, qcDoc);
  const request_type = normalizeQcRequestType(request?.request_type || qcDoc.request_type);
  const requestedQuantity = toNonNegativeNumber(record.vendor_requested, 0)
    || toNonNegativeNumber(request?.quantity_requested, 0);
  return {
    request_type,
    aql_passed: request_type === AQL_REQUEST_TYPE
      ? getEffectiveRequestPassedQuantity({ requestType: request_type, samplePassed: record.passed, requestedQuantity })
      : null,
  };
};

// Ownership is resolved over all visits before applying report date/inspector filters.
const buildEffectivePassedQuantityByInspectionId = (inspectionRecords = []) => {
  const quantities = new Map();
  const owners = new Map();
  for (const record of inspectionRecords) {
    const id = idString(record);
    const qc = record.qc || {};
    const fields = getInspectionPassedFields(record, qc);
    quantities.set(id, 0);
    if (normalizeInspectionStatus(record.status) === TRANSFERRED_STATUS) continue;
    if (fields.aql_passed === null) {
      quantities.set(id, toNonNegativeNumber(record.passed, 0));
      continue;
    }
    if (toNonNegativeNumber(record.passed, 0) <= 0) continue;
    const request = resolveInspectionRequest(record, qc);
    const key = `${idString(qc)}:${resolveInspectionRequestGroupKey({ ...record, request_history_id: request?._id || record.request_history_id }, id)}`;
    const time = toSortableTimestamp(record.inspection_date) || toSortableTimestamp(record.createdAt);
    const previous = owners.get(key);
    if (!previous || time > previous.time || (time === previous.time && id > previous.id)) {
      owners.set(key, { id, time, quantity: fields.aql_passed });
    }
  }
  for (const owner of owners.values()) quantities.set(owner.id, owner.quantity);
  return quantities;
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
    .map((record) => record.toObject ? record.toObject() : record)
    .filter((record) => normalizeInspectionStatus(record?.status) !== TRANSFERRED_STATUS);
  const totalEffectivePassed = [...buildEffectivePassedQuantityByInspectionId(
    records.map((record, index) => ({ ...record, _id: record._id || `visit-${index}`, qc: qcDoc })),
  ).values()].reduce((sum, quantity) => sum + quantity, 0);

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

const applyInspectionRecordPendingAfter = (qcDoc, inspectionRecords = []) => {
  const records = inspectionRecords.filter((record) => normalizeInspectionStatus(record.status) !== TRANSFERRED_STATUS)
    .sort((left, right) =>
      (toSortableTimestamp(left.inspection_date) || toSortableTimestamp(left.createdAt))
        - (toSortableTimestamp(right.inspection_date) || toSortableTimestamp(right.createdAt))
        || String(left._id || "").localeCompare(String(right._id || "")));
  const visited = [];
  for (const record of records) {
    visited.push(record);
    record.pending_after = Math.max(0, toNonNegativeNumber(qcDoc?.quantities?.client_demand, 0)
      - calculateQcAggregateMetrics(qcDoc, visited).totalEffectivePassed);
  }
};

// Mongo reports use the same request snapshot and global ownership as JS totals.
const buildInspectionPassedStages = () => {
  const number = (value) => ({ $convert: { input: value, to: "double", onError: 0, onNull: 0 } });
  const date = (value) => ({ $let: {
    vars: { raw: { $convert: { input: value, to: "string", onError: "", onNull: "" } } },
    in: { $dateToString: { format: "%Y-%m-%d", timezone: process.env.APP_DATE_TIMEZONE || "Asia/Kolkata", date: {
      $ifNull: [
        { $dateFromString: { dateString: "$$raw", format: "%Y-%m-%d", onError: null, onNull: null } },
        { $dateFromString: { dateString: "$$raw", format: "%d/%m/%Y", onError: null, onNull: null } },
        { $convert: { input: value, to: "date", onError: null, onNull: null } },
      ],
    }, onNull: "" } },
  } });
  const context = {
    $let: {
      vars: { history: { $ifNull: ["$_passed_qc.request_history", []] } },
      in: {
        $let: {
          vars: {
            linked: { $arrayElemAt: [{ $filter: { input: "$$history", as: "request", cond: {
              $and: [{ $ne: [{ $ifNull: ["$request_history_id", null] }, null] }, { $eq: ["$$request._id", "$request_history_id"] }],
            } } }, 0] },
            dated: { $filter: { input: "$$history", as: "request", cond: {
              $and: [{ $ne: [date("$requested_date"), ""] }, { $eq: [date("$$request.request_date"), date("$requested_date")] }],
            } } },
          },
          in: {
            $let: {
              vars: { request: { $ifNull: ["$$linked", {
                $let: {
                  vars: { inspectorMatches: { $filter: { input: "$$dated", as: "request", cond: { $eq: ["$$request.inspector", "$inspector"] } } } },
                  in: { $cond: [
                    { $eq: [{ $size: "$$inspectorMatches" }, 1] }, { $arrayElemAt: ["$$inspectorMatches", 0] },
                    { $cond: [{ $eq: [{ $size: "$$dated" }, 1] }, { $arrayElemAt: ["$$dated", 0] }, null] },
                  ] },
                },
              }] } },
              in: {
                $let: {
                  vars: {
                    type: { $toUpper: { $trim: { input: { $ifNull: ["$$request.request_type", { $ifNull: ["$_passed_qc.request_type", "FULL"] }] } } } },
                    requested: { $cond: [{ $gt: [number("$vendor_requested"), 0] }, number("$vendor_requested"), number("$$request.quantity_requested")] },
                    requestId: { $ifNull: ["$$request._id", "$request_history_id"] },
                    requestDate: date({ $ifNull: ["$requested_date", { $ifNull: ["$inspection_date", "$createdAt"] }] }),
                  },
                  in: {
                    request_type: { $cond: [{ $eq: ["$$type", "AQL"] }, "AQL", "FULL"] },
                    aql_passed: { $cond: [{ $eq: ["$$type", "AQL"] }, { $cond: [{ $gt: [number("$passed"), 0] }, { $max: [0, "$$requested"] }, 0] }, null] },
                    group: { $cond: [{ $ne: [{ $ifNull: ["$$requestId", null] }, null] },
                      { $concat: ["request:", { $toString: "$$requestId" }] },
                      { $cond: [{ $ne: ["$$requestDate", ""] }, { $concat: ["date:", "$$requestDate", ":", { $ifNull: [{ $toString: "$inspector" }, ""] }] }, { $concat: ["record:", { $toString: "$_id" }] }] },
                    ] },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  return [
    { $lookup: { from: "qcs", localField: "qc", foreignField: "_id", pipeline: [{ $project: { request_type: 1, request_history: 1 } }], as: "_passed_qc" } },
    { $set: { _passed_qc: { $arrayElemAt: ["$_passed_qc", 0] } } },
    { $set: { _passed_context: context } },
    { $lookup: {
      from: "inspections",
      let: { qcId: "$qc", qcDoc: "$_passed_qc", group: "$_passed_context.group", isAql: { $eq: ["$_passed_context.request_type", "AQL"] } },
      pipeline: [
        { $match: { passed: { $gt: 0 }, status: { $nin: ["transfered", "transferred"] }, $expr: { $and: ["$$isAql", { $eq: ["$qc", "$$qcId"] }] } } },
        { $project: { qc: 1, inspector: 1, request_history_id: 1, requested_date: 1, vendor_requested: 1, passed: 1, inspection_date: 1, createdAt: 1 } },
        { $set: { _passed_qc: "$$qcDoc" } },
        { $set: { _passed_context: context } },
        { $match: { $expr: { $eq: ["$_passed_context.group", "$$group"] } } },
        { $set: { _passed_date: { $cond: [{ $ne: [date("$inspection_date"), ""] }, date("$inspection_date"), date("$createdAt")] } } },
        { $sort: { _passed_date: -1, _id: -1 } }, { $limit: 1 }, { $project: { _id: 1 } },
      ], as: "_passed_owner",
    } },
    { $set: {
      request_type: "$_passed_context.request_type",
      aql_passed: "$_passed_context.aql_passed",
      effective_passed: { $cond: [{ $in: ["$status", ["transfered", "transferred"]] }, 0,
        { $cond: [{ $eq: ["$_passed_context.request_type", "AQL"] },
          { $cond: [{ $eq: ["$_id", { $arrayElemAt: ["$_passed_owner._id", 0] }] }, "$_passed_context.aql_passed", 0] },
          { $max: [0, number("$passed")] },
        ] },
      ] },
    } },
    { $unset: ["_passed_qc", "_passed_context", "_passed_owner"] },
  ];
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

      const requestHistoryEntry = resolveInspectionRequest(inspection, qcDoc);
      const groupKey = `${qcId}:${resolveInspectionRequestGroupKey(
        { ...inspection, request_history_id: requestHistoryEntry?._id || inspection.request_history_id },
        `fallback:${index}`,
      )}`;
      const group = requestGroups.get(groupKey) || {
        requestType: requestHistoryEntry?.request_type || qcDoc?.request_type,
        requestedQuantity: 0,
        samplePassed: 0,
        ownerId: "",
        ownerTime: 0,
      };

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
          group.requestedQuantity = toNonNegativeNumber(inspection.vendor_requested, 0)
            || toNonNegativeNumber(requestHistoryEntry?.quantity_requested, 0);
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
      requestedQuantity: group.requestedQuantity,
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

const getLatestQualifyingInspectionDate = (inspectionRecords = []) =>
  (Array.isArray(inspectionRecords) ? inspectionRecords : []).reduce(
    (latestDate, inspection) => {
      if (!isQualifyingPackedInspection(inspection)) return latestDate;
      const inspectionDate = toDateOnlyIso(
        inspection?.inspection_date || inspection?.createdAt,
      );
      return inspectionDate > latestDate ? inspectionDate : latestDate;
    },
    "",
  );

module.exports = {
  applyInspectionRecordPendingAfter,
  buildInspectionPassedStages,
  buildEffectivePassedQuantityByInspectionId,
  getInspectionPassedFields,
  resolveInspectionRequest,
  buildApprovedGoodsQuantityByInspectionId,
  calculateQcAggregateMetrics,
  getLatestQualifyingInspectionDate,
  getEffectiveRequestPassedQuantity,
  isQualifyingPackedInspection,
  normalizeQcRequestType,
  resolveInspectionRequestGroupKey,
  resolveRequestedQuantityFromQc,
};
