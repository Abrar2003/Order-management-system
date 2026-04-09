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
