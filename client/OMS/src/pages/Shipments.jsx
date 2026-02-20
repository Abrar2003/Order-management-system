import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import "../App.css";
import ShippingModal from "../components/ShippingModal";
import EditOrderModal from "../components/EditOrderModal";
import { getUserFromToken } from "../auth/auth.utils";

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
};

const formatDateLabel = (value) => {
  if (!value) return "N/A";
  const asString = String(value).trim();
  if (!asString) return "N/A";
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return asString;
  return parsed.toLocaleDateString();
};

const EMPTY_SUMMARY = {
  total: 0,
  inspectionDone: 0,
  partialShipped: 0,
  shipped: 0,
};

const Shipments = () => {
  const navigate = useNavigate();
  const user = getUserFromToken();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const canFinalizeShipping = ["admin", "manager", "dev", "Dev"].includes(
    user?.role,
  );

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [orderIdSearch, setOrderIdSearch] = useState("");
  const [itemCodeSearch, setItemCodeSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [filterOptions, setFilterOptions] = useState({
    vendors: [],
    order_ids: [],
    item_codes: [],
  });

  const debouncedOrderSearch = useDebouncedValue(orderIdSearch, 300);
  const debouncedItemSearch = useDebouncedValue(itemCodeSearch, 300);

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/orders/shipments", {
        params: {
          order_id: debouncedOrderSearch,
          item_code: debouncedItemSearch,
          vendor: vendorFilter,
        },
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setSummary(res?.data?.summary || EMPTY_SUMMARY);
      setFilterOptions({
        vendors: Array.isArray(res?.data?.filters?.vendors)
          ? res.data.filters.vendors
          : [],
        order_ids: Array.isArray(res?.data?.filters?.order_ids)
          ? res.data.filters.order_ids
          : [],
        item_codes: Array.isArray(res?.data?.filters?.item_codes)
          ? res.data.filters.item_codes
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load shipments.");
      setRows([]);
      setSummary(EMPTY_SUMMARY);
      setFilterOptions({
        vendors: [],
        order_ids: [],
        item_codes: [],
      });
    } finally {
      setLoading(false);
    }
  }, [debouncedItemSearch, debouncedOrderSearch, vendorFilter]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((row) => String(row?.status || "").trim() === statusFilter);
  }, [rows, statusFilter]);

  const canShowFinalizeAction = useCallback(
    (row) =>
      canFinalizeShipping &&
      ["Inspection Done", "Partial Shipped"].includes(row?.status),
    [canFinalizeShipping],
  );

  const canShowEditAction = useCallback(
    (row) =>
      isAdmin &&
      ["Partial Shipped", "Shipped"].includes(String(row?.status || "").trim()),
    [isAdmin],
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

  const handleOpenEditModal = useCallback((row) => {
    const normalizedOrder = {
      _id: row?._id,
      order_id: row?.order_id || "",
      brand: row?.brand || "",
      vendor: row?.vendor || "",
      item: {
        item_code: row?.item?.item_code || row?.item_code || "",
        description: row?.item?.description || row?.description || "",
      },
      quantity: Number(row?.order_quantity || 0),
      shipment: Array.isArray(row?.shipment) ? row.shipment : [],
      status: row?.status || "",
    };

    setEditingOrder(normalizedOrder);
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
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Search by Order ID</label>
                <input
                  type="text"
                  className="form-control"
                  value={orderIdSearch}
                  list="shipment-order-options"
                  onChange={(e) => setOrderIdSearch(e.target.value)}
                  placeholder="Enter order ID"
                />
                <datalist id="shipment-order-options">
                  {filterOptions.order_ids.map((orderId) => (
                    <option key={orderId} value={orderId} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-4">
                <label className="form-label">Search by Item Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={itemCodeSearch}
                  list="shipment-item-options"
                  onChange={(e) => setItemCodeSearch(e.target.value)}
                  placeholder="Enter item code"
                />
                <datalist id="shipment-item-options">
                  {filterOptions.item_codes.map((itemCode) => (
                    <option key={itemCode} value={itemCode} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Filter by Vendor</label>
                <select
                  className="form-select"
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filterOptions.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-1 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setOrderIdSearch("");
                    setItemCodeSearch("");
                    setVendorFilter("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "all" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => setStatusFilter("all")}
            >
              Total Items: {summary.total}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Inspection Done" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => setStatusFilter("Inspection Done")}
            >
              Inspection Done: {summary.inspectionDone}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Partial Shipped" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => setStatusFilter("Partial Shipped")}
            >
              Partial Shipped: {summary.partialShipped}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Shipped" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => setStatusFilter("Shipped")}
            >
              Shipped: {summary.shipped}
            </button>
            <span className="om-summary-chip">
              Showing: {statusFilter === "all" ? "All" : statusFilter}
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
                      <th>PO</th>
                      <th>Item Code</th>
                      <th>Vendor</th>
                      <th>Description</th>
                      <th>Order Quantity</th>
                      <th>Stuffing Date</th>
                      <th>Container Number</th>
                      <th>Quantity</th>
                      <th>Pending</th>
                      <th>Remarks</th>
                      {canFinalizeShipping && <th>Finalize</th>}
                      {isAdmin && <th>Edit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={
                            (canFinalizeShipping ? 11 : 10) + (isAdmin ? 1 : 0)
                          }
                          className="text-center py-4"
                        >
                          No records found
                        </td>
                      </tr>
                    )}

                    {filteredRows.map((row, index) => (
                      <tr key={row?.shipment_id || `${row.order_id}-${row.item_code}-${index}`}>
                        <td>{row?.order_id || "N/A"}</td>
                        <td>{row?.item_code || "N/A"}</td>
                        <td>{row?.vendor || "N/A"}</td>
                        <td>{row?.description || "N/A"}</td>
                        <td>{row?.order_quantity || "N/A"}</td>
                        <td>{formatDateLabel(row?.stuffing_date)}</td>
                        <td>{row?.container || "N/A"}</td>
                        <td>{row?.quantity ?? "N/A"}</td>
                        <td>{row?.pending ?? "N/A"}</td>
                        <td>{row?.remaining_remarks || "N/A"}</td>
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
                        {isAdmin && (
                          <td>
                            {canShowEditAction(row) ? (
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => handleOpenEditModal(row)}
                              >
                                Edit Shipping
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
      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSuccess={() => {
            setEditingOrder(null);
            fetchShipments();
          }}
        />
      )}
    </>
  );
};

export default Shipments;
