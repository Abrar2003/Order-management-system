import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
const REPORT_TIMELINE_DAYS = Object.freeze({
  "1m": 30,
  "3m": 90,
  "6m": 180,
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

    setTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
    setFromDate((prev) => (prev === nextDateRange.from_date ? prev : nextDateRange.from_date));
    setToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setInspectorFilter((prev) => (
      prev === nextInspectorFilter ? prev : nextInspectorFilter
    ));
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

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
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
                              <tr key={`${entry?.inspector?._id || "inspector"}-day-${row.date}`}>
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
                                key={`${entry?.inspector?._id || "inspector"}-week-${row.week_start}`}
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
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default InspectorReports;
