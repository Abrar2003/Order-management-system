import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePermissions } from "../auth/PermissionContext";
import { ROLE_LABELS, isStrictAdminRole, normalizeUserRole } from "../auth/permissions";
import Navbar from "../components/Navbar";
import {
  getWorkflowDashboard,
  getWorkflowDepartments,
  getWorkflowTaskTypes,
} from "../api/workflowApi";
import useWorkflowRealtime from "../hooks/useWorkflowRealtime";
import useBrandOptions from "../hooks/useBrandOptions";
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

const formatRealtimeStatusLabel = (connectionState = "") => {
  if (connectionState === "live") return "Live";
  if (connectionState === "reconnecting") return "Reconnecting";
  return "Offline";
};

const formatRoleLabel = (role) =>
  ROLE_LABELS[normalizeUserRole(role)] || normalizeText(role) || "User";

const getCount = (row, key) => Number(row?.counts?.[key] || 0);
const SPOTLIGHT_TASK_FILTERS = Object.freeze([
  { countKey: "open_tasks", label: "Open", status: "open" },
  { countKey: "needs_approval_tasks", label: "Needs Approval", status: "needs_approval" },
  { countKey: "upload_remaining_tasks", label: "Upload Remaining", status: "upload_remaining" },
  { countKey: "overdue_tasks", label: "Overdue", status: "overdue" },
  { countKey: "approval_overdue_tasks", label: "Approval Overdue", status: "approval_overdue" },
  { countKey: "upload_overdue_tasks", label: "Upload Overdue", status: "upload_overdue" },
  { countKey: "delayed_tasks", label: "Delayed", status: "delayed" },
  { countKey: "approval_delayed_tasks", label: "Approval Delay", status: "approval_delay" },
  { countKey: "upload_delayed_tasks", label: "Upload Delay", status: "upload_delay" },
]);
const getSpotlightTotal = (entry = {}) =>
  SPOTLIGHT_TASK_FILTERS.reduce((sum, filter) => sum + getCount(entry, filter.countKey), 0);
const DASHBOARD_STATUS_OPTIONS = Object.freeze([
  { value: "open", label: "Open" },
  { value: "needs_approval", label: "Needs Approval" },
  { value: "upload_remaining", label: "Upload Remaining" },
  { value: "overdue", label: "Overdue" },
  { value: "approval_overdue", label: "Approval Overdue" },
  { value: "upload_overdue", label: "Upload Overdue" },
  { value: "delayed", label: "Delayed" },
  { value: "approval_delay", label: "Approval Delay" },
  { value: "upload_delay", label: "Upload Delay" },
  { value: "assigned", label: "assigned" },
  { value: "started", label: "started" },
  { value: "complete", label: "complete" },
  { value: "approved", label: "approved" },
  { value: "uploaded", label: "uploaded" },
]);
const WORKLOAD_TABLE_GROUPS = Object.freeze([
  {
    key: "workload",
    label: "Workload",
    items: [
      { countKey: "total_tasks", label: "Total", status: "" },
      { countKey: "open_tasks", label: "Open", status: "open" },
      { countKey: "assigned_tasks", label: "Assigned", status: "assigned" },
      { countKey: "started_tasks", label: "Started", status: "started" },
    ],
  },
  {
    key: "progress",
    label: "Progress",
    items: [
      { countKey: "complete_done_tasks", label: "Complete", status: "complete_done" },
      { countKey: "needs_approval_tasks", label: "Approval", status: "needs_approval" },
      { countKey: "upload_remaining_tasks", label: "Upload Left", status: "upload_remaining" },
      { countKey: "uploaded_tasks", label: "Uploaded", status: "uploaded" },
      { countKey: "reworked_tasks", label: "Rework", status: "" },
      { countKey: "reworked_before_approval_tasks", label: "Before Appr Rework", status: "" },
      { countKey: "reworked_after_approval_tasks", label: "After Appr Rework", status: "" },
    ],
  },
  {
    key: "sla",
    label: "SLA",
    items: [
      { countKey: "overdue_tasks", label: "Overdue", status: "overdue" },
      { countKey: "approval_overdue_tasks", label: "Appr Overdue", status: "approval_overdue" },
      { countKey: "upload_overdue_tasks", label: "Upload Overdue", status: "upload_overdue" },
      { countKey: "delayed_tasks", label: "Delayed", status: "delayed" },
      { countKey: "approval_delayed_tasks", label: "Appr Delay", status: "approval_delay" },
      { countKey: "upload_delayed_tasks", label: "Upload Delay", status: "upload_delay" },
      { countKey: "due_today_tasks", label: "Due Today", status: "due_today" },
    ],
  },
]);

const WorkflowDashboard = () => {
  const navigate = useNavigate();
  const { hasPermission, role } = usePermissions();
  const canViewWorkflow = hasPermission("workflow", "view");
  const canViewDashboard = canViewWorkflow && isStrictAdminRole(role);

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
  const { brandOptions, loadingBrands } = useBrandOptions([brandFilter]);

  const handleRealtimeRefresh = useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);

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

  const { connectionState } = useWorkflowRealtime({
    enabled: canViewDashboard,
    joinDashboard: canViewDashboard,
    onTaskUpdated: handleRealtimeRefresh,
    onBatchUpdated: handleRealtimeRefresh,
  });

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

  const navigateToTaskBoardFilter = useCallback(
    (entry = {}, status = "") => {
      const userId = normalizeText(entry?.user_id);
      if (!userId) return;

      const next = new URLSearchParams();
      next.set("assignee", userId);
      if (status) next.set("status", status);
      if (taskTypeFilter) next.set("task_type_key", taskTypeFilter);
      if (departmentFilter) next.set("department", departmentFilter);
      if (brandFilter) next.set("brand", brandFilter);
      if (search) next.set("search", search);
      if (dueDateFrom) next.set("due_date_from", dueDateFrom);
      if (dueDateTo) next.set("due_date_to", dueDateTo);

      navigate(`/workflow/tasks?${next.toString()}`);
    },
    [
      brandFilter,
      departmentFilter,
      dueDateFrom,
      dueDateTo,
      navigate,
      search,
      taskTypeFilter,
    ],
  );

  const navigateToTaskBoardSummary = useCallback(
    (status = "") => {
      const next = new URLSearchParams();
      if (status) next.set("status", status);
      if (taskTypeFilter) next.set("task_type_key", taskTypeFilter);
      if (departmentFilter) next.set("department", departmentFilter);
      if (brandFilter) next.set("brand", brandFilter);
      if (search) next.set("search", search);
      if (dueDateFrom) next.set("due_date_from", dueDateFrom);
      if (dueDateTo) next.set("due_date_to", dueDateTo);

      const query = next.toString();
      navigate(query ? `/workflow/tasks?${query}` : "/workflow/tasks");
    },
    [
      brandFilter,
      departmentFilter,
      dueDateFrom,
      dueDateTo,
      navigate,
      search,
      taskTypeFilter,
    ],
  );

  const focusRows = useMemo(() => {
    const getOverdueTotal = (entry) =>
      getCount(entry, "overdue_tasks") +
      getCount(entry, "approval_overdue_tasks") +
      getCount(entry, "upload_overdue_tasks");
    const overdueRows = visibleUsers
      .filter((entry) => getOverdueTotal(entry) > 0)
      .sort(
        (left, right) =>
          getOverdueTotal(right) - getOverdueTotal(left)
          || getCount(right, "open_tasks") - getCount(left, "open_tasks"),
      );

    if (overdueRows.length > 0) {
      return {
        title: "Needs Attention",
        description: "These assignees have the highest overdue workflow count.",
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
            || getCount(right, "needs_approval_tasks")
              - getCount(left, "needs_approval_tasks"),
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
        status: "",
      },
      {
        key: "complete",
        label: "Complete",
        value: Number(overall.complete_done_tasks || 0),
        note: "Uploaded tasks, plus approved tasks that do not need upload.",
        status: "complete_done",
      },
      {
        key: "open",
        label: "Open Tasks",
        value: Number(overall.open_tasks || 0),
        note: "Tasks still not fully uploaded.",
        status: "open",
      },
      {
        key: "approval",
        label: "Needs Approval",
        value: Number(overall.needs_approval_tasks || 0),
        note: "Completed work waiting on admin approval.",
        status: "needs_approval",
      },
      {
        key: "overdue",
        label: "Overdue",
        value: Number(overall.overdue_tasks || 0),
        note: "Tasks not completed after the active due date crossed in IST.",
        status: "overdue",
      },
      {
        key: "approval-overdue",
        label: "Approval Overdue",
        value: Number(overall.approval_overdue_tasks || 0),
        note: "Completed tasks past their approval deadline.",
        status: "approval_overdue",
      },
      {
        key: "upload-overdue",
        label: "Upload Overdue",
        value: Number(overall.upload_overdue_tasks || 0),
        note: "Approved tasks past their upload deadline.",
        status: "upload_overdue",
      },
      {
        key: "delayed",
        label: "Delayed",
        value: Number(overall.delayed_tasks || 0),
        note: "Tasks completed after due date with later stages still in window.",
        status: "delayed",
      },
      {
        key: "approval-delay",
        label: "Approval Delay",
        value: Number(overall.approval_delayed_tasks || 0),
        note: "Final tasks approved after the approval deadline.",
        status: "approval_delay",
      },
      {
        key: "upload-delay",
        label: "Upload Delay",
        value: Number(overall.upload_delayed_tasks || 0),
        note: "Final tasks uploaded after the upload deadline.",
        status: "upload_delay",
      },
      {
        key: "due-today",
        label: "Due Today",
        value: Number(overall.due_today_tasks || 0),
        note: "Due today in IST and still not approved.",
        status: "due_today",
      },
      {
        key: "rework-before-approval",
        label: "Rework Before Approval",
        value: Number(overall.reworked_before_approval_tasks || 0),
        note: "Tasks sent to rework from the completed stage before approval.",
        status: "",
        disableNavigation: true,
      },
      {
        key: "rework-after-approval",
        label: "Rework After Approval",
        value: Number(overall.reworked_after_approval_tasks || 0),
        note: "Tasks sent to rework after approval or upload.",
        status: "",
        disableNavigation: true,
      },
      {
        key: "upload-remaining",
        label: "Upload Remaining",
        value: Number(overall.upload_remaining_tasks || 0),
        note: "Approved tasks still waiting to be uploaded.",
        status: "upload_remaining",
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
            <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
              <h2 className="h4 mb-0">Workflow Dashboard</h2>
              <span className="om-summary-chip">
                {formatRealtimeStatusLabel(connectionState)}
              </span>
            </div>
            <div className="text-secondary">
              Admin quick glance for production workflow workload, approval queue, and user-level task ownership.
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
                  placeholder="Task no, title, brand"
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
                  {DASHBOARD_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
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
                <select
                  className="form-select"
                  value={brandFilter}
                  onChange={(event) => setBrandFilter(event.target.value)}
                  disabled={loadingBrands}
                >
                  <option value="">All Brands</option>
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
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
                <button
                  key={card.key}
                  type="button"
                  className="card om-card workflow-dashboard-stat is-clickable"
                  disabled={card.disableNavigation}
                  onClick={() => {
                    if (!card.disableNavigation) {
                      navigateToTaskBoardSummary(card.status);
                    }
                  }}
                  title={
                    card.disableNavigation
                      ? card.label
                      : `View ${card.label.toLowerCase()} tasks`
                  }
                >
                  <div className="card-body">
                    <div className="workflow-dashboard-stat-label">{card.label}</div>
                    <div className="workflow-dashboard-stat-value">{card.value}</div>
                    <div className="workflow-dashboard-stat-note">{card.note}</div>
                  </div>
                </button>
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
                    {focusRows.rows.map((entry, index) => {
                      const activeFilters = SPOTLIGHT_TASK_FILTERS
                        .map((filter) => ({
                          ...filter,
                          count: getCount(entry, filter.countKey),
                        }))
                        .filter((filter) => filter.count > 0);
                      const spotlightTotal = getSpotlightTotal(entry);

                      return (
                      <div key={entry.user_id || entry.email || entry.name} className="workflow-dashboard-spotlight-item">
                        <div className="workflow-dashboard-spotlight-person">
                          <span className="workflow-dashboard-spotlight-rank">
                            {index + 1}
                          </span>
                          <div className="workflow-dashboard-spotlight-user">
                            <div className="fw-semibold">{entry.name}</div>
                            <div className="small text-secondary">
                              {formatRoleLabel(entry.role)}
                            </div>
                            {entry.email && (
                              <div className="workflow-dashboard-spotlight-email">
                                {entry.email}
                              </div>
                            )}
                          </div>
                          <div className="workflow-dashboard-spotlight-total">
                            <span>Total</span>
                            <strong>{spotlightTotal}</strong>
                          </div>
                        </div>
                        <div className="workflow-dashboard-spotlight-meta">
                          {activeFilters.length === 0 ? (
                            <span className="workflow-dashboard-spotlight-empty">
                              No active workload counts
                            </span>
                          ) : (
                            activeFilters.map((filter) => (
                              <button
                                key={filter.countKey}
                                type="button"
                                className="workflow-dashboard-spotlight-filter"
                                onClick={() => navigateToTaskBoardFilter(entry, filter.status)}
                                disabled={!entry?.user_id}
                                title={`View ${filter.label.toLowerCase()} tasks for ${entry.name}`}
                              >
                                <span>{filter.label}</span>
                                <strong>{filter.count}</strong>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    );
                    })}
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
                  <div className="workflow-dashboard-workload-table-wrap">
                    <table className="table align-middle mb-0 workflow-dashboard-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Role</th>
                          <th>Workload</th>
                          <th>Progress</th>
                          <th>SLA</th>
                          <th>Last Update</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleUsers.map((entry) => {
                          const userId = entry?.user_id ? String(entry.user_id) : "";
                          return (
                            <tr key={userId || entry.email || entry.name}>
                              <td>
                                <div className="workflow-dashboard-user-cell">
                                  <div className="fw-semibold">{entry.name}</div>
                                  <div className="small text-secondary">{entry.email || "—"}</div>
                                </div>
                              </td>
                              <td>{formatRoleLabel(entry.role)}</td>
                              {WORKLOAD_TABLE_GROUPS.map((group) => (
                                <td key={group.key}>
                                  <div className="workflow-dashboard-count-grid">
                                    {group.items.map((item) => {
                                      const count = getCount(entry, item.countKey);
                                      const disabled = !userId || count <= 0 || !item.status;
                                      return (
                                        <button
                                          key={item.countKey}
                                          type="button"
                                          className={`workflow-dashboard-count-chip ${
                                            count > 0 ? "has-count" : ""
                                          }`}
                                          disabled={disabled}
                                          onClick={() =>
                                            navigateToTaskBoardFilter(entry, item.status)
                                          }
                                          title={
                                            item.status
                                              ? `View ${item.label.toLowerCase()} tasks for ${entry.name}`
                                              : item.label
                                          }
                                        >
                                          <span>{item.label}</span>
                                          <strong>{count}</strong>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </td>
                              ))}
                              <td className="workflow-dashboard-last-update">
                                {formatDateTime(entry.last_task_update_at)}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm workflow-dashboard-view-button"
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
