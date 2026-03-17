import { useMemo, useState } from "react";
import { formatDateDDMMYYYY } from "../utils/date";
import { getOrderRevisedEtdHistory } from "../services/orders.service";
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
    .filter((entry) => entry.history.length > 0)
    .sort((left, right) =>
      left.item_code.localeCompare(right.item_code, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
};

const OrderEtdWithHistory = ({
  orderId,
  etd,
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

  const formattedEtd = formatDateDDMMYYYY(etd, fallback);
  const hasLookup = Boolean(String(orderId || "").trim());

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

  const totalHistoryEntries = useMemo(
    () =>
      historyState.items.reduce(
        (sum, entry) => sum + (Array.isArray(entry?.history) ? entry.history.length : 0),
        0,
      ),
    [historyState.items],
  );

  if (!hasLookup) {
    return <span className={className}>{formattedEtd}</span>;
  }

  return (
    <span
      className={`om-etd-history ${className}`.trim()}
      onMouseEnter={loadHistory}
      onFocus={loadHistory}
      tabIndex={0}
    >
      <span className="om-etd-history-label">{formattedEtd}</span>
      <span className="om-etd-history-panel" role="tooltip">
        {historyState.status === "loading" ? (
          <span className="om-etd-history-empty">Loading revised ETDs...</span>
        ) : historyState.status === "error" ? (
          <span className="om-etd-history-empty">{historyState.error}</span>
        ) : totalHistoryEntries === 0 ? (
          <span className="om-etd-history-empty">No revised ETD history.</span>
        ) : (
          <>
            <span className="om-etd-history-title">Revised ETDs</span>
            {historyState.items.map((entry) => (
              <span
                key={entry.id || `${entry.item_code}-${entry.description}`}
                className="om-etd-history-section"
              >
                {historyState.items.length > 1 ? (
                  <span className="om-etd-history-item-code">
                    {entry.item_code || "Item"}
                  </span>
                ) : null}
                {entry.history.map((historyEntry, index) => (
                  <span
                    key={`${entry.item_code || "item"}-${historyEntry.revised_etd || index}-${historyEntry.updated_at || index}`}
                    className="om-etd-history-row"
                  >
                    <span>{formatDateDDMMYYYY(historyEntry.revised_etd, "-")}</span>
                    {historyEntry.updated_by_name ? (
                      <span className="om-etd-history-meta">
                        {historyEntry.updated_by_name}
                      </span>
                    ) : null}
                  </span>
                ))}
              </span>
            ))}
          </>
        )}
      </span>
    </span>
  );
};

export default OrderEtdWithHistory;
