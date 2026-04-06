import { useCallback, useMemo, useState } from "react";
import api from "../api/axios";
import Tooltip from "./Tooltip";
import "../App.css";

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
      const rows = Array.isArray(response?.data?.data)
        ? response.data.data
        : [];
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

const formatPresenceSummary = (row = {}) => {
  const status = normalizeText(row?.status).toLowerCase();
  const openQuantity = Number(row?.open_quantity || 0);
  const shippedQuantity = Number(row?.shipped_quantity || 0);
  const totalQuantity = Number(row?.total_quantity || 0);

  if (status === "under inspection") {
    return `Open: ${openQuantity}`;
  }

  if (status === "partial shipped") {
    return `Shipped: ${shippedQuantity}`;
  }

  if (status === "shipped") {
    return `Shipped: ${shippedQuantity || totalQuantity}`;
  }

  return "";
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
        fetchError?.response?.data?.message ||
          fetchError?.message ||
          "Failed to load PO details.",
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
  <Tooltip
    onOpen={loadTooltipData}
    content={
      <>
        <div className="tooltip-title">
          {excludeOrderId ? "Other Active POs" : "Active POs"}
        </div>

        {loading ? (
          <div className="tooltip-empty">Loading...</div>
        ) : error ? (
          <div className="tooltip-empty">{error}</div>
        ) : visibleRows.length === 0 ? (
          <div className="tooltip-empty">
            {excludeOrderId
              ? "No other active POs found."
              : "No active POs found."}
          </div>
        ) : (
          visibleRows.map((row) => {
            const detailText = formatPresenceSummary(row);

            return (
              <div
                key={`${row?.id}-${row?.order_id}`}
                className="tooltip-entry"
              >
                <div className="tooltip-row">
                  <span className="tooltip-po">
                    PO: {row?.order_id || "N/A"}
                  </span>
                  <span className="tooltip-detail">
                    Qty: {Number(row?.total_quantity || 0)}
                  </span>
                </div>

                {row?.description && (
                  <div className="tooltip-detail">
                    {row.description}
                  </div>
                )}

                <div className="tooltip-detail">
                  Status: {row?.status || "N/A"}
                </div>

                {detailText && (
                  <div className="tooltip-detail">{detailText}</div>
                )}
              </div>
            );
          })
        )}
      </>
    }
  >
    <span className="om-item-order-presence-label">
      {label || itemCode}
    </span>
  </Tooltip>
);
};

export default ItemOrderPresenceTooltip;
