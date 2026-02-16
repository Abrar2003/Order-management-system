import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import "../App.css";
import ShippingModal from "../components/ShippingModal";
import { getUserFromToken } from "../auth/auth.utils";

const formatDateLabel = (value) => {
  if (!value) return "N/A";
  const asString = String(value).trim();
  if (!asString) return "N/A";
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return asString;
  return parsed.toLocaleDateString();
};

const Shipments = () => {
  const navigate = useNavigate();
  const user = getUserFromToken();
  const canFinalizeShipping = ["admin", "manager", "dev", "Dev"].includes(
    user?.role,
  );

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/orders/shipments");
      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load shipments.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const summary = useMemo(() => {
    const counts = {
      total: rows.length,
      inspectionDone: 0,
      partialShipped: 0,
      shipped: 0,
    };

    rows.forEach((row) => {
      if (row?.status === "Inspection Done") counts.inspectionDone += 1;
      if (row?.status === "Partial Shipped") counts.partialShipped += 1;
      if (row?.status === "Shipped") counts.shipped += 1;
    });

    return counts;
  }, [rows]);

  const canShowFinalizeAction = useCallback(
    (row) =>
      canFinalizeShipping &&
      ["Inspection Done", "Partial Shipped"].includes(row?.status),
    [canFinalizeShipping],
  );

  const handleOpenShippingModal = useCallback((row) => {
    const normalizedOrder = {
      _id: row?._id,
      order_id: row?.order_id || "",
      item: {
        item_code: row?.item?.item_code || row?.item_code || "",
        description: row?.item?.description || row?.description || "",
      },
      quantity: Number(row?.order_quantity || 0),
      shipment: Array.isArray(row?.shipment) ? row.shipment : [],
      status: row?.status || "",
    };

    setSelectedOrder(normalizedOrder);
  }, []);

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
          <h2 className="h4 mb-0">Shipments</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={fetchShipments}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Total Items: {summary.total}</span>
            <span className="om-summary-chip">
              Inspection Done: {summary.inspectionDone}
            </span>
            <span className="om-summary-chip">
              Partial Shipped: {summary.partialShipped}
            </span>
            <span className="om-summary-chip">Shipped: {summary.shipped}</span>
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
                      <th>PO</th>
                      <th>Item Code</th>
                      <th>Description</th>
                      <th>Stuffing Date</th>
                      <th>Container Number</th>
                      <th>Quantity</th>
                      {canFinalizeShipping && <th>Finalize</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={canFinalizeShipping ? 7 : 6}
                          className="text-center py-4"
                        >
                          No records found
                        </td>
                      </tr>
                    )}

                    {rows.map((row, index) => (
                      <tr key={`${row.order_id}-${row.item_code}-${index}`}>
                        <td>{row?.order_id || "N/A"}</td>
                        <td>{row?.item_code || "N/A"}</td>
                        <td>{row?.description || "N/A"}</td>
                        <td>{formatDateLabel(row?.stuffing_date)}</td>
                        <td>{row?.container || "N/A"}</td>
                        <td>{row?.quantity ?? "N/A"}</td>
                        {canFinalizeShipping && (
                          <td>
                            {canShowFinalizeAction(row) ? (
                              <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={() => handleOpenShippingModal(row)}
                              >
                                Finalize Shipping
                              </button>
                            ) : (
                              <span className="text-secondary small">N/A</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      {selectedOrder && (
        <ShippingModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onSuccess={() => {
            setSelectedOrder(null);
            fetchShipments();
          }}
        />
      )}
    </>
  );
};

export default Shipments;
