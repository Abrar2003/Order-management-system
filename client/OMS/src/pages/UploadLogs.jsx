import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getUploadLogs } from "../services/orders.service";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const STATUS_LABELS = {
  success: "Success",
  success_with_conflicts: "Success + Conflicts",
  failed: "Failed",
};

const UploadLogs = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "upload-logs");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("status"), "all"),
  );
  const [orderIdInput, setOrderIdInput] = useState(() =>
    normalizeSearchParam(searchParams.get("order_id")),
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));

  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
    statuses: [],
  });

  const [summary, setSummary] = useState({
    total: 0,
    success: 0,
    success_with_conflicts: 0,
    failed: 0,
  });

  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalRecords: 0,
  });

  const debouncedOrderId = useDebouncedValue(orderIdInput, 300);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await getUploadLogs({
        page,
        limit,
        brand: brandFilter,
        vendor: vendorFilter,
        status: statusFilter,
        order_id: debouncedOrderId,
      });

      setRows(Array.isArray(res?.data) ? res.data : []);
      setFilters({
        brands: Array.isArray(res?.filters?.brands) ? res.filters.brands : [],
        vendors: Array.isArray(res?.filters?.vendors) ? res.filters.vendors : [],
        statuses: Array.isArray(res?.filters?.statuses) ? res.filters.statuses : [],
      });
      setSummary({
        total: Number(res?.summary?.total || 0),
        success: Number(res?.summary?.success || 0),
        success_with_conflicts: Number(res?.summary?.success_with_conflicts || 0),
        failed: Number(res?.summary?.failed || 0),
      });
      setPagination({
        page: Number(res?.pagination?.page || 1),
        totalPages: Number(res?.pagination?.totalPages || 1),
        totalRecords: Number(res?.pagination?.totalRecords || 0),
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to fetch upload logs.");
      setRows([]);
      setSummary({
        total: 0,
        success: 0,
        success_with_conflicts: 0,
        failed: 0,
      });
      setPagination({
        page: 1,
        totalPages: 1,
        totalRecords: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, debouncedOrderId, limit, page, statusFilter, vendorFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextStatusFilter = normalizeFilterParam(searchParams.get("status"), "all");
    const nextOrderIdInput = normalizeSearchParam(searchParams.get("order_id"));
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
    setOrderIdInput((prev) => (prev === nextOrderIdInput ? prev : nextOrderIdInput));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    const orderIdValue = normalizeSearchParam(orderIdInput);

    if (orderIdValue) next.set("order_id", orderIdValue);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (statusFilter && statusFilter !== "all") next.set("status", statusFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    limit,
    brandFilter,
    orderIdInput,
    page,
    searchParams,
    setSearchParams,
    statusFilter,
    vendorFilter,
  ]);

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
          <h2 className="h4 mb-0">Upload Logs</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Order ID</label>
                <input
                  type="text"
                  className="form-control"
                  value={orderIdInput}
                  placeholder="Search order id"
                  onChange={(e) => {
                    setPage(1);
                    setOrderIdInput(e.target.value);
                  }}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={brandFilter}
                  onChange={(e) => {
                    setPage(1);
                    setBrandFilter(e.target.value);
                  }}
                >
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={vendorFilter}
                  onChange={(e) => {
                    setPage(1);
                    setVendorFilter(e.target.value);
                  }}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={statusFilter}
                  onChange={(e) => {
                    setPage(1);
                    setStatusFilter(e.target.value);
                  }}
                >
                  <option value="all">All Statuses</option>
                  {filters.statuses.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status] || status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setPage(1);
                    setBrandFilter("all");
                    setVendorFilter("all");
                    setStatusFilter("all");
                    setOrderIdInput("");
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
            <span className="om-summary-chip">Total Logs: {summary.total}</span>
            <span className="om-summary-chip">Success: {summary.success}</span>
            <span className="om-summary-chip">
              Success + Conflicts: {summary.success_with_conflicts}
            </span>
            <span className="om-summary-chip">Failed: {summary.failed}</span>
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
                      <th>Uploaded At</th>
                      <th>Uploaded By</th>
                      <th>File</th>
                      <th>Vendors</th>
                      <th>Distinct Orders</th>
                      <th>Inserted Items</th>
                      <th>Duplicates</th>
                      <th>Conflicts</th>
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan="10" className="text-center py-4">
                          No logs found
                        </td>
                      </tr>
                    )}

                    {rows.map((log) => {
                      const vendors = Array.isArray(log?.uploaded_vendors)
                        ? log.uploaded_vendors
                        : [];
                      const conflicts = Array.isArray(log?.conflicts) ? log.conflicts : [];
                      const vendorSummaries = Array.isArray(log?.vendor_summaries)
                        ? log.vendor_summaries
                        : [];
                      const remarks = Array.isArray(log?.remarks) ? log.remarks : [];
                      const status = String(log?.status || "").trim();

                      return (
                        <tr key={log?._id || `${log?.createdAt || ""}-${status}`}>
                          <td>{formatDateDDMMYYYY(log?.createdAt)}</td>
                          <td>{log?.uploaded_by_name || "N/A"}</td>
                          <td>{log?.source_filename || "N/A"}</td>
                          <td>{vendors.length > 0 ? vendors.join(", ") : "N/A"}</td>
                          <td>{Number(log?.total_distinct_orders_uploaded || 0)}</td>
                          <td>{Number(log?.inserted_item_rows || 0)}</td>
                          <td>{Number(log?.duplicate_count || 0)}</td>
                          <td>{conflicts.length}</td>
                          <td>{STATUS_LABELS[status] || status || "N/A"}</td>
                          <td>
                            <details>
                              <summary>View</summary>
                              <div className="small mt-2 d-grid gap-2">
                                <div>
                                  <strong>Remarks:</strong>{" "}
                                  {remarks.length > 0 ? remarks.join(" | ") : "N/A"}
                                </div>

                                <div>
                                  <strong>Missing Open Orders by Brand + Vendor:</strong>
                                  {vendorSummaries.length === 0 && <div>N/A</div>}
                                  {vendorSummaries.map((entry) => (
                                    <div
                                      key={`${log?._id || "log"}-${entry?.brand || "brand"}-${entry?.vendor || "vendor"}`}
                                    >
                                      <div>
                                        {entry?.brand || "N/A"} / {entry?.vendor || "N/A"} | Uploaded Orders:{" "}
                                        {Number(entry?.uploaded_orders_count || 0)} | Items:{" "}
                                        {Number(entry?.uploaded_items_count || 0)} | Missing Open:{" "}
                                        {Number(entry?.missing_open_orders_count || 0)}
                                      </div>
                                      <div>
                                        {Array.isArray(entry?.missing_open_order_ids) && entry.missing_open_order_ids.length > 0
                                          ? entry.missing_open_order_ids
                                            .map((orderId) => String(orderId || "").trim())
                                            .join(", ")
                                          : "No missing open orders"}
                                      </div>
                                      {entry?.remark && <div>{entry.remark}</div>}
                                    </div>
                                  ))}
                                </div>

                                <div>
                                  <strong>Conflicts:</strong>{" "}
                                  {conflicts.length > 0
                                    ? conflicts.map((entry, index) => (
                                      <div
                                        key={`${log?._id || "log"}-${entry?.brand || "brand"}-${entry?.vendor || "vendor"}-${entry?.order_id || "order"}-${index}`}
                                      >
                                        {entry.message}
                                      </div>
                                    ))
                                    : "None"}
                                </div>
                              </div>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
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
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((prev) => Math.min(pagination.totalPages, prev + 1))}
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
    </>
  );
};

export default UploadLogs;
