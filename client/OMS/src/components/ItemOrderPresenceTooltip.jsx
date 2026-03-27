import { useCallback, useMemo, useState } from "react";
import api from "../api/axios";

const orderPresenceCache = new Map();
const orderPresenceInflight = new Map();

const normalizeText = (value) => String(value || "").trim();

const normalizeOrderKey = (value) => normalizeText(value).toLowerCase();

const fetchOrderPresence = async (itemCode = "") => {
  const normalizedItemCode = normalizeText(itemCode);
  if (!normalizedItemCode) {
    return [];
  }

  if (orderPresenceCache.has(normalizedItemCode)) {
    return orderPresenceCache.get(normalizedItemCode);
  }

  if (orderPresenceInflight.has(normalizedItemCode)) {
    return orderPresenceInflight.get(normalizedItemCode);
  }

  const request = api
    .get(`/items/${encodeURIComponent(normalizedItemCode)}/order-presence`)
    .then((response) => {
      const rows = Array.isArray(response?.data?.data) ? response.data.data : [];
      orderPresenceCache.set(normalizedItemCode, rows);
      orderPresenceInflight.delete(normalizedItemCode);
      return rows;
    })
    .catch((error) => {
      orderPresenceInflight.delete(normalizedItemCode);
      throw error;
    });

  orderPresenceInflight.set(normalizedItemCode, request);
  return request;
};

const formatQuantitySummary = (row = {}) => {
  const status = normalizeText(row?.status).toLowerCase();
  const totalQuantity = Number(row?.total_quantity || 0);
  const openQuantity = Number(row?.open_quantity || 0);
  const shippedQuantity = Number(row?.shipped_quantity || 0);

  if (status === "under inspection") {
    return `Total: ${totalQuantity} | Open: ${openQuantity}`;
  }

  if (status === "partial shipped") {
    return `Shipped: ${shippedQuantity}`;
  }

  if (status === "shipped") {
    return `Shipped: ${shippedQuantity || totalQuantity}`;
  }

  return `Total: ${totalQuantity}`;
};

const ItemOrderPresenceTooltip = ({
  itemCode = "",
  excludeOrderId = "",
  label,
  onClick,
  className = "",
  buttonClassName = "",
  emptyLabel = "N/A",
}) => {
  const normalizedItemCode = normalizeText(itemCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(() =>
    normalizedItemCode && orderPresenceCache.has(normalizedItemCode)
      ? orderPresenceCache.get(normalizedItemCode)
      : [],
  );

  const visibleRows = useMemo(() => {
    const excludedKey = normalizeOrderKey(excludeOrderId);
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!excludedKey) return true;
      return normalizeOrderKey(row?.order_id) !== excludedKey;
    });
  }, [excludeOrderId, rows]);

  const loadTooltipData = useCallback(async () => {
    if (!normalizedItemCode || loading) return;
    if (orderPresenceCache.has(normalizedItemCode)) {
      setRows(orderPresenceCache.get(normalizedItemCode) || []);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const nextRows = await fetchOrderPresence(normalizedItemCode);
      setRows(nextRows);
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.message
          || fetchError?.message
          || "Failed to load PO details.",
      );
    } finally {
      setLoading(false);
    }
  }, [loading, normalizedItemCode]);

  if (!normalizedItemCode) {
    return emptyLabel;
  }

  const triggerLabel = label || normalizedItemCode;

  return (
    <span
      className={`om-item-order-presence ${className}`.trim()}
      onMouseEnter={loadTooltipData}
      onFocus={loadTooltipData}
    >
      {onClick ? (
        <button
          type="button"
          className={buttonClassName || "btn btn-link btn-sm p-0 text-start"}
          onClick={onClick}
        >
          {triggerLabel}
        </button>
      ) : (
        <span className="om-item-order-presence-label" tabIndex={0}>
          {triggerLabel}
        </span>
      )}

      <span className="om-item-order-presence-panel" role="tooltip">
        <span className="om-item-order-presence-title">
          {excludeOrderId ? "Other Active POs" : "Active POs"}
        </span>

        {loading ? (
          <span className="om-item-order-presence-empty">Loading...</span>
        ) : error ? (
          <span className="om-item-order-presence-empty">{error}</span>
        ) : visibleRows.length === 0 ? (
          <span className="om-item-order-presence-empty">
            {excludeOrderId
              ? "No other active POs found for this item."
              : "No active POs found for this item."}
          </span>
        ) : (
          visibleRows.map((row) => (
            <span
              key={`${normalizeText(row?.id)}-${normalizeText(row?.order_id)}`}
              className="om-item-order-presence-entry"
            >
              <span className="om-item-order-presence-po">
                PO: {normalizeText(row?.order_id) || "N/A"}
              </span>
              <span className="om-item-order-presence-row">
                Status: {normalizeText(row?.status) || "N/A"}
              </span>
              <span className="om-item-order-presence-meta">
                {formatQuantitySummary(row)}
              </span>
            </span>
          ))
        )}
      </span>
    </span>
  );
};

export default ItemOrderPresenceTooltip;
