import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import InspectorCard from "../components/reports/InspectorCard";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { formatCbm } from "../utils/cbm";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_TIMELINE = "1m";
const DEFAULT_CUSTOM_DAYS = 30;
const DEFAULT_INSPECTOR_FILTER = "all";
const DEFAULT_CHART_STEP = "weekly";
const REPORT_TIMELINE_DAYS = Object.freeze({
  "1m": 30,
  "3m": 90,
  "6m": 180,
});
const AUTO_WEEKLY_DAY_THRESHOLD = 90;
const INITIAL_VISIBLE_INSPECTORS = 5;
const LOAD_MORE_COUNT = 5;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const CHART_STEP_OPTIONS = Object.freeze([
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]);

const normalizeTimeline = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "1m" || normalized === "3m" || normalized === "6m") {
    return normalized;
  }
  if (normalized === "custom") return "custom";
  return DEFAULT_TIMELINE;
};

const parseCustomDays = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CUSTOM_DAYS;
  return Math.min(parsed, 3650);
};

const normalizeChartStep = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "daily" || normalized === "weekly" || normalized === "monthly") {
    return normalized;
  }
  return DEFAULT_CHART_STEP;
};

const normalizeInspectorFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_INSPECTOR_FILTER;

  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return DEFAULT_INSPECTOR_FILTER;
  }

  return normalized;
};

const normalizeDateFilter = (value, fallback = "") => toISODateString(value) || fallback;

const parseIsoDateUtc = (value) => {
  const isoValue = toISODateString(value);
  if (!isoValue) return null;

  const [year, month, day] = isoValue.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getInclusiveDayCount = (fromDate, toDate) => {
  const startDate = parseIsoDateUtc(fromDate);
  const endDate = parseIsoDateUtc(toDate);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return 0;
  }

  return Math.floor((endDate.getTime() - startDate.getTime()) / DAY_IN_MS) + 1;
};

const getDateRangeFromTimeline = (timelineValue, customDaysValue) => {
  const normalizedTimeline = normalizeTimeline(timelineValue);
  const days = normalizedTimeline === "custom"
    ? parseCustomDays(customDaysValue)
    : REPORT_TIMELINE_DAYS[normalizedTimeline];

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

const getDateRangeFromSearchParams = (searchParams, timelineValue, customDaysValue) => {
  const derivedRange = getDateRangeFromTimeline(timelineValue, customDaysValue);

  return {
    from_date: normalizeDateFilter(
      searchParams.get("from_date"),
      derivedRange.from_date,
    ),
    to_date: normalizeDateFilter(searchParams.get("to_date"), derivedRange.to_date),
  };
};

const defaultReport = {
  filters: {
    timeline: DEFAULT_TIMELINE,
    custom_days: null,
    from_date: "",
    to_date: "",
    inspector: "",
    inspector_options: [],
  },
  summary: {
    inspectors_count: 0,
    inspections_count: 0,
    total_requested: 0,
    total_checked: 0,
    total_passed: 0,
    total_inspected_cbm: 0,
  },
  inspectors: [],
};

const InspectorReports = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "inspector-reports");

  const initialTimeline = normalizeTimeline(searchParams.get("timeline"));
  const initialCustomDays = parseCustomDays(searchParams.get("custom_days"));
  const initialDateRange = getDateRangeFromSearchParams(
    searchParams,
    initialTimeline,
    initialCustomDays,
  );

  const [timeline, setTimeline] = useState(() => initialTimeline);
  const [draftTimeline, setDraftTimeline] = useState(() => initialTimeline);
  const [customDays, setCustomDays] = useState(() => initialCustomDays);
  const [draftCustomDays, setDraftCustomDays] = useState(() => initialCustomDays);
  const [fromDate, setFromDate] = useState(() => initialDateRange.from_date);
  const [draftFromDate, setDraftFromDate] = useState(() => initialDateRange.from_date);
  const [toDate, setToDate] = useState(() => initialDateRange.to_date);
  const [draftToDate, setDraftToDate] = useState(() => initialDateRange.to_date);
  const [inspectorFilter, setInspectorFilter] = useState(() =>
    normalizeInspectorFilter(searchParams.get("inspector")),
  );
  const [draftInspectorFilter, setDraftInspectorFilter] = useState(() =>
    normalizeInspectorFilter(searchParams.get("inspector")),
  );
  const [chartStep, setChartStep] = useState(() =>
    normalizeChartStep(searchParams.get("chart_step")),
  );
  const [visibleInspectorCount, setVisibleInspectorCount] = useState(
    INITIAL_VISIBLE_INSPECTORS,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      if (fromDate > toDate) {
        setReport(defaultReport);
        setError("From date cannot be later than To date.");
        return;
      }

      const params = {
        timeline,
        from_date: fromDate,
        to_date: toDate,
      };
      if (timeline === "custom") {
        params.custom_days = customDays;
      }
      if (inspectorFilter !== DEFAULT_INSPECTOR_FILTER) {
        params.inspector = inspectorFilter;
      }

      const response = await api.get("/qc/reports/inspectors", { params });
      const responseData = response?.data || {};

      setReport({
        filters: {
          ...defaultReport.filters,
          ...(responseData?.filters || {}),
        },
        summary: responseData?.summary || defaultReport.summary,
        inspectors: Array.isArray(responseData?.inspectors)
          ? responseData.inspectors
          : [],
      });
    } catch (err) {
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load inspector reports.");
    } finally {
      setLoading(false);
    }
  }, [customDays, fromDate, inspectorFilter, timeline, toDate]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextTimeline = normalizeTimeline(searchParams.get("timeline"));
    const nextCustomDays = parseCustomDays(searchParams.get("custom_days"));
    const nextDateRange = getDateRangeFromSearchParams(
      searchParams,
      nextTimeline,
      nextCustomDays,
    );
    const nextInspectorFilter = normalizeInspectorFilter(searchParams.get("inspector"));
    const nextChartStep = normalizeChartStep(searchParams.get("chart_step"));

    setTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setDraftTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
    setDraftCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
    setFromDate((prev) => (prev === nextDateRange.from_date ? prev : nextDateRange.from_date));
    setDraftFromDate((prev) => (prev === nextDateRange.from_date ? prev : nextDateRange.from_date));
    setToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setDraftToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setInspectorFilter((prev) => (
      prev === nextInspectorFilter ? prev : nextInspectorFilter
    ));
    setDraftInspectorFilter((prev) => (
      prev === nextInspectorFilter ? prev : nextInspectorFilter
    ));
    setChartStep((prev) => (prev === nextChartStep ? prev : nextChartStep));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (timeline !== DEFAULT_TIMELINE) {
      next.set("timeline", timeline);
    }
    if (timeline === "custom") {
      next.set("custom_days", String(customDays));
    }
    next.set("from_date", fromDate);
    next.set("to_date", toDate);
    if (inspectorFilter !== DEFAULT_INSPECTOR_FILTER) {
      next.set("inspector", inspectorFilter);
    }
    if (chartStep !== DEFAULT_CHART_STEP) {
      next.set("chart_step", chartStep);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    chartStep,
    customDays,
    fromDate,
    inspectorFilter,
    searchParams,
    setSearchParams,
    syncedQuery,
    timeline,
    toDate,
  ]);

  const rangeDayCount = useMemo(
    () => getInclusiveDayCount(fromDate, toDate),
    [fromDate, toDate],
  );

  const disableDailyStep = rangeDayCount >= AUTO_WEEKLY_DAY_THRESHOLD;

  useEffect(() => {
    if (disableDailyStep && chartStep === "daily") {
      setChartStep("weekly");
    }
  }, [chartStep, disableDailyStep]);

  useEffect(() => {
    setVisibleInspectorCount(INITIAL_VISIBLE_INSPECTORS);
  }, [report.inspectors]);

  const summary = useMemo(
    () => report?.summary || defaultReport.summary,
    [report?.summary],
  );

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

  const inspectorOptions = useMemo(
    () => (Array.isArray(filters.inspector_options) ? filters.inspector_options : []),
    [filters.inspector_options],
  );

  const selectedInspectorLabel = useMemo(() => {
    if (inspectorFilter === DEFAULT_INSPECTOR_FILTER) {
      return "all";
    }

    const matchedInspector = inspectorOptions.find(
      (option) => String(option?._id || "") === inspectorFilter,
    );

    return matchedInspector?.name || "selected";
  }, [inspectorFilter, inspectorOptions]);

  const visibleInspectors = useMemo(
    () => report.inspectors.slice(0, visibleInspectorCount),
    [report.inspectors, visibleInspectorCount],
  );

  const hasMoreInspectors = visibleInspectorCount < report.inspectors.length;

  const handleTimelineChange = useCallback((event) => {
    const nextTimeline = normalizeTimeline(event.target.value);
    const nextRange = getDateRangeFromTimeline(nextTimeline, draftCustomDays);
    setDraftTimeline(nextTimeline);
    setDraftFromDate(nextRange.from_date);
    setDraftToDate(nextRange.to_date);
  }, [draftCustomDays]);

  const handleCustomDaysChange = useCallback((event) => {
    const nextCustomDays = parseCustomDays(event.target.value);
    setDraftCustomDays(nextCustomDays);
    if (draftTimeline === "custom") {
      const nextRange = getDateRangeFromTimeline("custom", nextCustomDays);
      setDraftFromDate(nextRange.from_date);
      setDraftToDate(nextRange.to_date);
    }
  }, [draftTimeline]);

  const handleFromDateChange = useCallback((event) => {
    setDraftFromDate((prev) => normalizeDateFilter(event.target.value, prev));
  }, []);

  const handleToDateChange = useCallback((event) => {
    setDraftToDate((prev) => normalizeDateFilter(event.target.value, prev));
  }, []);

  const handleInspectorChange = useCallback((event) => {
    setDraftInspectorFilter(normalizeInspectorFilter(event.target.value));
  }, []);

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setTimeline(normalizeTimeline(draftTimeline));
    setCustomDays(parseCustomDays(draftCustomDays));
    setFromDate(normalizeDateFilter(draftFromDate, fromDate));
    setToDate(normalizeDateFilter(draftToDate, toDate));
    setInspectorFilter(normalizeInspectorFilter(draftInspectorFilter));
  }, [
    draftCustomDays,
    draftFromDate,
    draftInspectorFilter,
    draftTimeline,
    draftToDate,
    fromDate,
    toDate,
  ]);

  const handleClearFilters = useCallback(() => {
    const defaultCustomDays = DEFAULT_CUSTOM_DAYS;
    const defaultRange = getDateRangeFromTimeline(DEFAULT_TIMELINE, defaultCustomDays);
    setDraftTimeline(DEFAULT_TIMELINE);
    setDraftCustomDays(defaultCustomDays);
    setDraftFromDate(defaultRange.from_date);
    setDraftToDate(defaultRange.to_date);
    setDraftInspectorFilter(DEFAULT_INSPECTOR_FILTER);
    setTimeline(DEFAULT_TIMELINE);
    setCustomDays(defaultCustomDays);
    setFromDate(defaultRange.from_date);
    setToDate(defaultRange.to_date);
    setInspectorFilter(DEFAULT_INSPECTOR_FILTER);
  }, []);

  const handleChartStepChange = useCallback((value) => {
    const nextChartStep = normalizeChartStep(value);
    if (disableDailyStep && nextChartStep === "daily") {
      setChartStep("weekly");
      return;
    }
    setChartStep(nextChartStep);
  }, [disableDailyStep]);

  const handleLoadMore = useCallback(() => {
    setVisibleInspectorCount((prev) => Math.min(
      prev + LOAD_MORE_COUNT,
      report.inspectors.length,
    ));
  }, [report.inspectors.length]);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page inspector-report-page py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={handleBack}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Inspector Reports</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <form className="card-body d-flex flex-wrap gap-2 align-items-end" onSubmit={handleApplyFilters}>
            <div>
              <label className="form-label mb-1">Timeline</label>
              <select
                className="form-select"
                value={draftTimeline}
                onChange={handleTimelineChange}
              >
                <option value="1m">Last 1 month</option>
                <option value="3m">Last 3 months</option>
                <option value="6m">Last 6 months</option>
                <option value="custom">Last custom days</option>
              </select>
            </div>

            {draftTimeline === "custom" && (
              <div>
                <label className="form-label mb-1">Custom Days</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  className="form-control"
                  value={draftCustomDays}
                  onChange={handleCustomDaysChange}
                />
              </div>
            )}

            <div>
              <label className="form-label mb-1">From</label>
              <input
                type="date"
                className="form-control"
                value={draftFromDate}
                max={draftToDate}
                onChange={handleFromDateChange}
              />
            </div>

            <div>
              <label className="form-label mb-1">To</label>
              <input
                type="date"
                className="form-control"
                value={draftToDate}
                min={draftFromDate}
                onChange={handleToDateChange}
              />
            </div>

            <div>
              <label className="form-label mb-1">Inspector</label>
              <select
                className="form-select"
                value={draftInspectorFilter}
                onChange={handleInspectorChange}
              >
                <option value={DEFAULT_INSPECTOR_FILTER}>All Inspectors</option>
                {inspectorOptions.map((option) => (
                  <option key={option._id} value={option._id}>
                    {option.name || "Unknown"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label mb-1">Chart Step</label>
              <div
                className="om-report-step-group"
                role="group"
                aria-label="Inspector report chart step"
              >
                {CHART_STEP_OPTIONS.map((option) => {
                  const isDisabled = disableDailyStep && option.value === "daily";
                  const isActive = chartStep === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`om-report-step-btn${isActive ? " is-active" : ""}`}
                      onClick={() => handleChartStepChange(option.value)}
                      disabled={isDisabled}
                      aria-pressed={isActive}
                      title={
                        isDisabled
                          ? "Daily step is available only for shorter date ranges."
                          : `Show ${option.label.toLowerCase()} chart grouping`
                      }
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
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
              Range: {formatDateDDMMYYYY(filters.from_date)} - {formatDateDDMMYYYY(filters.to_date)}
            </span>
            <span className="om-summary-chip">
              Inspector: {selectedInspectorLabel}
            </span>
            <span className="om-summary-chip">
              Charts: line + bar / {chartStep}
            </span>
            <span className="om-summary-chip">
              Inspectors: {summary.inspectors_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Inspections: {summary.inspections_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Total Requested: {summary.total_requested ?? 0}
            </span>
            <span className="om-summary-chip">
              Total Checked: {summary.total_checked ?? 0}
            </span>
            <span className="om-summary-chip">
              Total Passed: {summary.total_passed ?? 0}
            </span>
            <span className="om-summary-chip">
              Total CBM: {formatCbm(summary.total_inspected_cbm)}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="d-grid gap-3">
          {report.inspectors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No inspector activity found for the selected filters.
              </div>
            </div>
          ) : (
            <>
              {visibleInspectors.map((entry, index) => (
                <InspectorCard
                  key={entry?.inspector?._id || entry?.inspector?.name || `inspector-${index}`}
                  entry={entry}
                  fromDate={filters.from_date}
                  toDate={filters.to_date}
                  chartStep={chartStep}
                />
              ))}

              {hasMoreInspectors && (
                <div className="d-flex justify-content-center">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={handleLoadMore}
                  >
                    Load More Inspectors ({report.inspectors.length - visibleInspectorCount} left)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default InspectorReports;
