import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  exportDelayedPoReport,
  getDelayedPoReport,
} from "../services/orders.service";
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

const defaultReport = {
  filters: {
    brand: "",
    vendor: "",
    brand_options: [],
    vendor_options: [],
    from_date: "",
    to_date: "",
    report_date: "",
  },
  summary: {
    delayed_po_count: 0,
    vendors_count: 0,
    pending_count: 0,
    inspection_done_count: 0,
    shipped_count: 0,
    total_delay_days: 0,
    average_delay_days: 0,
  },
  vendors: [],
};

const DelayedPoReports = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "delayed-po-reports");

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
  const [fromDateFilter, setFromDateFilter] = useState(() =>
    String(
      searchParams.get("from_date")
      || searchParams.get("fromDate")
      || "",
    ).trim(),
  );
  const [draftFromDateFilter, setDraftFromDateFilter] = useState(() =>
    String(
      searchParams.get("from_date")
      || searchParams.get("fromDate")
      || "",
    ).trim(),
  );
  const [toDateFilter, setToDateFilter] = useState(() =>
    String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || "",
    ).trim(),
  );
  const [draftToDateFilter, setDraftToDateFilter] = useState(() =>
    String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || "",
    ).trim(),
  );
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("delayDays");
  const [sortOrder, setSortOrder] = useState("desc");

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const normalizedFromDate = String(fromDateFilter || "").trim();
      const normalizedToDate = String(toDateFilter || "").trim();

      if (normalizedFromDate && normalizedToDate && normalizedFromDate > normalizedToDate) {
        setReport(defaultReport);
        setError("From date must be before or equal to To date.");
        return;
      }

      const params = {};
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }
      if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
        params.vendor = vendorFilter;
      }
      if (normalizedFromDate) {
        params.from_date = normalizedFromDate;
      }
      if (normalizedToDate) {
        params.to_date = normalizedToDate;
      }

      const response = await getDelayedPoReport(params);
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
      setError(err?.response?.data?.message || "Failed to load delayed PO report.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, fromDateFilter, toDateFilter, vendorFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    const nextVendorFilter = normalizeEntityFilter(searchParams.get("vendor"));
    const nextFromDate = String(
      searchParams.get("from_date")
      || searchParams.get("fromDate")
      || "",
    ).trim();
    const nextToDate = String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || "",
    ).trim();

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setFromDateFilter((prev) => (prev === nextFromDate ? prev : nextFromDate));
    setDraftFromDateFilter((prev) => (prev === nextFromDate ? prev : nextFromDate));
    setToDateFilter((prev) => (prev === nextToDate ? prev : nextToDate));
    setDraftToDateFilter((prev) => (prev === nextToDate ? prev : nextToDate));
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
    if (fromDateFilter) {
      next.set("from_date", fromDateFilter);
    }
    if (toDateFilter) {
      next.set("to_date", toDateFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    fromDateFilter,
    searchParams,
    setSearchParams,
    syncedQuery,
    toDateFilter,
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

  const handleOpenOrder = useCallback((orderId) => {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) return;
    navigate(`/orders?order_id=${encodeURIComponent(normalizedOrderId)}`);
  }, [navigate]);

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setBrandFilter(normalizeEntityFilter(draftBrandFilter));
    setVendorFilter(normalizeEntityFilter(draftVendorFilter));
    setFromDateFilter(String(draftFromDateFilter || "").trim());
    setToDateFilter(String(draftToDateFilter || "").trim());
  }, [
    draftBrandFilter,
    draftFromDateFilter,
    draftToDateFilter,
    draftVendorFilter,
  ]);

  const handleClearFilters = useCallback(() => {
    setDraftBrandFilter(DEFAULT_ENTITY_FILTER);
    setDraftVendorFilter(DEFAULT_ENTITY_FILTER);
    setDraftFromDateFilter("");
    setDraftToDateFilter("");
    setBrandFilter(DEFAULT_ENTITY_FILTER);
    setVendorFilter(DEFAULT_ENTITY_FILTER);
    setFromDateFilter("");
    setToDateFilter("");
  }, []);

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      const normalizedFromDate = String(fromDateFilter || "").trim();
      const normalizedToDate = String(toDateFilter || "").trim();

      if (normalizedFromDate && normalizedToDate && normalizedFromDate > normalizedToDate) {
        alert("From date must be before or equal to To date.");
        return;
      }

      const params = {};
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }
      if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
        params.vendor = vendorFilter;
      }
      if (normalizedFromDate) {
        params.from_date = normalizedFromDate;
      }
      if (normalizedToDate) {
        params.to_date = normalizedToDate;
      }

      const response = await exportDelayedPoReport(params);
      const disposition = String(response?.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
      const fallbackName = `delayed-po-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const fileName = match?.[1]
        ? decodeURIComponent(match[1].trim())
        : fallbackName;

      const blob = new Blob(
        [response.data],
        {
          type:
            response?.headers?.["content-type"]
            || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to export delayed PO report.");
    } finally {
      setExporting(false);
    }
  }, [brandFilter, fromDateFilter, toDateFilter, vendorFilter]);

  const displayedFromDate = useMemo(
    () => toISODateString(filters.from_date) || "",
    [filters.from_date],
  );
  const displayedToDate = useMemo(
    () => toISODateString(filters.to_date) || "",
    [filters.to_date],
  );
  const etdWindowLabel = useMemo(() => {
    if (displayedFromDate && displayedToDate) {
      return `${formatDateDDMMYYYY(displayedFromDate)} - ${formatDateDDMMYYYY(displayedToDate)}`;
    }
    if (displayedFromDate) {
      return `From ${formatDateDDMMYYYY(displayedFromDate)}`;
    }
    if (displayedToDate) {
      return `Until ${formatDateDDMMYYYY(displayedToDate)}`;
    }
    return "All ETD Dates";
  }, [displayedFromDate, displayedToDate]);

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
          <h2 className="h4 mb-0">Delayed PO Reports</h2>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "Exporting..." : "Export XLSX"}
          </button>
        </div>

        <div className="card om-card mb-3">
          <form className="card-body d-flex flex-wrap gap-2 align-items-end" onSubmit={handleApplyFilters}>
            <div>
              <label className="form-label mb-1">From Date</label>
              <input
                type="date"
                className="form-control"
                value={draftFromDateFilter}
                max={draftToDateFilter || undefined}
                onChange={(event) =>
                  setDraftFromDateFilter(String(event.target.value || "").trim())
                }
              />
            </div>

            <div>
              <label className="form-label mb-1">To Date</label>
              <input
                type="date"
                className="form-control"
                value={draftToDateFilter}
                min={draftFromDateFilter || undefined}
                onChange={(event) =>
                  setDraftToDateFilter(String(event.target.value || "").trim())
                }
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
              {loading ? "Loading..." : "Apply"}
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
              ETD Window: {etdWindowLabel}
            </span>
            <span className="om-summary-chip">
              Report Date: {formatDateDDMMYYYY(filters.report_date)}
            </span>
            <span className="om-summary-chip">
              Brand: {brandFilter === DEFAULT_ENTITY_FILTER ? "all" : brandFilter}
            </span>
            <span className="om-summary-chip">
              Vendor: {vendorFilter === DEFAULT_ENTITY_FILTER ? "all" : vendorFilter}
            </span>
            <span className="om-summary-chip">
              Delayed POs: {summary.delayed_po_count ?? 0}
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
              Avg Delay: {summary.average_delay_days ?? 0} days
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
                No delayed POs found for the selected filters.
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
                  if (column === "etd") return new Date(row?.etd || 0).getTime();
                  if (column === "delayDays") return Number(row?.delay_days || 0);
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
                        Delayed POs: {vendorEntry.delayed_po_count ?? 0}
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
                        Avg Delay: {vendorEntry.average_delay_days ?? 0} days
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
                                onClick={() => handleSortColumn("etd", "desc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Delay Days"
                                isActive={sortBy === "delayDays"}
                                direction={sortOrder}
                                onClick={() => handleSortColumn("delayDays", "desc")}
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
                                No delayed POs for this vendor.
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
                              <td>{formatDateDDMMYYYY(row.etd)}</td>
                              <td>{row.delay_days ?? 0}</td>
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
    </>
  );
};

export default DelayedPoReports;
