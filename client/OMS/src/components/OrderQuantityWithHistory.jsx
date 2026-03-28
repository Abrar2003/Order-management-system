import { useEffect, useMemo, useState } from "react";
import { formatDateDDMMYYYY } from "../utils/date";
import { getOrderEditLogs } from "../services/orders.service";
import HoverPortal from "./HoverPortal";
import "../App.css";

const historyCache = new Map();
const pendingRequests = new Map();

const normalizeText = (value) => String(value || "").trim();

const getCacheKey = (orderId, itemCode) =>
  `${normalizeText(orderId)}__${normalizeText(itemCode).toLowerCase()}`;

const createDefaultState = () => ({
  status: "idle",
  items: [],
  error: "",
});

const toTimestamp = (value) => {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeQuantityHistoryItems = (logs = [], itemCode = "") => {
  const normalizedItemCode = normalizeText(itemCode).toLowerCase();

  return (Array.isArray(logs) ? logs : [])
    .filter((entry) => {
      if (!normalizedItemCode) return true;
      return normalizeText(entry?.item_code).toLowerCase() === normalizedItemCode;
    })
    .flatMap((entry) => {
      const editedByName = normalizeText(entry?.edited_by_name);
      const remarks = Array.isArray(entry?.remarks)
        ? entry.remarks.map((remark) => normalizeText(remark)).filter(Boolean).join(" | ")
        : normalizeText(entry?.remarks);

      return (Array.isArray(entry?.changes) ? entry.changes : [])
        .filter((change) => normalizeText(change?.field).toLowerCase() === "quantity")
        .map((change, index) => ({
          id: `${normalizeText(entry?._id || entry?.id || entry?.createdAt || "history")}-${index}`,
          before: normalizeText(change?.before),
          after: normalizeText(change?.after),
          updated_at: entry?.createdAt || entry?.updatedAt || null,
          updated_by_name: editedByName,
          remarks,
        }));
    })
    .sort((left, right) => toTimestamp(right?.updated_at) - toTimestamp(left?.updated_at));
};

const OrderQuantityWithHistory = ({
  orderId,
  itemCode = "",
  quantity,
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
  const hasLookup = Boolean(normalizeText(orderId));
  const formattedQuantity =
    quantity === null || quantity === undefined || quantity === ""
      ? fallback
      : String(quantity);

  useEffect(() => {
    setHistoryState(historyCache.get(cacheKey) || createDefaultState());
  }, [cacheKey]);

  const loadHistory = async () => {
    if (!hasLookup) return;

    const cached = historyCache.get(cacheKey);
    if (cached && cached.status !== "idle") {
      setHistoryState(cached);
      return;
    }

    if (pendingRequests.has(cacheKey)) {
      const pendingResult = await pendingRequests.get(cacheKey);
      setHistoryState(pendingResult);
      return;
    }

    const requestPromise = (async () => {
      try {
        const response = await getOrderEditLogs({
          order_id: orderId,
          limit: 100,
        });
        const nextState = {
          status: "success",
          items: normalizeQuantityHistoryItems(response?.data, itemCode),
          error: "",
        };
        historyCache.set(cacheKey, nextState);
        return nextState;
      } catch (error) {
        const nextState = {
          status: "error",
          items: [],
          error: error?.response?.data?.message || "Failed to load order quantity history.",
        };
        historyCache.set(cacheKey, nextState);
        return nextState;
      } finally {
        pendingRequests.delete(cacheKey);
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);
    setHistoryState((prev) => (
      prev.status === "idle" ? { ...prev, status: "loading" } : prev
    ));
    const nextState = await requestPromise;
    setHistoryState(nextState);
  };

  if (!hasLookup) {
    return <span className={className}>{formattedQuantity}</span>;
  }

  return (
    <HoverPortal
      className={`om-order-quantity-history ${className}`.trim()}
      panelClassName="om-order-quantity-history-panel"
      onOpen={loadHistory}
      trigger={<span className="om-order-quantity-history-label" tabIndex={0}>{formattedQuantity}</span>}
    >
      {historyState.status === "loading" ? (
        <span className="om-order-quantity-history-empty">
          Loading order quantity history...
        </span>
      ) : historyState.status === "error" ? (
        <span className="om-order-quantity-history-empty">{historyState.error}</span>
      ) : historyState.items.length === 0 ? (
        <span className="om-order-quantity-history-empty">No order quantity history.</span>
      ) : (
        <>
          <span className="om-order-quantity-history-title">Order Quantity History</span>
          {historyState.items.map((entry) => (
            <span key={entry.id} className="om-order-quantity-history-entry">
              <span className="om-order-quantity-history-row">
                <span>{entry.before || "-"}</span>
                <span className="om-order-quantity-history-arrow">{"->"}</span>
                <span>{entry.after || "-"}</span>
              </span>
              <span className="om-order-quantity-history-meta">
                {formatDateDDMMYYYY(entry.updated_at, "-")}
                {entry.updated_by_name ? ` | ${entry.updated_by_name}` : ""}
              </span>
             
            </span>
          ))}
        </>
      )}
    </HoverPortal>
  );
};

export default OrderQuantityWithHistory;
