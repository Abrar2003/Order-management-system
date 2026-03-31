import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../api/axios";
import Navbar from "../components/Navbar";
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
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const monthYearFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

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

const toIsoDateUtc = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const addUtcDays = (date, days) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + Number(days || 0));
  return nextDate;
};

const addUtcMonths = (date, months) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + Number(months || 0),
    1,
  ));
};

const endOfUtcMonth = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0,
  ));
};

const formatShortDateLabel = (value) => {
  const formatted = formatDateDDMMYYYY(value, "");
  if (!formatted) return "";
  return formatted.slice(0, 5);
};

const createDailyCbmMap = (dailyRows = []) => {
  const dateMap = new Map();

  for (const row of Array.isArray(dailyRows) ? dailyRows : []) {
    const isoDate = toISODateString(row?.date);
    if (!isoDate) continue;
    dateMap.set(isoDate, Number(row?.inspected_cbm || 0));
  }

  return dateMap;
};

const buildDailyChartData = ({ dailyRows = [], fromDate = "", toDate = "" } = {}) => {
  const startDate = parseIsoDateUtc(fromDate);
  const endDate = parseIsoDateUtc(toDate);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const cbmByDate = createDailyCbmMap(dailyRows);
  const points = [];

  for (
    let cursor = new Date(startDate);
    cursor.getTime() <= endDate.getTime();
    cursor = addUtcDays(cursor, 1)
  ) {
    const isoDate = toIsoDateUtc(cursor);
    points.push({
      key: isoDate,
      label: formatShortDateLabel(isoDate) || isoDate,
      tooltipLabel: formatDateDDMMYYYY(isoDate),
      cbm: Number(cbmByDate.get(isoDate) || 0),
    });
  }

  return points;
};

const buildWeeklyChartData = ({ dailyRows = [], fromDate = "", toDate = "" } = {}) => {
  const startDate = parseIsoDateUtc(fromDate);
  const endDate = parseIsoDateUtc(toDate);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const cbmByDate = createDailyCbmMap(dailyRows);
  const points = [];
  let weekIndex = 0;

  for (
    let bucketStart = new Date(startDate);
    bucketStart.getTime() <= endDate.getTime();
    bucketStart = addUtcDays(bucketStart, 7)
  ) {
    const bucketEnd = addUtcDays(bucketStart, 6);
    const effectiveEnd = bucketEnd && bucketEnd.getTime() < endDate.getTime()
      ? bucketEnd
      : endDate;

    let totalCbm = 0;
    for (
      let cursor = new Date(bucketStart);
      cursor.getTime() <= effectiveEnd.getTime();
      cursor = addUtcDays(cursor, 1)
    ) {
      totalCbm += Number(cbmByDate.get(toIsoDateUtc(cursor)) || 0);
    }

    const bucketStartIso = toIsoDateUtc(bucketStart);
    const effectiveEndIso = toIsoDateUtc(effectiveEnd);
    points.push({
      key: `${bucketStartIso}-${effectiveEndIso}`,
      label: formatShortDateLabel(bucketStartIso) || `W${weekIndex + 1}`,
      tooltipLabel: `${formatDateDDMMYYYY(bucketStartIso)} - ${formatDateDDMMYYYY(effectiveEndIso)}`,
      cbm: Number(totalCbm.toFixed(3)),
    });
    weekIndex += 1;
  }

  return points;
};

const buildMonthlyChartData = ({ dailyRows = [], fromDate = "", toDate = "" } = {}) => {
  const startDate = parseIsoDateUtc(fromDate);
  const endDate = parseIsoDateUtc(toDate);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const cbmByDate = createDailyCbmMap(dailyRows);
  const points = [];

  for (
    let monthCursor = new Date(Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      1,
    ));
    monthCursor.getTime() <= endDate.getTime();
    monthCursor = addUtcMonths(monthCursor, 1)
  ) {
    const monthStart = monthCursor.getTime() < startDate.getTime()
      ? startDate
      : monthCursor;
    const monthEndCandidate = endOfUtcMonth(monthCursor);
    const monthEnd = monthEndCandidate && monthEndCandidate.getTime() < endDate.getTime()
      ? monthEndCandidate
      : endDate;

    let totalCbm = 0;
    for (
      let cursor = new Date(monthStart);
      cursor.getTime() <= monthEnd.getTime();
      cursor = addUtcDays(cursor, 1)
    ) {
      totalCbm += Number(cbmByDate.get(toIsoDateUtc(cursor)) || 0);
    }

    const monthStartIso = toIsoDateUtc(monthStart);
    const monthEndIso = toIsoDateUtc(monthEnd);
    points.push({
      key: `${monthStartIso}-${monthEndIso}`,
      label: monthYearFormatter.format(monthCursor),
      tooltipLabel: `${formatDateDDMMYYYY(monthStartIso)} - ${formatDateDDMMYYYY(monthEndIso)}`,
      cbm: Number(totalCbm.toFixed(3)),
    });
  }

  return points;
};

const buildInspectorChartData = ({
  dailyRows = [],
  fromDate = "",
  toDate = "",
  chartStep = DEFAULT_CHART_STEP,
} = {}) => {
  if (chartStep === "daily") {
    return buildDailyChartData({ dailyRows, fromDate, toDate });
  }

  if (chartStep === "monthly") {
    return buildMonthlyChartData({ dailyRows, fromDate, toDate });
  }

  return buildWeeklyChartData({ dailyRows, fromDate, toDate });
};

const getChartAxisMax = (chartData = []) => {
  const maxCbm = Math.max(
    0,
    ...chartData.map((point) => Number(point?.cbm || 0)),
  );

  return Math.max(0.05, Math.ceil(maxCbm / 0.05) * 0.05);
};

const getChartTicks = (axisMax) => {
  const safeMax = Math.max(0.05, Number(axisMax || 0));
  const ticks = [];

  for (let value = 0; value <= safeMax + 0.000001; value += 0.05) {
    ticks.push(Number(value.toFixed(2)));
  }

  return ticks;
};

const InspectorCbmTooltip = ({ active, payload }) => {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="inspector-report-chart-tooltip">
      <div className="fw-semibold">{point.tooltipLabel || point.label}</div>
      <div>CBM: {formatCbm(point.cbm)}</div>
    </div>
  );
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

  const [timeline, setTimeline] = useState(() =>
    initialTimeline,
  );
  const [customDays, setCustomDays] = useState(() =>
    initialCustomDays,
  );
  const [fromDate, setFromDate] = useState(() => initialDateRange.from_date);
  const [toDate, setToDate] = useState(() => initialDateRange.to_date);
  const [inspectorFilter, setInspectorFilter] = useState(() =>
    normalizeInspectorFilter(searchParams.get("inspector")),
  );
  const [chartStep, setChartStep] = useState(() =>
    normalizeChartStep(searchParams.get("chart_step")),
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
    setCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
    setFromDate((prev) => (prev === nextDateRange.from_date ? prev : nextDateRange.from_date));
    setToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setInspectorFilter((prev) => (
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

  const summary = useMemo(
    () => report?.summary || defaultReport.summary,
    [report?.summary],
  );

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

  const selectedInspectorLabel = useMemo(() => {
    if (inspectorFilter === DEFAULT_INSPECTOR_FILTER) {
      return "all";
    }

    const matchedInspector = (Array.isArray(filters.inspector_options)
      ? filters.inspector_options
      : []
    ).find((option) => String(option?._id || "") === inspectorFilter);

    return matchedInspector?.name || "selected";
  }, [filters.inspector_options, inspectorFilter]);

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
          <h2 className="h4 mb-0">Inspector Reports</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-end">
            <div>
              <label className="form-label mb-1">Timeline</label>
              <select
                className="form-select"
                value={timeline}
                onChange={(e) => {
                  const nextTimeline = normalizeTimeline(e.target.value);
                  const nextRange = getDateRangeFromTimeline(nextTimeline, customDays);
                  setTimeline(nextTimeline);
                  setFromDate(nextRange.from_date);
                  setToDate(nextRange.to_date);
                }}
              >
                <option value="1m">Last 1 month</option>
                <option value="3m">Last 3 months</option>
                <option value="6m">Last 6 months</option>
                <option value="custom">Last custom days</option>
              </select>
            </div>

            {timeline === "custom" && (
              <div>
                <label className="form-label mb-1">Custom Days</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  className="form-control"
                  value={customDays}
                  onChange={(e) => {
                    const nextCustomDays = parseCustomDays(e.target.value);
                    setCustomDays(nextCustomDays);
                    if (timeline === "custom") {
                      const nextRange = getDateRangeFromTimeline("custom", nextCustomDays);
                      setFromDate(nextRange.from_date);
                      setToDate(nextRange.to_date);
                    }
                  }}
                />
              </div>
            )}

            <div>
              <label className="form-label mb-1">From</label>
              <input
                type="date"
                className="form-control"
                value={fromDate}
                max={toDate}
                onChange={(e) => setFromDate(normalizeDateFilter(e.target.value, fromDate))}
              />
            </div>

            <div>
              <label className="form-label mb-1">To</label>
              <input
                type="date"
                className="form-control"
                value={toDate}
                min={fromDate}
                onChange={(e) => setToDate(normalizeDateFilter(e.target.value, toDate))}
              />
            </div>

            <div>
              <label className="form-label mb-1">Inspector</label>
              <select
                className="form-select"
                value={inspectorFilter}
                onChange={(e) => setInspectorFilter(normalizeInspectorFilter(e.target.value))}
              >
                <option value={DEFAULT_INSPECTOR_FILTER}>All Inspectors</option>
                {(Array.isArray(filters.inspector_options) ? filters.inspector_options : []).map(
                  (option) => (
                    <option key={option._id} value={option._id}>
                      {option.name || "Unknown"}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label className="form-label mb-1">Chart Step</label>
              <select
                className="form-select"
                value={chartStep}
                onChange={(e) => setChartStep(normalizeChartStep(e.target.value))}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={fetchReports}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
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
              Chart: {chartStep}
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
            report.inspectors.map((entry) => (
              (() => {
                const inspectorId = entry?.inspector?._id || "inspector";
                const chartData = buildInspectorChartData({
                  dailyRows: entry?.daily,
                  fromDate: filters.from_date,
                  toDate: filters.to_date,
                  chartStep,
                });
                const chartAxisMax = getChartAxisMax(chartData);
                const chartTicks = getChartTicks(chartAxisMax);

                return (
                  <div
                    key={entry?.inspector?._id || entry?.inspector?.name}
                    className="card om-card"
                  >
                    <div className="card-body p-0">
                      <div className="px-3 py-2 border-bottom d-flex flex-wrap gap-2">
                        <span className="fw-semibold">
                          Inspector: {entry?.inspector?.name || "Unassigned"}
                        </span>
                        <span className="om-summary-chip">
                          Orders Touched: {entry?.orders_touched ?? 0}
                        </span>
                        <span className="om-summary-chip">
                          Requested: {entry?.total_requested ?? 0}
                        </span>
                        <span className="om-summary-chip">
                          Checked: {entry?.total_checked ?? 0}
                        </span>
                        <span className="om-summary-chip">
                          Passed: {entry?.total_passed ?? 0}
                        </span>
                        <span className="om-summary-chip">
                          Inspections: {entry?.total_inspections ?? 0}
                        </span>
                        <span className="om-summary-chip">
                          CBM: {formatCbm(entry?.total_inspected_cbm)}
                        </span>
                      </div>

                      <div className="row g-0">
                        <div className="col-12 col-xxl-6 border-end-lg">
                          <div className="table-responsive">
                            <table className="table table-sm table-striped align-middle mb-0">
                              <thead>
                                <tr>
                                  <th colSpan="5" className="bg-body-tertiary">
                                    Daily
                                  </th>
                                </tr>
                                <tr>
                                  <th>Date</th>
                                  <th>Requested</th>
                                  <th>Passed</th>
                                  <th>Inspections</th>
                                  <th>CBM</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(entry?.daily) ? entry.daily : []).length === 0 && (
                                  <tr>
                                    <td colSpan="5" className="text-center py-3">
                                      No daily data.
                                    </td>
                                  </tr>
                                )}
                                {(Array.isArray(entry?.daily) ? entry.daily : []).map((row) => (
                                  <tr key={`${inspectorId}-day-${row.date}`}>
                                    <td>{formatDateDDMMYYYY(row.date)}</td>
                                    <td>{row.requested_quantity ?? 0}</td>
                                    <td>{row.passed_quantity ?? 0}</td>
                                    <td>{row.inspections_count ?? 0}</td>
                                    <td>{formatCbm(row.inspected_cbm)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              {(Array.isArray(entry?.daily) ? entry.daily : []).length > 0 && (
                                <tfoot>
                                  <tr className="table-secondary">
                                    <th>Total</th>
                                    <th>{entry?.total_requested ?? 0}</th>
                                    <th>{entry?.total_passed ?? 0}</th>
                                    <th>{entry?.total_inspections ?? 0}</th>
                                    <th>{formatCbm(entry?.total_inspected_cbm)}</th>
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                          </div>
                        </div>

                        <div className="col-12 col-xxl-6">
                          <div className="table-responsive">
                            <table className="table table-sm table-striped align-middle mb-0">
                              <thead>
                                <tr>
                                  <th colSpan="6" className="bg-body-tertiary">
                                    Weekly
                                  </th>
                                </tr>
                                <tr>
                                  <th>Week Start</th>
                                  <th>Week End</th>
                                  <th>Requested</th>
                                  <th>Passed</th>
                                  <th>Inspections</th>
                                  <th>CBM</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(Array.isArray(entry?.weekly) ? entry.weekly : []).length === 0 && (
                                  <tr>
                                    <td colSpan="6" className="text-center py-3">
                                      No weekly data.
                                    </td>
                                  </tr>
                                )}
                                {(Array.isArray(entry?.weekly) ? entry.weekly : []).map((row) => (
                                  <tr
                                    key={`${inspectorId}-week-${row.week_start}`}
                                  >
                                    <td>{formatDateDDMMYYYY(row.week_start)}</td>
                                    <td>{formatDateDDMMYYYY(row.week_end)}</td>
                                    <td>{row.requested_quantity ?? 0}</td>
                                    <td>{row.passed_quantity ?? 0}</td>
                                    <td>{row.inspections_count ?? 0}</td>
                                    <td>{formatCbm(row.inspected_cbm)}</td>
                                  </tr>
                                ))}
                              </tbody>
                              {(Array.isArray(entry?.weekly) ? entry.weekly : []).length > 0 && (
                                <tfoot>
                                  <tr className="table-secondary">
                                    <th colSpan="2">Total</th>
                                    <th>{entry?.total_requested ?? 0}</th>
                                    <th>{entry?.total_passed ?? 0}</th>
                                    <th>{entry?.total_inspections ?? 0}</th>
                                    <th>{formatCbm(entry?.total_inspected_cbm)}</th>
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                          </div>
                        </div>
                      </div>

                      <div className="border-top px-3 py-3">
                        <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
                          <span className="fw-semibold">CBM Trend</span>
                          <span className="om-summary-chip">
                            Step: {chartStep}
                          </span>
                          <span className="om-summary-chip">
                            Y-axis step: 0.05
                          </span>
                        </div>

                        <div className="inspector-report-chart-wrap">
                          <ResponsiveContainer width="100%" height={320}>
                            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                dataKey="label"
                                minTickGap={20}
                                tick={{ fontSize: 12 }}
                              />
                              <YAxis
                                domain={[0, chartAxisMax]}
                                ticks={chartTicks}
                                interval="preserveStartEnd"
                                tick={{ fontSize: 12 }}
                                tickFormatter={(value) => Number(value).toFixed(2)}
                                width={56}
                              />
                              <Tooltip content={<InspectorCbmTooltip />} />
                              <Line
                                type="monotone"
                                dataKey="cbm"
                                name="CBM"
                                stroke="var(--bs-primary)"
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4 }}
                                isAnimationActive={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default InspectorReports;
