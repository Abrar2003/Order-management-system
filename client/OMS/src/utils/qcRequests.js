import { getTodayISODate, toISODateString } from "./date";

const normalizeRequestHistoryStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "transferred") return "transfered";
  if (normalized === "pending") return "open";
  return normalized;
};

const toSortableTimestamp = (value) => {
  const isoDate = toISODateString(value);
  if (isoDate) {
    const parsedFromIso = new Date(`${isoDate}T00:00:00Z`);
    return Number.isNaN(parsedFromIso.getTime())
      ? 0
      : parsedFromIso.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export const resolveLatestRequestEntry = (requestHistory = []) => {
  const normalizedHistory = Array.isArray(requestHistory) ? requestHistory : [];
  let latestEntry = null;
  let latestTimestamp = -1;

  normalizedHistory.forEach((entry, index) => {
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

export const isPendingRequestHistoryStatus = (value) =>
  normalizeRequestHistoryStatus(value) === "open";

const isInspectionStatusMatching = (value = "", expected = "") =>
  normalizeRequestHistoryStatus(value) === normalizeRequestHistoryStatus(expected);

const hasInspectionRecordActivity = ({
  checked = 0,
  passed = 0,
  vendorOffered = 0,
  labelsAdded = [],
  labelRanges = [],
  goodsNotReady = null,
  status = "",
} = {}) =>
  isInspectionStatusMatching(status, "rejected") ||
  isInspectionStatusMatching(status, "goods not ready") ||
  Boolean(goodsNotReady?.ready) ||
  Number(checked || 0) > 0 ||
  Number(passed || 0) > 0 ||
  Number(vendorOffered || 0) > 0 ||
  (Array.isArray(labelsAdded) && labelsAdded.length > 0) ||
  (Array.isArray(labelRanges) && labelRanges.length > 0);

export const resolveLatestInspectionRecordForRequestEntry = (
  inspectionRecords = [],
  requestEntry = null,
) => {
  if (!requestEntry) return null;

  const requestHistoryId = String(
    requestEntry?._id ||
      requestEntry?.request_history_id ||
      requestEntry?.id ||
      "",
  ).trim();
  const requestDateKey = toISODateString(
    requestEntry?.request_date || requestEntry?.requested_date,
  );
  const requestInspectorId = String(
    requestEntry?.inspector?._id ||
      requestEntry?.inspector ||
      requestEntry?.inspector_id ||
      "",
  ).trim();
  const canUseDateFallbackRecord = (record = {}) => {
    const linkedRequestHistoryId = String(record?.request_history_id || "").trim();
    if (!requestHistoryId || !linkedRequestHistoryId) return true;
    if (linkedRequestHistoryId === requestHistoryId) return true;
    if (isInspectionStatusMatching(record?.status, "transfered")) return false;
    return Number(record?.checked || 0) <= 0;
  };

  const findLatestMatchingRecord = (matcher) => {
    let latestRecord = null;
    let latestTimestamp = 0;

    for (const record of Array.isArray(inspectionRecords) ? inspectionRecords : []) {
      if (!matcher(record)) continue;

      const recordTimestamp = Math.max(
        toSortableTimestamp(record?.inspection_date),
        toSortableTimestamp(record?.requested_date),
        toSortableTimestamp(record?.createdAt),
      );
      if (!latestRecord || recordTimestamp >= latestTimestamp) {
        latestRecord = record;
        latestTimestamp = recordTimestamp;
      }
    }

    return latestRecord;
  };

  if (requestHistoryId) {
    const exactMatch = findLatestMatchingRecord(
      (record) => String(record?.request_history_id || "").trim() === requestHistoryId,
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (!requestDateKey) return null;

  return (
    findLatestMatchingRecord((record) => {
      if (!canUseDateFallbackRecord(record)) return false;

      const recordRequestedDate = toISODateString(
        record?.requested_date || record?.inspection_date || record?.createdAt,
      );
      if (recordRequestedDate !== requestDateKey) return false;

      if (!requestInspectorId) return true;

      const recordInspectorId = String(
        record?.inspector?._id || record?.inspector || "",
      ).trim();
      return !recordInspectorId || recordInspectorId === requestInspectorId;
    }) ||
    findLatestMatchingRecord((record) => {
      if (!canUseDateFallbackRecord(record)) return false;

      const recordRequestedDate = toISODateString(
        record?.requested_date || record?.inspection_date || record?.createdAt,
      );
      return recordRequestedDate === requestDateKey;
    }) ||
    null
  );
};

export const getQcUserUpdateRequestAvailability = (qc = {}) => {
  const latestRequestEntry = resolveLatestRequestEntry(qc?.request_history);

  if (!latestRequestEntry) {
    return {
      isAvailable: false,
      reason: "A new QC request is required before QC can update this record.",
      latestRequestEntry: null,
      latestInspectionRecord: null,
    };
  }

  const latestInspectionRecord = resolveLatestInspectionRecordForRequestEntry(
    qc?.inspection_record,
    latestRequestEntry,
  );
  const zeroCheckedInspectionRecord = (Array.isArray(qc?.inspection_record)
    ? qc.inspection_record
    : []
  ).find((record) => Number(record?.checked || 0) <= 0);
  if (zeroCheckedInspectionRecord) {
    return {
      isAvailable: true,
      reason: "",
      latestRequestEntry,
      latestInspectionRecord: latestInspectionRecord || zeroCheckedInspectionRecord,
    };
  }

  const latestRequestStatus = normalizeRequestHistoryStatus(
    latestRequestEntry?.status || "open",
  );
  if (latestRequestStatus !== "open") {
    return {
      isAvailable: false,
      reason: "The latest QC request is already closed. Align a new QC request before updating again.",
      latestRequestEntry,
      latestInspectionRecord,
    };
  }

  const latestRequestHasActivity = latestInspectionRecord
    ? hasInspectionRecordActivity({
      checked: latestInspectionRecord?.checked,
      passed: latestInspectionRecord?.passed,
      vendorOffered: latestInspectionRecord?.vendor_offered,
      labelsAdded: latestInspectionRecord?.labels_added,
      labelRanges: latestInspectionRecord?.label_ranges,
      goodsNotReady: latestInspectionRecord?.goods_not_ready,
      status: latestInspectionRecord?.status,
    })
    : false;

  if (latestRequestHasActivity) {
    return {
      isAvailable: false,
      reason: "The latest QC request is already worked upon. Align a new QC request before updating again.",
      latestRequestEntry,
      latestInspectionRecord,
    };
  }

  return {
    isAvailable: true,
    reason: "",
    latestRequestEntry,
    latestInspectionRecord,
  };
};

const getPendingQuantity = (qc = {}) => {
  const parsed = Number(qc?.quantities?.pending);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export const canTransferLatestRequestToday = (
  qc = {},
  todayIso = getTodayISODate(),
) => {
  const latestRequestEntry = resolveLatestRequestEntry(qc?.request_history);
  if (!latestRequestEntry) return false;

  if (!isPendingRequestHistoryStatus(latestRequestEntry?.status)) {
    return false;
  }

  const latestRequestDateIso = toISODateString(
    latestRequestEntry?.request_date || latestRequestEntry?.requested_date || "",
  );
  if (!latestRequestDateIso || latestRequestDateIso !== todayIso) {
    return false;
  }

  return getPendingQuantity(qc) > 0;
};
