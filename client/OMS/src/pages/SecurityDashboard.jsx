import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import { isStrictAdminRole } from "../auth/permissions";
import Navbar from "../components/Navbar";
import "../App.css";

const DEFAULT_LIMIT = 25;
const STATUS_OPTIONS = ["", "open", "acknowledged", "resolved", "dismissed"];
const SEVERITY_OPTIONS = ["", "medium", "high", "critical"];

const normalizeText = (value) => String(value ?? "").trim();

const formatDateTime = (value) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
};

const formatUser = (user, fallback = "") => {
  if (!user) return normalizeText(fallback) || "-";
  return (
    normalizeText(user.name) ||
    normalizeText(user.username) ||
    normalizeText(user.email) ||
    normalizeText(user._id) ||
    "-"
  );
};

const severityClass = (severity = "") => {
  const normalized = normalizeText(severity).toLowerCase();
  if (normalized === "critical") return "danger";
  if (normalized === "high") return "warning";
  if (normalized === "medium") return "info";
  return "secondary";
};

const buildQuery = (filters = {}) =>
  Object.entries(filters).reduce((params, [key, value]) => {
    const normalized = normalizeText(value);
    if (normalized) params[key] = normalized;
    return params;
  }, {});

const SecurityDashboard = () => {
  const { role } = usePermissions();
  const canViewSecurity = isStrictAdminRole(role);

  const [summary, setSummary] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertPagination, setAlertPagination] = useState(null);
  const [activity, setActivity] = useState([]);
  const [activityPagination, setActivityPagination] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [alertFilters, setAlertFilters] = useState({
    status: "open",
    severity: "",
    user: "",
    from: "",
    to: "",
  });
  const [activityFilters, setActivityFilters] = useState({
    user: "",
    action: "",
    resource_type: "",
    from: "",
    to: "",
    min_risk_score: "",
  });

  const summaryCards = useMemo(
    () => [
      {
        label: "Open alerts",
        value: summary?.open_alerts ?? 0,
        note: "Needs review",
      },
      {
        label: "High and critical",
        value: summary?.high_critical_open_alerts ?? 0,
        note: "Open severe alerts",
      },
      {
        label: "Activity 24h",
        value: summary?.activity_last_24h ?? 0,
        note: "Logged events",
      },
      {
        label: "Risky users",
        value: Array.isArray(summary?.top_risky_users)
          ? summary.top_risky_users.length
          : 0,
        note: "Last 24 hours",
      },
    ],
    [summary],
  );

  const loadSummary = useCallback(async () => {
    const response = await api.get("/security/summary");
    setSummary(response?.data?.data || null);
  }, []);

  const loadAlerts = useCallback(async () => {
    const response = await api.get("/security/alerts", {
      params: {
        ...buildQuery(alertFilters),
        limit: DEFAULT_LIMIT,
      },
    });
    setAlerts(Array.isArray(response?.data?.data) ? response.data.data : []);
    setAlertPagination(response?.data?.pagination || null);
  }, [alertFilters]);

  const loadActivity = useCallback(async () => {
    const response = await api.get("/security/activity", {
      params: {
        ...buildQuery(activityFilters),
        limit: DEFAULT_LIMIT,
      },
    });
    setActivity(Array.isArray(response?.data?.data) ? response.data.data : []);
    setActivityPagination(response?.data?.pagination || null);
  }, [activityFilters]);

  const loadDashboard = useCallback(async () => {
    if (!canViewSecurity) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadSummary(), loadAlerts(), loadActivity()]);
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message ||
          loadError?.message ||
          "Failed to load security monitoring data.",
      );
    } finally {
      setLoading(false);
    }
  }, [canViewSecurity, loadActivity, loadAlerts, loadSummary]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const updateAlertFilter = (field, value) => {
    setAlertFilters((prev) => ({ ...prev, [field]: value }));
  };

  const updateActivityFilter = (field, value) => {
    setActivityFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleStatusChange = async (alertId, status) => {
    if (!alertId || !status) return;
    setNotice("");
    try {
      await api.patch(`/security/alerts/${alertId}/status`, { status });
      setNotice("Alert status updated.");
      await Promise.all([loadSummary(), loadAlerts()]);
    } catch (statusError) {
      setError(
        statusError?.response?.data?.message ||
          statusError?.message ||
          "Failed to update alert status.",
      );
    }
  };

  const loadBaseline = async (userIdInput = selectedUserId) => {
    const userId = normalizeText(userIdInput);
    if (!userId) return;
    setSelectedUserId(userId);
    setBaselineLoading(true);
    setError("");
    try {
      const response = await api.get(`/security/users/${userId}/baseline`);
      setBaseline(response?.data?.data || null);
    } catch (baselineError) {
      setBaseline(null);
      setError(
        baselineError?.response?.data?.message ||
          baselineError?.message ||
          "Failed to load user baseline.",
      );
    } finally {
      setBaselineLoading(false);
    }
  };

  const recalculateBaseline = async () => {
    const userId = normalizeText(selectedUserId);
    if (!userId) return;
    setBaselineLoading(true);
    setError("");
    try {
      const response = await api.post(`/security/users/${userId}/recalculate-baseline`);
      setBaseline(response?.data?.data || null);
      setNotice("User baseline recalculated.");
      await loadSummary();
    } catch (baselineError) {
      setError(
        baselineError?.response?.data?.message ||
          baselineError?.message ||
          "Failed to recalculate user baseline.",
      );
    } finally {
      setBaselineLoading(false);
    }
  };

  const selectUser = (userId) => {
    const normalized = normalizeText(userId);
    if (!normalized) return;
    setActivityFilters((prev) => ({ ...prev, user: normalized }));
    setAlertFilters((prev) => ({ ...prev, user: normalized }));
    loadBaseline(normalized);
  };

  return (
    <>
      <Navbar />
      <div className="page-shell py-4 security-dashboard-page">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
          <div>
            <h1 className="h3 mb-1">Security Monitoring</h1>
            <p className="text-secondary mb-0">Activity logs, anomaly alerts, and user baselines.</p>
          </div>
          <button
            type="button"
            className="btn btn-dark rounded-pill px-4"
            onClick={loadDashboard}
            disabled={loading || !canViewSecurity}
          >
            Refresh
          </button>
        </div>

        {!canViewSecurity ? (
          <div className="alert alert-warning">Security monitoring is restricted to admins.</div>
        ) : (
          <>
            {error && <div className="alert alert-danger">{error}</div>}
            {notice && <div className="alert alert-success">{notice}</div>}

            <div className="security-summary-grid mb-3">
              {summaryCards.map((card) => (
                <div key={card.label} className="workflow-dashboard-stat">
                  <span className="workflow-dashboard-stat-label">{card.label}</span>
                  <strong className="workflow-dashboard-stat-value">{card.value}</strong>
                  <span className="workflow-dashboard-stat-note">{card.note}</span>
                </div>
              ))}
            </div>

            <div className="card om-card mb-3">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between gap-3 align-items-center mb-3">
                  <h2 className="h5 mb-0">Top risky users</h2>
                  <span className="text-secondary small">Based on activity from the last 24 hours</span>
                </div>
                <div className="security-risky-user-list">
                  {(summary?.top_risky_users || []).length === 0 ? (
                    <span className="text-secondary">No risky user activity found.</span>
                  ) : (
                    summary.top_risky_users.map((entry) => (
                      <button
                        key={entry.user?._id || entry._id}
                        type="button"
                        className="security-risky-user"
                        onClick={() => selectUser(entry.user?._id || entry._id)}
                      >
                        <span>{formatUser(entry.user, entry._id)}</span>
                        <strong>{entry.total_score || 0}</strong>
                        <small>{entry.activity_count || 0} events</small>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="card om-card mb-3">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between gap-3 align-items-center mb-3">
                  <h2 className="h5 mb-0">Alerts</h2>
                  <span className="text-secondary small">
                    {alertPagination?.total ?? alerts.length} records
                  </span>
                </div>
                <div className="security-filter-grid mb-3">
                  <select
                    className="form-select"
                    value={alertFilters.status}
                    onChange={(event) => updateAlertFilter("status", event.target.value)}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option || "all"} value={option}>
                        {option || "All statuses"}
                      </option>
                    ))}
                  </select>
                  <select
                    className="form-select"
                    value={alertFilters.severity}
                    onChange={(event) => updateAlertFilter("severity", event.target.value)}
                  >
                    {SEVERITY_OPTIONS.map((option) => (
                      <option key={option || "all"} value={option}>
                        {option || "All severities"}
                      </option>
                    ))}
                  </select>
                  <input
                    className="form-control"
                    placeholder="User id"
                    value={alertFilters.user}
                    onChange={(event) => updateAlertFilter("user", event.target.value)}
                  />
                  <input
                    className="form-control"
                    type="date"
                    value={alertFilters.from}
                    onChange={(event) => updateAlertFilter("from", event.target.value)}
                  />
                  <input
                    className="form-control"
                    type="date"
                    value={alertFilters.to}
                    onChange={(event) => updateAlertFilter("to", event.target.value)}
                  />
                </div>
                <div className="table-responsive">
                  <table className="table align-middle security-table">
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>User</th>
                        <th>Severity</th>
                        <th>Score</th>
                        <th>Reasons</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="text-center text-secondary py-4">
                            No alerts found.
                          </td>
                        </tr>
                      ) : (
                        alerts.map((alert) => (
                          <tr key={alert._id}>
                            <td>{formatDateTime(alert.created_at)}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-link p-0"
                                onClick={() => selectUser(alert.user?._id)}
                              >
                                {formatUser(alert.user)}
                              </button>
                            </td>
                            <td>
                              <span className={`badge text-bg-${severityClass(alert.severity)}`}>
                                {alert.severity}
                              </span>
                            </td>
                            <td>{alert.score}</td>
                            <td>{(alert.reasons || []).join(", ") || "-"}</td>
                            <td>{alert.status}</td>
                            <td>
                              <select
                                className="form-select form-select-sm security-status-select"
                                value={alert.status}
                                onChange={(event) => handleStatusChange(alert._id, event.target.value)}
                              >
                                {STATUS_OPTIONS.filter(Boolean).map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="card om-card mb-3">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between gap-3 align-items-center mb-3">
                  <h2 className="h5 mb-0">Activity</h2>
                  <span className="text-secondary small">
                    {activityPagination?.total ?? activity.length} records
                  </span>
                </div>
                <div className="security-filter-grid mb-3">
                  <input
                    className="form-control"
                    placeholder="User id"
                    value={activityFilters.user}
                    onChange={(event) => updateActivityFilter("user", event.target.value)}
                  />
                  <input
                    className="form-control"
                    placeholder="Action"
                    value={activityFilters.action}
                    onChange={(event) => updateActivityFilter("action", event.target.value)}
                  />
                  <input
                    className="form-control"
                    placeholder="Resource type"
                    value={activityFilters.resource_type}
                    onChange={(event) => updateActivityFilter("resource_type", event.target.value)}
                  />
                  <input
                    className="form-control"
                    type="date"
                    value={activityFilters.from}
                    onChange={(event) => updateActivityFilter("from", event.target.value)}
                  />
                  <input
                    className="form-control"
                    type="date"
                    value={activityFilters.to}
                    onChange={(event) => updateActivityFilter("to", event.target.value)}
                  />
                  <input
                    className="form-control"
                    type="number"
                    min="0"
                    placeholder="Min score"
                    value={activityFilters.min_risk_score}
                    onChange={(event) => updateActivityFilter("min_risk_score", event.target.value)}
                  />
                </div>
                <div className="table-responsive">
                  <table className="table align-middle security-table">
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>User</th>
                        <th>Action</th>
                        <th>Resource</th>
                        <th>IP</th>
                        <th>Score</th>
                        <th>Reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="text-center text-secondary py-4">
                            No activity found.
                          </td>
                        </tr>
                      ) : (
                        activity.map((row) => (
                          <tr key={row._id}>
                            <td>{formatDateTime(row.created_at)}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-link p-0"
                                onClick={() => selectUser(row.user?._id)}
                              >
                                {formatUser(row.user, row.username)}
                              </button>
                            </td>
                            <td>{row.action}</td>
                            <td>{row.resource_type || "-"}</td>
                            <td>{row.ip || "-"}</td>
                            <td>{row.risk_score || 0}</td>
                            <td>{(row.risk_reasons || []).join(", ") || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="card om-card">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between gap-3 align-items-center mb-3">
                  <h2 className="h5 mb-0">User baseline</h2>
                  <div className="security-baseline-actions">
                    <input
                      className="form-control"
                      placeholder="User id"
                      value={selectedUserId}
                      onChange={(event) => setSelectedUserId(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-dark"
                      onClick={() => loadBaseline()}
                      disabled={baselineLoading || !selectedUserId}
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      className="btn btn-dark"
                      onClick={recalculateBaseline}
                      disabled={baselineLoading || !selectedUserId}
                    >
                      Recalculate
                    </button>
                  </div>
                </div>

                {!baseline ? (
                  <div className="text-secondary">Select a user to view the baseline.</div>
                ) : (
                  <div className="security-baseline-grid">
                    <div>
                      <span className="text-secondary small">User</span>
                      <strong>{formatUser(baseline.user)}</strong>
                    </div>
                    <div>
                      <span className="text-secondary small">Common hours</span>
                      <strong>{(baseline.common_hours || []).join(", ") || "-"}</strong>
                    </div>
                    <div>
                      <span className="text-secondary small">Avg daily exports</span>
                      <strong>{baseline.avg_daily_exports ?? 0}</strong>
                    </div>
                    <div>
                      <span className="text-secondary small">Avg daily views</span>
                      <strong>{baseline.avg_daily_views ?? 0}</strong>
                    </div>
                    <div>
                      <span className="text-secondary small">Top IPs</span>
                      <strong>
                        {(baseline.top_ips || [])
                          .map((entry) => `${entry.value} (${entry.count})`)
                          .join(", ") || "-"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-secondary small">Top devices</span>
                      <strong>
                        {(baseline.top_devices || [])
                          .map((entry) => `${entry.value.slice(0, 10)}... (${entry.count})`)
                          .join(", ") || "-"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-secondary small">Last recalculated</span>
                      <strong>{formatDateTime(baseline.last_recalculated_at)}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default SecurityDashboard;
