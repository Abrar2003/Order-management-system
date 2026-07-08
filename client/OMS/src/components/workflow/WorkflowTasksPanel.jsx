import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/axios";
import { getUserFromToken } from "../../auth/auth.service";
import { isManagerLikeRole, isStrictAdminRole } from "../../auth/permissions";
import { usePermissions } from "../../auth/PermissionContext";
import {
  approveWorkflowTask,
  approveWorkflowTaskHold,
  bulkUpdateWorkflowBatchTasks,
  completeWorkflowTask,
  deleteWorkflowBatch,
  deleteWorkflowTask,
  getWorkflowDepartments,
  getWorkflowTaskTypes,
  getWorkflowTasks,
  getWorkflowUsers,
  rejectWorkflowTaskHold,
  requestWorkflowTaskHold,
  resumeWorkflowTask,
  sendWorkflowTaskToRework,
  startWorkflowTask,
  uploadWorkflowTask,
} from "../../api/workflowApi";
import { useRememberSearchParams } from "../../hooks/useRememberSearchParams";
import useWorkflowRealtime from "../../hooks/useWorkflowRealtime";
import { formatDateOnlyIST, formatDateTimeIST } from "../../utils/date";
import { getOptionText } from "../../utils/optionText";
import { areSearchParamsEquivalent } from "../../utils/searchParams";
import HoverPortal from "../HoverPortal";
import WorkflowBatchBulkActionsModal from "./WorkflowBatchBulkActionsModal";
import WorkflowBatchCreateModal from "./WorkflowBatchCreateModal";
import WorkflowTaskCreateModal from "./WorkflowTaskCreateModal";
import WorkflowTaskDetailModal from "./WorkflowTaskDetailModal";
import WorkflowTaskStageBar from "./WorkflowTaskStageBar";
import {
  formatWorkflowStageLabel,
  getWorkflowUploadStatuses,
  isWorkflowUploadStepKey,
} from "./workflowTaskProgress";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const normalizeText = (value) => String(value ?? "").trim();
const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      values.map(getOptionText).filter(Boolean),
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

const formatRealtimeStatusLabel = (connectionState = "") => {
  if (connectionState === "live") return "Live";
  if (connectionState === "connecting") return "Connecting";
  if (connectionState === "error") return "Realtime offline";
  return "Offline";
};

const formatDateTime = (value) => formatDateTimeIST(value);

const formatDateOnly = (value) => formatDateOnlyIST(value);

const formatOrdinal = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "Due Date";
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th Due Date`;
  const mod10 = number % 10;
  if (mod10 === 1) return `${number}st Due Date`;
  if (mod10 === 2) return `${number}nd Due Date`;
  if (mod10 === 3) return `${number}rd Due Date`;
  return `${number}th Due Date`;
};

const compareDateValues = (left, right) => {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime;
};

const getTaskUserId = (entry = {}) =>
  entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || "";

const getTaskUserName = (entry = {}) =>
  entry?.user?.name || entry?.user?.email || entry?.name || entry?.email || "User";

const getPendingUploadUserNames = (task = {}) =>
  normalizeDistinctValues(
    getWorkflowUploadStatuses(task)
      .filter((entry) => normalizeText(entry?.status).toLowerCase() !== "uploaded")
      .map((entry) => getTaskUserName(entry)),
  );

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

const getTaskId = (task = {}) => String(task?._id || task?.taskId || "");

const taskMatchesVisibleFilters = (task = {}, filters = {}) => {
  if (!getTaskId(task)) return false;
  const search = normalizeText(filters.search).toLowerCase();
  if (search) {
    const haystack = [task.task_no, task.title, task.brand, task.task_type_name, task.task_type_key]
      .map(normalizeText)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (filters.statusFilter) {
    if (filters.statusFilter === "upload_pending") {
      const hasPendingUpload = (Array.isArray(task.upload_statuses) ? task.upload_statuses : [])
        .some((entry) => normalizeText(entry?.status).toLowerCase() !== "uploaded");
      if (!(task.status === "approved" && hasPendingUpload)) return false;
    } else if (!["open", "complete_and_beyond", "upload_remaining"].includes(filters.statusFilter)) {
      if (normalizeText(task.status) !== normalizeText(filters.statusFilter)) return false;
    }
  }
  if (filters.taskTypeFilter && normalizeText(task.task_type_key) !== normalizeText(filters.taskTypeFilter)) {
    return false;
  }
  if (filters.brandFilter && normalizeText(task.brand) !== normalizeText(filters.brandFilter)) {
    return false;
  }
  if (filters.assigneeFilter) {
    const assigneeIds = (Array.isArray(task.assigned_to) ? task.assigned_to : [])
      .map((entry) => String(entry?.user?._id || entry?.user || entry?._id || entry || ""));
    if (!assigneeIds.includes(String(filters.assigneeFilter))) return false;
  }
  return true;
};

const WORKFLOW_ACTION_ICONS = Object.freeze({
  info: "/workflow-icons/info.png",
  delete: "/workflow-icons/delete.png",
  rework: "/workflow-icons/rework.png",
});
const TASK_STATUS_FILTER_OPTIONS = Object.freeze([
  { value: "complete_done", label: "Complete" },
  { value: "complete", label: "Stage Complete" },
  { value: "complete_and_beyond", label: "Complete + Later" },
  { value: "open", label: "Open" },
  { value: "hold", label: "Hold" },
  { value: "hold_approval_pending", label: "Hold Approval Pending" },
  { value: "needs_approval", label: "Needs Approval" },
  { value: "upload_remaining", label: "Upload Remaining" },
  { value: "overdue", label: "Overdue" },
  { value: "approval_overdue", label: "Approval Overdue" },
  { value: "upload_overdue", label: "Upload Overdue" },
  { value: "delayed", label: "Delayed" },
  { value: "approval_delay", label: "Approval Delay" },
  { value: "upload_delay", label: "Upload Delay" },
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
  canAdminWorkflow = false,
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
    canRework:
      (canManageWorkflow || canAdminWorkflow || createdByCurrentUser) &&
      ["complete", "approved", "uploaded"].includes(task?.status),
    canApprove: assignedByCurrentUser && task?.status === "complete",
    canRequestHold:
      task?.status !== "hold" &&
      task?.status !== "uploaded" &&
      (assignedToCurrentUser || createdByCurrentUser || canAdminWorkflow) &&
      task?.hold?.status !== "pending",
    canApproveHold:
      task?.status !== "hold" &&
      task?.hold?.status === "pending" &&
      (createdByCurrentUser || canAdminWorkflow),
    canRejectHold:
      task?.status !== "hold" &&
      task?.hold?.status === "pending" &&
      (createdByCurrentUser || canAdminWorkflow),
    canResume:
      task?.status === "hold" &&
      (createdByCurrentUser || canAdminWorkflow),
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

const HoldPill = ({ hold = {} }) => {
  if (!["pending", "hold"].includes(normalizeText(hold?.status).toLowerCase())) {
    return null;
  }

  const isPending = normalizeText(hold.status).toLowerCase() === "pending";
  const label = isPending ? "Hold Pending" : "HOLD";
  const comment = hold?.approved_comment || hold?.requested_comment || "";
  return (
    <span
      className={`workflow-hold-badge ${isPending ? "is-pending" : "is-active"}`}
      title={comment || label}
    >
      {label}
    </span>
  );
};

const ReworkDueDateHover = ({ taskId = "", dueDate = "", entries = [] }) => {
  const history = Array.isArray(entries)
    ? entries
        .filter((entry) => entry?.date)
        .sort((left, right) => compareDateValues(left?.date, right?.date))
    : [];
  const trigger = (
    <span
      className={`workflow-due-date-value ${history.length > 0 ? "has-history" : ""}`}
      tabIndex={history.length > 0 ? 0 : -1}
    >
      {formatDateOnly(dueDate)}
    </span>
  );

  if (history.length === 0) {
    return trigger;
  }

  return (
    <HoverPortal
      className="workflow-rework-portal-trigger"
      panelClassName="workflow-rework-hovercard"
      align="left"
      trigger={trigger}
    >
      <span className="workflow-rework-hovercard-title">
        Rework Due Date History
      </span>
      <span className="workflow-rework-hovercard-list">
        <span className="workflow-rework-hovercard-item">
          <span className="workflow-rework-hovercard-comment">
            Main Due Date
          </span>
          <span className="workflow-rework-hovercard-meta">
            {formatDateOnly(dueDate)}
          </span>
        </span>
        {history.map((entry, index) => (
          <span
            key={`${taskId}-rework-due-${index}`}
            className="workflow-rework-hovercard-item"
          >
            <span className="workflow-rework-hovercard-comment">
              {formatOrdinal(index + 1)}
            </span>
            <span className="workflow-rework-hovercard-meta">
              {formatDateOnly(entry?.date)}
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
  const [bulkBatchRow, setBulkBatchRow] = useState(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkActionResult, setBulkActionResult] = useState(null);
  const [bulkActionError, setBulkActionError] = useState("");
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
  const [pendingRealtimeUpdates, setPendingRealtimeUpdates] = useState(0);
  const [actionTaskId, setActionTaskId] = useState("");
  const [expandedBatchIds, setExpandedBatchIds] = useState(() => new Set());
  const [notePrompt, setNotePrompt] = useState({
    taskId: "",
    type: "",
    note: "",
    dueDate: "",
  });

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
      setPendingRealtimeUpdates(0);
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

  const currentTaskFilters = useMemo(
    () => ({
      search,
      statusFilter,
      taskTypeFilter,
      assigneeFilter: mineOnly && isAdmin ? currentUserId : assigneeFilter,
      brandFilter,
    }),
    [assigneeFilter, brandFilter, currentUserId, isAdmin, mineOnly, search, statusFilter, taskTypeFilter],
  );

  const patchVisibleTask = useCallback((nextTask) => {
    const nextTaskId = getTaskId(nextTask);
    if (!nextTaskId) return false;
    let patched = false;
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (getTaskId(row) === nextTaskId) {
          patched = true;
          return { ...row, ...nextTask };
        }
        if (row?.is_batch_group && Array.isArray(row.child_tasks)) {
          const childTasks = row.child_tasks.map((childTask) => {
            if (getTaskId(childTask) !== nextTaskId) return childTask;
            patched = true;
            return { ...childTask, ...nextTask };
          });
          return patched ? { ...row, child_tasks: childTasks } : row;
        }
        return row;
      }),
    );
    return patched;
  }, []);

  const removeVisibleTask = useCallback((taskId) => {
    if (!taskId) return;
    setRows((currentRows) =>
      currentRows
        .filter((row) => getTaskId(row) !== String(taskId))
        .map((row) => {
          if (!row?.is_batch_group || !Array.isArray(row.child_tasks)) return row;
          return {
            ...row,
            child_tasks: row.child_tasks.filter((childTask) => getTaskId(childTask) !== String(taskId)),
          };
        }),
    );
  }, []);

  const handleRealtimeTaskCreated = useCallback((payload) => {
    if (payload?.shouldRefetch) {
      setPendingRealtimeUpdates((count) => count + 1);
      return;
    }
    if (page === 1 && taskMatchesVisibleFilters(payload, currentTaskFilters)) {
      setRows((currentRows) =>
        currentRows.some((row) => getTaskId(row) === getTaskId(payload))
          ? currentRows
          : [payload, ...currentRows].slice(0, limit),
      );
      setPagination((current) => ({
        ...current,
        totalRecords: Number(current.totalRecords || 0) + 1,
      }));
      return;
    }
    setPendingRealtimeUpdates((count) => count + 1);
  }, [currentTaskFilters, limit, page]);

  const handleRealtimeTaskUpdated = useCallback((payload) => {
    const taskId = getTaskId(payload);
    if (!taskId) return;
    if (payload?.shouldRefetch && !taskMatchesVisibleFilters(payload, currentTaskFilters)) {
      removeVisibleTask(taskId);
      setPendingRealtimeUpdates((count) => count + 1);
      return;
    }
    const patched = patchVisibleTask(payload);
    if (!patched && payload?.shouldRefetch) {
      setPendingRealtimeUpdates((count) => count + 1);
    }
  }, [currentTaskFilters, patchVisibleTask, removeVisibleTask]);

  const handleRealtimeTaskDeleted = useCallback((payload) => {
    removeVisibleTask(payload?._id || payload?.taskId);
    setPagination((current) => ({
      ...current,
      totalRecords: Math.max(0, Number(current.totalRecords || 0) - 1),
    }));
  }, [removeVisibleTask]);

  const handleRealtimeBatchUpdated = useCallback((payload) => {
    if (payload?.shouldRefetch) {
      setPendingRealtimeUpdates((count) => count + 1);
    }
  }, []);

  const { connectionState } = useWorkflowRealtime({
    enabled: canViewWorkflow,
    joinDashboard: isAdmin && !mineOnly && canViewWorkflow,
    userId: canViewWorkflow && (!isAdmin || mineOnly) ? currentUserId : "",
    onTaskCreated: handleRealtimeTaskCreated,
    onTaskUpdated: handleRealtimeTaskUpdated,
    onTaskDeleted: handleRealtimeTaskDeleted,
    onBatchUpdated: !mineOnly ? handleRealtimeBatchUpdated : undefined,
    onForceRefetch: loadTasks,
    onSyncRequired: loadTasks,
  });

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

  const handleDeleteBatchGroup = async (batchRow) => {
    const batchId = batchRow?.batch?._id || batchRow?.batch?.id || "";
    if (!batchId) {
      setError("Batch id is missing for this row.");
      return;
    }

    const confirmed = window.confirm(
      `Delete workflow batch ${batchRow?.batch_no || batchRow?.title || "this batch"} and all tasks inside it?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Enter delete note (optional)") || "";
    await handleQuickAction(
      () =>
        deleteWorkflowBatch(batchId, {
          note: normalizeText(reason),
        }),
      "Workflow batch and all tasks inside it deleted successfully.",
      { taskId: batchRow?._id },
    );
  };

  const handleOpenBatchBulkActions = (batchRow) => {
    setBulkActionError("");
    setBulkActionResult(null);
    setBulkBatchRow(batchRow);
  };

  const handleSubmitBatchBulkActions = async (payload = {}) => {
    if (payload?.__client_error) {
      setBulkActionError(payload.__client_error);
      return;
    }
    const batchId = String(
      bulkBatchRow?.batch?._id || bulkBatchRow?.batch?.id || bulkBatchRow?._id || "",
    ).replace(/^batch:/, "");
    if (!batchId) {
      setBulkActionError("Batch id is missing for this row.");
      return;
    }
    setBulkActionLoading(true);
    setBulkActionError("");
    setBulkActionResult(null);
    try {
      const result = await bulkUpdateWorkflowBatchTasks(batchId, payload);
      const data = result?.data || {};
      setBulkActionResult(data);
      setSuccess(
        `Batch bulk update applied to ${Number(data?.affected_task_count || 0)} task(s).`,
      );
      setPendingRealtimeUpdates((count) => count + 1);
      setRefreshTick((prev) => prev + 1);
    } catch (bulkError) {
      setBulkActionError(
        bulkError?.response?.data?.message
          || bulkError?.message
          || "Failed to update batch tasks.",
      );
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleStageClick = async (task, stepKey) => {
    const actions = getTaskActionState({
      task,
      currentUserId,
      canManageWorkflow,
      canAdminWorkflow: isAdmin,
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

  const handleHoldAction = (task, type = "hold") => {
    setError("");
    setSuccess("");
    setNotePrompt({
      taskId: task._id,
      type,
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

    if (notePrompt.type === "hold" && !note) {
      setError("Hold comment is required.");
      return;
    }

    if (notePrompt.type === "resume" && !normalizeText(notePrompt.dueDate)) {
      setError("New due date is required to resume this task.");
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

    if (notePrompt.type === "hold") {
      const creatorHold =
        String(getTaskUserId(task?.created_by)) === String(currentUserId);
      await handleQuickAction(
        () => requestWorkflowTaskHold(task._id, { note }),
        isAdmin || creatorHold ? "Task put on hold." : "Task hold request submitted.",
        {
          taskId: task._id,
          closeNotePrompt: true,
        },
      );
      return;
    }

    if (notePrompt.type === "approve_hold") {
      await handleQuickAction(
        () => approveWorkflowTaskHold(task._id, { note }),
        "Task hold approved.",
        {
          taskId: task._id,
          closeNotePrompt: true,
        },
      );
      return;
    }

    if (notePrompt.type === "reject_hold") {
      await handleQuickAction(
        () => rejectWorkflowTaskHold(task._id, { note }),
        "Task hold rejected.",
        {
          taskId: task._id,
          closeNotePrompt: true,
        },
      );
      return;
    }

    if (notePrompt.type === "resume") {
      await handleQuickAction(
        () =>
          resumeWorkflowTask(task._id, {
            note,
            due_date: normalizeText(notePrompt.dueDate),
          }),
        "Task resumed successfully.",
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

  const toggleBatchExpanded = useCallback((batchId = "") => {
    const normalizedBatchId = normalizeText(batchId);
    if (!normalizedBatchId) return;
    setExpandedBatchIds((current) => {
      const next = new Set(current);
      if (next.has(normalizedBatchId)) {
        next.delete(normalizedBatchId);
      } else {
        next.add(normalizedBatchId);
      }
      return next;
    });
  }, []);

  const visibleRows = useMemo(() => {
    const flattenedRows = [];
    rows.forEach((row) => {
      flattenedRows.push(row);
      if (row?.is_batch_group && expandedBatchIds.has(String(row._id))) {
        (Array.isArray(row.child_tasks) ? row.child_tasks : []).forEach((childTask) => {
          flattenedRows.push({
            ...childTask,
            _is_batch_child: true,
            _parent_batch_row_id: row._id,
          });
        });
      }
    });
    return flattenedRows;
  }, [expandedBatchIds, rows]);

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
              {pendingRealtimeUpdates > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => setRefreshTick((prev) => prev + 1)}
                >
                  {pendingRealtimeUpdates} update{pendingRealtimeUpdates === 1 ? "" : "s"}
                </button>
              )}
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
                      <th>Brand</th>
                      <th>Task Type</th>
                      <th>Dates</th>
                      <th>Status Flow</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((task) => {
                      const isBatchGroup = Boolean(task?.is_batch_group);
                      const isBatchChild = Boolean(task?._is_batch_child);
                      const actions = getTaskActionState({
                        task,
                        currentUserId,
                        canManageWorkflow: isBatchGroup ? false : canManageWorkflow,
                        canAdminWorkflow: isBatchGroup ? false : isAdmin,
                      });
                      const isBusy = actionTaskId === task._id;
                      const isCompletePromptOpen =
                        notePrompt.taskId === task._id && notePrompt.type === "complete";
                      const assigneeText =
                        Array.isArray(task.assigned_to) && task.assigned_to.length > 0
                          ? task.assigned_to.map((entry) => getTaskUserName(entry)).join(", ")
                          : "Unassigned";
                      const assignedByText =
                        task?.assigned_by?.name
                        || task?.assigned_by?.user?.name
                        || task?.assigned_by?.user?.email
                        || task?.assigned_by?.email
                        || "—";
                      const uploadPendingUserNames = getPendingUploadUserNames(task);
                      const reworkCount = Number(task?.reworked?.count || task?.rework_count || 0);
                      const reworkComments = Array.isArray(task?.reworked?.comments)
                        ? [...task.reworked.comments].reverse()
                        : [];
                      const reworkDueDateHistory = Array.isArray(task?.rework_due_dates)
                        ? task.rework_due_dates
                        : [];
                      const taskBrand = normalizeText(task?.brand || task?.batch?.brand);

                      return (
                        <tr
                          key={`${task._parent_batch_row_id || ""}-${task._id}`}
                          className={[
                            isBatchGroup ? "workflow-batch-group-row" : "",
                            isBatchChild ? "workflow-batch-child-row" : "",
                          ].filter(Boolean).join(" ")}
                        >
                          <td>
                            <div className="workflow-task-name-cell">
                              <div className="d-flex align-items-center gap-2">
                                {isBatchGroup && (
                                  <button
                                    type="button"
                                    className="workflow-batch-accordion-button"
                                    onClick={() => toggleBatchExpanded(task._id)}
                                    aria-expanded={expandedBatchIds.has(String(task._id))}
                                    title={expandedBatchIds.has(String(task._id)) ? "Collapse batch tasks" : "Expand batch tasks"}
                                  >
                                    {expandedBatchIds.has(String(task._id)) ? "−" : "+"}
                                  </button>
                                )}
                                {isBatchChild && (
                                  <span className="workflow-batch-child-marker" aria-hidden="true" />
                                )}
                                <div>
                                  <div className="small text-secondary">
                                    Assigned by: {assignedByText}
                                  </div>
                                  <div className="fw-semibold">
                                    {task.title}
                                  </div>
                                  {isBatchGroup && (
                                    <div className="small text-secondary">
                                      Batch: {task.batch_no || task?.batch?.batch_no || "—"} • {Number(task?.batch_counts?.total_tasks || task?.child_tasks?.length || 0)} tasks
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="small text-secondary mt-1">
                                {assigneeText}
                              </div>
                              {uploadPendingUserNames.length > 0 && (
                                <div className="small text-secondary">
                                  Upload Pending: {uploadPendingUserNames.join(", ")}
                                </div>
                              )}
                              {isBatchGroup && (
                                <div className="workflow-batch-count-line">
                                  <span>Started: {Number(task?.batch_counts?.started_tasks || 0)}</span>
                                  <span>Completed: {Number(task?.batch_counts?.complete_done_tasks || 0)}</span>
                                  <span>Approved: {Number(task?.batch_counts?.approved_tasks || 0)}</span>
                                </div>
                              )}
                              <div className="workflow-task-rework-line">
                                <ReworkHoverBadge
                                  taskId={task._id}
                                  count={reworkCount}
                                  comments={reworkComments}
                                />
                                <HoldPill hold={task?.hold} />
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="workflow-task-brand-value">
                              {taskBrand || "—"}
                            </span>
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
                                <ReworkDueDateHover
                                  taskId={task._id}
                                  dueDate={task.active_due_date || task.due_date}
                                  entries={reworkDueDateHistory}
                                />
                              </div>
                              <div>
                                <span className="workflow-task-dates-label">Approval Limit</span>
                                <span>{formatDateOnly(task?.deadline_summary?.approval_deadline)}</span>
                              </div>
                              {task?.upload_required !== false && (
                                <div>
                                  <span className="workflow-task-dates-label">Upload Limit</span>
                                  <span>{formatDateOnly(task?.deadline_summary?.upload_deadline)}</span>
                                </div>
                              )}
                              <div>
                                <span className="workflow-task-dates-label">Complete</span>
                                <span>{formatDateTime(task.completed_at)}</span>
                              </div>
                              <div>
                                <span className="workflow-task-dates-label">
                                  {task?.upload_required === false ? "Approved" : "Uploaded"}
                                </span>
                                <span>
                                  {formatDateTime(
                                    task?.upload_required === false
                                      ? task.approved_at
                                      : task.uploaded_at,
                                  )}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="workflow-task-flow-cell">
                              <WorkflowTaskStageBar
                                task={task}
                                disabled={isBusy}
                                isStepClickable={(stepKey) =>
                                  !isBatchGroup && (
                                  (stepKey === "started" && actions.canStart)
                                  || (stepKey === "complete" && actions.canComplete)
                                  || (stepKey === "approved" && actions.canApprove)
	                                  || (
	                                    (stepKey === "uploaded" || isWorkflowUploadStepKey(stepKey)) &&
	                                    actions.canUpload &&
	                                    isUploadStepPending(task, stepKey)
	                                  )
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
                            <div
                              className={`workflow-task-actions ${
                                actions.canApproveHold ? "is-hold-decision" : ""
                              } ${
                                actions.canRequestHold ? "is-hold-request" : ""
                              }`}
                            >
                              <div className="workflow-task-primary-actions">
                                {actions.canApproveHold && (
                                  <div className="workflow-task-decision-group">
                                    <button
                                      type="button"
                                      className="btn btn-warning btn-sm workflow-task-action-button"
                                      disabled={isBusy}
                                      onClick={() => handleHoldAction(task, "approve_hold")}
                                      title="Approve hold request"
                                    >
                                      Approve Hold
                                    </button>
                                    {actions.canRejectHold && (
                                      <button
                                        type="button"
                                        className="btn btn-outline-danger btn-sm workflow-task-action-button"
                                        disabled={isBusy}
                                        onClick={() => handleHoldAction(task, "reject_hold")}
                                        title="Reject hold request"
                                      >
                                        Reject
                                      </button>
                                    )}
                                  </div>
                                )}
                                {!actions.canApproveHold && actions.canRequestHold && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-warning btn-sm workflow-task-action-button"
                                    disabled={isBusy || task?.hold?.status === "pending"}
                                    onClick={() => handleHoldAction(task, "hold")}
                                    title={
                                      task?.hold?.status === "pending"
                                        ? "Hold request is pending"
                                        : isAdmin || actions.createdByCurrentUser
                                        ? "Put task on hold"
                                        : "Request hold"
                                    }
                                  >
                                    Hold
                                  </button>
                                )}
                                {actions.canResume && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-success btn-sm workflow-task-action-button"
                                    disabled={isBusy}
                                    onClick={() => handleHoldAction(task, "resume")}
                                    title="Resume held task"
                                  >
                                    Resume
                                  </button>
                                )}
                                {isBatchGroup && canManageWorkflow && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm workflow-task-action-button"
                                    disabled={isBusy}
                                    onClick={() => handleOpenBatchBulkActions(task)}
                                    title="Edit batch shared fields and bulk task actions"
                                  >
                                    Edit / Bulk
                                  </button>
                                )}
                              </div>

                              <div className="workflow-task-utility-actions">
                                {!isBatchGroup && (
                                  <button
                                    type="button"
                                    className="workflow-icon-button"
                                    onClick={() => setSelectedTaskId(task._id)}
                                    title="View task details"
                                    aria-label="View task details"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10"></circle>
                                      <line x1="12" y1="16" x2="12" y2="12"></line>
                                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                    </svg>
                                  </button>
                                )}
                                {actions.canRework && (
                                  <button
                                    type="button"
                                    className="workflow-icon-button is-accent"
                                    disabled={isBusy}
                                    onClick={() => handleReworkAction(task)}
                                    title={`Send to rework (${reworkCount})`}
                                    aria-label="Send to rework"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                                    </svg>
                                  </button>
                                )}
                                {isBatchGroup && canDeleteWorkflow && (
                                  <button
                                    type="button"
                                    className="workflow-icon-button is-danger"
                                    disabled={isBusy}
                                    onClick={() => handleDeleteBatchGroup(task)}
                                    title="Delete batch and all tasks"
                                    aria-label="Delete batch and all tasks"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3 6 5 6 21 6"></polyline>
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                      <line x1="10" y1="11" x2="10" y2="17"></line>
                                      <line x1="14" y1="11" x2="14" y2="17"></line>
                                    </svg>
                                  </button>
                                )}
                                {!isBatchGroup && (canDeleteWorkflow || actions.createdByCurrentUser) && (
                                  <button
                                    type="button"
                                    className="workflow-icon-button is-danger"
                                    disabled={isBusy}
                                    onClick={() => handleDeleteTask(task)}
                                    title="Delete task"
                                    aria-label="Delete task"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3 6 5 6 21 6"></polyline>
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                      <line x1="10" y1="11" x2="10" y2="17"></line>
                                      <line x1="14" y1="11" x2="14" y2="17"></line>
                                    </svg>
                                  </button>
                                )}
                              </div>
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

      {["rework", "hold", "approve_hold", "reject_hold", "resume"].includes(notePrompt.type) && notePrompt.taskId && (
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
              <div className="modal-header workflow-quick-modal-header">
                <button
                  type="button"
                  className="btn-close workflow-quick-modal-close"
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
                <div className="workflow-quick-modal-title-block">
                  <h5 className="modal-title">
                    {notePrompt.type === "rework"
                      ? "Send to Rework"
                      : notePrompt.type === "approve_hold"
                      ? "Approve Hold"
                      : notePrompt.type === "reject_hold"
                      ? "Reject Hold"
                      : notePrompt.type === "resume"
                      ? "Resume Task"
                      : "Request Hold"}
                  </h5>
                  <div className="small text-muted">
                    {activePromptTask?.title || activePromptTask?.task_no || "Add a note"}
                  </div>
                </div>
                {["rework", "resume"].includes(notePrompt.type) && (
                <div className="workflow-quick-modal-date">
                  <label className="form-label">
                    {notePrompt.type === "resume" ? "New Due Date" : "Next Due Date"}
                  </label>
                  <input
                    type="date"
                    className="form-control"
                    required={notePrompt.type === "resume"}
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
                )}
              </div>
              <div className="modal-body">
                <label className="form-label">
                  {notePrompt.type === "rework"
                    ? "Rework Comment"
                    : notePrompt.type === "resume"
                    ? "Resume Comment"
                    : notePrompt.type === "reject_hold"
                    ? "Reject Comment"
                    : "Hold Comment"}
                </label>
                <textarea
                  rows="3"
                  className="form-control"
                  placeholder={
                    notePrompt.type === "rework"
                      ? "Explain what needs to be fixed"
                      : notePrompt.type === "resume"
                      ? "Add an optional resume note"
                      : notePrompt.type === "reject_hold"
                      ? "Add an optional reject note"
                      : "Explain why this task should be on hold"
                  }
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
                  className={
                    notePrompt.type === "rework"
                      ? "btn btn-danger"
                      : notePrompt.type === "reject_hold"
                      ? "btn btn-secondary"
                      : notePrompt.type === "resume"
                      ? "btn btn-success"
                      : "btn btn-warning"
                  }
                  onClick={() => handleConfirmNote(activePromptTask || { _id: notePrompt.taskId })}
                  disabled={actionTaskId === notePrompt.taskId}
                >
                  {actionTaskId === notePrompt.taskId
                    ? "Saving..."
                    : notePrompt.type === "rework"
                    ? "Confirm Rework"
                    : notePrompt.type === "approve_hold"
                    ? "Approve Hold"
                    : notePrompt.type === "reject_hold"
                    ? "Reject Hold"
                    : notePrompt.type === "resume"
                    ? "Resume Task"
                    : "Submit Hold"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <WorkflowBatchBulkActionsModal
        show={Boolean(bulkBatchRow)}
        batch={bulkBatchRow}
        tasks={bulkBatchRow?.child_tasks || []}
        users={users}
        taskTypes={taskTypes}
        loading={bulkActionLoading}
        result={bulkActionResult}
        error={bulkActionError}
        onClose={() => setBulkBatchRow(null)}
        onSubmit={handleSubmitBatchBulkActions}
      />
    </>
  );
};

export default WorkflowTasksPanel;
