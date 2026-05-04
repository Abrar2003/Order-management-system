import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getUserFromToken } from "../../auth/auth.service";
import { usePermissions } from "../../auth/PermissionContext";
import {
  approveWorkflowTask,
  getWorkflowBatches,
  getWorkflowDepartments,
  getWorkflowTaskTypes,
  getWorkflowTasks,
  getWorkflowUsers,
  reviewWorkflowTask,
  sendWorkflowTaskToRework,
  startWorkflowTask,
  submitWorkflowTask,
} from "../../api/workflowApi";
import { useRememberSearchParams } from "../../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../../utils/searchParams";
import WorkflowTaskDetailModal from "./WorkflowTaskDetailModal";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const normalizeText = (value) => String(value ?? "").trim();

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

const getTaskUserId = (entry = {}) =>
  entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || "";

const getTaskUserName = (entry = {}) =>
  entry?.user?.name || entry?.user?.email || entry?.name || entry?.email || "User";

const WorkflowTasksPanel = ({
  mineOnly = false,
  title = "Task Board",
  description = "Track workflow tasks and update their status.",
}) => {
  const { hasPermission, role } = usePermissions();
  const currentUser = getUserFromToken();
  const currentUserId = currentUser?._id || currentUser?.id || "";
  const isManagerOrAdmin = ["admin", "manager"].includes(String(role || "").trim().toLowerCase());
  const canViewWorkflow = hasPermission("workflow", "view");
  const canAssignWorkflow = isManagerOrAdmin && hasPermission("workflow", "assign");
  const canApproveWorkflow = isManagerOrAdmin && hasPermission("workflow", "approve");
  const canManageWorkflow = isManagerOrAdmin && hasPermission("workflow", "edit");

  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(
    searchParams,
    setSearchParams,
    mineOnly ? "workflow-my-tasks" : "workflow-tasks",
  );

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalRecords: 0,
  });
  const [loading, setLoading] = useState(true);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [taskTypes, setTaskTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [batches, setBatches] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [search, setSearch] = useState(() => normalizeText(searchParams.get("search")));
  const [statusFilter, setStatusFilter] = useState(() => normalizeText(searchParams.get("status")));
  const [taskTypeFilter, setTaskTypeFilter] = useState(() => normalizeText(searchParams.get("task_type_key")));
  const [batchFilter, setBatchFilter] = useState(() => normalizeText(searchParams.get("batch")));
  const [assigneeFilter, setAssigneeFilter] = useState(() => {
    const value = normalizeText(searchParams.get("assignee"));
    if (mineOnly) return currentUserId;
    return value;
  });
  const [departmentFilter, setDepartmentFilter] = useState(() => normalizeText(searchParams.get("department")));
  const [brandFilter, setBrandFilter] = useState(() => normalizeText(searchParams.get("brand")));
  const [dueDateFrom, setDueDateFrom] = useState(() => normalizeText(searchParams.get("due_date_from")));
  const [dueDateTo, setDueDateTo] = useState(() => normalizeText(searchParams.get("due_date_to")));
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [refreshTick, setRefreshTick] = useState(0);

  const loadLookups = useCallback(async () => {
    if (!canViewWorkflow) {
      setLookupLoading(false);
      return;
    }

    setLookupLoading(true);
    try {
      const [taskTypeResult, departmentResult, batchResult, userResult] =
        await Promise.allSettled([
          getWorkflowTaskTypes(),
          getWorkflowDepartments(),
          getWorkflowBatches({ limit: 100 }),
          canAssignWorkflow || isManagerOrAdmin
            ? getWorkflowUsers()
            : Promise.resolve([]),
        ]);

      if (taskTypeResult.status === "fulfilled") {
        setTaskTypes(
          Array.isArray(taskTypeResult.value?.data) ? taskTypeResult.value.data : [],
        );
      }
      if (departmentResult.status === "fulfilled") {
        setDepartments(
          Array.isArray(departmentResult.value?.data)
            ? departmentResult.value.data
            : [],
        );
      }
      if (batchResult.status === "fulfilled") {
        setBatches(Array.isArray(batchResult.value?.data) ? batchResult.value.data : []);
      }
      if (userResult.status === "fulfilled") {
        setUsers(
          Array.isArray(userResult.value)
            ? userResult.value
            : Array.isArray(userResult.value?.data)
            ? userResult.value.data
            : [],
        );
      } else {
        setUsers([]);
      }
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to load workflow filters.",
      );
    } finally {
      setLookupLoading(false);
    }
  }, [canAssignWorkflow, canViewWorkflow, isManagerOrAdmin]);

  const loadTasks = useCallback(async () => {
    if (!canViewWorkflow) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await getWorkflowTasks({
        page,
        limit,
        status: statusFilter || undefined,
        task_type_key: taskTypeFilter || undefined,
        batch: batchFilter || undefined,
        assignee:
          mineOnly && isManagerOrAdmin
            ? currentUserId || undefined
            : assigneeFilter || undefined,
        department: departmentFilter || undefined,
        brand: brandFilter || undefined,
        search: search || undefined,
        due_date_from: dueDateFrom || undefined,
        due_date_to: dueDateTo || undefined,
      });

      setRows(Array.isArray(response?.data) ? response.data : []);
      setPagination({
        page: Number(response?.pagination?.page || 1),
        totalPages: Number(response?.pagination?.totalPages || 1),
        totalRecords: Number(response?.pagination?.totalRecords || 0),
      });
    } catch (loadError) {
      setRows([]);
      setPagination({
        page: 1,
        totalPages: 1,
        totalRecords: 0,
      });
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to fetch workflow tasks.",
      );
    } finally {
      setLoading(false);
    }
  }, [
    assigneeFilter,
    batchFilter,
    brandFilter,
    canViewWorkflow,
    currentUserId,
    departmentFilter,
    dueDateFrom,
    dueDateTo,
    isManagerOrAdmin,
    limit,
    mineOnly,
    page,
    search,
    statusFilter,
    taskTypeFilter,
  ]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks, refreshTick]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (statusFilter) next.set("status", statusFilter);
    if (taskTypeFilter) next.set("task_type_key", taskTypeFilter);
    if (batchFilter) next.set("batch", batchFilter);
    if (assigneeFilter && !mineOnly) next.set("assignee", assigneeFilter);
    if (departmentFilter) next.set("department", departmentFilter);
    if (brandFilter) next.set("brand", brandFilter);
    if (dueDateFrom) next.set("due_date_from", dueDateFrom);
    if (dueDateTo) next.set("due_date_to", dueDateTo);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    assigneeFilter,
    batchFilter,
    brandFilter,
    departmentFilter,
    dueDateFrom,
    dueDateTo,
    limit,
    mineOnly,
    page,
    search,
    searchParams,
    setSearchParams,
    statusFilter,
    taskTypeFilter,
  ]);

  const handleQuickAction = async (action, message) => {
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
      setRefreshTick((prev) => prev + 1);
    } catch (actionError) {
      setError(
        actionError?.response?.data?.message
          || actionError?.message
          || "Task update failed.",
      );
    }
  };

  const taskStatuses = useMemo(
    () => ["pending", "assigned", "in_progress", "submitted", "review", "rework", "completed", "cancelled"],
    [],
  );

  const visibleRows = useMemo(() => rows, [rows]);

  if (!canViewWorkflow) {
    return (
      <div className="page-shell py-3">
        <div className="alert alert-danger">
          You do not have access to Production Workflow.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h2 className="h4">{title}</h2>
            <div className="text-secondary">{description}</div>
          </div>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card mb-3">
          <div className="card-body">
            <form
              className="row g-3 align-items-end"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setRefreshTick((prev) => prev + 1);
              }}
            >
              <div className="col-lg-3">
                <label className="form-label">Search</label>
                <input
                  type="text"
                  className="form-control"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Task no, title, folder, brand"
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
                  {taskStatuses.map((status) => (
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
                <label className="form-label">Batch</label>
                <select
                  className="form-select"
                  value={batchFilter}
                  onChange={(event) => setBatchFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {batches.map((batch) => (
                    <option key={batch._id} value={batch._id}>
                      {batch.batch_no} • {batch.name}
                    </option>
                  ))}
                </select>
              </div>
              {isManagerOrAdmin && !mineOnly && (
                <div className="col-md-3 col-lg-2">
                  <label className="form-label">Assignee</label>
                  <select
                    className="form-select"
                    value={assigneeFilter}
                    onChange={(event) => setAssigneeFilter(event.target.value)}
                  >
                    <option value="">All</option>
                    {users.map((user) => (
                      <option key={user._id || user.id} value={user._id || user.id}>
                        {user.name || user.username}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Rows</label>
                <select
                  className="form-select"
                  value={limit}
                  onChange={(event) => {
                    setLimit(parseLimit(event.target.value));
                    setPage(1);
                  }}
                >
                  {LIMIT_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
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
                    setStatusFilter("");
                    setTaskTypeFilter("");
                    setBatchFilter("");
                    setAssigneeFilter(mineOnly ? currentUserId : "");
                    setDepartmentFilter("");
                    setBrandFilter("");
                    setDueDateFrom("");
                    setDueDateTo("");
                    setLimit(DEFAULT_LIMIT);
                    setPage(1);
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
            <span className="om-summary-chip">Rows: {pagination.totalRecords}</span>
            <span className="om-summary-chip">
              Page: {pagination.page} / {pagination.totalPages}
            </span>
            {lookupLoading && (
              <span className="small text-secondary align-self-center">
                Loading workflow filters...
              </span>
            )}
          </div>
        </div>

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5 text-secondary">Loading workflow tasks...</div>
            ) : visibleRows.length === 0 ? (
              <div className="text-center py-5 text-secondary">
                No workflow tasks found for the current filters.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Task No</th>
                      <th>Title</th>
                      <th>Batch</th>
                      <th>Task Type</th>
                      <th>Status</th>
                      <th>Assigned Users</th>
                      <th>Rework</th>
                      <th>Source Files</th>
                      <th>Due Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((task) => {
                      const assignedToCurrentUser = Array.isArray(task.assigned_to)
                        ? task.assigned_to.some(
                            (entry) => String(getTaskUserId(entry)) === String(currentUserId),
                          )
                        : false;
                      const showStart =
                        assignedToCurrentUser && ["assigned", "rework"].includes(task.status);
                      const showSubmit =
                        assignedToCurrentUser
                        && ["assigned", "in_progress", "rework"].includes(task.status);
                      const showApprove =
                        canApproveWorkflow && ["submitted", "review"].includes(task.status);
                      const showReview =
                        canApproveWorkflow && task.status === "submitted";

                      return (
                        <tr key={task._id}>
                          <td>{task.task_no}</td>
                          <td>
                            <div className="fw-semibold">{task.title}</div>
                            <div className="small text-secondary">
                              {task.source_folder_path || task.source_folder_name || "—"}
                            </div>
                          </td>
                          <td>
                            <div>{task.batch?.batch_no || "—"}</div>
                            <div className="small text-secondary">{task.batch?.name || ""}</div>
                          </td>
                          <td>{task.task_type_name || task.task_type?.name || task.task_type_key}</td>
                          <td>{task.status}</td>
                          <td>
                            {Array.isArray(task.assigned_to) && task.assigned_to.length > 0
                              ? task.assigned_to.map((entry) => getTaskUserName(entry)).join(", ")
                              : "Unassigned"}
                          </td>
                          <td>{Number(task.rework_count || 0)}</td>
                          <td>{Array.isArray(task.source_files) ? task.source_files.length : 0}</td>
                          <td>{formatDateTime(task.due_date)}</td>
                          <td>
                            <div className="d-flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => setSelectedTaskId(task._id)}
                              >
                                View
                              </button>
                              {showStart && (
                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={() =>
                                    handleQuickAction(
                                      () => startWorkflowTask(task._id),
                                      "Task moved to in progress.",
                                    )
                                  }
                                >
                                  Start Work
                                </button>
                              )}
                              {showSubmit && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() =>
                                    handleQuickAction(
                                      () => submitWorkflowTask(task._id),
                                      "Task submitted for review.",
                                    )
                                  }
                                >
                                  Submit
                                </button>
                              )}
                              {showReview && (
                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={() =>
                                    handleQuickAction(
                                      () => reviewWorkflowTask(task._id, {}),
                                      "Task moved to review.",
                                    )
                                  }
                                >
                                  Review
                                </button>
                              )}
                              {showApprove && (
                                <button
                                  type="button"
                                  className="btn btn-success btn-sm"
                                  onClick={() =>
                                    handleQuickAction(
                                      () => approveWorkflowTask(task._id, {}),
                                      "Task approved successfully.",
                                    )
                                  }
                                >
                                  Approve
                                </button>
                              )}
                              {showApprove && (
                                <button
                                  type="button"
                                  className="btn btn-outline-danger btn-sm"
                                  onClick={async () => {
                                    const reason = window.prompt("Enter rework reason");
                                    if (!normalizeText(reason)) return;
                                    await handleQuickAction(
                                      () =>
                                        sendWorkflowTaskToRework(task._id, {
                                          note: normalizeText(reason),
                                        }),
                                      "Task sent to rework.",
                                    );
                                  }}
                                >
                                  Rework
                                </button>
                              )}
                            </div>
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

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={loading || page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <div className="small text-secondary">
            Page {pagination.page} of {pagination.totalPages}
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={loading || page >= pagination.totalPages}
            onClick={() =>
              setPage((prev) => Math.min(pagination.totalPages, prev + 1))
            }
          >
            Next
          </button>
        </div>
      </div>

      {selectedTaskId && (
        <WorkflowTaskDetailModal
          taskId={selectedTaskId}
          availableUsers={users}
          canManageWorkflow={canManageWorkflow}
          canAssignWorkflow={canAssignWorkflow}
          canApproveWorkflow={canApproveWorkflow}
          onClose={() => setSelectedTaskId("")}
          onUpdated={() => {
            setRefreshTick((prev) => prev + 1);
          }}
        />
      )}
    </>
  );
};

export default WorkflowTasksPanel;
