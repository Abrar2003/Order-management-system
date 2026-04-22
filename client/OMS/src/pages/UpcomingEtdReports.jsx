import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import UpcomingEtdExportModal from "../components/UpcomingEtdExportModal";
import SortHeaderButton from "../components/SortHeaderButton";
import { getUpcomingEtdReport } from "../services/orders.service";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_ENTITY_FILTER = "all";

const normalizeEntityFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_ENTITY_FILTER;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return DEFAULT_ENTITY_FILTER;
  }
  return normalized;
};

const getDefaultUpcomingEtdToDate = () => {
  const todayIso = toISODateString(new Date());
  const todayUtc = todayIso ? new Date(`${todayIso}T00:00:00Z`) : new Date();
  const nextDate = new Date(todayUtc);
  nextDate.setUTCDate(nextDate.getUTCDate() + 15);
  return toISODateString(nextDate);
};

const defaultReport = {
  filters: {
    brand: "",
    vendor: "",
    brand_options: [],
    vendor_options: [],
    report_start_date: "",
    report_end_date: "",
  },
  summary: {
    upcoming_po_count: 0,
    vendors_count: 0,
    pending_count: 0,
    inspection_done_count: 0,
    shipped_count: 0,
    total_days_until_etd: 0,
    average_days_until_etd: 0,
  },
  vendors: [],
};

const UpcomingEtdReports = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "upcoming-etd-reports");

  const defaultToDate = useMemo(() => getDefaultUpcomingEtdToDate(), []);
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("vendor")),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("vendor")),
  );
  const [toDateFilter, setToDateFilter] = useState(() =>
    String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || defaultToDate,
    ).trim(),
  );
  const [draftToDateFilter, setDraftToDateFilter] = useState(() =>
    String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || defaultToDate,
    ).trim(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [sortBy, setSortBy] = useState("daysUntilEtd");
  const [sortOrder, setSortOrder] = useState("asc");

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = {
        to_date: String(toDateFilter || "").trim() || defaultToDate,
      };
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }
      if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
        params.vendor = vendorFilter;
      }

      const response = await getUpcomingEtdReport(params);
      setReport({
        filters: {
          ...defaultReport.filters,
          ...(response?.filters || {}),
        },
        summary: response?.summary || defaultReport.summary,
        vendors: Array.isArray(response?.vendors) ? response.vendors : [],
      });
    } catch (err) {
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load upcoming ETD report.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, defaultToDate, toDateFilter, vendorFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    const nextVendorFilter = normalizeEntityFilter(searchParams.get("vendor"));
    const nextToDate = String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || defaultToDate,
    ).trim();

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setToDateFilter((prev) => (prev === nextToDate ? prev : nextToDate));
    setDraftToDateFilter((prev) => (prev === nextToDate ? prev : nextToDate));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [defaultToDate, searchParams, syncedQuery]);

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
    if (toDateFilter) {
      next.set("to_date", toDateFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [brandFilter, searchParams, setSearchParams, syncedQuery, toDateFilter, vendorFilter]);

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setBrandFilter(normalizeEntityFilter(draftBrandFilter));
    setVendorFilter(normalizeEntityFilter(draftVendorFilter));
    setToDateFilter(String(draftToDateFilter || "").trim() || defaultToDate);
  };

  const handleClearFilters = () => {
    setDraftBrandFilter(DEFAULT_ENTITY_FILTER);
    setDraftVendorFilter(DEFAULT_ENTITY_FILTER);
    setDraftToDateFilter(defaultToDate);
    setBrandFilter(DEFAULT_ENTITY_FILTER);
    setVendorFilter(DEFAULT_ENTITY_FILTER);
    setToDateFilter(defaultToDate);
  };
  const summary = useMemo(
    () => report?.summary || defaultReport.summary,
    [report?.summary],
  );

  const handleOpenOrder = useCallback((orderId) => {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) return;
    navigate(`/orders?order_id=${encodeURIComponent(normalizedOrderId)}`);
  }, [navigate]);

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        sortBy,
        sortOrder,
        column,
        defaultDirection,
      );
      setSortBy(nextSortState.sortBy);
      setSortOrder(nextSortState.sortOrder);
    },
    [sortBy, sortOrder],
  );

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
          <h2 className="h4 mb-0">Upcoming ETD Reports</h2>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => setShowExportModal(true)}
          >
            Export Report
          </button>
        </div>

        <div className="card om-card mb-3">
          <form className="card-body d-flex flex-wrap gap-2 align-items-end" onSubmit={handleApplyFilters}>
            <div>
              <label className="form-label mb-1">Until Date</label>
              <input
                type="date"
                className="form-control"
                value={draftToDateFilter}
                onChange={(event) => setDraftToDateFilter(String(event.target.value || "").trim())}
              />
            </div>

            <div>
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={draftBrandFilter}
                onChange={(event) =>
                  setDraftBrandFilter(normalizeEntityFilter(event.target.value))
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
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={draftVendorFilter}
                onChange={(event) =>
                  setDraftVendorFilter(normalizeEntityFilter(event.target.value))
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

            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={loading}
            >
              Apply
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleClearFilters}
              disabled={loading}
            >
              Clear
            </button>
          </form>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">
              Window: {formatDateDDMMYYYY(filters.report_start_date)} - {formatDateDDMMYYYY(filters.report_end_date)}
            </span>
            <span className="om-summary-chip">
              Brand: {brandFilter === DEFAULT_ENTITY_FILTER ? "all" : brandFilter}
            </span>
            <span className="om-summary-chip">
              Vendor: {vendorFilter === DEFAULT_ENTITY_FILTER ? "all" : vendorFilter}
            </span>
            <span className="om-summary-chip">
              Upcoming POs: {summary.upcoming_po_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Vendors: {summary.vendors_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Pending: {summary.pending_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Inspection Done: {summary.inspection_done_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Shipped: {summary.shipped_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Avg Days Until ETD: {summary.average_days_until_etd ?? 0}
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
                No upcoming ETD POs found for the selected filters.
              </div>
            </div>
          ) : (
            report.vendors.map((vendorEntry, index) => {
              const rows = Array.isArray(vendorEntry?.rows) ? vendorEntry.rows : [];
              const sortedRows = sortClientRows(rows, {
                sortBy,
                sortOrder,
                getSortValue: (row, column) => {
                  if (column === "orderId") return row?.order_id;
                  if (column === "brand") return row?.brand;
                  if (column === "orderDate") return new Date(row?.order_date || 0).getTime();
                  if (column === "etd") {
                    return new Date(row?.effective_etd || 0).getTime();
                  }
                  if (column === "daysUntilEtd") {
                    return Number(row?.days_until_etd || 0);
                  }
                  if (column === "pending") return Number(row?.pending_count || 0);
                  if (column === "inspectionDone") {
                    return Number(row?.inspection_done_count || 0);
                  }
                  if (column === "shipped") return Number(row?.shipped_count || 0);
                  if (column === "lastProgress") return row?.last_progress;
                  return "";
                },
              });
              const vendorKey = String(vendorEntry?.vendor || "").trim() || `vendor-${index}`;

              return (
                <div key={vendorKey} className="card om-card">
                  <div className="card-body p-0">
                    <div className="px-3 py-2 border-bottom d-flex flex-wrap gap-2">
                      <span className="fw-semibold">Vendor: {vendorEntry.vendor}</span>
                      <span className="om-summary-chip">
                        Brands: {(Array.isArray(vendorEntry?.brands) ? vendorEntry.brands : []).join(", ") || "N/A"}
                      </span>
                      <span className="om-summary-chip">
                        Upcoming POs: {vendorEntry.upcoming_po_count ?? 0}
                      </span>
                      <span className="om-summary-chip">
                        Pending: {vendorEntry.pending_count ?? 0}
                      </span>
                      <span className="om-summary-chip">
                        Inspection Done: {vendorEntry.inspection_done_count ?? 0}
                      </span>
                      <span className="om-summary-chip">
                        Shipped: {vendorEntry.shipped_count ?? 0}
                      </span>
                      <span className="om-summary-chip">
                        Avg Days Until ETD: {vendorEntry.average_days_until_etd ?? 0}
                      </span>
                    </div>

                    <div className="table-responsive">
                      <table className="table table-sm table-striped align-middle mb-0">
                        <thead>
                          <tr>
                            <th>
                              <SortHeaderButton
                                label="PO"
                                isActive={sortBy === "orderId"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("orderId", "asc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Brand"
                                isActive={sortBy === "brand"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("brand", "asc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Order Date"
                                isActive={sortBy === "orderDate"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("orderDate", "desc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="ETD"
                                isActive={sortBy === "etd"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("etd", "asc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Days Until ETD"
                                isActive={sortBy === "daysUntilEtd"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("daysUntilEtd", "asc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Pending"
                                isActive={sortBy === "pending"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("pending", "desc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Inspection Done"
                                isActive={sortBy === "inspectionDone"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("inspectionDone", "desc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Shipped"
                                isActive={sortBy === "shipped"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("shipped", "desc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Last Progress"
                                isActive={sortBy === "lastProgress"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("lastProgress", "asc")}
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRows.length === 0 && (
                            <tr>
                              <td colSpan="9" className="text-center py-3">
                                No upcoming ETD POs for this vendor.
                              </td>
                            </tr>
                          )}

                          {sortedRows.map((row) => (
                            <tr
                              key={`${vendorKey}-${row.order_id}`}
                              className="table-clickable"
                              onClick={() => handleOpenOrder(row.order_id)}
                            >
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-link p-0 align-baseline text-decoration-none"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleOpenOrder(row.order_id);
                                  }}
                                >
                                  {row.order_id}
                                </button>
                              </td>
                              <td>{row.brand}</td>
                              <td>{formatDateDDMMYYYY(row.order_date)}</td>
                              <td>{formatDateDDMMYYYY(row.effective_etd)}</td>
                              <td>{row.days_until_etd ?? 0}</td>
                              <td>{row.pending_count ?? 0}</td>
                              <td>{row.inspection_done_count ?? 0}</td>
                              <td>{row.shipped_count ?? 0}</td>
                              <td>{row.last_progress || "-"}</td>
                            </tr>
                          ))}
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

      {showExportModal && (
        <UpcomingEtdExportModal
          onClose={() => setShowExportModal(false)}
          filterOptions={filters}
          defaultFilters={{
            brand: brandFilter,
            vendor: vendorFilter,
            to_date: toDateFilter,
          }}
        />
      )}
    </>
  );
};

export default UpcomingEtdReports;
