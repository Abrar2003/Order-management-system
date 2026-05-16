import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/axios";
import { getUserFromToken } from "../../auth/auth.service";
import { isManagerLikeRole, isStrictAdminRole } from "../../auth/permissions";
import { usePermissions } from "../../auth/PermissionContext";
import {
  approveWorkflowTask,
  completeWorkflowTask,
  deleteWorkflowTask,
  getWorkflowDepartments,
  getWorkflowTaskTypes,
  getWorkflowTasks,
  getWorkflowUsers,
  sendWorkflowTaskToRework,
  startWorkflowTask,
  uploadWorkflowTask,
} from "../../api/workflowApi";
import { useRememberSearchParams } from "../../hooks/useRememberSearchParams";
import useWorkflowRealtime from "../../hooks/useWorkflowRealtime";
import { formatDateOnlyIST, formatDateTimeIST } from "../../utils/date";
import { areSearchParamsEquivalent } from "../../utils/searchParams";
import HoverPortal from "../HoverPortal";
import WorkflowBatchCreateModal from "./WorkflowBatchCreateModal";
import WorkflowTaskCreateModal from "./WorkflowTaskCreateModal";
import WorkflowTaskDetailModal from "./WorkflowTaskDetailModal";
import WorkflowTaskStageBar from "./WorkflowTaskStageBar";
import {
  formatWorkflowStageLabel,
  isWorkflowUploadStepKey,
} from "./workflowTaskProgress";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const normalizeText = (value) => String(value ?? "").trim();
const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const formatDateTime = (value) => formatDateTimeIST(value);

const formatDateOnly = (value) => formatDateOnlyIST(value);

const getTaskUserId = (entry = {}) =>
  entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || "";

const getTaskUserName = (entry = {}) =>
  entry?.user?.name || entry?.user?.email || entry?.name || entry?.email || "User";

const getAuditActorName = (actor = {}) =>
  actor?.name || actor?.user?.name || actor?.user?.email || "User";

const hasUploadAssignees = (task = {}) =>
  Array.isArray(task?.upload_assignees) && task.upload_assignees.length > 0;

const isUploadAssignedToCurrentUser = (task = {}, currentUserId = "") =>
  hasUploadAssignees(task) &&
  task.upload_assignees.some(
    (entry) => String(getTaskUserId(entry)) === String(currentUserId),
  );

const getUploadUserIdFromStepKey = (stepKey = "") =>
  isWorkflowUploadStepKey(stepKey)
    ? stepKey.split(":").slice(1).join(":")
    : "";

const isUploadStepPending = (task = {}, stepKey = "") => {
  if (stepKey === "uploaded") {
    return !(Array.isArray(task?.upload_statuses) ? task.upload_statuses : []).some(
      (entry) => normalizeText(entry?.status).toLowerCase() === "uploaded",
    );
  }

  const uploadUserId = getUploadUserIdFromStepKey(stepKey);
  if (!uploadUserId) return false;
  return (Array.isArray(task?.upload_statuses) ? task.upload_statuses : []).some(
    (entry) =>
      String(getTaskUserId(entry)) === String(uploadUserId) &&
      normalizeText(entry?.status).toLowerCase() !== "uploaded",
  );
};

const formatRealtimeStatusLabel = (connectionState = "") => {
  if (connectionState === "live") return "Live";
  if (connectionState === "reconnecting") return "Reconnecting";
  return "Offline";
};

const WORKFLOW_ACTION_ICONS = Object.freeze({
  info: "/workflow-icons/info.png",
  delete: "/workflow-icons/delete.png",
  rework: "/workflow-icons/rework.png",
});
const TASK_STATUS_FILTER_OPTIONS = Object.freeze([
  { value: "complete_and_beyond", label: "Complete" },
  { value: "open", label: "Open" },
  { value: "needs_approval", label: "Needs Approval" },
  { value: "upload_remaining", label: "Upload Remaining" },
  { value: "upload_pending", label: "Upload Pending" },
  { value: "overdue", label: "Overdue" },
  { value: "due_today", label: "Due Today" },
  { value: "assigned", label: "assigned" },
  { value: "started", label: "started" },
  { value: "complete", label: "complete" },
  { value: "approved", label: "approved" },
  { value: "uploaded", label: "uploaded" },
]);

const getTaskActionState = ({
  task = {},
  currentUserId = "",
  canManageWorkflow = false,
} = {}) => {
  const assignedToCurrentUser = Array.isArray(task?.assigned_to)
    ? task.assigned_to.some(
        (entry) => String(getTaskUserId(entry)) === String(currentUserId),
      )
    : false;
  const assignedByCurrentUser =
    String(getTaskUserId(task?.assigned_by)) === String(currentUserId);
  const createdByCurrentUser =
    String(getTaskUserId(task?.created_by)) === String(currentUserId);
  const uploadAssignedToCurrentUser = isUploadAssignedToCurrentUser(task, currentUserId);
  const uploadRequired = task?.upload_required !== false;

  return {
    assignedToCurrentUser,
    assignedByCurrentUser,
    createdByCurrentUser,
    canStart: assignedToCurrentUser && task?.status === "assigned",
    canComplete: assignedToCurrentUser && task?.status === "started",
    canUpload:
	      uploadRequired &&
	      task?.status === "approved" &&
	      (
	        hasUploadAssignees(task)
	          ? uploadAssignedToCurrentUser
          : (assignedToCurrentUser || createdByCurrentUser)
      ),
    canRework: canManageWorkflow && ["complete", "approved", "uploaded"].includes(task?.status),
    canApprove: assignedByCurrentUser && task?.status === "complete",
  };
};

const ReworkHoverBadge = ({ taskId = "", count = 0, comments = [] }) => {
  const reworkCount = Number(count || 0);
  const badgeClassName = [
    "workflow-rework-badge",
    "is-inline",
    reworkCount > 0 ? "has-comments" : "is-empty",
  ]
    .filter(Boolean)
    .join(" ");

  const badge = (
    <span className={badgeClassName} tabIndex={reworkCount > 0 ? 0 : -1}>
      Reworked: {reworkCount}
    </span>
  );

  if (reworkCount <= 0) {
    return badge;
  }

  return (
    <HoverPortal
      className="workflow-rework-portal-trigger"
      panelClassName="workflow-rework-hovercard"
      align="left"
      trigger={badge}
    >
      <span className="workflow-rework-hovercard-title">
        Rework Comments
      </span>
      <span className="workflow-rework-hovercard-list">
        {comments.map((entry, index) => (
          <span
            key={`${taskId}-rework-${index}`}
            className="workflow-rework-hovercard-item"
          >
            <span className="workflow-rework-hovercard-comment">
              {entry?.comment || "—"}
            </span>
            <span className="workflow-rework-hovercard-meta">
              {getAuditActorName(entry?.created_by)} • {formatDateTime(entry?.created_at)}
            </span>
          </span>
        ))}
      </span>
    </HoverPortal>
  );
};

const WorkflowTasksPanel = ({
  mineOnly = false,
  fixedStatusFilter = "",
  title = "Task Board",
  description = "Track workflow tasks and update their status.",
}) => {
  const { hasPermission, role } = usePermissions();
  const currentUser = getUserFromToken();
  const currentUserId = currentUser?._id || currentUser?.id || "";
  const isManagerOrAdmin = isManagerLikeRole(role);
  const isAdmin = isStrictAdminRole(role);
  const canViewWorkflow = hasPermission("workflow", "view");
  const canCreateWorkflow = !mineOnly && canViewWorkflow;
  const canCreateFolderWorkflow = !mineOnly && isAdmin && hasPermission("workflow", "create");
  const canEditWorkflow = hasPermission("workflow", "edit");
  const canAssignWorkflow = canEditWorkflow;
  const canManageWorkflow = isManagerOrAdmin && hasPermission("workflow", "edit");
  const canDeleteWorkflow = isAdmin && hasPermission("workflow", "delete");
  const canFilterByAssignee = isAdmin && canViewWorkflow;

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
  const [users, setUsers] = useState([]);
  const [brands, setBrands] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFolderCreateModal, setShowFolderCreateModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [search, setSearch] = useState(() => normalizeText(searchParams.get("search")));
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeText(fixedStatusFilter) || normalizeText(searchParams.get("status")),
  );
  const [taskTypeFilter, setTaskTypeFilter] = useState(() => normalizeText(searchParams.get("task_type_key")));
  const [assigneeFilter, setAssigneeFilter] = useState(() => {
    const value = normalizeText(searchParams.get("assignee"));
    if (mineOnly) return currentUserId;
    return value;
  });
  const [creatorFilter, setCreatorFilter] = useState(() => normalizeText(searchParams.get("creator")));
  const [departmentFilter, setDepartmentFilter] = useState(() => normalizeText(searchParams.get("department")));
  const [brandFilter, setBrandFilter] = useState(() => normalizeText(searchParams.get("brand")));
  const [dueDateFrom, setDueDateFrom] = useState(() => normalizeText(searchParams.get("due_date_from")));
  const [dueDateTo, setDueDateTo] = useState(() => normalizeText(searchParams.get("due_date_to")));
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [refreshTick, setRefreshTick] = useState(0);
  const [actionTaskId, setActionTaskId] = useState("");
  const [notePrompt, setNotePrompt] = useState({
    taskId: "",
    type: "",
    note: "",
    dueDate: "",
  });

  const handleRealtimeRefresh = useCallback(() => {
    setRefreshTick((prev) => prev + 1);
  }, []);

  const activePromptTask = useMemo(
    () => rows.find((task) => String(task?._id) === String(notePrompt.taskId)) || null,
    [notePrompt.taskId, rows],
  );

  const availableBrandOptions = useMemo(
    () =>
      normalizeDistinctValues([
        ...brands,
        ...rows.map((task) => task?.brand),
        brandFilter,
      ]),
    [brandFilter, brands, rows],
  );

  const loadLookups = useCallback(async () => {
    if (!canViewWorkflow) {
      setLookupLoading(false);
      return;
    }

    setLookupLoading(true);
    try {
      const [taskTypeResult, departmentResult, userResult, brandResult] =
        await Promise.allSettled([
          getWorkflowTaskTypes(),
          getWorkflowDepartments(),
          getWorkflowUsers(),
          api.get("/orders/brands-and-vendors"),
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
      if (brandResult.status === "fulfilled") {
        setBrands(
          Array.isArray(brandResult.value?.data?.brands)
            ? normalizeDistinctValues(brandResult.value.data.brands)
            : [],
        );
      } else {
        setBrands([]);
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
  }, [canViewWorkflow]);

  useEffect(() => {
    const normalizedFixedStatus = normalizeText(fixedStatusFilter);
    if (normalizedFixedStatus && statusFilter !== normalizedFixedStatus) {
      setStatusFilter(normalizedFixedStatus);
      setPage(1);
    }
  }, [fixedStatusFilter, statusFilter]);

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
        assignee:
          mineOnly && isAdmin
            ? currentUserId || undefined
            : assigneeFilter || undefined,
        creator: !mineOnly ? creatorFilter || undefined : undefined,
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
    brandFilter,
    canViewWorkflow,
    creatorFilter,
    currentUserId,
    departmentFilter,
    dueDateFrom,
    dueDateTo,
    isAdmin,
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
    if (statusFilter && !fixedStatusFilter) next.set("status", statusFilter);
    if (taskTypeFilter) next.set("task_type_key", taskTypeFilter);
    if (assigneeFilter && !mineOnly) next.set("assignee", assigneeFilter);
    if (creatorFilter && !mineOnly) next.set("creator", creatorFilter);
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
    brandFilter,
    creatorFilter,
    departmentFilter,
    dueDateFrom,
    dueDateTo,
    fixedStatusFilter,
    limit,
    mineOnly,
    page,
    search,
    searchParams,
    setSearchParams,
    statusFilter,
    taskTypeFilter,
  ]);

  const handleQuickAction = async (
    action,
    message,
    { taskId = "", closeNotePrompt = false } = {},
  ) => {
    setError("");
    setSuccess("");
    setActionTaskId(taskId);
    try {
      await action();
      setSuccess(message);
      if (closeNotePrompt) {
        setNotePrompt({
          taskId: "",
          type: "",
          note: "",
          dueDate: "",
        });
      }
      setRefreshTick((prev) => prev + 1);
    } catch (actionError) {
      setError(
        actionError?.response?.data?.message
          || actionError?.message
          || "Task update failed.",
      );
    } finally {
      setActionTaskId("");
    }
  };

  const handleDeleteTask = async (task) => {
    const confirmed = window.confirm(
      `Delete workflow task ${task?.task_no || task?.title || "this task"}?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Enter delete note (optional)") || "";
    await handleQuickAction(
      () =>
        deleteWorkflowTask(task._id, {
          note: normalizeText(reason),
        }),
      "Workflow task deleted successfully.",
      { taskId: task?._id },
    );
  };

  const handleStageClick = async (task, stepKey) => {
    const actions = getTaskActionState({
      task,
      currentUserId,
      canManageWorkflow,
    });

    if (stepKey === "started" && actions.canStart) {
      await handleQuickAction(
        () => startWorkflowTask(task._id, { note: "" }),
        "Task started successfully.",
        { taskId: task._id },
      );
      return;
    }

    if (stepKey === "complete" && actions.canComplete) {
      setNotePrompt({
        taskId: task._id,
        type: "complete",
        note: "",
        dueDate: "",
      });
      return;
    }

    if (stepKey === "approved" && actions.canApprove) {
      await handleQuickAction(
        () => approveWorkflowTask(task._id, { note: "" }),
        "Task approved successfully.",
        { taskId: task._id },
      );
      return;
    }

    if (
      (stepKey === "uploaded" || isWorkflowUploadStepKey(stepKey)) &&
      actions.canUpload &&
      isUploadStepPending(task, stepKey)
    ) {
      await handleQuickAction(
        () => uploadWorkflowTask(task._id, {
          upload_user_id: getUploadUserIdFromStepKey(stepKey),
        }),
        "Task marked uploaded successfully.",
        { taskId: task._id },
      );
    }
  };

  const handleReworkAction = (task) => {
    setError("");
    setSuccess("");
    setNotePrompt({
      taskId: task._id,
      type: "rework",
      note: "",
      dueDate: "",
    });
  };

  const handleConfirmNote = async (task) => {
    const note = normalizeText(notePrompt.note);
    if (notePrompt.type === "rework" && !note) {
      setError("Rework reason is required.");
      return;
    }

    if (notePrompt.type === "complete") {
      await handleQuickAction(
        () => completeWorkflowTask(task._id, { note }),
        "Task marked complete successfully.",
        {
          taskId: task._id,
          closeNotePrompt: true,
        },
      );
      return;
    }

    await handleQuickAction(
      () =>
        sendWorkflowTaskToRework(task._id, {
          note,
          due_date: normalizeText(notePrompt.dueDate) || undefined,
        }),
      "Task sent to rework.",
      {
        taskId: task._id,
        closeNotePrompt: true,
      },
    );
  };

  const visibleRows = useMemo(() => rows, [rows]);

  const { connectionState } = useWorkflowRealtime({
    enabled: canViewWorkflow,
    joinDashboard: isAdmin && !mineOnly && canViewWorkflow,
    userId: canViewWorkflow && (!isAdmin || mineOnly) ? currentUserId : "",
    onTaskUpdated: handleRealtimeRefresh,
    onBatchUpdated: !mineOnly ? handleRealtimeRefresh : undefined,
  });

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
            <div className="d-flex flex-wrap align-items-center gap-2">
              <h2 className="h4 mb-0">{title}</h2>
              <span className="om-summary-chip">
                {formatRealtimeStatusLabel(connectionState)}
              </span>
            </div>
            <div className="text-secondary">{description}</div>
          </div>
          {(canCreateWorkflow || canCreateFolderWorkflow) && (
            <div className="d-flex flex-wrap gap-2">
              {canCreateFolderWorkflow && (
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => setShowFolderCreateModal(true)}
                >
                  Create Tasks from Folder
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowCreateModal(true)}
              >
                Create Manual Task
              </button>
            </div>
          )}
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
                  placeholder="Task no, title, brand"
                />
              </div>
              {fixedStatusFilter ? (
                <div className="col-md-3 col-lg-2">
                  <label className="form-label">Status</label>
                  <div className="form-control bg-light">
                    {TASK_STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilter)?.label
                      || formatWorkflowStageLabel(statusFilter)}
                  </div>
                </div>
              ) : (
                <div className="col-md-3 col-lg-2">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="">All</option>
                    {TASK_STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
              {canFilterByAssignee && !mineOnly && (
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
              {!mineOnly && (
                <div className="col-md-3 col-lg-2">
                  <label className="form-label">Creator</label>
                  <select
                    className="form-select"
                    value={creatorFilter}
                    onChange={(event) => setCreatorFilter(event.target.value)}
                  >
                    <option value="">All</option>
                    {users.map((user) => (
                      <option key={user._id || user.id} value={user._id || user.id}>
                        {user.name || user.username || user.email}
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
                <select
                  className="form-select"
                  value={brandFilter}
                  onChange={(event) => setBrandFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {availableBrandOptions.map((brand) => (
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
	                    setStatusFilter(normalizeText(fixedStatusFilter));
	                    setTaskTypeFilter("");
	                    setAssigneeFilter(mineOnly ? currentUserId : "");
	                    setCreatorFilter("");
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
              <div className="table-responsive workflow-task-table-wrap">
                <table className="table align-middle mb-0 workflow-task-table">
                  <thead>
                    <tr>
                      <th>Task Name</th>
                      <th>Task Type</th>
                      <th>Dates</th>
                      <th>Status Flow</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((task) => {
                      const actions = getTaskActionState({
                        task,
                        currentUserId,
                        canManageWorkflow,
                      });
                      const isBusy = actionTaskId === task._id;
                      const isCompletePromptOpen =
                        notePrompt.taskId === task._id && notePrompt.type === "complete";
                      const assigneeText =
                        Array.isArray(task.assigned_to) && task.assigned_to.length > 0
                          ? task.assigned_to.map((entry) => getTaskUserName(entry)).join(", ")
                          : "Unassigned";
                      const reworkCount = Number(task?.reworked?.count || task?.rework_count || 0);
                      const reworkComments = Array.isArray(task?.reworked?.comments)
                        ? [...task.reworked.comments].reverse()
                        : [];

                      return (
                        <tr key={task._id}>
                          <td>
                            <div className="workflow-task-name-cell">
                              <div className="fw-semibold">{task.title}</div>
                              <div className="small text-secondary mt-1">
                                {assigneeText}
                              </div>
                              <div className="workflow-task-rework-line">
                                <ReworkHoverBadge
                                  taskId={task._id}
                                  count={reworkCount}
                                  comments={reworkComments}
                                />
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="workflow-task-type-cell">
                              <div className="fw-semibold">
                                {task.task_type_name || task.task_type?.name || task.task_type_key}
                              </div>
                              <div className="small text-secondary mt-1">
                                {formatWorkflowStageLabel(task.status)}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="workflow-task-dates">
                              <div>
                                <span className="workflow-task-dates-label">Assigned</span>
                                <span>{formatDateTime(task.assigned_at)}</span>
                              </div>
                              <div>
                                <span className="workflow-task-dates-label">Started</span>
                                <span>{formatDateTime(task.started_at)}</span>
                              </div>
                              <div>
                                <span className="workflow-task-dates-label">Due</span>
                                <span>{formatDateOnly(task.due_date)}</span>
                              </div>
                              <div>
                                <span className="workflow-task-dates-label">Complete</span>
                                <span>{formatDateTime(task.completed_at)}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="workflow-task-flow-cell">
                              <WorkflowTaskStageBar
                                task={task}
                                disabled={isBusy}
                                isStepClickable={(stepKey) =>
                                  (stepKey === "started" && actions.canStart)
                                  || (stepKey === "complete" && actions.canComplete)
                                  || (stepKey === "approved" && actions.canApprove)
	                                  || (
	                                    (stepKey === "uploaded" || isWorkflowUploadStepKey(stepKey)) &&
	                                    actions.canUpload &&
	                                    isUploadStepPending(task, stepKey)
	                                  )
                                }
                                onStepClick={(stepKey) => handleStageClick(task, stepKey)}
                              />

                              {isCompletePromptOpen && (
                                <div className="workflow-stage-popover workflow-task-quick-note mt-3">
                                  <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                                    <div>
                                      <div className="fw-semibold">
                                        Mark Complete
                                      </div>
                                      <div className="small text-secondary">
                                        Add an optional completion note, then keep moving from the table.
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() =>
                                        setNotePrompt({
                                          taskId: "",
                                          type: "",
                                          note: "",
                                          dueDate: "",
                                        })
                                      }
                                      disabled={isBusy}
                                    >
                                      Close
                                    </button>
                                  </div>
                                  <label className="form-label">Completion Comment</label>
                                  <textarea
                                    rows="2"
                                    className="form-control"
                                    placeholder="Add a short completion note"
                                    value={notePrompt.note}
                                    onChange={(event) =>
                                      setNotePrompt((prev) => ({
                                        ...prev,
                                        note: event.target.value,
                                      }))
                                    }
                                  />
                                  <div className="d-flex justify-content-end gap-2 mt-3">
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() =>
                                        setNotePrompt({
                                          taskId: "",
                                          type: "",
                                          note: "",
                                          dueDate: "",
                                        })
                                      }
                                      disabled={isBusy}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      onClick={() => handleConfirmNote(task)}
                                      disabled={isBusy}
                                    >
                                      {isBusy
                                        ? "Saving..."
                                        : "Save Complete"}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="workflow-task-actions">
                              <button
                                type="button"
                                className="workflow-icon-button"
                                onClick={() => setSelectedTaskId(task._id)}
                                title="View task details"
                                aria-label="View task details"
                              >
                                <img src={WORKFLOW_ACTION_ICONS.info} alt="" />
                              </button>
                              {actions.canRework && (
                                <button
                                  type="button"
                                  className="workflow-icon-button is-accent"
                                  disabled={isBusy}
                                  onClick={() => handleReworkAction(task)}
                                  title={`Send to rework (${reworkCount})`}
                                  aria-label="Send to rework"
                                >
                                  <img src={WORKFLOW_ACTION_ICONS.rework} alt="" />
                                </button>
                              )}
                              {(canDeleteWorkflow || actions.createdByCurrentUser) && (
                                <button
                                  type="button"
                                  className="workflow-icon-button is-danger"
                                  disabled={isBusy}
                                  onClick={() => handleDeleteTask(task)}
                                  title="Delete task"
                                  aria-label="Delete task"
                                >
                                  <img src={WORKFLOW_ACTION_ICONS.delete} alt="" />
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
          departments={departments}
          brandOptions={availableBrandOptions}
          canManageWorkflow={canManageWorkflow}
          canAssignWorkflow={canAssignWorkflow}
          canEditTaskDetails={canEditWorkflow}
          canEditAnyTaskDetails={isAdmin && canEditWorkflow}
          canDeleteWorkflow={canDeleteWorkflow}
          canDeleteOwnTask={canViewWorkflow}
          onClose={() => setSelectedTaskId("")}
          onUpdated={() => {
            setRefreshTick((prev) => prev + 1);
          }}
          onDeleted={() => {
            setSelectedTaskId("");
            setRefreshTick((prev) => prev + 1);
          }}
        />
      )}

      {showFolderCreateModal && (
        <WorkflowBatchCreateModal
          taskTypes={taskTypes}
          availableUsers={users}
          brandOptions={availableBrandOptions}
          onClose={() => setShowFolderCreateModal(false)}
          onCreated={() => {
            setShowFolderCreateModal(false);
            setSuccess("Tasks created from folder successfully.");
            setRefreshTick((prev) => prev + 1);
          }}
        />
      )}

      {showCreateModal && (
        <WorkflowTaskCreateModal
          taskTypes={taskTypes}
          departments={departments}
          availableUsers={users}
          brandOptions={availableBrandOptions}
          defaultTaskTypeKey={taskTypeFilter}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            setSuccess("Workflow task created successfully.");
            setRefreshTick((prev) => prev + 1);
          }}
        />
      )}

      {notePrompt.type === "rework" && notePrompt.taskId && (
        <div
          className="modal d-block om-modal-backdrop"
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
          onClick={() =>
            setNotePrompt({
              taskId: "",
              type: "",
              note: "",
              dueDate: "",
            })
          }
        >
          <div
            className="modal-dialog modal-dialog-centered workflow-quick-modal-dialog"
            role="document"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <div>
                  <h5 className="modal-title">Send to Rework</h5>
                  <div className="small text-muted">
                    {activePromptTask?.title || activePromptTask?.task_no || "Add a rework note"}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() =>
                    setNotePrompt({
                      taskId: "",
                      type: "",
                      note: "",
                      dueDate: "",
                    })
                  }
                  disabled={actionTaskId === notePrompt.taskId}
                />
                <div className="mt-3">
                  <label className="form-label">Next Due Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={notePrompt.dueDate}
                    onChange={(event) =>
                      setNotePrompt((prev) => ({
                        ...prev,
                        dueDate: event.target.value,
                      }))
                    }
                    disabled={actionTaskId === notePrompt.taskId}
                  />
                </div>
              </div>
              <div className="modal-body">
                <label className="form-label">Rework Comment</label>
                <textarea
                  rows="3"
                  className="form-control"
                  placeholder="Explain what needs to be fixed"
                  value={notePrompt.note}
                  onChange={(event) =>
                    setNotePrompt((prev) => ({
                      ...prev,
                      note: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() =>
                    setNotePrompt({
                      taskId: "",
                      type: "",
                      note: "",
                      dueDate: "",
                    })
                  }
                  disabled={actionTaskId === notePrompt.taskId}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleConfirmNote(activePromptTask || { _id: notePrompt.taskId })}
                  disabled={actionTaskId === notePrompt.taskId}
                >
                  {actionTaskId === notePrompt.taskId ? "Saving..." : "Confirm Rework"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default WorkflowTasksPanel;
