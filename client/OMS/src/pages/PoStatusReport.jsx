import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getPoStatusReport } from "../services/orders.service";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const DEFAULT_ENTITY_FILTER = "all";
const DEFAULT_STATUS_FILTER = "Inspection Done";
const STATUS_OPTIONS_FALLBACK = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const normalizeEntityFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_ENTITY_FILTER;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return DEFAULT_ENTITY_FILTER;
  }
  return normalized;
};

const normalizeStatusFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_STATUS_FILTER;

  const matchedStatus = STATUS_OPTIONS_FALLBACK.find(
    (status) => status.toLowerCase() === normalized.toLowerCase(),
  );
  return matchedStatus || DEFAULT_STATUS_FILTER;
};

const defaultReport = {
  filters: {
    brand: "",
    vendor: "",
    status: DEFAULT_STATUS_FILTER,
    brand_options: [],
    vendor_options: [],
    status_options: STATUS_OPTIONS_FALLBACK,
  },
  summary: {
    vendors_count: 0,
    rows_count: 0,
    total_order_quantity: 0,
  },
  vendors: [],
};

const PoStatusReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "po-status-report");

  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("vendor")),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeStatusFilter(searchParams.get("status")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = {
        status: statusFilter,
      };
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }
      if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
        params.vendor = vendorFilter;
      }

      const response = await getPoStatusReport(params);
      setReport({
        filters: {
          ...defaultReport.filters,
          ...(response?.filters || {}),
        },
        summary: response?.summary || defaultReport.summary,
        vendors: Array.isArray(response?.vendors) ? response.vendors : [],
      });
    } catch (err) {
      console.error(err);
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load PO status report.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, statusFilter, vendorFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    const nextVendorFilter = normalizeEntityFilter(searchParams.get("vendor"));
    const nextStatusFilter = normalizeStatusFilter(searchParams.get("status"));

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (brandFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("brand", brandFilter);
    }
    if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("vendor", vendorFilter);
    }
    if (statusFilter !== DEFAULT_STATUS_FILTER) {
      next.set("status", statusFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    searchParams,
    setSearchParams,
    statusFilter,
    syncedQuery,
    vendorFilter,
  ]);

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );
  const summary = useMemo(
    () => report?.summary || defaultReport.summary,
    [report?.summary],
  );
  const statusOptions = useMemo(() => {
    const rawOptions = Array.isArray(filters.status_options)
      ? filters.status_options
      : STATUS_OPTIONS_FALLBACK;
    return Array.from(new Set(rawOptions.map((value) => String(value || "").trim()).filter(Boolean)));
  }, [filters.status_options]);

  const handleOpenOrder = useCallback((orderId) => {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) return;
    navigate(`/orders?order_id=${encodeURIComponent(normalizedOrderId)}`);
  }, [navigate]);

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">PO Status Report</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-end">
            <div>
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={vendorFilter}
                onChange={(event) =>
                  setVendorFilter(normalizeEntityFilter(event.target.value))
                }
              >
                <option value={DEFAULT_ENTITY_FILTER}>All Vendors</option>
                {(Array.isArray(filters.vendor_options) ? filters.vendor_options : []).map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={brandFilter}
                onChange={(event) =>
                  setBrandFilter(normalizeEntityFilter(event.target.value))
                }
              >
                <option value={DEFAULT_ENTITY_FILTER}>All Brands</option>
                {(Array.isArray(filters.brand_options) ? filters.brand_options : []).map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label mb-1">Status</label>
              <select
                className="form-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(normalizeStatusFilter(event.target.value))
                }
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={fetchReport}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">
              Vendor: {vendorFilter === DEFAULT_ENTITY_FILTER ? "all" : vendorFilter}
            </span>
            <span className="om-summary-chip">
              Brand: {brandFilter === DEFAULT_ENTITY_FILTER ? "all" : brandFilter}
            </span>
            <span className="om-summary-chip">
              Status: {statusFilter}
            </span>
            <span className="om-summary-chip">
              Vendors: {summary.vendors_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Items: {summary.rows_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Total Order Qty: {summary.total_order_quantity ?? 0}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="d-grid gap-3">
          {loading ? (
            <div className="card om-card">
              <div className="card-body text-center py-4">Loading...</div>
            </div>
          ) : report.vendors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No rows found for the selected filters.
              </div>
            </div>
          ) : (
            report.vendors.map((vendorEntry, index) => {
              const rows = Array.isArray(vendorEntry?.rows) ? vendorEntry.rows : [];
              const vendorKey = String(vendorEntry?.vendor || "").trim() || `vendor-${index}`;

              return (
                <div key={vendorKey} className="card om-card">
                  <div className="card-body p-0">
                    <div className="px-3 py-2 border-bottom d-flex flex-wrap gap-2">
                      <span className="fw-semibold">Vendor: {vendorEntry.vendor}</span>
                      <span className="om-summary-chip">
                        Items: {vendorEntry.total_rows ?? rows.length}
                      </span>
                      <span className="om-summary-chip">
                        Total Order Qty: {vendorEntry.total_order_quantity ?? 0}
                      </span>
                    </div>

                    <div className="table-responsive">
                      <table className="table table-sm table-striped align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Brand</th>
                            <th>PO</th>
                            <th>Order Date</th>
                            <th>ETD</th>
                            <th>Item Code</th>
                            <th>Description</th>
                            <th>Order Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 ? (
                            <tr>
                              <td colSpan="7" className="text-center py-3">
                                No rows for this vendor.
                              </td>
                            </tr>
                          ) : (
                            rows.map((row) => (
                              <tr
                                key={`${vendorKey}-${row._id || `${row.order_id}-${row.item_code}`}`}
                                className="table-clickable"
                                onClick={() => handleOpenOrder(row.order_id)}
                              >
                                <td>{row.brand || "N/A"}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn-link p-0 align-baseline text-decoration-none"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleOpenOrder(row.order_id);
                                    }}
                                  >
                                    {row.order_id || "N/A"}
                                  </button>
                                </td>
                                <td>{formatDateDDMMYYYY(row.order_date)}</td>
                                <td>{formatDateDDMMYYYY(row.ETD)}</td>
                                <td>{row.item_code || "N/A"}</td>
                                <td>{row.description || "N/A"}</td>
                                <td>{row.order_quantity ?? 0}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default PoStatusReport;
