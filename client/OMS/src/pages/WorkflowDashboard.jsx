import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePermissions } from "../auth/PermissionContext";
import { ROLE_LABELS, isAdminLikeRole, normalizeUserRole } from "../auth/permissions";
import Navbar from "../components/Navbar";
import {
  getWorkflowDashboard,
  getWorkflowDepartments,
  getWorkflowTaskTypes,
} from "../api/workflowApi";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const normalizeText = (value) => String(value ?? "").trim();

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

const formatRoleLabel = (role) =>
  ROLE_LABELS[normalizeUserRole(role)] || normalizeText(role) || "User";

const getCount = (row, key) => Number(row?.counts?.[key] || 0);

const WorkflowDashboard = () => {
  const navigate = useNavigate();
  const { hasPermission, role } = usePermissions();
  const canViewWorkflow = hasPermission("workflow", "view");
  const canViewDashboard = canViewWorkflow && isAdminLikeRole(role);

  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "workflow-dashboard");

  const [dashboard, setDashboard] = useState(null);
  const [taskTypes, setTaskTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState(() => normalizeText(searchParams.get("status")));
  const [taskTypeFilter, setTaskTypeFilter] = useState(() => normalizeText(searchParams.get("task_type_key")));
  const [departmentFilter, setDepartmentFilter] = useState(() => normalizeText(searchParams.get("department")));
  const [brandFilter, setBrandFilter] = useState(() => normalizeText(searchParams.get("brand")));
  const [search, setSearch] = useState(() => normalizeText(searchParams.get("search")));
  const [dueDateFrom, setDueDateFrom] = useState(() => normalizeText(searchParams.get("due_date_from")));
  const [dueDateTo, setDueDateTo] = useState(() => normalizeText(searchParams.get("due_date_to")));
  const [userSearch, setUserSearch] = useState(() => normalizeText(searchParams.get("user_search")));
  const [refreshTick, setRefreshTick] = useState(0);

  const loadLookups = useCallback(async () => {
    if (!canViewDashboard) {
      setLookupLoading(false);
      return;
    }

    setLookupLoading(true);
    try {
      const [taskTypeResult, departmentResult] = await Promise.allSettled([
        getWorkflowTaskTypes(),
        getWorkflowDepartments(),
      ]);

      if (taskTypeResult.status === "fulfilled") {
        setTaskTypes(Array.isArray(taskTypeResult.value?.data) ? taskTypeResult.value.data : []);
      } else {
        setTaskTypes([]);
      }

      if (departmentResult.status === "fulfilled") {
        setDepartments(
          Array.isArray(departmentResult.value?.data) ? departmentResult.value.data : [],
        );
      } else {
        setDepartments([]);
      }
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to load workflow dashboard filters.",
      );
    } finally {
      setLookupLoading(false);
    }
  }, [canViewDashboard]);

  const loadDashboard = useCallback(async () => {
    if (!canViewDashboard) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await getWorkflowDashboard({
        status: statusFilter || undefined,
        task_type_key: taskTypeFilter || undefined,
        department: departmentFilter || undefined,
        brand: brandFilter || undefined,
        search: search || undefined,
        due_date_from: dueDateFrom || undefined,
        due_date_to: dueDateTo || undefined,
      });
      setDashboard(response?.data || null);
    } catch (loadError) {
      setDashboard(null);
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to fetch workflow dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [
    brandFilter,
    canViewDashboard,
    departmentFilter,
    dueDateFrom,
    dueDateTo,
    search,
    statusFilter,
    taskTypeFilter,
  ]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard, refreshTick]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (statusFilter) next.set("status", statusFilter);
    if (taskTypeFilter) next.set("task_type_key", taskTypeFilter);
    if (departmentFilter) next.set("department", departmentFilter);
    if (brandFilter) next.set("brand", brandFilter);
    if (search) next.set("search", search);
    if (dueDateFrom) next.set("due_date_from", dueDateFrom);
    if (dueDateTo) next.set("due_date_to", dueDateTo);
    if (userSearch) next.set("user_search", userSearch);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    departmentFilter,
    dueDateFrom,
    dueDateTo,
    search,
    searchParams,
    setSearchParams,
    statusFilter,
    taskTypeFilter,
    userSearch,
  ]);

  const summaryUsers = useMemo(
    () => (Array.isArray(dashboard?.users) ? dashboard.users : []),
    [dashboard?.users],
  );

  const visibleUsers = useMemo(() => {
    if (!userSearch) return summaryUsers;
    const needle = normalizeText(userSearch).toLowerCase();
    return summaryUsers.filter((entry) =>
      `${entry?.name || ""} ${entry?.email || ""} ${entry?.role || ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [summaryUsers, userSearch]);

  const focusRows = useMemo(() => {
    const overdueRows = visibleUsers
      .filter((entry) => getCount(entry, "overdue_tasks") > 0)
      .sort(
        (left, right) =>
          getCount(right, "overdue_tasks") - getCount(left, "overdue_tasks")
          || getCount(right, "open_tasks") - getCount(left, "open_tasks"),
      );

    if (overdueRows.length > 0) {
      return {
        title: "Needs Attention",
        description: "These assignees have the highest overdue workflow load right now.",
        rows: overdueRows.slice(0, 5),
      };
    }

    return {
      title: "Top Open Workloads",
      description: "No overdue tasks in this slice. These assignees currently carry the most open work.",
      rows: [...visibleUsers]
        .sort(
          (left, right) =>
            getCount(right, "open_tasks") - getCount(left, "open_tasks")
            || getCount(right, "awaiting_review_tasks")
              - getCount(left, "awaiting_review_tasks"),
        )
        .slice(0, 5),
    };
  }, [visibleUsers]);

  const statCards = useMemo(() => {
    const overall = dashboard?.overall || {};
    return [
      {
        key: "total",
        label: "Total Tasks",
        value: Number(overall.total_tasks || 0),
        note: "All tasks in the current dashboard slice.",
      },
      {
        key: "open",
        label: "Open Tasks",
        value: Number(overall.open_tasks || 0),
        note: "Pending through rework and still active.",
      },
      {
        key: "approval",
        label: "Needs Approval",
        value: Number(overall.awaiting_review_tasks || 0),
        note: "Submitted or in review waiting on admin action.",
      },
      {
        key: "overdue",
        label: "Overdue",
        value: Number(overall.overdue_tasks || 0),
        note: "Past due and not yet completed or cancelled.",
      },
      {
        key: "due-today",
        label: "Due Today",
        value: Number(overall.due_today_tasks || 0),
        note: "Active tasks due before the day rolls over.",
      },
      {
        key: "unassigned",
        label: "Unassigned",
        value: Number(overall.unassigned_tasks || 0),
        note: "Tasks with no assignee yet.",
      },
    ];
  }, [dashboard?.overall]);

  if (!canViewWorkflow) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-3">
          <div className="alert alert-danger">
            You do not have access to Production Workflow.
          </div>
        </div>
      </>
    );
  }

  if (!canViewDashboard) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-3">
          <div className="alert alert-danger">
            Workflow dashboard is only available to admins.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-shell py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h2 className="h4 mb-1">Workflow Dashboard</h2>
            <div className="text-secondary">
              Admin quick glance for production workflow workload, review queue, and user-level task ownership.
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => navigate("/workflow/tasks")}
            >
              Open Task Board
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setRefreshTick((prev) => prev + 1)}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}

        <div className="card om-card mb-3">
          <div className="card-body">
            <form
              className="row g-3 align-items-end"
              onSubmit={(event) => {
                event.preventDefault();
                setRefreshTick((prev) => prev + 1);
              }}
            >
              <div className="col-lg-3">
                <label className="form-label">Task Search</label>
                <input
                  type="text"
                  className="form-control"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Task no, title, folder, brand"
                />
              </div>
              <div className="col-lg-3">
                <label className="form-label">User Search</label>
                <input
                  type="text"
                  className="form-control"
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="User name, email, role"
                />
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {["pending", "assigned", "in_progress", "submitted", "review", "rework", "completed", "cancelled"].map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Task Type</label>
                <select
                  className="form-select"
                  value={taskTypeFilter}
                  onChange={(event) => setTaskTypeFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {taskTypes.map((taskType) => (
                    <option key={taskType._id || taskType.key} value={taskType.key}>
                      {taskType.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Department</label>
                <select
                  className="form-select"
                  value={departmentFilter}
                  onChange={(event) => setDepartmentFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {departments.map((department) => (
                    <option key={department._id} value={department._id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Brand</label>
                <input
                  type="text"
                  className="form-control"
                  value={brandFilter}
                  onChange={(event) => setBrandFilter(event.target.value)}
                />
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Due From</label>
                <input
                  type="date"
                  className="form-control"
                  value={dueDateFrom}
                  onChange={(event) => setDueDateFrom(event.target.value)}
                />
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Due To</label>
                <input
                  type="date"
                  className="form-control"
                  value={dueDateTo}
                  onChange={(event) => setDueDateTo(event.target.value)}
                />
              </div>
              <div className="col-12 d-flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setSearch("");
                    setUserSearch("");
                    setStatusFilter("");
                    setTaskTypeFilter("");
                    setDepartmentFilter("");
                    setBrandFilter("");
                    setDueDateFrom("");
                    setDueDateTo("");
                    setRefreshTick((prev) => prev + 1);
                  }}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">
              Users Shown: {visibleUsers.length}
            </span>
            <span className="om-summary-chip">
              Users With Workload: {Number(dashboard?.overall?.users_with_tasks || 0)}
            </span>
            <span className="om-summary-chip">
              Users With Overdue Tasks: {Number(dashboard?.overall?.users_with_overdue_tasks || 0)}
            </span>
            <span className="om-summary-chip">
              Generated: {formatDateTime(dashboard?.generated_at)}
            </span>
            {lookupLoading && (
              <span className="small text-secondary align-self-center">
                Loading workflow dashboard filters...
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="card om-card">
            <div className="card-body text-center py-5 text-secondary">
              Loading workflow dashboard...
            </div>
          </div>
        ) : (
          <>
            <div className="workflow-dashboard-grid mb-3">
              {statCards.map((card) => (
                <div key={card.key} className="card om-card workflow-dashboard-stat">
                  <div className="card-body">
                    <div className="workflow-dashboard-stat-label">{card.label}</div>
                    <div className="workflow-dashboard-stat-value">{card.value}</div>
                    <div className="workflow-dashboard-stat-note">{card.note}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="card om-card mb-3">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                  <div>
                    <h5 className="mb-1">{focusRows.title}</h5>
                    <div className="text-secondary small">
                      {focusRows.description}
                    </div>
                  </div>
                </div>
                {focusRows.rows.length === 0 ? (
                  <div className="text-secondary">No workload rows matched the current filters.</div>
                ) : (
                  <div className="workflow-dashboard-spotlight-list">
                    {focusRows.rows.map((entry) => (
                      <div key={entry.user_id || entry.email || entry.name} className="workflow-dashboard-spotlight-item">
                        <div>
                          <div className="fw-semibold">{entry.name}</div>
                          <div className="small text-secondary">
                            {formatRoleLabel(entry.role)}
                            {entry.email ? ` • ${entry.email}` : ""}
                          </div>
                        </div>
                        <div className="workflow-dashboard-spotlight-meta">
                          <span className="om-summary-chip">Open: {getCount(entry, "open_tasks")}</span>
                          <span className="om-summary-chip">Review: {getCount(entry, "awaiting_review_tasks")}</span>
                          <span className="om-summary-chip">Overdue: {getCount(entry, "overdue_tasks")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="card om-card">
              <div className="card-body p-0">
                {visibleUsers.length === 0 ? (
                  <div className="text-center py-5 text-secondary">
                    No user workload rows matched the current dashboard filters.
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0 workflow-dashboard-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Role</th>
                          <th>Total</th>
                          <th>Open</th>
                          <th>Ready</th>
                          <th>In Progress</th>
                          <th>Waiting Review</th>
                          <th>Rework</th>
                          <th>Completed</th>
                          <th>Overdue</th>
                          <th>Due Today</th>
                          <th>Last Update</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleUsers.map((entry) => {
                          const readyCount =
                            getCount(entry, "pending_tasks") + getCount(entry, "assigned_tasks");
                          const userId = entry?.user_id ? String(entry.user_id) : "";
                          return (
                            <tr key={userId || entry.email || entry.name}>
                              <td>
                                <div className="fw-semibold">{entry.name}</div>
                                <div className="small text-secondary">{entry.email || "—"}</div>
                              </td>
                              <td>{formatRoleLabel(entry.role)}</td>
                              <td>{getCount(entry, "total_tasks")}</td>
                              <td>{getCount(entry, "open_tasks")}</td>
                              <td>{readyCount}</td>
                              <td>{getCount(entry, "in_progress_tasks")}</td>
                              <td>{getCount(entry, "awaiting_review_tasks")}</td>
                              <td>{getCount(entry, "rework_tasks")}</td>
                              <td>{getCount(entry, "completed_tasks")}</td>
                              <td>{getCount(entry, "overdue_tasks")}</td>
                              <td>{getCount(entry, "due_today_tasks")}</td>
                              <td>{formatDateTime(entry.last_task_update_at)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={() =>
                                    navigate(`/workflow/tasks?assignee=${encodeURIComponent(userId)}`)
                                  }
                                  disabled={!userId}
                                >
                                  View Tasks
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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

export default WorkflowDashboard;
