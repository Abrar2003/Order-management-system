import { useEffect, useMemo, useState } from "react";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { getOrderRevisedEtdHistory } from "../services/orders.service";
import HoverPortal from "./HoverPortal";
import "../App.css";

const historyCache = new Map();
const pendingHistoryRequests = new Map();

const getCacheKey = (orderId, itemCode) =>
  `${String(orderId || "").trim()}__${String(itemCode || "").trim()}`;

const createDefaultState = () => ({
  status: "idle",
  items: [],
  error: "",
});

const toDateKey = (value) => toISODateString(value);
const toTimestamp = (value) => {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeHistoryItems = (items = [], itemCode = "") => {
  const normalizedItemCode = String(itemCode || "").trim().toLowerCase();
  const safeItems = Array.isArray(items) ? items : [];

  return safeItems
    .filter((entry) => {
      if (!normalizedItemCode) return true;
      return String(entry?.item_code || "").trim().toLowerCase() === normalizedItemCode;
    })
    .map((entry) => ({
      id: String(entry?.id || ""),
      item_code: String(entry?.item_code || "").trim(),
      description: String(entry?.description || "").trim(),
      current_revised_etd: entry?.current_revised_etd || null,
      history: (Array.isArray(entry?.history) ? entry.history : [])
        .map((historyEntry) => ({
          revised_etd: historyEntry?.revised_etd || null,
          updated_at: historyEntry?.updated_at || null,
          updated_by_name: String(historyEntry?.updated_by?.name || "").trim(),
        }))
        .sort((left, right) => {
          const leftTime = left?.updated_at ? new Date(left.updated_at).getTime() : 0;
          const rightTime = right?.updated_at ? new Date(right.updated_at).getTime() : 0;
          return rightTime - leftTime;
        }),
    }))
    .filter((entry) => entry.history.length > 0 || toDateKey(entry?.current_revised_etd))
    .sort((left, right) =>
      left.item_code.localeCompare(right.item_code, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
};

const getCurrentRevisedEntry = (entry = {}) => {
  const currentDateKey = toDateKey(entry?.current_revised_etd);
  if (!currentDateKey) {
    return {
      value: null,
      updatedAt: null,
    };
  }

  const matchingHistoryEntry = (Array.isArray(entry?.history) ? entry.history : []).find(
    (historyEntry) => toDateKey(historyEntry?.revised_etd) === currentDateKey,
  );

  return {
    value: entry?.current_revised_etd || null,
    updatedAt: matchingHistoryEntry?.updated_at || null,
  };
};

const OrderEtdWithHistory = ({
  orderId,
  etd,
  revisedEtd = "",
  itemCode = "",
  className = "",
  fallback = "N/A",
}) => {
  const cacheKey = useMemo(
    () => getCacheKey(orderId, itemCode),
    [itemCode, orderId],
  );
  const [historyState, setHistoryState] = useState(
    () => historyCache.get(cacheKey) || createDefaultState(),
  );
  const hasLookup = Boolean(String(orderId || "").trim());
  const normalizedItemCode = String(itemCode || "").trim().toLowerCase();

  useEffect(() => {
    setHistoryState(historyCache.get(cacheKey) || createDefaultState());
  }, [cacheKey]);

  useEffect(() => {
    if (!hasLookup) return;

    const revisedEtdKey = toDateKey(revisedEtd);
    if (!revisedEtdKey) return;

    const cached = historyCache.get(cacheKey);
    const hasMatchingCurrentValue = Array.isArray(cached?.items)
      && cached.items.some((entry) => toDateKey(entry?.current_revised_etd) === revisedEtdKey);

    if (hasMatchingCurrentValue) return;

    historyCache.delete(cacheKey);
    pendingHistoryRequests.delete(cacheKey);
    setHistoryState(createDefaultState());
  }, [cacheKey, hasLookup, revisedEtd]);

  const loadHistory = async () => {
    if (!hasLookup) return;

    const cached = historyCache.get(cacheKey);
    if (cached && cached.status !== "idle") {
      setHistoryState(cached);
      return;
    }

    if (pendingHistoryRequests.has(cacheKey)) {
      const pendingResult = await pendingHistoryRequests.get(cacheKey);
      setHistoryState(pendingResult);
      return;
    }

    const requestPromise = (async () => {
      try {
        const response = await getOrderRevisedEtdHistory({
          orderId,
          itemCode,
        });
        const nextState = {
          status: "success",
          items: normalizeHistoryItems(response?.items, itemCode),
          error: "",
        };
        historyCache.set(cacheKey, nextState);
        return nextState;
      } catch (error) {
        const nextState = {
          status: "error",
          items: [],
          error: error?.response?.data?.message || "Failed to load revised ETD history.",
        };
        historyCache.set(cacheKey, nextState);
        return nextState;
      } finally {
        pendingHistoryRequests.delete(cacheKey);
      }
    })();

    pendingHistoryRequests.set(cacheKey, requestPromise);
    setHistoryState((prev) => (
      prev.status === "idle" ? { ...prev, status: "loading" } : prev
    ));
    const nextState = await requestPromise;
    setHistoryState(nextState);
  };

  const historyDisplayValue = useMemo(() => {
    const candidates = historyState.items
      .map((entry) => {
        const currentEntry = getCurrentRevisedEntry(entry);
        return {
          value: currentEntry.value,
          updatedAt: toTimestamp(currentEntry.updatedAt),
        };
      })
      .filter((entry) => toDateKey(entry?.value));

    if (candidates.length === 0) return null;

    candidates.sort((left, right) => right.updatedAt - left.updatedAt);
    return candidates[0]?.value || null;
  }, [historyState.items]);

  const displayValue = historyDisplayValue || revisedEtd || etd;
  const formattedEtd = formatDateDDMMYYYY(displayValue, fallback);

  const tooltipHistoryItems = useMemo(() => {
    const baseItems =
      historyState.items.length > 0
        ? historyState.items
        : [
            {
              id: cacheKey,
              item_code: String(itemCode || "").trim(),
              description: "",
              current_revised_etd: revisedEtd || null,
              history: [],
            },
          ];

    const relevantItems = normalizedItemCode
      ? baseItems.filter(
          (entry) =>
            String(entry?.item_code || "").trim().toLowerCase() === normalizedItemCode,
        )
      : baseItems;

    const revisedHistoryByDate = new Map();
    const addRevisedEntry = (value, updatedAt = null) => {
      const dateKey = toDateKey(value);
      if (!dateKey) return;

      const nextTimestamp = toTimestamp(updatedAt);
      const existing = revisedHistoryByDate.get(dateKey);
      if (!existing) {
        revisedHistoryByDate.set(dateKey, {
          revised_etd: value,
          updated_at: updatedAt || null,
          sort_timestamp: nextTimestamp,
        });
        return;
      }

      if (!existing.updated_at || (nextTimestamp && nextTimestamp < existing.sort_timestamp)) {
        revisedHistoryByDate.set(dateKey, {
          revised_etd: value,
          updated_at: updatedAt || null,
          sort_timestamp: nextTimestamp,
        });
      }
    };

    for (const entry of relevantItems) {
      const currentEntry = getCurrentRevisedEntry(entry);
      addRevisedEntry(currentEntry.value, currentEntry.updatedAt);

      for (const historyEntry of Array.isArray(entry?.history) ? entry.history : []) {
        addRevisedEntry(historyEntry?.revised_etd, historyEntry?.updated_at);
      }
    }

    if (relevantItems.length === 1 && revisedEtd) {
      addRevisedEntry(revisedEtd, null);
    }

    const originalDateKey = toDateKey(etd);
    const displayDateKey = toDateKey(displayValue);
    const hasCurrentRevision = Boolean(displayDateKey && displayDateKey !== originalDateKey);

    const mergedTooltipHistory = [];
    if (originalDateKey && (hasCurrentRevision || revisedHistoryByDate.size > 0)) {
      mergedTooltipHistory.push({
        revised_etd: etd,
        updated_at: null,
        meta: "Original ETD",
      });
    }

    const previousRevisedHistory = Array.from(revisedHistoryByDate.values())
      .filter((historyEntry) => {
        const historyDateKey = toDateKey(historyEntry?.revised_etd);
        if (!historyDateKey) return false;
        if (historyDateKey === originalDateKey) return false;
        if (displayDateKey && historyDateKey === displayDateKey) return false;
        return true;
      })
      .sort((left, right) => left.sort_timestamp - right.sort_timestamp)
      .map((historyEntry) => ({
        revised_etd: historyEntry.revised_etd,
        updated_at: historyEntry.updated_at,
        meta: "Previous Revised ETD",
      }));

    mergedTooltipHistory.push(...previousRevisedHistory);

    return mergedTooltipHistory.length > 0
      ? [
          {
            id: cacheKey,
            item_code: "",
            description: "",
            tooltip_history: mergedTooltipHistory,
          },
        ]
      : [];
  }, [cacheKey, displayValue, etd, historyState.items, normalizedItemCode, revisedEtd]);

  const totalTooltipHistoryEntries = useMemo(
    () =>
      tooltipHistoryItems.reduce(
        (sum, entry) =>
          sum + (Array.isArray(entry?.tooltip_history) ? entry.tooltip_history.length : 0),
        0,
      ),
    [tooltipHistoryItems],
  );

  if (!hasLookup) {
    return <span className={className}>{formattedEtd}</span>;
  }

  return (
    <HoverPortal
      className={`om-etd-history ${className}`.trim()}
      panelClassName="om-etd-history-panel"
      onOpen={loadHistory}
      align="right"
      trigger={<span className="om-etd-history-label" tabIndex={0}>{formattedEtd}</span>}
    >
      {historyState.status === "loading" ? (
        <span className="om-etd-history-empty">Loading ETD history...</span>
      ) : historyState.status === "error" ? (
        <span className="om-etd-history-empty">{historyState.error}</span>
      ) : totalTooltipHistoryEntries === 0 ? (
        <span className="om-etd-history-empty">No ETD history.</span>
      ) : (
        <>
          <span className="om-etd-history-title">ETD History</span>
          {tooltipHistoryItems.map((entry) => (
            <span
              key={entry.id || `${entry.item_code}-${entry.description}`}
              className="om-etd-history-section"
            >
              {tooltipHistoryItems.length > 1 ? (
                <span className="om-etd-history-item-code">
                  {entry.item_code || "Item"}
                </span>
              ) : null}
              {entry.tooltip_history.map((historyEntry, index) => (
                <span
                  key={`${entry.item_code || "item"}-${historyEntry.revised_etd || index}-${historyEntry.updated_at || index}`}
                  className="om-etd-history-row"
                >
                  <span>{formatDateDDMMYYYY(historyEntry.revised_etd, "-")}</span>
                  {historyEntry.meta ? (
                    <span className="om-etd-history-meta">
                      {historyEntry.meta}
                    </span>
                  ) : null}
                </span>
              ))}
            </span>
          ))}
        </>
      )}
    </HoverPortal>
  );
};

export default OrderEtdWithHistory;
