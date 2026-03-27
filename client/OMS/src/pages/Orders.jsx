import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import AlignQCModal from "../components/AlignQcModal";
import EditOrderModal from "../components/EditOrderModal";
import EditCompleteOrderModal from "../components/EditCompleteOrderModal";
import ArchiveOrderModal from "../components/ArchiveOrderModal";
import RevisedEtdModal from "../components/RevisedEtdModal";
import BulkRevisedEtdModal from "../components/BulkRevisedEtdModal";
import OrderEtdWithHistory from "../components/OrderEtdWithHistory";
import ItemOrderPresenceTooltip from "../components/ItemOrderPresenceTooltip";
import { archiveOrder } from "../services/orders.service";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDateDDMMYYYY } from "../utils/date";
import { formatCbm } from "../utils/cbm";
import "../App.css";

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getShippedQuantity = (order) =>
  (Array.isArray(order?.shipment) ? order.shipment : []).reduce(
    (sum, shipmentEntry) => sum + Math.max(0, toSafeNumber(shipmentEntry?.quantity)),
    0,
  );

const getInspectionDoneQuantity = (order) =>
  Math.max(0, toSafeNumber(order?.qc_record?.quantities?.qc_passed));

const getOpenInspectionQuantity = (order) => {
  const hasQcRecord = Boolean(order?.qc_record);
  if (hasQcRecord) {
    return Math.max(0, toSafeNumber(order?.qc_record?.quantities?.pending));
  }

  const totalQuantity = Math.max(0, toSafeNumber(order?.quantity));
  const inspectionDoneQuantity = getInspectionDoneQuantity(order);
  return Math.max(0, totalQuantity - inspectionDoneQuantity);
};

const getPendingDisplayQuantity = (order) => {
  const inspectionDoneQuantity = getInspectionDoneQuantity(order);
  const shippedQuantity = getShippedQuantity(order);
  return Math.max(0, inspectionDoneQuantity - shippedQuantity);
};

const formatResolvedCbm = (value) => {
  if (value === null || value === undefined || value === "") return "N/A";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "N/A";
  return formatCbm(parsed);
};

const renderOrderCbmCell = (order) => {
  const perItemCbm = order?.cbm_summary?.per_item;
  const totalCbm = order?.cbm_summary?.total;

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
  const normalizedRole = String(role || "").trim().toLowerCase();
  const canManageOrders = ["admin", "manager", "dev"].includes(normalizedRole);
  const canAlignQc = ["admin", "manager"].includes(
    normalizedRole,
  );
  const canEditOrder = normalizedRole === "admin";
  const canArchiveOrder = normalizedRole === "admin";

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
  const itemSortIndicator = itemCodeSortOrder === "asc" ? " (asc)" : " (desc)";
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
      setArchiveError(err?.response?.data?.message || "Failed to archive order.");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>
            Back
          </button>
          <h2 className="h4 mb-0">Orders</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 justify-content-between align-items-start">
            <div className="d-flex flex-wrap gap-2">
              <span className="om-summary-chip">Order: {primaryOrder?.order_id ?? "N/A"}</span>
              <span className="om-summary-chip">Brand: {primaryOrder?.brand ?? "N/A"}</span>
              <span className="om-summary-chip">Vendor: {primaryOrder?.vendor ?? "N/A"}</span>
              <span className="om-summary-chip">Status: {primaryOrder?.status ?? "N/A"}</span>
              <span className="om-summary-chip">
                Order Date: {formatDateDDMMYYYY(primaryOrder?.order_date)}
              </span>
              <span className="om-summary-chip">
                ETD:{" "}
                <OrderEtdWithHistory
                  orderId={primaryOrder?.order_id}
                  etd={primaryOrder?.ETD}
                  revisedEtd={primaryOrder?.revised_ETD}
                  className="ms-1"
                />
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
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setShowBulkRevisedEtdModal(true)}
                >
                  Bulk Revised ETD
                </button>
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
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() =>
                            setItemCodeSortOrder((prev) =>
                              prev === "asc" ? "desc" : "asc",
                            )
                          }
                        >
                          Item{itemSortIndicator}
                        </button>
                      </th>
                      <th>Description</th>
                      <th>Quantity</th>
                      <th>Open Quantity</th>
                      <th>Packed</th>
                      <th className="orders-cbm-col">CBM</th>
                      <th>Status</th>
                      <th>Revised ETD</th>
                      {canManageOrders && <th className="orders-action-col">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOrders.map((order) => (
                      <tr key={order._id}>
                        <td>
                          <ItemOrderPresenceTooltip
                            itemCode={order?.item?.item_code}
                            excludeOrderId={order?.order_id}
                            label={order?.item?.item_code || "N/A"}
                          />
                        </td>
                        <td>{order.item?.description}</td>
                        <td>{order.quantity}</td>
                        <td>{getOpenInspectionQuantity(order)}</td>
                        <td>{getPendingDisplayQuantity(order)}</td>
                        <td className="orders-cbm-col">{renderOrderCbmCell(order)}</td>
                        <td>{order.status}</td>
                        <td>{formatDateDDMMYYYY(order?.revised_ETD)}</td>
                        {canManageOrders && (
                          <td className="orders-action-col">
                            <div className="orders-action-stack">
                              {(canEditOrder || canArchiveOrder) && (
                                <div className="orders-action-main-row equal-three">
                                  {canEditOrder && (
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() => setEditingOrder(order)}
                                    >
                                      Edit Order
                                    </button>
                                  )}
                                  {canEditOrder && (
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

                              {order.qc_record ? (
                                <button
                                  type="button"
                                  className="btn btn-link btn-sm p-0 text-start"
                                  onClick={() =>
                                    navigateToQcForItem(order?.order_id, order?.item?.item_code)
                                  }
                                >
                                  Inspection Requested / Check updates
                                </button>
                              ) : (
                                canAlignQc && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-secondary btn-sm"
                                    onClick={() => openAlignModal(order, false)}
                                  >
                                    Add Inspection Request
                                  </button>
                                )
                              )}

                              {canAlignQc &&
                                order?.qc_record &&
                                Number(order?.qc_record?.quantities?.pending || 0) > 0 && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm"
                                    onClick={() => openAlignModal(order, true)}
                                  >
                                    Realign QC
                                  </button>
                                )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}

                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={canManageOrders ? 9 : 8} className="text-center py-4">
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
