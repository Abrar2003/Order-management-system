import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import { isViewOnlyUser } from "../auth/permissions";
import AlignQCModal from "../components/AlignQcModal";
import EditOrderModal from "../components/EditOrderModal";
import EditCompleteOrderModal from "../components/EditCompleteOrderModal";
import ArchiveOrderModal from "../components/ArchiveOrderModal";
import RevisedEtdModal from "../components/RevisedEtdModal";
import BulkRevisedEtdModal from "../components/BulkRevisedEtdModal";
import OrderEtdWithHistory from "../components/OrderEtdWithHistory";
import OrderQuantityWithHistory from "../components/OrderQuantityWithHistory";
import ItemOrderPresenceTooltip from "../components/ItemOrderPresenceTooltip";
import SortHeaderButton from "../components/SortHeaderButton";
import { archiveOrder } from "../services/orders.service";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { formatCbm, resolvePreferredCbm } from "../utils/cbm";
import {
  getGroupedOrderStatus,
  getOrderProgress,
  toSafeOrderNumber,
} from "../utils/orderStatus";
import "../App.css";

const getPendingDisplayQuantity = (order) => {
  return getOrderProgress({ order }).inspected_unshipped_quantity;
};

const getOpenInspectionQuantity = (order) =>
  getOrderProgress({ order }).pending_inspection_quantity;

const toStatusTimestamp = (value) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const isOpenRequestStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "pending") return true;
  if (normalized === "open") return true;
  if (normalized === "requested") return true;
  if (normalized === "under inspection") return true;
  if (normalized === "in progress" || normalized === "in_progress") return true;
  return false;
};

const getLatestRequestEntry = (qcRecord = {}) =>
  (Array.isArray(qcRecord?.request_history) ? [...qcRecord.request_history] : [])
    .sort((left, right) => {
      const leftTime = Math.max(
        toStatusTimestamp(left?.request_date),
        toStatusTimestamp(left?.updatedAt),
        toStatusTimestamp(left?.createdAt),
      );
      const rightTime = Math.max(
        toStatusTimestamp(right?.request_date),
        toStatusTimestamp(right?.updatedAt),
        toStatusTimestamp(right?.createdAt),
      );
      return rightTime - leftTime;
    })[0] || null;

const resolveLatestInspectionRecordForRequest = (
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

  const findLatestMatchingRecord = (matcher) => {
    let latestRecord = null;
    let latestTimestamp = 0;

    for (const record of Array.isArray(inspectionRecords) ? inspectionRecords : []) {
      if (!matcher(record)) continue;

      const recordTimestamp = Math.max(
        toStatusTimestamp(record?.inspection_date),
        toStatusTimestamp(record?.requested_date),
        toStatusTimestamp(record?.createdAt),
      );
      if (!latestRecord || recordTimestamp >= latestTimestamp) {
        latestRecord = record;
        latestTimestamp = recordTimestamp;
      }
    }

    return latestRecord;
  };

  if (requestHistoryId) {
    const exactRequestHistoryMatch = findLatestMatchingRecord(
      (record) => String(record?.request_history_id || "").trim() === requestHistoryId,
    );
    if (exactRequestHistoryMatch) return exactRequestHistoryMatch;
  }

  if (!requestDateKey) return null;

  return (
    findLatestMatchingRecord((record) => {
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
      const recordRequestedDate = toISODateString(
        record?.requested_date || record?.inspection_date || record?.createdAt,
      );
      return recordRequestedDate === requestDateKey;
    }) ||
    null
  );
};

const hasRaisedInspectionRequest = (order, pendingInspectionQuantity = 0) => {
  if (pendingInspectionQuantity <= 0) return false;

  const qcRecord = order?.qc_record;
  if (!qcRecord || typeof qcRecord !== "object") return false;

  const requestHistory = Array.isArray(qcRecord?.request_history)
    ? qcRecord.request_history
    : [];
  const inspectionRecords = Array.isArray(qcRecord?.inspection_record)
    ? qcRecord.inspection_record
    : [];

  if (requestHistory.length > 0) {
    const latestRequest = getLatestRequestEntry(qcRecord);
    const requestedQuantity = toSafeOrderNumber(
      latestRequest?.quantity_requested,
      0,
    );
    if (requestedQuantity <= 0 || !isOpenRequestStatus(latestRequest?.status)) {
      return false;
    }

    const latestInspectionRecord = resolveLatestInspectionRecordForRequest(
      inspectionRecords,
      latestRequest,
    );

    return toSafeOrderNumber(latestInspectionRecord?.checked, 0) <= 0;
  }

  const latestLegacyInspectionRecord = [...inspectionRecords]
    .sort((left, right) => {
      const leftTime = Math.max(
        toStatusTimestamp(left?.inspection_date),
        toStatusTimestamp(left?.requested_date),
        toStatusTimestamp(left?.createdAt),
      );
      const rightTime = Math.max(
        toStatusTimestamp(right?.inspection_date),
        toStatusTimestamp(right?.requested_date),
        toStatusTimestamp(right?.createdAt),
      );
      return rightTime - leftTime;
    })[0] || null;
  if (toSafeOrderNumber(latestLegacyInspectionRecord?.checked, 0) > 0) {
    return false;
  }

  return (
    toSafeOrderNumber(qcRecord?.quantities?.quantity_requested, 0) > 0 ||
    Boolean(String(qcRecord?.request_date || "").trim())
  );
};

const getDisplayedOrderStatus = (order) => {
  const progress = getOrderProgress({ order });
  const {
    order_quantity: orderQuantity,
    shipped_quantity: shippedQuantity,
    passed_quantity: passedQuantity,
    pending_inspection_quantity: pendingInspectionQuantity,
  } = progress;

  if (orderQuantity > 0 && shippedQuantity >= orderQuantity) {
    return "Shipped";
  }
  if (orderQuantity > 0 && passedQuantity >= orderQuantity && shippedQuantity > 0) {
    return "Partial Shipped";
  }
  if (orderQuantity > 0 && passedQuantity >= orderQuantity) {
    return "Inspection Done";
  }
  if (hasRaisedInspectionRequest(order, pendingInspectionQuantity)) {
    return "Under Inspection";
  }

  return "Pending";
};

const getDisplayedOrderGroupStatus = (orders) => {
  const displayStatuses = (Array.isArray(orders) ? orders : []).map(getDisplayedOrderStatus);
  if (displayStatuses.length === 0) return "N/A";
  return getGroupedOrderStatus(displayStatuses);
};

const isCompletelyShipped = (order) => {
  const normalizedStatus = String(order?.status || "").trim().toLowerCase();
  if (normalizedStatus === "shipped") return true;

  const { order_quantity: totalQuantity, shipped_quantity: shippedQuantity } =
    getOrderProgress({ order });
  return totalQuantity > 0 && shippedQuantity >= totalQuantity;
};

const getShipmentContainersDisplay = (order) => {
  if (!isCompletelyShipped(order)) return "-";

  const containers = [
    ...new Set(
      (Array.isArray(order?.shipment) ? order.shipment : [])
        .map((shipmentEntry) => String(shipmentEntry?.container || "").trim())
        .filter(Boolean),
    ),
  ];

  return containers.join(", ") || "-";
};

const formatResolvedCbm = (value) => {
  if (value === null || value === undefined || value === "") return "N/A";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "N/A";
  return formatCbm(parsed);
};

const renderOrderCbmCell = (order) => {
  const totalCbm = resolvePreferredCbm(
    order?.cbm_summary?.total,
    order?.total_po_cbm,
    order?.top_po_cbm,
  );
  const perItemCbm = order?.cbm_summary?.per_item;

  return (
    <div className="d-flex flex-column gap-1">
      <span>Item: {formatResolvedCbm(perItemCbm)}</span>
      <span>Total: {formatResolvedCbm(totalCbm)}</span>
    </div>
  );
};

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [alignContext, setAlignContext] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editingCompleteOrder, setEditingCompleteOrder] = useState(null);
  const [revisedEtdTarget, setRevisedEtdTarget] = useState(null);
  const [showBulkRevisedEtdModal, setShowBulkRevisedEtdModal] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [itemCodeSortOrder, setItemCodeSortOrder] = useState("asc");

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const user = getUserFromToken();
  const role = user?.role;
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();
  const isViewOnly = isViewOnlyUser(user);
  const canManageOrders = ["admin", "manager", "dev"].includes(normalizedRole);
  const canAlignQc = ["admin", "manager"].includes(normalizedRole);
  const canEditOrder = normalizedRole === "admin";
  const canArchiveOrder = normalizedRole === "admin";
  const showActionColumn = canManageOrders || isViewOnly;

  const orderId = searchParams.get("order_id");

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(`/orders/order-by-id/${orderId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setOrders(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const sortedOrders = useMemo(() => {
    const direction = itemCodeSortOrder === "asc" ? 1 : -1;
    return [...orders].sort((a, b) => {
      const left = String(a?.item?.item_code || "");
      const right = String(b?.item?.item_code || "");
      const comparison = left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (comparison !== 0) return comparison * direction;
      return String(a?._id || "").localeCompare(String(b?._id || ""));
    });
  }, [itemCodeSortOrder, orders]);

  const primaryOrder = orders[0];
  const allOrdersCompletelyShipped =
    orders.length > 0 && orders.every((order) => isCompletelyShipped(order));
  const navigateToQcForItem = (orderId, itemCode) => {
    const trimmedOrderId = String(orderId || "").trim();
    const trimmedItemCode = String(itemCode || "").trim();
    if (!trimmedOrderId && !trimmedItemCode) {
      navigate("/qc");
      return;
    }

    const nextParams = new URLSearchParams();
    if (trimmedOrderId) nextParams.set("order", trimmedOrderId);
    if (trimmedItemCode) nextParams.set("item_code", trimmedItemCode);

    const nextQuery = nextParams.toString();
    navigate(nextQuery ? `/qc?${nextQuery}` : "/qc");
  };

  const navigateToQcDetails = useCallback(
    (order) => {
      const rawQcRecord = order?.qc_record;
      const qcId =
        typeof rawQcRecord === "string"
          ? rawQcRecord.trim()
          : String(rawQcRecord?._id || "").trim();

      if (qcId) {
        navigate(`/qc/${encodeURIComponent(qcId)}`);
        return;
      }

      navigateToQcForItem(order?.order_id, order?.item?.item_code);
    },
    [navigate],
  );

  const openAlignModal = (order, isRealign = false) => {
    const qcRecord = order?.qc_record || null;
    const openQuantity = isRealign
      ? Number(qcRecord?.quantities?.pending ?? order?.quantity ?? 0)
      : Number(order?.quantity ?? 0);
    setAlignContext({
      order,
      initialInspector: isRealign
        ? String(qcRecord?.inspector?._id || qcRecord?.inspector || "")
        : "",
      initialQuantityRequested: isRealign
        ? (qcRecord?.quantities?.pending ?? order.quantity ?? "")
        : order?.quantity,
      initialRequestDate: isRealign ? qcRecord?.request_date || "" : "",
      initialRequestType: isRealign
        ? String(qcRecord?.request_type || "FULL")
        : "FULL",
      openQuantity: Number.isFinite(openQuantity) ? openQuantity : 0,
    });
  };

  const handleArchiveConfirm = async (remark) => {
    if (!archiveTarget?._id) return;

    try {
      setArchiving(true);
      setArchiveError("");
      await archiveOrder(archiveTarget._id, remark);
      setArchiveTarget(null);
      await fetchOrders();
    } catch (err) {
      setArchiveError(
        err?.response?.data?.message || "Failed to archive order.",
      );
    } finally {
      setArchiving(false);
    }
  };
  const navigateToItemOrdersHistory = useCallback(
    (item) => {
      const itemCode = String(item?.item_code || "").trim();
      if (!itemCode) return;
      navigate(`/items/${encodeURIComponent(itemCode)}/orders-history`, {
        state: {
          fromItems: `${location.pathname}${location.search}`,
        },
      });
    },
    [location.pathname, location.search, navigate],
  );

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Orders</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 justify-content-between align-items-start">
            <div className="d-flex flex-wrap gap-2">
              <span className="om-summary-chip">
                Order: {primaryOrder?.order_id ?? "N/A"}
              </span>
              <span className="om-summary-chip">
                Brand: {primaryOrder?.brand ?? "N/A"}
              </span>
              <span className="om-summary-chip">
                Vendor: {primaryOrder?.vendor ?? "N/A"}
              </span>
              <span className="om-summary-chip">
                Status: {getDisplayedOrderGroupStatus(orders)}
              </span>
              <span className="om-summary-chip">
                Order Date: {formatDateDDMMYYYY(primaryOrder?.order_date)}
              </span>
              <span className="om-summary-chip">
                ETD: {formatDateDDMMYYYY(primaryOrder?.ETD)}
              </span>
            </div>
            {canEditOrder && primaryOrder ? (
              <div className="d-flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => setEditingCompleteOrder(primaryOrder)}
                >
                  Update Complete Order
                </button>
                {!allOrdersCompletelyShipped && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setShowBulkRevisedEtdModal(true)}
                  >
                    Bulk Revised ETD
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>
                        <SortHeaderButton
                          label="Item"
                          isActive
                          direction={itemCodeSortOrder}
                          onClick={() =>
                            setItemCodeSortOrder((prev) =>
                              prev === "asc" ? "desc" : "asc",
                            )
                          }
                        />
                      </th>
                      <th>Description</th>
                      <th>Quantity</th>
                      <th>Open Quantity</th>
                      <th>Packed</th>
                      <th className="orders-cbm-col">CBM</th>
                      <th>Status</th>
                      <th>ETD</th>
                      <th>Revised ETD</th>
                      <th>Containers</th>
                      {showActionColumn && (
                        <th className="orders-action-col">Action</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOrders.map((order) => {
                      const shippedOrder = isCompletelyShipped(order);
                      const hasPendingOrderQuantity =
                        getOpenInspectionQuantity(order) > 0;
                      const mainActionCount = [
                        canEditOrder,
                        canEditOrder && !shippedOrder,
                        canArchiveOrder,
                      ].filter(Boolean).length;
                      const mainActionRowClassName =
                        mainActionCount >= 3
                          ? "orders-action-main-row equal-three"
                          : mainActionCount === 2
                            ? "orders-action-main-row equal-two"
                            : "orders-action-main-row";

                      return (
                      <tr key={order._id}>
                        <td
                        style={{ cursor: order?.item?.item_code ? "pointer" : "default" }}
                          onClick={
                            order?.item.item_code
                              ? () => navigateToItemOrdersHistory(order.item)
                              :() => {console.log("clicked but no item code")}
                          }
                        >
                          {order?.item?.item_code || "N/A"}
                        </td>
                        <td>{order.item?.description}</td>
                        <td>
                          <OrderQuantityWithHistory
                            orderId={order?.order_id}
                            itemCode={order?.item?.item_code}
                            quantity={order?.quantity}
                          />
                        </td>
                        <td>{getOpenInspectionQuantity(order)}</td>
                        <td>{getPendingDisplayQuantity(order)}</td>
                        <td className="orders-cbm-col">
                          {renderOrderCbmCell(order)}
                        </td>
                        <td>{getDisplayedOrderStatus(order)}</td>
                        <td>{formatDateDDMMYYYY(order?.ETD)}</td>
                        <td>
                          <OrderEtdWithHistory
                            orderId={order?.order_id}
                            itemCode={order?.item?.item_code}
                            etd={order?.ETD}
                            revisedEtd={order?.revised_ETD}
                            fallback="-"
                            showOriginalWhenNoRevision={false}
                            />
                        </td>
                        <td>{getShipmentContainersDisplay(order)}</td>
                        {showActionColumn && (
                          <td className="orders-action-col">
                            {canManageOrders ? (
                              <div className="orders-action-stack">
                                {(canEditOrder || canArchiveOrder) && (
                                  <div className={mainActionRowClassName}>
                                    {canEditOrder && (
                                      <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => setEditingOrder(order)}
                                      >
                                        Edit Order
                                      </button>
                                    )}
                                    {canEditOrder && !shippedOrder && (
                                      <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => setRevisedEtdTarget(order)}
                                      >
                                        Revised ETD
                                      </button>
                                    )}
                                    {canArchiveOrder && (
                                      <button
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        onClick={() => {
                                          setArchiveError("");
                                          setArchiveTarget(order);
                                        }}
                                      >
                                        Archive
                                      </button>
                                    )}
                                  </div>
                                )}

                                {shippedOrder ? (
                                  <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm"
                                    onClick={() => navigateToQcDetails(order)}
                                  >
                                    See Details
                                  </button>
                                ) : order.qc_record ? (
                                    <button
                                      type="button"
                                      className="btn btn-link btn-sm p-0 text-start"
                                      onClick={() =>
                                        navigateToQcForItem(
                                          order?.order_id,
                                          order?.item?.item_code,
                                        )
                                      }
                                    >
                                      Inspection Requested / Check updates
                                    </button>
                                ) : (
                                  canAlignQc && hasPendingOrderQuantity && (
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() => openAlignModal(order, false)}
                                    >
                                      Raise Request
                                    </button>
                                  )
                                )}

                                {canAlignQc &&
                                  order?.qc_record &&
                                  hasPendingOrderQuantity && (
                                    <button
                                      type="button"
                                      className="btn btn-outline-primary btn-sm"
                                      onClick={() => openAlignModal(order, true)}
                                    >
                                      Raise Request
                                    </button>
                                  )}
                              </div>
                            ) : order?.qc_record ? (
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm w-100"
                                onClick={() => navigateToQcDetails(order)}
                              >
                                See Details
                              </button>
                            ) : (
                              <span className="text-secondary small">No QC details</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                    })}

                    {orders.length === 0 && (
                      <tr>
                        <td
                          colSpan={showActionColumn ? 11 : 10}
                          className="text-center py-4"
                        >
                          No orders found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {alignContext?.order && (
        <AlignQCModal
          order={alignContext.order}
          initialInspector={alignContext.initialInspector}
          initialQuantityRequested={alignContext.initialQuantityRequested}
          initialRequestDate={alignContext.initialRequestDate}
          initialRequestType={alignContext.initialRequestType}
          openQuantity={alignContext.openQuantity}
          onClose={() => setAlignContext(null)}
          onSuccess={() => {
            setAlignContext(null);
            fetchOrders();
          }}
        />
      )}

      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSuccess={() => {
            setEditingOrder(null);
            fetchOrders();
          }}
        />
      )}

      {editingCompleteOrder && (
        <EditCompleteOrderModal
          order={editingCompleteOrder}
          rowCount={orders.length}
          onClose={() => setEditingCompleteOrder(null)}
          onSuccess={(response) => {
            const nextOrderId = String(
              response?.group?.order_id || editingCompleteOrder?.order_id || "",
            ).trim();
            setEditingCompleteOrder(null);

            if (nextOrderId && nextOrderId !== String(orderId || "").trim()) {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.set("order_id", nextOrderId);
              setSearchParams(nextParams, { replace: true });
              return;
            }

            fetchOrders();
          }}
        />
      )}

      {revisedEtdTarget && (
        <RevisedEtdModal
          order={revisedEtdTarget}
          onClose={() => setRevisedEtdTarget(null)}
          onSuccess={() => {
            setRevisedEtdTarget(null);
            fetchOrders();
          }}
        />
      )}

      {showBulkRevisedEtdModal && (
        <BulkRevisedEtdModal
          orders={sortedOrders}
          onClose={() => setShowBulkRevisedEtdModal(false)}
          onSuccess={() => {
            setShowBulkRevisedEtdModal(false);
            fetchOrders();
          }}
        />
      )}

      {archiveTarget && (
        <ArchiveOrderModal
          order={archiveTarget}
          saving={archiving}
          error={archiveError}
          onClose={() => {
            if (archiving) return;
            setArchiveTarget(null);
            setArchiveError("");
          }}
          onConfirm={handleArchiveConfirm}
        />
      )}
    </>
  );
};

export default Orders;
