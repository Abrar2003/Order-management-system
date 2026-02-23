import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import "../App.css";
import ShippingModal from "../components/ShippingModal";
import EditOrderModal from "../components/EditOrderModal";
import { getUserFromToken } from "../auth/auth.utils";
import { formatDateDDMMYYYY } from "../utils/date";

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
};

const EMPTY_SUMMARY = {
  total: 0,
  inspectionDone: 0,
  partialShipped: 0,
  shipped: 0,
};

const DEFAULT_LIMIT = 20;

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
  const [containerSearch, setContainerSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("stuffing_date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [filterOptions, setFilterOptions] = useState({
    vendors: [],
    order_ids: [],
    containers: [],
  });

  const debouncedOrderSearch = useDebouncedValue(orderIdSearch, 300);
  const debouncedContainerSearch = useDebouncedValue(containerSearch, 300);

  const fetchShipments = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/orders/shipments", {
        params: {
          order_id: debouncedOrderSearch,
          container: debouncedContainerSearch,
          vendor: vendorFilter,
          status: statusFilter,
          page,
          limit,
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setSummary(res?.data?.summary || EMPTY_SUMMARY);
      setPage(Math.max(1, Number(res?.data?.pagination?.page || 1)));
      setTotalPages(Math.max(1, Number(res?.data?.pagination?.totalPages || 1)));
      setTotalRecords(Number(res?.data?.pagination?.totalRecords || 0));
      setFilterOptions({
        vendors: Array.isArray(res?.data?.filters?.vendors)
          ? res.data.filters.vendors
          : [],
        order_ids: Array.isArray(res?.data?.filters?.order_ids)
          ? res.data.filters.order_ids
          : [],
        containers: Array.isArray(res?.data?.filters?.containers)
          ? res.data.filters.containers
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load shipments.");
      setRows([]);
      setSummary(EMPTY_SUMMARY);
      setTotalPages(1);
      setTotalRecords(0);
      setFilterOptions({
        vendors: [],
        order_ids: [],
        containers: [],
      });
    } finally {
      setLoading(false);
    }
  }, [
    debouncedContainerSearch,
    debouncedOrderSearch,
    limit,
    page,
    sortBy,
    sortOrder,
    statusFilter,
    vendorFilter,
  ]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      setPage(1);
      if (sortBy === column) {
        setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
        return;
      }
      setSortBy(column);
      setSortOrder(defaultDirection);
    },
    [sortBy],
  );

  const sortIndicator = useCallback(
    (column) => {
      if (sortBy !== column) return "";
      return sortOrder === "asc" ? " (asc)" : " (desc)";
    },
    [sortBy, sortOrder],
  );

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
                  onChange={(e) => {
                    setOrderIdSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Enter order ID"
                />
                <datalist id="shipment-order-options">
                  {filterOptions.order_ids.map((orderId) => (
                    <option key={orderId} value={orderId} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-4">
                <label className="form-label">Search by Container Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={containerSearch}
                  list="shipment-container-options"
                  onChange={(e) => {
                    setContainerSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Enter container number"
                />
                <datalist id="shipment-container-options">
                  {filterOptions.containers.map((containerValue) => (
                    <option key={containerValue} value={containerValue} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label">Filter by Vendor</label>
                <select
                  className="form-select"
                  value={vendorFilter}
                  onChange={(e) => {
                    setVendorFilter(e.target.value);
                    setPage(1);
                  }}
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
                    setContainerSearch("");
                    setVendorFilter("all");
                    setStatusFilter("all");
                    setSortBy("stuffing_date");
                    setSortOrder("desc");
                    setPage(1);
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
              onClick={() => {
                setStatusFilter("all");
                setPage(1);
              }}
            >
              Total Items: {summary.total}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Inspection Done" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Inspection Done");
                setPage(1);
              }}
            >
              Inspection Done: {summary.inspectionDone}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Partial Shipped" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Partial Shipped");
                setPage(1);
              }}
            >
              Partial Shipped: {summary.partialShipped}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === "Shipped" ? "btn-primary" : "btn-outline-secondary"}`}
              onClick={() => {
                setStatusFilter("Shipped");
                setPage(1);
              }}
            >
              Shipped: {summary.shipped}
            </button>
            <span className="om-summary-chip">
              Showing: {statusFilter === "all" ? "All" : statusFilter}
            </span>
            <span className="om-summary-chip">Total Records: {totalRecords}</span>
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
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("order_id", "asc")}
                        >
                          PO{sortIndicator("order_id")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("item_code", "asc")}
                        >
                          Item Code{sortIndicator("item_code")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("vendor", "asc")}
                        >
                          Vendor{sortIndicator("vendor")}
                        </button>
                      </th>
                      <th>Description</th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("order_quantity", "desc")}
                        >
                          Order Quantity{sortIndicator("order_quantity")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("stuffing_date", "desc")}
                        >
                          Stuffing Date{sortIndicator("stuffing_date")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("container", "asc")}
                        >
                          Container Number{sortIndicator("container")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("quantity", "desc")}
                        >
                          Quantity{sortIndicator("quantity")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                          onClick={() => handleSortColumn("pending", "desc")}
                        >
                          Pending{sortIndicator("pending")}
                        </button>
                      </th>
                      <th>Remarks</th>
                      {canFinalizeShipping && <th>Finalize</th>}
                      {isAdmin && <th>Edit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
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

                    {rows.map((row, index) => (
                      <tr key={row?.shipment_id || `${row.order_id}-${row.item_code}-${index}`}>
                        <td>{row?.order_id || "N/A"}</td>
                        <td>{row?.item_code || "N/A"}</td>
                        <td>{row?.vendor || "N/A"}</td>
                        <td>{row?.description || "N/A"}</td>
                        <td>{row?.order_quantity || "N/A"}</td>
                        <td>{formatDateDDMMYYYY(row?.stuffing_date)}</td>
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

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </button>
        </div>

        <div className="d-flex justify-content-end mt-3">
          <div className="input-group om-limit-control">
            <span className="input-group-text">Limit</span>
            <select
              className="form-select"
              value={limit}
              onChange={(e) => {
                setPage(1);
                setLimit(Number(e.target.value));
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
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
