import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_TIMELINE = "1m";
const DEFAULT_CUSTOM_DAYS = 30;

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

const formatCbm = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
};

const defaultReport = {
  filters: {
    timeline: DEFAULT_TIMELINE,
    custom_days: null,
    from_date: "",
    to_date: "",
  },
  summary: {
    inspectors_count: 0,
    inspections_count: 0,
    total_checked: 0,
    total_passed: 0,
    total_inspected_cbm: 0,
  },
  inspectors: [],
  daily_totals: [],
  weekly_totals: [],
};

const InspectorReports = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "inspector-reports");

  const [timeline, setTimeline] = useState(() =>
    normalizeTimeline(searchParams.get("timeline")),
  );
  const [customDays, setCustomDays] = useState(() =>
    parseCustomDays(searchParams.get("custom_days")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = { timeline };
      if (timeline === "custom") {
        params.custom_days = customDays;
      }

      const response = await api.get("/qc/reports/inspectors", { params });
      const responseData = response?.data || {};

      setReport({
        filters: responseData?.filters || defaultReport.filters,
        summary: responseData?.summary || defaultReport.summary,
        inspectors: Array.isArray(responseData?.inspectors)
          ? responseData.inspectors
          : [],
        daily_totals: Array.isArray(responseData?.daily_totals)
          ? responseData.daily_totals
          : [],
        weekly_totals: Array.isArray(responseData?.weekly_totals)
          ? responseData.weekly_totals
          : [],
      });
    } catch (err) {
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load inspector reports.");
    } finally {
      setLoading(false);
    }
  }, [customDays, timeline]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextTimeline = normalizeTimeline(searchParams.get("timeline"));
    const nextCustomDays = parseCustomDays(searchParams.get("custom_days"));

    setTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
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
    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [customDays, searchParams, setSearchParams, syncedQuery, timeline]);

  const summary = useMemo(
    () => report?.summary || defaultReport.summary,
    [report?.summary],
  );

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

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
                onChange={(e) => setTimeline(normalizeTimeline(e.target.value))}
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
                  onChange={(e) => setCustomDays(parseCustomDays(e.target.value))}
                />
              </div>
            )}

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
              Inspectors: {summary.inspectors_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Inspections: {summary.inspections_count ?? 0}
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

        <div className="row g-3 mb-3">
          <div className="col-12 col-lg-6">
            <div className="card om-card h-100">
              <div className="card-body p-0">
                <div className="px-3 py-2 border-bottom">
                  <h3 className="h6 mb-0">Daily Totals</h3>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Checked</th>
                        <th>Passed</th>
                        <th>Inspections</th>
                        <th>CBM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.daily_totals.length === 0 && (
                        <tr>
                          <td colSpan="5" className="text-center py-3">
                            No daily records in selected range.
                          </td>
                        </tr>
                      )}
                      {report.daily_totals.map((row) => (
                        <tr key={`daily-${row.date}`}>
                          <td>{formatDateDDMMYYYY(row.date)}</td>
                          <td>{row.checked_quantity ?? 0}</td>
                          <td>{row.passed_quantity ?? 0}</td>
                          <td>{row.inspections_count ?? 0}</td>
                          <td>{formatCbm(row.inspected_cbm)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-lg-6">
            <div className="card om-card h-100">
              <div className="card-body p-0">
                <div className="px-3 py-2 border-bottom">
                  <h3 className="h6 mb-0">Weekly Totals</h3>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Week Start</th>
                        <th>Checked</th>
                        <th>Passed</th>
                        <th>Inspections</th>
                        <th>CBM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.weekly_totals.length === 0 && (
                        <tr>
                          <td colSpan="5" className="text-center py-3">
                            No weekly records in selected range.
                          </td>
                        </tr>
                      )}
                      {report.weekly_totals.map((row) => (
                        <tr key={`weekly-${row.week_start}`}>
                          <td>{formatDateDDMMYYYY(row.week_start)}</td>
                          <td>{row.checked_quantity ?? 0}</td>
                          <td>{row.passed_quantity ?? 0}</td>
                          <td>{row.inspections_count ?? 0}</td>
                          <td>{formatCbm(row.inspected_cbm)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="d-grid gap-3">
          {report.inspectors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No inspector activity found for this range.
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
                    <div className="col-12 col-lg-6 border-end-lg">
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
                              <th>Checked</th>
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
                                <td>{row.checked_quantity ?? 0}</td>
                                <td>{row.passed_quantity ?? 0}</td>
                                <td>{row.inspections_count ?? 0}</td>
                                <td>{formatCbm(row.inspected_cbm)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="col-12 col-lg-6">
                      <div className="table-responsive">
                        <table className="table table-sm table-striped align-middle mb-0">
                          <thead>
                            <tr>
                              <th colSpan="5" className="bg-body-tertiary">
                                Weekly
                              </th>
                            </tr>
                            <tr>
                              <th>Week Start</th>
                              <th>Checked</th>
                              <th>Passed</th>
                              <th>Inspections</th>
                              <th>CBM</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(Array.isArray(entry?.weekly) ? entry.weekly : []).length === 0 && (
                              <tr>
                                <td colSpan="5" className="text-center py-3">
                                  No weekly data.
                                </td>
                              </tr>
                            )}
                            {(Array.isArray(entry?.weekly) ? entry.weekly : []).map((row) => (
                              <tr
                                key={`${entry?.inspector?._id || "inspector"}-week-${row.week_start}`}
                              >
                                <td>{formatDateDDMMYYYY(row.week_start)}</td>
                                <td>{row.checked_quantity ?? 0}</td>
                                <td>{row.passed_quantity ?? 0}</td>
                                <td>{row.inspections_count ?? 0}</td>
                                <td>{formatCbm(row.inspected_cbm)}</td>
                              </tr>
                            ))}
                          </tbody>
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
