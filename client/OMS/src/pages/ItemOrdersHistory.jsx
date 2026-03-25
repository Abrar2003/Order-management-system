import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import OrderEtdWithHistory from "../components/OrderEtdWithHistory";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toText = (value, fallback = "N/A") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const ItemOrdersHistory = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { itemCode } = useParams();

  const resolvedItemCode = useMemo(
    () => decodeURIComponent(String(itemCode || "")).trim(),
    [itemCode],
  );
  const backTarget = useMemo(() => {
    const fromItems = String(location.state?.fromItems || "").trim();
    if (fromItems.startsWith("/items")) return fromItems;
    return "/items";
  }, [location.state]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemInfo, setItemInfo] = useState(null);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({
    total_orders: 0,
    total_inspection_rows: 0,
  });

  const fetchItemOrdersHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get(
        `/items/${encodeURIComponent(resolvedItemCode)}/orders-history`,
      );
      setItemInfo(response?.data?.item || null);
      setOrders(Array.isArray(response?.data?.data) ? response.data.data : []);
      setSummary({
        total_orders: Number(response?.data?.summary?.total_orders || 0),
        total_inspection_rows: Number(
          response?.data?.summary?.total_inspection_rows || 0,
        ),
      });
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.message
          || "Failed to load item order history.",
      );
      setItemInfo(null);
      setOrders([]);
      setSummary({
        total_orders: 0,
        total_inspection_rows: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [resolvedItemCode]);

  useEffect(() => {
    if (!resolvedItemCode) {
      setError("Item code is required.");
      setLoading(false);
      return;
    }
    fetchItemOrdersHistory();
  }, [fetchItemOrdersHistory, resolvedItemCode]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(backTarget)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Item Order History</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Item: {toText(itemInfo?.code, resolvedItemCode || "N/A")}</span>
            <span className="om-summary-chip">Name: {toText(itemInfo?.name, "-")}</span>
            <span className="om-summary-chip">
              Description: {toText(itemInfo?.description, "-")}
            </span>
            <span className="om-summary-chip">Orders: {summary.total_orders}</span>
            <span className="om-summary-chip">
              Inspection Rows: {summary.total_inspection_rows}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Order ID</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Order Date</th>
                      <th>ETD</th>
                      <th>Status</th>
                      <th>Order Qty</th>
                    </tr>
                  </thead>
                  {orders.length === 0 && (
                    <tbody>
                      <tr>
                        <td colSpan={7} className="text-center py-4">
                          No orders found for this item.
                        </td>
                      </tr>
                    </tbody>
                  )}
                  {orders.map((order) => {
                    const inspectionRows = Array.isArray(order?.inspections)
                      ? order.inspections
                      : [];

                    return (
                      <tbody key={order?.id || `${order?.order_id}-${order?.item_code}`}>
                        <tr className="table-light">
                          <td>
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 text-start"
                              onClick={() =>
                                navigate(
                                  `/orders?order_id=${encodeURIComponent(
                                    String(order?.order_id || "").trim(),
                                  )}`,
                                )
                              }
                            >
                              {toText(order?.order_id)}
                            </button>
                          </td>
                          <td>{toText(order?.brand)}</td>
                          <td>{toText(order?.vendor)}</td>
                          <td>{formatDateDDMMYYYY(order?.order_date)}</td>
                          <td>
                            <OrderEtdWithHistory
                              orderId={order?.order_id}
                              itemCode={order?.item_code}
                              etd={order?.ETD}
                              revisedEtd={order?.revised_ETD}
                            />
                          </td>
                          <td>{toText(order?.status)}</td>
                          <td>{toSafeNumber(order?.quantity)}</td>
                        </tr>

                        {inspectionRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="text-secondary small">
                              Inspection: No inspection records
                            </td>
                          </tr>
                        ) : (
                          inspectionRows.map((inspection, index) => (
                            <tr
                              key={inspection?.id || `${order?.id || "order"}-inspection-${index}`}
                            >
                              <td colSpan={7} className="small">
                                <div className="d-flex flex-wrap gap-3">
                                  <span className="fw-semibold">{`Inspection ${index + 1}`}</span>
                                  <span>
                                    Inspector:{" "}
                                    {inspection?.source === "qc_snapshot"
                                      ? `${toText(inspection?.inspector_name)} (QC Snapshot)`
                                      : toText(inspection?.inspector_name)}
                                  </span>
                                  <span>
                                    Date: {formatDateDDMMYYYY(inspection?.inspection_date)}
                                  </span>
                                  <span>Requested: {toSafeNumber(inspection?.vendor_requested)}</span>
                                  <span>Offered: {toSafeNumber(inspection?.vendor_offered)}</span>
                                  <span>Checked: {toSafeNumber(inspection?.checked)}</span>
                                  <span>Passed: {toSafeNumber(inspection?.passed)}</span>
                                  <span>Pending After: {toSafeNumber(inspection?.pending_after)}</span>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ItemOrdersHistory;
