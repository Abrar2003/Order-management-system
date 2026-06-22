import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import ReportInfoBanner from "../components/ReportInfoBanner";
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

const getEtdUrgency = (daysUntilEtd) => {
  const days = Number(daysUntilEtd || 0);
  if (days <= 0) return { className: "is-today", label: "Today" };
  if (days <= 3) return { className: "is-urgent", label: `${days}d` };
  if (days <= 7) return { className: "is-soon", label: `${days}d` };
  return { className: "is-upcoming", label: `${days}d` };
};

const getProgressTone = (lastProgress) => {
  const normalized = String(lastProgress || "").trim().toLowerCase();
  if (!normalized || normalized === "pending") return "is-pending";
  if (normalized.includes("ship")) return "is-shipped";
  if (normalized.includes("inspect")) return "is-inspection";
  return "is-progress";
};

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
  nextDate.setUTCDate(nextDate.getUTCDate() + 10);
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
  const [collapsedVendors, setCollapsedVendors] = useState(() => new Set());

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

  const toggleVendor = useCallback((vendorKey) => {
    setCollapsedVendors((current) => {
      const next = new Set(current);
      if (next.has(vendorKey)) {
        next.delete(vendorKey);
      } else {
        next.add(vendorKey);
      }
      return next;
    });
  }, []);

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page upcoming-etd-page py-3">
        <header className="upcoming-etd-page-header">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm upcoming-etd-back-button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <span aria-hidden="true">←</span>
            <span>Back</span>
          </button>
          <div className="upcoming-etd-heading">
            <span className="upcoming-etd-eyebrow">Planning overview</span>
            <h1>Upcoming ETD Report</h1>
            <p>Track purchase orders approaching their effective departure date.</p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm upcoming-etd-export-button"
            onClick={() => setShowExportModal(true)}
          >
            <span aria-hidden="true">⇩</span>
            <span>Export</span>
          </button>
        </header>

        <div className="upcoming-etd-info-banner">
          <ReportInfoBanner
            description="Monitors Purchase Orders with delivery dates approaching within a specified future window."
            dataShown="PO numbers, brand, order date, effective ETD, days remaining, pending/inspected/shipped item counts, and last recorded progress."
            howItWorks="Shows upcoming orders grouped by vendor and sorted by days remaining. Filterable by limit date, brand, and vendor."
          />
        </div>

        <section className="card om-card upcoming-etd-filter-card mb-3" aria-labelledby="upcoming-etd-filter-title">
          <div className="upcoming-etd-section-heading">
            <div>
              <h2 id="upcoming-etd-filter-title">Report controls</h2>
              <p>Adjust the ETD window or narrow the report by brand and vendor.</p>
            </div>
          </div>
          <form className="upcoming-etd-filter-grid" onSubmit={handleApplyFilters}>
            <div className="upcoming-etd-filter-field">
              <label className="form-label" htmlFor="upcoming-etd-until-date">Until date</label>
              <input
                id="upcoming-etd-until-date"
                type="date"
                className="form-control"
                value={draftToDateFilter}
                onChange={(event) => setDraftToDateFilter(String(event.target.value || "").trim())}
              />
            </div>

            <div className="upcoming-etd-filter-field">
              <label className="form-label" htmlFor="upcoming-etd-brand">Brand</label>
              <select
                id="upcoming-etd-brand"
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

            <div className="upcoming-etd-filter-field">
              <label className="form-label" htmlFor="upcoming-etd-vendor">Vendor</label>
              <select
                id="upcoming-etd-vendor"
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

            <div className="upcoming-etd-filter-actions">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={handleClearFilters}
                disabled={loading}
              >
                Reset
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "Loading..." : "Apply filters"}
              </button>
            </div>
          </form>
        </section>

        <section className="upcoming-etd-overview mb-3" aria-label="Report summary">
          <div className="upcoming-etd-window-card">
            <div className="upcoming-etd-window-icon" aria-hidden="true">↗</div>
            <div>
              <span className="upcoming-etd-card-label">ETD window</span>
              <strong>
                {formatDateDDMMYYYY(filters.report_start_date)} —{" "}
                {formatDateDDMMYYYY(filters.report_end_date)}
              </strong>
              <div className="upcoming-etd-active-filters">
                <span>
                  Brand: {brandFilter === DEFAULT_ENTITY_FILTER ? "All" : brandFilter}
                </span>
                <span>
                  Vendor: {vendorFilter === DEFAULT_ENTITY_FILTER ? "All" : vendorFilter}
                </span>
              </div>
            </div>
          </div>

          <div className="upcoming-etd-kpi-grid">
            <div className="upcoming-etd-kpi is-primary">
              <span className="upcoming-etd-card-label">Upcoming POs</span>
              <strong>{summary.upcoming_po_count ?? 0}</strong>
              <small>Across {summary.vendors_count ?? 0} vendors</small>
            </div>
            <div className="upcoming-etd-kpi is-warning">
              <span className="upcoming-etd-card-label">Pending items</span>
              <strong>{summary.pending_count ?? 0}</strong>
              <small>Awaiting inspection</small>
            </div>
            <div className="upcoming-etd-kpi is-success">
              <span className="upcoming-etd-card-label">Inspection done</span>
              <strong>{summary.inspection_done_count ?? 0}</strong>
              <small>Ready for next step</small>
            </div>
            <div className="upcoming-etd-kpi is-neutral">
              <span className="upcoming-etd-card-label">Avg. time to ETD</span>
              <strong>
                {summary.average_days_until_etd ?? 0}
                <span> days</span>
              </strong>
              <small>{summary.shipped_count ?? 0} items shipped</small>
            </div>
          </div>
        </section>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="d-grid gap-3">
          {loading ? (
            <div className="card om-card upcoming-etd-state-card">
              <div className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              <div>
                <strong>Loading upcoming ETDs</strong>
                <span>Building the latest vendor view…</span>
              </div>
            </div>
          ) : report.vendors.length === 0 ? (
            <div className="card om-card upcoming-etd-state-card">
              <div className="upcoming-etd-empty-icon" aria-hidden="true">✓</div>
              <div>
                <strong>No upcoming ETDs found</strong>
                <span>Try extending the until date or clearing the selected filters.</span>
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
              const isCollapsed = collapsedVendors.has(vendorKey);
              const vendorInitial = String(vendorEntry?.vendor || "?")
                .trim()
                .charAt(0)
                .toUpperCase();

              return (
                <section key={vendorKey} className="card om-card upcoming-etd-vendor-card">
                  <div className="upcoming-etd-vendor-header">
                    <div className="upcoming-etd-vendor-identity">
                      <span className="upcoming-etd-vendor-avatar" aria-hidden="true">
                        {vendorInitial}
                      </span>
                      <div>
                        <span className="upcoming-etd-card-label">Vendor</span>
                        <h2>{vendorEntry.vendor}</h2>
                        <p>
                          {(Array.isArray(vendorEntry?.brands) ? vendorEntry.brands : []).join(", ") || "No brand listed"}
                        </p>
                      </div>
                    </div>

                    <div className="upcoming-etd-vendor-summary">
                      <div>
                        <span>POs</span>
                        <strong>{vendorEntry.upcoming_po_count ?? 0}</strong>
                      </div>
                      <div className="is-warning">
                        <span>Pending</span>
                        <strong>{vendorEntry.pending_count ?? 0}</strong>
                      </div>
                      <div className="is-success">
                        <span>Inspected</span>
                        <strong>{vendorEntry.inspection_done_count ?? 0}</strong>
                      </div>
                      <div>
                        <span>Avg. ETD</span>
                        <strong>{vendorEntry.average_days_until_etd ?? 0}d</strong>
                      </div>
                      <button
                        type="button"
                        className="upcoming-etd-collapse-button"
                        onClick={() => toggleVendor(vendorKey)}
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${vendorEntry.vendor}`}
                      >
                        <span aria-hidden="true">{isCollapsed ? "+" : "−"}</span>
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="card-body p-0">
                      <div className="table-responsive">
                      <table className="table table-sm table-hover align-middle mb-0 upcoming-etd-table">
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

                          {sortedRows.map((row) => {
                            const urgency = getEtdUrgency(row.days_until_etd);
                            return (
                              <tr
                                key={`${vendorKey}-${row.order_id}`}
                                className="table-clickable"
                                onClick={() => handleOpenOrder(row.order_id)}
                              >
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn-link p-0 align-baseline text-decoration-none upcoming-etd-po-link"
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
                                <td>
                                  <span className={`upcoming-etd-days-badge ${urgency.className}`}>
                                    {urgency.label}
                                  </span>
                                </td>
                                <td>
                                  <span className={`upcoming-etd-count${Number(row.pending_count || 0) > 0 ? " is-pending" : ""}`}>
                                    {row.pending_count ?? 0}
                                  </span>
                                </td>
                                <td>
                                  <span className={`upcoming-etd-count${Number(row.inspection_done_count || 0) > 0 ? " is-inspected" : ""}`}>
                                    {row.inspection_done_count ?? 0}
                                  </span>
                                </td>
                                <td>
                                  <span className="upcoming-etd-count">
                                    {row.shipped_count ?? 0}
                                  </span>
                                </td>
                                <td>
                                  <span className={`upcoming-etd-progress ${getProgressTone(row.last_progress)}`}>
                                    <span aria-hidden="true" />
                                    {row.last_progress || "Pending"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </section>
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
