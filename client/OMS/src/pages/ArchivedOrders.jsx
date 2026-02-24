import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.service";
import {
  getArchivedOrders,
  syncZeroQuantityOrdersArchive,
} from "../services/orders.service";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const ArchivedOrders = () => {
  const user = getUserFromToken();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    order_id: "",
    vendor: "",
    brand: "",
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    totalPages: 1,
    totalRecords: 0,
  });

  const canGoPrev = pagination.page > 1;
  const canGoNext = pagination.page < pagination.totalPages;

  const activeQueryParams = useMemo(() => {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
    };
    const orderId = String(filters.order_id || "").trim();
    const vendor = String(filters.vendor || "").trim();
    const brand = String(filters.brand || "").trim();

    if (orderId) params.order_id = orderId;
    if (vendor) params.vendor = vendor;
    if (brand) params.brand = brand;

    return params;
  }, [filters.brand, filters.order_id, filters.vendor, pagination.limit, pagination.page]);

  const fetchArchivedOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await getArchivedOrders(activeQueryParams);
      setRows(Array.isArray(response?.data) ? response.data : []);
      setPagination((prev) => ({
        ...prev,
        totalPages: Number(response?.pagination?.totalPages || 1),
        totalRecords: Number(response?.pagination?.totalRecords || 0),
      }));
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.message || "Failed to fetch archived orders.");
    } finally {
      setLoading(false);
    }
  }, [activeQueryParams]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchArchivedOrders();
  }, [fetchArchivedOrders, isAdmin]);

  const handleSyncZeroQuantity = async () => {
    const remark = window.prompt(
      "Optional archive remark for zero-quantity sync:",
      "",
    );

    try {
      setSyncing(true);
      setError("");
      const response = await syncZeroQuantityOrdersArchive(remark || "");
      await fetchArchivedOrders();
      window.alert(
        `Sync complete. Archived: ${Number(response?.archived_count || 0)}, Remark backfilled: ${Number(response?.remark_backfilled_count || 0)}, Status backfilled: ${Number(response?.status_backfilled_count || 0)}`,
      );
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to sync zero-quantity orders.");
    } finally {
      setSyncing(false);
    }
  };

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h4 mb-0">Archived Orders</h2>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={handleSyncZeroQuantity}
              disabled={syncing}
            >
              {syncing ? "Syncing..." : "Sync 0 Qty Orders"}
            </button>
            <span className="om-summary-chip">Total: {pagination.totalRecords}</span>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2">
              <div className="col-md-4">
                <label className="form-label mb-1">Order ID</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={filters.order_id}
                  onChange={(e) => setFilters((prev) => ({ ...prev, order_id: e.target.value }))}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label mb-1">Vendor</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={filters.vendor}
                  onChange={(e) => setFilters((prev) => ({ ...prev, vendor: e.target.value }))}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label mb-1">Brand</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={filters.brand}
                  onChange={(e) => setFilters((prev) => ({ ...prev, brand: e.target.value }))}
                />
              </div>
            </div>

            <div className="d-flex gap-2 mt-3">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  setPagination((prev) => ({
                    ...prev,
                    page: 1,
                  }))}
              >
                Apply Filters
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => {
                  setFilters({ order_id: "", vendor: "", brand: "" });
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

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
                      <th>Item</th>
                      <th>Description</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Quantity</th>
                      <th>Archived At</th>
                      <th>Archived By</th>
                      <th>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row?._id || `${row?.order_id}-${row?.item?.item_code}`}>
                        <td>{row?.order_id || "N/A"}</td>
                        <td>{row?.item?.item_code || "N/A"}</td>
                        <td>{row?.item?.description || "-"}</td>
                        <td>{row?.brand || "-"}</td>
                        <td>{row?.vendor || "-"}</td>
                        <td>{Number(row?.quantity || 0)}</td>
                        <td>{formatDateDDMMYYYY(row?.archived_at)}</td>
                        <td>{row?.archived_by?.name || "-"}</td>
                        <td>{row?.archived_remark || "-"}</td>
                      </tr>
                    ))}

                    {rows.length === 0 && (
                      <tr>
                        <td colSpan="9" className="text-center py-4">
                          No archived orders found
                        </td>
                      </tr>
                    )}
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
            disabled={!canGoPrev || loading}
            onClick={() =>
              setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!canGoNext || loading}
            onClick={() =>
              setPagination((prev) => ({
                ...prev,
                page: Math.min(prev.totalPages, prev.page + 1),
              }))}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};

export default ArchivedOrders;
