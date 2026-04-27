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
  isInspectionStatusMatching(status, "Inspection Done") ||
  Boolean(goodsNotReady?.ready) ||
  Number(checked || 0) > 0 ||
  Number(passed || 0) > 0 ||
  Number(vendorOffered || 0) > 0 ||
  (Array.isArray(labelsAdded) && labelsAdded.length > 0) ||
  (Array.isArray(labelRanges) && labelRanges.length > 0);

const getUtcDayOffsetFromToday = (isoDateValue) => {
  const normalizedIso = toISODateString(isoDateValue);
  if (!normalizedIso) return null;
  const [year, month, day] = normalizedIso.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const todayIso = getTodayISODate();
  if (!todayIso) return null;
  const [todayYear, todayMonth, todayDay] = todayIso.split("-").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round((todayUtc - targetUtc) / oneDayMs);
};

const isTodayOrYesterday = (value) => {
  const offset = getUtcDayOffsetFromToday(value);
  return offset !== null && offset >= 0 && offset <= 1;
};

const QC_UPDATE_DATE_MESSAGE =
  "QC can update only requests from today or yesterday.";

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

const getInspectionRecordsForRequestEntry = (
  inspectionRecords = [],
  requestEntry = null,
) => {
  if (!requestEntry) return [];

  const records = Array.isArray(inspectionRecords) ? inspectionRecords : [];
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

  if (requestHistoryId) {
    const exactMatches = records.filter(
      (record) => String(record?.request_history_id || "").trim() === requestHistoryId,
    );
    if (exactMatches.length > 0) return exactMatches;
  }

  if (!requestDateKey) return [];

  return records.filter((record) => {
    const linkedRequestHistoryId = String(record?.request_history_id || "").trim();
    if (requestHistoryId && linkedRequestHistoryId && linkedRequestHistoryId !== requestHistoryId) {
      return false;
    }

    const recordRequestedDate = toISODateString(
      record?.requested_date || record?.inspection_date || record?.createdAt,
    );
    if (recordRequestedDate !== requestDateKey) return false;

    if (!requestInspectorId) return true;

    const recordInspectorId = String(
      record?.inspector?._id || record?.inspector || "",
    ).trim();
    return !recordInspectorId || recordInspectorId === requestInspectorId;
  });
};

export const getQcUserUpdateRequestAvailability = (
  qc = {},
  { currentUserId = "" } = {},
) => {
  const latestRequestEntry = resolveLatestRequestEntry(qc?.request_history);

  if (!latestRequestEntry) {
    return {
      isAvailable: false,
      reason: "A new QC request is required before QC can update this record.",
      latestRequestEntry: null,
      latestInspectionRecord: null,
    };
  }

  const requestDateIso = toISODateString(
    latestRequestEntry?.request_date || qc?.request_date || "",
  );
  if (!requestDateIso || !isTodayOrYesterday(requestDateIso)) {
    return {
      isAvailable: false,
      reason: QC_UPDATE_DATE_MESSAGE,
      latestRequestEntry,
      latestInspectionRecord: null,
    };
  }

  const requestInspectorId = String(
    latestRequestEntry?.inspector?._id ||
      latestRequestEntry?.inspector ||
      qc?.inspector?._id ||
      qc?.inspector ||
      "",
  ).trim();
  const normalizedCurrentUserId = String(currentUserId || "").trim();
  if (
    normalizedCurrentUserId &&
    (!requestInspectorId || requestInspectorId !== normalizedCurrentUserId)
  ) {
    return {
      isAvailable: false,
      reason: "Only the inspector assigned to this QC request can update it.",
      latestRequestEntry,
      latestInspectionRecord: null,
    };
  }

  const latestRequestStatus = normalizeRequestHistoryStatus(
    latestRequestEntry?.status || "open",
  );
  if (latestRequestStatus !== "open") {
    return {
      isAvailable: false,
      reason: "This QC request is already closed and cannot be updated again.",
      latestRequestEntry,
      latestInspectionRecord: null,
    };
  }

  const requestInspectionRecords = getInspectionRecordsForRequestEntry(
    qc?.inspection_record,
    latestRequestEntry,
  );
  const latestInspectionRecord =
    resolveLatestInspectionRecordForRequestEntry(qc?.inspection_record, latestRequestEntry);
  const latestRequestHasActivity = requestInspectionRecords.some((record) =>
    hasInspectionRecordActivity({
      checked: record?.checked,
      passed: record?.passed,
      vendorOffered: record?.vendor_offered,
      labelsAdded: record?.labels_added,
      labelRanges: record?.label_ranges,
      goodsNotReady: record?.goods_not_ready,
      status: record?.status,
    }),
  );

  if (latestRequestHasActivity) {
    return {
      isAvailable: false,
      reason: "This QC request has already been inspected and cannot be updated again.",
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
