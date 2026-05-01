import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { formatCbm } from "../utils/cbm";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import "../App.css";

const DEFAULT_TAB = "summary";
const DEFAULT_TIMELINE = "1m";
const REPORT_TIMELINE_DAYS = Object.freeze({
  "1m": 30,
  "3m": 90,
  "6m": 180,
});

const createDefaultSummaryReport = (fromDate = "", toDate = "", vendor = "") => ({
  filters: {
    timeline: DEFAULT_TIMELINE,
    from_date: fromDate,
    to_date: toDate,
    vendor,
    vendor_options: [],
  },
  summary: {
    inspectors_count: 0,
    inspection_count: 0,
    inspected_quantity: 0,
    inspected_cbm: 0,
  },
  inspectors: [],
});

const createDefaultDetailedReport = (fromDate = "", toDate = "", vendor = "", inspector = "") => ({
  filters: {
    timeline: DEFAULT_TIMELINE,
    from_date: fromDate,
    to_date: toDate,
    vendor,
    inspector,
    vendor_options: [],
    inspector_options: [],
  },
  summary: {
    vendors_count: 0,
    brand_tables_count: 0,
    total_inspections: 0,
    total_passed_quantity: 0,
    total_cbm: 0,
  },
  vendors: [],
});

const normalizeTab = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "detailed" ? "detailed" : DEFAULT_TAB;
};

const normalizeTimeline = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "1m" || normalized === "3m" || normalized === "6m") {
    return normalized;
  }
  if (normalized === "custom") return "custom";
  return DEFAULT_TIMELINE;
};

const normalizeEntityFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return "";
  }
  return normalized;
};

const normalizeDateFilter = (value, fallback = "") => toISODateString(value) || fallback;

const getDateRangeFromTimeline = (timelineValue) => {
  const normalizedTimeline = normalizeTimeline(timelineValue);
  const days = REPORT_TIMELINE_DAYS[normalizedTimeline] || REPORT_TIMELINE_DAYS[DEFAULT_TIMELINE];
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (Math.max(1, days) - 1));

  const toDateIso = toISODateString(toDate);
  const fromDateIso = toISODateString(fromDate) || toDateIso;

  return {
    from_date: fromDateIso,
    to_date: toDateIso,
  };
};

const getDateRangeFromSearchParams = (searchParams, timelineValue) => {
  const derivedRange = getDateRangeFromTimeline(timelineValue);

  return {
    from_date: normalizeDateFilter(
      searchParams.get("from_date"),
      derivedRange.from_date,
    ),
    to_date: normalizeDateFilter(searchParams.get("to_date"), derivedRange.to_date),
  };
};

const mergeTextOptions = (...groups) =>
  [...new Set(
    groups
      .flatMap((group) => (Array.isArray(group) ? group : []))
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

const mergeInspectorOptions = (...groups) => {
  const optionMap = new Map();

  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const option of group) {
      const id = String(option?._id || "").trim();
      if (!id) continue;

      optionMap.set(id, {
        _id: id,
        name: String(option?.name || "").trim() || "Unknown",
      });
    }
  }

  return [...optionMap.values()].sort((left, right) => {
    const nameCompare = left.name.localeCompare(right.name);
    if (nameCompare !== 0) return nameCompare;
    return left._id.localeCompare(right._id);
  });
};

const formatMetric = (value, fallback = "0") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(parsed) ? 0 : 0,
    maximumFractionDigits: 3,
  });
};

const VendorWiseQAReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "vendor-wise-qa-report");

  const initialTab = normalizeTab(searchParams.get("tab"));
  const initialTimeline = normalizeTimeline(searchParams.get("timeline"));
  const initialDateRange = getDateRangeFromSearchParams(searchParams, initialTimeline);
  const initialVendor = normalizeEntityFilter(searchParams.get("vendor"));
  const initialInspector = normalizeEntityFilter(searchParams.get("inspector"));

  const [activeTab, setActiveTab] = useState(() => initialTab);
  const [timeline, setTimeline] = useState(() => initialTimeline);
  const [draftTimeline, setDraftTimeline] = useState(() => initialTimeline);
  const [fromDate, setFromDate] = useState(() => initialDateRange.from_date);
  const [draftFromDate, setDraftFromDate] = useState(() => initialDateRange.from_date);
  const [toDate, setToDate] = useState(() => initialDateRange.to_date);
  const [draftToDate, setDraftToDate] = useState(() => initialDateRange.to_date);
  const [vendorFilter, setVendorFilter] = useState(() => initialVendor);
  const [draftVendorFilter, setDraftVendorFilter] = useState(() => initialVendor);
  const [inspectorFilter, setInspectorFilter] = useState(() => initialInspector);
  const [draftInspectorFilter, setDraftInspectorFilter] = useState(() => initialInspector);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [loadingVendorOptions, setLoadingVendorOptions] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingDetailed, setLoadingDetailed] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [detailedError, setDetailedError] = useState("");
  const [summaryReport, setSummaryReport] = useState(() =>
    createDefaultSummaryReport(initialDateRange.from_date, initialDateRange.to_date, initialVendor),
  );
  const [detailedReport, setDetailedReport] = useState(() =>
    createDefaultDetailedReport(
      initialDateRange.from_date,
      initialDateRange.to_date,
      initialVendor,
      initialInspector,
    ),
  );
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [summarySortBy, setSummarySortBy] = useState("inspector");
  const [summarySortOrder, setSummarySortOrder] = useState("asc");
  const [detailSortBy, setDetailSortBy] = useState("inspectionDate");
  const [detailSortOrder, setDetailSortOrder] = useState("desc");

  const fetchVendorOptions = useCallback(async () => {
    try {
      setLoadingVendorOptions(true);
      const response = await api.get("/orders/brands-and-vendors");
      setVendorOptions(
        mergeTextOptions(response?.data?.vendors),
      );
    } catch (error) {
      setVendorOptions([]);
    } finally {
      setLoadingVendorOptions(false);
    }
  }, []);

  const fetchSummaryReport = useCallback(async () => {
    const baseReport = createDefaultSummaryReport(fromDate, toDate, vendorFilter);
    if (!vendorFilter) {
      setSummaryError("");
      setSummaryReport(baseReport);
      return;
    }

    if (fromDate > toDate) {
      setSummaryReport(baseReport);
      setSummaryError("From date cannot be later than To date.");
      return;
    }

    try {
      setLoadingSummary(true);
      setSummaryError("");

      const response = await api.get("/reports/vendor-wise-qa/summary", {
        params: {
          timeline,
          from_date: fromDate,
          to_date: toDate,
          vendor: vendorFilter,
        },
      });
      const responseData = response?.data || {};

      setSummaryReport({
        filters: {
          ...baseReport.filters,
          ...(responseData?.filters || {}),
        },
        summary: responseData?.summary || baseReport.summary,
        inspectors: Array.isArray(responseData?.inspectors)
          ? responseData.inspectors
          : [],
      });
    } catch (error) {
      setSummaryReport(baseReport);
      setSummaryError(
        error?.response?.data?.message || "Failed to load vendor wise QA summary.",
      );
    } finally {
      setLoadingSummary(false);
    }
  }, [fromDate, timeline, toDate, vendorFilter]);

  const fetchDetailedReport = useCallback(async () => {
    const baseReport = createDefaultDetailedReport(
      fromDate,
      toDate,
      vendorFilter,
      inspectorFilter,
    );

    if (fromDate > toDate) {
      setDetailedReport(baseReport);
      setDetailedError("From date cannot be later than To date.");
      return;
    }

    try {
      setLoadingDetailed(true);
      setDetailedError("");

      const params = {
        timeline,
        from_date: fromDate,
        to_date: toDate,
      };

      if (vendorFilter) {
        params.vendor = vendorFilter;
      }

      if (inspectorFilter) {
        params.inspector = inspectorFilter;
      }

      const response = await api.get("/reports/vendor-wise-qa/detailed", { params });
      const responseData = response?.data || {};

      setDetailedReport({
        filters: {
          ...baseReport.filters,
          ...(responseData?.filters || {}),
        },
        summary: responseData?.summary || baseReport.summary,
        vendors: Array.isArray(responseData?.vendors) ? responseData.vendors : [],
      });
    } catch (error) {
      setDetailedReport(baseReport);
      setDetailedError(
        error?.response?.data?.message || "Failed to load vendor wise QA details.",
      );
    } finally {
      setLoadingDetailed(false);
    }
  }, [fromDate, inspectorFilter, timeline, toDate, vendorFilter]);

  useEffect(() => {
    fetchVendorOptions();
  }, [fetchVendorOptions]);

  useEffect(() => {
    if (activeTab === "summary") {
      fetchSummaryReport();
      return;
    }

    fetchDetailedReport();
  }, [activeTab, fetchDetailedReport, fetchSummaryReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextTab = normalizeTab(searchParams.get("tab"));
    const nextTimeline = normalizeTimeline(searchParams.get("timeline"));
    const nextDateRange = getDateRangeFromSearchParams(searchParams, nextTimeline);
    const nextVendor = normalizeEntityFilter(searchParams.get("vendor"));
    const nextInspector = normalizeEntityFilter(searchParams.get("inspector"));

    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
    setTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setDraftTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setFromDate((prev) => (prev === nextDateRange.from_date ? prev : nextDateRange.from_date));
    setDraftFromDate((prev) => (prev === nextDateRange.from_date ? prev : nextDateRange.from_date));
    setToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setDraftToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setDraftVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setInspectorFilter((prev) => (prev === nextInspector ? prev : nextInspector));
    setDraftInspectorFilter((prev) => (prev === nextInspector ? prev : nextInspector));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (activeTab !== DEFAULT_TAB) {
      next.set("tab", activeTab);
    }
    if (timeline !== DEFAULT_TIMELINE) {
      next.set("timeline", timeline);
    }
    next.set("from_date", fromDate);
    next.set("to_date", toDate);
    if (vendorFilter) {
      next.set("vendor", vendorFilter);
    }
    if (inspectorFilter) {
      next.set("inspector", inspectorFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    activeTab,
    fromDate,
    inspectorFilter,
    searchParams,
    setSearchParams,
    syncedQuery,
    timeline,
    toDate,
    vendorFilter,
  ]);

  const combinedVendorOptions = useMemo(
    () => mergeTextOptions(
      vendorOptions,
      summaryReport?.filters?.vendor_options,
      detailedReport?.filters?.vendor_options,
      vendorFilter ? [vendorFilter] : [],
    ),
    [
      detailedReport?.filters?.vendor_options,
      summaryReport?.filters?.vendor_options,
      vendorFilter,
      vendorOptions,
    ],
  );

  const inspectorOptions = useMemo(
    () => mergeInspectorOptions(
      detailedReport?.filters?.inspector_options,
      inspectorFilter
        ? [{ _id: inspectorFilter, name: "Selected Inspector" }]
        : [],
    ),
    [detailedReport?.filters?.inspector_options, inspectorFilter],
  );

  const activeSummary = useMemo(
    () => summaryReport?.summary || createDefaultSummaryReport().summary,
    [summaryReport?.summary],
  );

  const activeDetailedSummary = useMemo(
    () => detailedReport?.summary || createDefaultDetailedReport().summary,
    [detailedReport?.summary],
  );

  const selectedInspectorLabel = useMemo(() => {
    if (!inspectorFilter) return "all";
    return (
      inspectorOptions.find((option) => option._id === inspectorFilter)?.name
      || "selected"
    );
  }, [inspectorFilter, inspectorOptions]);

  const activeError = activeTab === "summary" ? summaryError : detailedError;

  const handleSummarySortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        summarySortBy,
        summarySortOrder,
        column,
        defaultDirection,
      );
      setSummarySortBy(nextSortState.sortBy);
      setSummarySortOrder(nextSortState.sortOrder);
    },
    [summarySortBy, summarySortOrder],
  );

  const handleDetailSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        detailSortBy,
        detailSortOrder,
        column,
        defaultDirection,
      );
      setDetailSortBy(nextSortState.sortBy);
      setDetailSortOrder(nextSortState.sortOrder);
    },
    [detailSortBy, detailSortOrder],
  );

  const sortedSummaryInspectors = useMemo(
    () =>
      sortClientRows(summaryReport.inspectors, {
        sortBy: summarySortBy,
        sortOrder: summarySortOrder,
        getSortValue: (entry, column) => {
          if (column === "inspector") return entry?.inspector_name;
          if (column === "inspectionCount") return Number(entry?.inspection_count || 0);
          if (column === "passedQuantity") {
            return Number(entry?.inspected_quantity || 0);
          }
          if (column === "cbm") return Number(entry?.inspected_cbm || 0);
          return "";
        },
      }),
    [summaryReport.inspectors, summarySortBy, summarySortOrder],
  );
  const activeLoading = activeTab === "summary" ? loadingSummary : loadingDetailed;

  const handleTimelineChange = (nextTimelineValue) => {
    const normalizedTimeline = normalizeTimeline(nextTimelineValue);
    setDraftTimeline(normalizedTimeline);

    if (normalizedTimeline !== "custom") {
      const nextRange = getDateRangeFromTimeline(normalizedTimeline);
      setDraftFromDate(nextRange.from_date);
      setDraftToDate(nextRange.to_date);
    }
  };

  const handleCustomFromDateChange = (value) => {
    setDraftTimeline("custom");
    setDraftFromDate(normalizeDateFilter(value, draftFromDate));
  };

  const handleCustomToDateChange = (value) => {
    setDraftTimeline("custom");
    setDraftToDate(normalizeDateFilter(value, draftToDate));
  };

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setTimeline(normalizeTimeline(draftTimeline));
    setFromDate(normalizeDateFilter(draftFromDate, fromDate));
    setToDate(normalizeDateFilter(draftToDate, toDate));
    setVendorFilter(normalizeEntityFilter(draftVendorFilter));
    setInspectorFilter(normalizeEntityFilter(draftInspectorFilter));
  };

  const handleClearFilters = () => {
    const defaultRange = getDateRangeFromTimeline(DEFAULT_TIMELINE);
    setDraftTimeline(DEFAULT_TIMELINE);
    setDraftFromDate(defaultRange.from_date);
    setDraftToDate(defaultRange.to_date);
    setDraftVendorFilter("");
    setDraftInspectorFilter("");
    setTimeline(DEFAULT_TIMELINE);
    setFromDate(defaultRange.from_date);
    setToDate(defaultRange.to_date);
    setVendorFilter("");
    setInspectorFilter("");
  };

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
          <h2 className="h4 mb-0">Vendor Wise QA Performance Report</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-column gap-3">
            <ul className="nav nav-tabs vendor-wise-qa-tabs">
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${activeTab === "summary" ? "active" : ""}`}
                  onClick={() => setActiveTab("summary")}
                >
                  Summary
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${activeTab === "detailed" ? "active" : ""}`}
                  onClick={() => setActiveTab("detailed")}
                >
                  Detailed
                </button>
              </li>
            </ul>

            <form className="d-flex flex-wrap gap-2 align-items-end" onSubmit={handleApplyFilters}>
              <div>
                <label className="form-label mb-1">Timeline</label>
                <select
                  className="form-select"
                  value={draftTimeline}
                  onChange={(e) => handleTimelineChange(e.target.value)}
                >
                  <option value="1m">Last 1 month</option>
                  <option value="3m">Last 3 months</option>
                  <option value="6m">Last 6 months</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>

              <div>
                <label className="form-label mb-1">From</label>
                <input
                  type="date"
                  className="form-control"
                  value={draftFromDate}
                  max={draftToDate}
                  onChange={(e) => handleCustomFromDateChange(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label mb-1">To</label>
                <input
                  type="date"
                  className="form-control"
                  value={draftToDate}
                  min={draftFromDate}
                  onChange={(e) => handleCustomToDateChange(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label mb-1">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(e) => setDraftVendorFilter(normalizeEntityFilter(e.target.value))}
                  disabled={loadingVendorOptions}
                >
                  <option value="">
                    {activeTab === "summary" ? "Select Vendor" : "All Vendors"}
                  </option>
                  {combinedVendorOptions.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              {activeTab === "detailed" && (
                <div>
                  <label className="form-label mb-1">Inspector</label>
                  <select
                    className="form-select"
                    value={draftInspectorFilter}
                    onChange={(e) => setDraftInspectorFilter(normalizeEntityFilter(e.target.value))}
                  >
                    <option value="">All Inspectors</option>
                    {inspectorOptions.map((option) => (
                      <option key={option._id} value={option._id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={activeLoading}
              >
                {activeLoading ? "Loading..." : "Apply"}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleClearFilters}
                disabled={activeLoading}
              >
                Clear
              </button>
            </form>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">
              Range: {formatDateDDMMYYYY(fromDate)} - {formatDateDDMMYYYY(toDate)}
            </span>
            <span className="om-summary-chip">
              Vendor: {vendorFilter || (activeTab === "summary" ? "required" : "all")}
            </span>

            {activeTab === "summary" ? (
              <>
                <span className="om-summary-chip">
                  Inspectors: {activeSummary.inspectors_count ?? 0}
                </span>
                <span className="om-summary-chip">
                  Inspections: {activeSummary.inspection_count ?? 0}
                </span>
                <span className="om-summary-chip">
                  Passed Qty: {formatMetric(activeSummary.inspected_quantity)}
                </span>
                <span className="om-summary-chip">
                  CBM: {formatCbm(activeSummary.inspected_cbm)}
                </span>
              </>
            ) : (
              <>
                <span className="om-summary-chip">
                  Inspector: {selectedInspectorLabel}
                </span>
                <span className="om-summary-chip">
                  Vendors: {activeDetailedSummary.vendors_count ?? 0}
                </span>
                <span className="om-summary-chip">
                  Brand Tables: {activeDetailedSummary.brand_tables_count ?? 0}
                </span>
                <span className="om-summary-chip">
                  Inspections: {activeDetailedSummary.total_inspections ?? 0}
                </span>
                <span className="om-summary-chip">
                  Passed Qty: {formatMetric(activeDetailedSummary.total_passed_quantity)}
                </span>
                <span className="om-summary-chip">
                  CBM: {formatCbm(activeDetailedSummary.total_cbm)}
                </span>
              </>
            )}
          </div>
        </div>

        {activeError && (
          <div className="alert alert-danger mb-3" role="alert">
            {activeError}
          </div>
        )}

        {activeTab === "summary" ? (
          !vendorFilter ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                Select a vendor to load the summary tab.
              </div>
            </div>
          ) : loadingSummary ? (
            <div className="card om-card">
              <div className="card-body text-secondary">Loading summary report...</div>
            </div>
          ) : summaryReport.inspectors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No QA records found for the selected vendor and date range.
              </div>
            </div>
          ) : (
            <div className="card om-card">
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0 vendor-wise-qa-table">
                    <thead>
                      <tr>
                        <th>
                          <SortHeaderButton
                            label="Inspector"
                            isActive={summarySortBy === "inspector"}
                            direction={summarySortOrder}
                            onClick={() => handleSummarySortColumn("inspector", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspection Count"
                            isActive={summarySortBy === "inspectionCount"}
                            direction={summarySortOrder}
                            onClick={() => handleSummarySortColumn("inspectionCount", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Passed Quantity"
                            isActive={summarySortBy === "passedQuantity"}
                            direction={summarySortOrder}
                            onClick={() => handleSummarySortColumn("passedQuantity", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="CBM"
                            isActive={summarySortBy === "cbm"}
                            direction={summarySortOrder}
                            onClick={() => handleSummarySortColumn("cbm", "desc")}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSummaryInspectors.map((entry) => (
                        <tr key={entry?.inspector_id || entry?.inspector_name || "inspector"}>
                          <td>{entry?.inspector_name || "Unassigned"}</td>
                          <td>{entry?.inspection_count ?? 0}</td>
                          <td>{formatMetric(entry?.inspected_quantity)}</td>
                          <td>{formatCbm(entry?.inspected_cbm)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        ) : loadingDetailed ? (
          <div className="card om-card">
            <div className="card-body text-secondary">Loading detailed report...</div>
          </div>
        ) : detailedReport.vendors.length === 0 ? (
          <div className="card om-card">
            <div className="card-body text-secondary">
              No QA records found for the selected filters.
            </div>
          </div>
        ) : (
          <div className="d-grid gap-3">
            {detailedReport.vendors.map((vendorEntry, vendorIndex) => {
              const vendorKey = String(vendorEntry?.vendor || "").trim() || `vendor-${vendorIndex}`;
              const brandTables = Array.isArray(vendorEntry?.brand_tables)
                ? vendorEntry.brand_tables
                : [];

              return (
                <div key={vendorKey} className="card om-card">
                  <div className="card-body p-0">
                    <div className="px-3 py-2 border-bottom">
                      <span className="fw-semibold">Vendor: {vendorEntry?.vendor || "N/A"}</span>
                    </div>

                    <div className="d-grid gap-3 p-3">
                      {brandTables.length === 0 ? (
                        <div className="text-secondary">No brand tables for this vendor.</div>
                      ) : (
                        brandTables.map((brandTable, brandIndex) => {
                          const brandKey = `${vendorKey}-${String(brandTable?.brand || "").trim() || brandIndex}`;
                          const rows = Array.isArray(brandTable?.rows) ? brandTable.rows : [];
                          const sortedRows = sortClientRows(rows, {
                            sortBy: detailSortBy,
                            sortOrder: detailSortOrder,
                            getSortValue: (row, column) => {
                              if (column === "inspector") return row?.inspector_name;
                              if (column === "requestDate") {
                                return new Date(row?.request_date || 0).getTime();
                              }
                              if (column === "inspectionDate") {
                                return new Date(row?.inspection_date || 0).getTime();
                              }
                              if (column === "orderId") return row?.order_id;
                              if (column === "itemCode") return row?.item_code;
                              if (column === "requestedQuantity") {
                                return Number(row?.requested_quantity || 0);
                              }
                              if (column === "passedQuantity") {
                                return Number(row?.passed_quantity || 0);
                              }
                              if (column === "itemCbm") return Number(row?.item_cbm || 0);
                              if (column === "packedCbm") return Number(row?.packed_cbm || 0);
                              return "";
                            },
                          });

                          return (
                            <div key={brandKey} className="border rounded-3 overflow-hidden">
                              <div className="px-3 py-2 border-bottom bg-body-tertiary d-flex flex-wrap gap-2 align-items-center">
                                <span className="fw-semibold">Brand: {brandTable?.brand || "N/A"}</span>
                                <span className="om-summary-chip">
                                  Rows: {rows.length}
                                </span>
                              </div>

                              <div className="table-responsive">
                                <table className="table table-sm table-striped align-middle mb-0 vendor-wise-qa-table">
                                  <thead>
                                    <tr>
                                      <th>
                                        <SortHeaderButton
                                          label="Inspector"
                                          isActive={detailSortBy === "inspector"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("inspector", "asc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="Request Date"
                                          isActive={detailSortBy === "requestDate"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("requestDate", "desc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="Inspection Date"
                                          isActive={detailSortBy === "inspectionDate"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("inspectionDate", "desc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="PO"
                                          isActive={detailSortBy === "orderId"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("orderId", "asc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="Item Code"
                                          isActive={detailSortBy === "itemCode"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("itemCode", "asc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="Req Qty"
                                          isActive={detailSortBy === "requestedQuantity"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("requestedQuantity", "desc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="Passed Qty"
                                          isActive={detailSortBy === "passedQuantity"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("passedQuantity", "desc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="Item CBM"
                                          isActive={detailSortBy === "itemCbm"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("itemCbm", "desc")}
                                        />
                                      </th>
                                      <th>
                                        <SortHeaderButton
                                          label="Packed CBM"
                                          isActive={detailSortBy === "packedCbm"}
                                          direction={detailSortOrder}
                                          onClick={() => handleDetailSortColumn("packedCbm", "desc")}
                                        />
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sortedRows.length === 0 && (
                                      <tr>
                                        <td colSpan="9" className="text-center py-3">
                                          No rows found for this brand.
                                        </td>
                                      </tr>
                                    )}
                                    {sortedRows.map((row, rowIndex) => (
                                      <tr key={`${brandKey}-${row?.order_id || "po"}-${row?.item_code || "item"}-${rowIndex}`}>
                                        <td>{row?.inspector_name || "Unassigned"}</td>
                                        <td>{formatDateDDMMYYYY(row?.request_date)}</td>
                                        <td>{formatDateDDMMYYYY(row?.inspection_date)}</td>
                                        <td>{row?.order_id || "N/A"}</td>
                                        <td>{row?.item_code || "N/A"}</td>
                                        <td>{formatMetric(row?.requested_quantity)}</td>
                                        <td>{formatMetric(row?.passed_quantity)}</td>
                                        <td>{formatCbm(row?.item_cbm)}</td>
                                        <td>{formatCbm(row?.packed_cbm)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              <div className="px-3 py-2 border-top d-flex flex-wrap gap-2">
                                <span className="om-summary-chip">
                                  Total Inspections: {brandTable?.totals?.total_inspections ?? 0}
                                </span>
                                <span className="om-summary-chip">
                                  Total Requested Qty: {formatMetric(brandTable?.totals?.total_requested_quantity)}
                                </span>
                                <span className="om-summary-chip">
                                  Total Passed Qty: {formatMetric(brandTable?.totals?.total_passed_quantity)}
                                </span>
                                <span className="om-summary-chip">
                                  Total CBM: {formatCbm(brandTable?.totals?.total_cbm)}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

export default VendorWiseQAReport;
