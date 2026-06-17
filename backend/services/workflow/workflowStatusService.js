const mongoose = require("mongoose");
const { buildAuditActor } = require("../../helpers/permissions");
const User = require("../../models/user.model");
const {
  buildWorkflowTaskStatusNormalizationExpression,
  buildWorkflowManualTaskNo,
  getWorkflowStatusFilterValues,
  WORKFLOW_ALLOWED_STATUS_TRANSITIONS,
  WORKFLOW_TASK_COMMENT_TYPES,
  WORKFLOW_TASK_PRIORITIES,
  WORKFLOW_TASK_STATUSES,
  normalizeKey,
  normalizeWorkflowTaskStatus,
  normalizeText,
} = require("../../helpers/workflow");
const {
  Comment,
  Batch,
  Department,
  Task,
  TaskAssignment,
  TaskStatusHistory,
  TaskType,
} = require("../../models/workflow");
const {
  canApproveWorkflowTask,
  canCompleteWorkflowTask,
  canDeleteWorkflowTask,
  canEditWorkflowTaskDetails,
  canReadWorkflowTask,
  canUploadWorkflowTask,
  isAdmin,
  isManagerOrAdmin,
  isPrivilegedWorkflowReader,
  isTaskCreatedByUser,
} = require("./workflowPermissionService");
const { applyDataAccessMatch } = require("../userDataAccess.service");
const { validateAssigneeUsers } = require("./workflowTaskGenerationService");
const {
  recalculateWorkflowBatchFromTasks,
} = require("./workflowBatchAggregationService");
const {
  emitWorkflowBatchUpdated,
  emitWorkflowCommentAdded,
  emitWorkflowTaskCreated,
  emitWorkflowTaskDeleted,
  emitWorkflowTaskUpdated,
} = require("./workflowRealtimeService");
const {
  notifyWorkflowCommentAdded,
  notifyWorkflowTaskEvent,
} = require("../notificationService");

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const WORKFLOW_DUE_TIMEZONE = "Asia/Kolkata";
const INDIA_TIMEZONE_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_COUNT_DELAY_MS = 1000;
const OPEN_TASK_STATUS_VALUES = Object.freeze([
  "assigned",
  "pending",
  "rework",
  "started",
  "in_progress",
]);
const NEEDS_APPROVAL_STATUS_VALUES = Object.freeze([
  "complete",
  "submitted",
  "review",
]);
const PRE_TERMINAL_TASK_STATUSES = Object.freeze([
  "assigned",
  "started",
  "complete",
]);
const PRE_TERMINAL_TASK_STATUS_VALUES = Object.freeze([
  ...OPEN_TASK_STATUS_VALUES,
  ...NEEDS_APPROVAL_STATUS_VALUES,
]);
const DUE_TRACKED_TASK_STATUSES = Object.freeze([
  "assigned",
  "started",
  "complete",
  "approved",
  "uploaded",
]);
const DUE_TRACKED_TASK_STATUS_VALUES = Object.freeze([
  ...OPEN_TASK_STATUS_VALUES,
  ...NEEDS_APPROVAL_STATUS_VALUES,
  "approved",
  "uploaded",
  "completed",
]);
const DASHBOARD_COUNT_FIELDS = Object.freeze([
  "total_tasks",
  "open_tasks",
  "assigned_tasks",
  "started_tasks",
  "complete_tasks",
  "complete_done_tasks",
  "hold_tasks",
  "hold_approval_pending_tasks",
  "approved_tasks",
  "uploaded_tasks",
  "upload_remaining_tasks",
  "reworked_tasks",
  "reworked_before_approval_tasks",
  "reworked_after_approval_tasks",
  "needs_approval_tasks",
  "overdue_tasks",
  "approval_overdue_tasks",
  "upload_overdue_tasks",
  "delayed_tasks",
  "approval_delayed_tasks",
  "upload_delayed_tasks",
  "due_today_tasks",
]);
const WORKFLOW_UPLOAD_ROLE_RANK = Object.freeze({
  super_admin: 10,
  admin: 20,
  manager: 30,
  product_manager: 40,
  inspection_manager: 50,
  qc: 60,
  dev: 70,
  user: 80,
});

const normalizeId = (value) => String(value || "").trim();
const uniqueIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))];
const normalizeRoleKeyForRank = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const getWorkflowUploadRoleRank = (role = "") =>
  WORKFLOW_UPLOAD_ROLE_RANK[normalizeRoleKeyForRank(role)] || 999;
const getUserRefId = (entry = {}) =>
  normalizeId(entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id);

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const toDateOrNull = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getIndianDayStart = (value = new Date()) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const shifted = new Date(parsed.getTime() + INDIA_TIMEZONE_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) - INDIA_TIMEZONE_OFFSET_MS,
  );
};

const isSameIndianDay = (left, right) => {
  const leftDayStart = getIndianDayStart(left);
  const rightDayStart = getIndianDayStart(right);
  if (!leftDayStart || !rightDayStart) return false;
  return leftDayStart.getTime() === rightDayStart.getTime();
};

const addDays = (value, days = 1) => new Date(value.getTime() + Number(days || 0) * DAY_MS);

const isSundayInIndia = (value) => {
  const parsed = getDateOrNull(value);
  if (!parsed) return false;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: WORKFLOW_DUE_TIMEZONE,
    weekday: "short",
  }).format(parsed) === "Sun";
};

const addWorkflowDaysSkippingSunday = (dayStart, days = 2) => {
  const parsedStart = getDateOrNull(dayStart);
  const targetDays = Math.max(0, Number(days || 0));
  if (!parsedStart || targetDays === 0) return parsedStart;

  let cursor = parsedStart;
  let addedDays = 0;
  while (addedDays < targetDays) {
    cursor = addDays(cursor, 1);
    if (!isSundayInIndia(cursor)) {
      addedDays += 1;
    }
  }
  return cursor;
};

const getDateOrNull = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getWholeIstDayCutoff = (value, delayMs = 0) => {
  const dayStart = getIndianDayStart(value);
  return dayStart ? new Date(dayStart.getTime() + DAY_MS + Number(delayMs || 0)) : null;
};

const getDaysPastCutoff = (value, cutoff) => {
  const parsedValue = getDateOrNull(value);
  const parsedCutoff = getDateOrNull(cutoff);
  if (!parsedValue || !parsedCutoff || parsedValue <= parsedCutoff) return 0;
  return Math.max(1, Math.ceil((parsedValue.getTime() - parsedCutoff.getTime()) / DAY_MS));
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateTaskQuery = (query) =>
  query
    .populate("batch", "batch_no name brand source_folder_name status")
    .populate("task_type", "key name category auto_create_mode default_priority requires_review is_active")
    .populate("department", "name key description is_active")
    .populate("assigned_to.user", "name email role")
    .populate("upload_assignees.user", "name email role")
    .populate("upload_statuses.user", "name email role")
    .populate("upload_statuses.uploaded_by.user", "name email role")
    .populate("assigned_by.user", "name email role")
    .populate("created_by.user", "name email role")
    .populate("updated_by.user", "name email role")
    .populate("reviewed_by.user", "name email role")
    .populate("rework_due_dates.created_by.user", "name email role")
    .lean();

const getTaskReworkPayload = (doc = {}) => {
  const comments = Array.isArray(doc?.reworked?.comments) ? doc.reworked.comments : [];
  const count = Math.max(
    0,
    Number(doc?.reworked?.count || 0),
    Number(doc?.rework_count || 0),
  );

  return {
    count,
    before_approval_count: Math.max(0, Number(doc?.reworked?.before_approval_count || 0)),
    after_approval_count: Math.max(0, Number(doc?.reworked?.after_approval_count || 0)),
    comments,
  };
};

const getTaskReworkDueDatePayload = (doc = {}) =>
  (Array.isArray(doc?.rework_due_dates) ? doc.rework_due_dates : [])
    .map((entry) => ({
      date: entry?.date || entry?.due_date || null,
      comment: normalizeText(entry?.comment),
      source: normalizeKey(entry?.source) === "due_date" ? "due_date" : "rework",
      created_at: entry?.created_at || null,
      created_by: entry?.created_by || {},
    }))
    .filter((entry) => Boolean(entry.date));

const getTaskHoldPayload = (doc = {}) => {
  const hold = doc?.hold && typeof doc.hold === "object" ? doc.hold : {};
  const status = ["pending", "hold"].includes(normalizeKey(hold?.status))
    ? normalizeKey(hold.status)
    : "none";
  return {
    status,
    previous_status: normalizeWorkflowTaskStatus(hold?.previous_status, { fallback: "" }),
    requested_comment: normalizeText(hold?.requested_comment),
    requested_by: hold?.requested_by || {},
    requested_at: hold?.requested_at || null,
    approved_comment: normalizeText(hold?.approved_comment),
    approved_by: hold?.approved_by || {},
    approved_at: hold?.approved_at || null,
    resumed_comment: normalizeText(hold?.resumed_comment),
    resumed_by: hold?.resumed_by || {},
    resumed_at: hold?.resumed_at || null,
    rejected_comment: normalizeText(hold?.rejected_comment),
    rejected_by: hold?.rejected_by || {},
    rejected_at: hold?.rejected_at || null,
    total_paused_ms: Math.max(0, Number(hold?.total_paused_ms || 0)),
  };
};

const isTaskHoldApprover = (actor = {}, task = {}) =>
  isAdmin(actor) || isTaskCreatedByUser(task, actor?._id || actor?.id);

const getLatestWorkflowDueDateEntry = (doc = {}) => {
  const candidates = [
    {
      date: getDateOrNull(doc?.due_date),
      source: "due_date",
    },
    ...getTaskReworkDueDatePayload(doc).map((entry) => ({
      ...entry,
      date: getDateOrNull(entry?.date),
      source: entry?.source || "rework",
    })),
  ].filter((entry) => entry.date);

  if (candidates.length === 0) return null;
  return candidates.reduce((latest, entry) =>
    entry.date.getTime() > latest.date.getTime() ? entry : latest,
  );
};

const getActiveWorkflowDueDate = (doc = {}) => {
  return getLatestWorkflowDueDateEntry(doc)?.date || null;
};

const getWorkflowDeadlineSummary = (doc = {}) => {
  const normalizedStatus = normalizeWorkflowTaskStatus(doc?.status, {
    fallback: "assigned",
  }) || "assigned";
  const reworkDueDates = getTaskReworkDueDatePayload(doc);
  const latestDueDateEntry = getLatestWorkflowDueDateEntry(doc);
  const activeDueDate = getActiveWorkflowDueDate(doc);
  const completedAt = getDateOrNull(doc?.completed_at);
  const statusCanHaveApproval = ["approved", "uploaded"].includes(normalizedStatus);
  const approvedAt = statusCanHaveApproval
    ? getDateOrNull(doc?.approved_at || doc?.reviewed_at)
    : null;
  const uploadedAt = normalizedStatus === "uploaded" ? getDateOrNull(doc?.uploaded_at) : null;
  const now = new Date();
  const hold = getTaskHoldPayload(doc);
  const isHeld = normalizedStatus === "hold" || hold.status === "hold";
  const activeDueDayStart = activeDueDate ? getIndianDayStart(activeDueDate) : null;
  const completedDeadlineCutoff = activeDueDate
    ? getWholeIstDayCutoff(activeDueDate, OVERDUE_COUNT_DELAY_MS)
    : null;

  const completedPlusTwoDayStart = completedAt
    ? addWorkflowDaysSkippingSunday(getIndianDayStart(completedAt), 2)
    : null;
  const approvalDeadlineDayStart = activeDueDayStart
    ? (
        completedPlusTwoDayStart
          ? new Date(Math.max(activeDueDayStart.getTime(), completedPlusTwoDayStart.getTime()))
          : addWorkflowDaysSkippingSunday(activeDueDayStart, 2)
      )
    : null;
  const approvalDeadlineCutoff = approvalDeadlineDayStart
    ? addDays(approvalDeadlineDayStart, 1)
    : null;
  const uploadDeadlineDayStart = approvedAt
    ? addWorkflowDaysSkippingSunday(
        getIndianDayStart(
          hold.resumed_at && activeDueDayStart
            ? new Date(Math.max(approvedAt.getTime(), activeDueDayStart.getTime()))
            : approvedAt,
        ),
        2,
      )
    : (approvalDeadlineDayStart ? addWorkflowDaysSkippingSunday(approvalDeadlineDayStart, 2) : null);
  const uploadDeadlineCutoff = uploadDeadlineDayStart
    ? addDays(uploadDeadlineDayStart, 1)
    : null;

  const uploadStatuses = buildWorkflowUploadStatuses(doc);
  const pendingUploads = doc?.upload_required !== false && statusCanHaveApproval
    ? uploadStatuses.filter((entry) => normalizeKey(entry?.status) !== "uploaded")
    : [];
  const uploadDelayedAssignees = doc?.upload_required !== false && uploadDeadlineCutoff
    ? uploadStatuses
        .filter((entry) => {
          const entryUploadedAt = getDateOrNull(entry?.uploaded_at);
          return entryUploadedAt && entryUploadedAt > uploadDeadlineCutoff;
        })
        .map((entry) => ({
          user: entry?.user || null,
          status: normalizeKey(entry?.status) || "pending",
          uploaded_at: entry?.uploaded_at || null,
          days_late: getDaysPastCutoff(entry?.uploaded_at, uploadDeadlineCutoff),
        }))
    : [];
  const uploadOverdueAssignees = doc?.upload_required !== false && uploadDeadlineCutoff
    ? pendingUploads
        .filter(() => now > uploadDeadlineCutoff)
        .map((entry) => ({
          user: entry?.user || null,
          status: normalizeKey(entry?.status) || "pending",
          uploaded_at: entry?.uploaded_at || null,
          days_late: getDaysPastCutoff(now, uploadDeadlineCutoff),
        }))
    : [];

  const completionDaysLate = getDaysPastCutoff(completedAt, completedDeadlineCutoff);
  const approvalDaysLate = getDaysPastCutoff(approvedAt, approvalDeadlineCutoff);
  const uploadDaysLate = doc?.upload_required !== false
    ? Math.max(
        getDaysPastCutoff(uploadedAt, uploadDeadlineCutoff),
        ...uploadDelayedAssignees.map((entry) => Number(entry?.days_late || 0)),
        0,
      )
    : 0;

  const completionOverdueDays = !completedAt
    ? getDaysPastCutoff(now, completedDeadlineCutoff)
    : 0;
  const approvalOverdueDays = completedAt && !approvedAt
    ? getDaysPastCutoff(now, approvalDeadlineCutoff)
    : 0;
  const uploadOverdueDays = doc?.upload_required !== false && approvedAt && pendingUploads.length > 0
    ? getDaysPastCutoff(now, uploadDeadlineCutoff)
    : 0;

  let delayStage = uploadDaysLate > 0
    ? "upload_delay"
    : approvalDaysLate > 0
      ? "approval_delay"
      : completionDaysLate > 0
        ? "delayed"
        : "";
  let overdueStage = uploadOverdueDays > 0
    ? "upload_overdue"
    : approvalOverdueDays > 0
      ? "approval_overdue"
      : completionOverdueDays > 0
        ? "overdue"
        : "";

  if (isHeld) {
    delayStage = "";
    overdueStage = "";
  }

  return {
    active_due_date: activeDueDate,
    original_due_date: doc?.due_date || null,
    active_due_source: latestDueDateEntry?.source || "due_date",
    completed_at: completedAt,
    approved_at: approvedAt,
    uploaded_at: uploadedAt,
    approval_deadline: approvalDeadlineDayStart,
    upload_deadline: doc?.upload_required === false ? null : uploadDeadlineDayStart,
    completion_cutoff: completedDeadlineCutoff,
    approval_cutoff: approvalDeadlineCutoff,
    upload_cutoff: doc?.upload_required === false ? null : uploadDeadlineCutoff,
    delay_stage: delayStage,
    overdue_stage: overdueStage,
    completion_days_late: isHeld ? 0 : completionDaysLate,
    approval_days_late: isHeld ? 0 : approvalDaysLate,
    upload_days_late: isHeld ? 0 : uploadDaysLate,
    completion_overdue_days: isHeld ? 0 : completionOverdueDays,
    approval_overdue_days: isHeld ? 0 : approvalOverdueDays,
    upload_overdue_days: isHeld ? 0 : uploadOverdueDays,
    pending_upload_count: isHeld ? 0 : pendingUploads.length,
    upload_delayed_assignees: uploadDelayedAssignees,
    upload_overdue_assignees: uploadOverdueAssignees,
    status: normalizedStatus,
    paused: isHeld,
    hold_started_at: isHeld ? hold.approved_at : null,
    hold_total_paused_ms: hold.total_paused_ms,
  };
};

const buildWorkflowUploadStatuses = (doc = {}) => {
  if (doc?.upload_required === false) return [];

  const taskStatus = normalizeWorkflowTaskStatus(doc?.status, { fallback: "" });
  const taskUploadedByUserId = getUserRefId(doc?.uploaded_by);
  const existingStatusByUserId = new Map(
    (Array.isArray(doc?.upload_statuses) ? doc.upload_statuses : [])
      .map((entry) => [getUserRefId(entry), entry])
      .filter(([userId]) => Boolean(userId)),
  );

  return (Array.isArray(doc?.upload_assignees) ? doc.upload_assignees : [])
    .map((entry) => {
      const userId = getUserRefId(entry);
      if (!userId) return null;

      const user = entry?.user || entry;
      const existingStatus = existingStatusByUserId.get(userId) || {};
      const uploaded =
        normalizeKey(existingStatus?.status) === "uploaded" ||
        Boolean(existingStatus?.uploaded_at) ||
        (
          taskStatus === "uploaded" &&
          taskUploadedByUserId === userId
        );

      return {
        user,
        status: uploaded ? "uploaded" : "pending",
        uploaded_by: existingStatus?.uploaded_by || (uploaded ? doc?.uploaded_by || {} : {}),
        uploaded_at: existingStatus?.uploaded_at || (uploaded ? doc?.uploaded_at || null : null),
        role_rank: getWorkflowUploadRoleRank(user?.role),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.role_rank !== right.role_rank) return left.role_rank - right.role_rank;
      return normalizeText(left?.user?.name || left?.user?.email)
        .localeCompare(normalizeText(right?.user?.name || right?.user?.email));
    })
    .map(({ role_rank, ...entry }) => entry);
};

const serializeTask = (doc = {}) => {
  const normalizedStatus = normalizeWorkflowTaskStatus(doc?.status, {
    fallback: "assigned",
  }) || "assigned";
  const reworked = getTaskReworkPayload(doc);
  const reworkDueDates = getTaskReworkDueDatePayload(doc);
  const uploadStatuses = buildWorkflowUploadStatuses(doc);
  const deadlineSummary = getWorkflowDeadlineSummary({
    ...doc,
    status: normalizedStatus,
    upload_statuses: uploadStatuses,
  });
  const hasPendingUploads =
    doc?.upload_required !== false &&
    normalizedStatus === "uploaded" &&
    uploadStatuses.some((entry) => normalizeKey(entry?.status) !== "uploaded");
  const displayStatus = hasPendingUploads ? "approved" : normalizedStatus;
  const displayStatusCanHaveApproval = ["approved", "uploaded"].includes(displayStatus);
  const serializedApprovedAt = displayStatusCanHaveApproval
    ? doc?.approved_at || doc?.reviewed_at || null
    : null;
  const serializedApprovedBy = displayStatusCanHaveApproval
    ? (
        doc?.approved_by?.user || doc?.approved_by?.name || doc?.approved_by?.email
          ? doc.approved_by
          : doc?.reviewed_by || {}
      )
    : {};

  return {
    ...doc,
    status: displayStatus,
    task_type_key: normalizeKey(doc?.task_type_key || doc?.task_type?.key),
    task_type_name: normalizeText(doc?.task_type_name || doc?.task_type?.name),
    upload_required: doc?.upload_required !== false,
    upload_assignees: Array.isArray(doc?.upload_assignees) ? doc.upload_assignees : [],
    upload_statuses: uploadStatuses,
    approved_at: serializedApprovedAt,
    approved_by: serializedApprovedBy,
    reworked,
    rework_due_dates: reworkDueDates,
    hold: getTaskHoldPayload(doc),
    active_due_date: deadlineSummary.active_due_date,
    deadline_summary: deadlineSummary,
    delay_stage: deadlineSummary.delay_stage,
    overdue_stage: deadlineSummary.overdue_stage,
    completion_comment: doc?.completion_comment || null,
  };
};

const getLatestCompletionComment = (comments = []) =>
  (Array.isArray(comments) ? comments : [])
    .find((entry) => normalizeKey(entry?.comment_type) === "complete" && normalizeText(entry?.comment))
    || null;

const getLatestCompletionCommentMap = async (taskIds = []) => {
  const ids = uniqueIds(taskIds);
  if (ids.length === 0) return new Map();

  const comments = await Comment.find({
    task: { $in: ids },
    comment_type: "complete",
    is_deleted: false,
  })
    .populate("created_by.user", "name email role")
    .sort({ createdAt: -1 })
    .lean();

  return comments.reduce((acc, comment) => {
    const taskId = normalizeId(comment?.task);
    if (taskId && !acc.has(taskId)) {
      acc.set(taskId, comment);
    }
    return acc;
  }, new Map());
};

const getBatchRefId = (task = {}) =>
  normalizeId(task?.batch?._id || task?.batch?.id || task?.batch || "");

const getUniqueUserRefs = (tasks = [], field = "assigned_to") => {
  const refsById = new Map();
  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    (Array.isArray(task?.[field]) ? task[field] : []).forEach((entry) => {
      const userId = getUserRefId(entry);
      if (userId && !refsById.has(userId)) {
        refsById.set(userId, entry?.user ? entry : { user: entry });
      }
    });
  });
  return [...refsById.values()];
};

const getMaxDate = (tasks = [], field = "") =>
  (Array.isArray(tasks) ? tasks : [])
    .map((task) => getDateOrNull(task?.[field]))
    .filter(Boolean)
    .reduce((latest, value) => (
      !latest || value.getTime() > latest.getTime() ? value : latest
    ), null);

const deriveBatchTaskLikeStatus = (tasks = []) => {
  const normalizedTasks = (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    normalized_status: normalizeWorkflowTaskStatus(task?.status, { fallback: "assigned" }) || "assigned",
  }));
  const totalTasks = normalizedTasks.length;
  if (totalTasks <= 0) return "assigned";

  const isTerminal = (task) =>
    ["uploaded", "completed"].includes(task.normalized_status) ||
    (task.normalized_status === "approved" && task?.upload_required === false);
  const atLeastApproved = (task) =>
    isTerminal(task) || task.normalized_status === "approved";
  const atLeastComplete = (task) =>
    atLeastApproved(task) || task.normalized_status === "complete";
  const hasStarted = normalizedTasks.some((task) =>
    ["started", "complete", "approved", "uploaded", "completed"].includes(task.normalized_status),
  );

  if (normalizedTasks.some((task) => task.normalized_status === "hold")) return "hold";
  if (normalizedTasks.every(isTerminal)) return "uploaded";
  if (normalizedTasks.every(atLeastApproved)) return "approved";
  if (normalizedTasks.every(atLeastComplete)) return "complete";
  if (hasStarted) return "started";
  return "assigned";
};

const buildBatchChildCounts = (tasks = []) => {
  const counts = {
    total_tasks: 0,
    started_tasks: 0,
    complete_tasks: 0,
    approved_tasks: 0,
    uploaded_tasks: 0,
    complete_done_tasks: 0,
    hold_tasks: 0,
  };

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    const status = normalizeWorkflowTaskStatus(task?.status, { fallback: "assigned" }) || "assigned";
    counts.total_tasks += 1;
    if (status === "started") counts.started_tasks += 1;
    if (status === "complete") counts.complete_tasks += 1;
    if (status === "approved") counts.approved_tasks += 1;
    if (status === "uploaded") counts.uploaded_tasks += 1;
    if (status === "hold") counts.hold_tasks += 1;
    if (status === "uploaded" || (status === "approved" && task?.upload_required === false)) {
      counts.complete_done_tasks += 1;
    }
  });

  return counts;
};

const serializeBatchTaskGroup = ({ batch = {}, tasks = [] } = {}) => {
  const childTasks = (Array.isArray(tasks) ? tasks : []).map(serializeTask);
  const status = deriveBatchTaskLikeStatus(childTasks);
  const counts = buildBatchChildCounts(childTasks);
  const completedAt = status === "uploaded" ? getMaxDate(childTasks, "completed_at") : null;
  const approvedAt = counts.approved_tasks + counts.uploaded_tasks + counts.complete_done_tasks > 0
    ? getMaxDate(childTasks, "approved_at")
    : null;
  const uploadedAt = status === "uploaded" ? getMaxDate(childTasks, "uploaded_at") : null;
  const assignedTo = getUniqueUserRefs(childTasks, "assigned_to");
  const uploadAssignees = getUniqueUserRefs(childTasks, "upload_assignees");
  const batchDoc = batch || childTasks[0]?.batch || {};
  const groupDoc = {
    _id: `batch:${normalizeId(batchDoc?._id || childTasks[0]?.batch)}`,
    batch: batchDoc,
    batch_no: batchDoc?.batch_no || childTasks[0]?.batch_no || "",
    task_no: batchDoc?.batch_no || childTasks[0]?.batch_no || "",
    title: batchDoc?.name || batchDoc?.source_folder_name || childTasks[0]?.source_folder_name || "Workflow Batch",
    task_type: batchDoc?.task_type || childTasks[0]?.task_type || null,
    task_type_key: batchDoc?.task_type_key || childTasks[0]?.task_type_key || "",
    task_type_name:
      batchDoc?.selected_task_type?.name ||
      childTasks[0]?.task_type_name ||
      childTasks[0]?.task_type?.name ||
      "",
    department: childTasks[0]?.department || null,
    brand: batchDoc?.brand || childTasks[0]?.brand || "",
    source_folder_name: batchDoc?.source_folder_name || childTasks[0]?.source_folder_name || "",
    source_folder_path: batchDoc?.source_folder_name || childTasks[0]?.source_folder_path || "",
    status,
    assigned_to: assignedTo,
    assigned_by: childTasks[0]?.assigned_by || {},
    assigned_at: childTasks.reduce((earliest, task) => {
      const value = getDateOrNull(task?.assigned_at || task?.createdAt);
      if (!value) return earliest;
      return !earliest || value.getTime() < earliest.getTime() ? value : earliest;
    }, null),
    upload_required: childTasks.some((task) => task?.upload_required !== false),
    upload_assignees: uploadAssignees,
    upload_statuses: [],
    due_date: batchDoc?.due_date || childTasks[0]?.due_date || null,
    active_due_date: batchDoc?.due_date || childTasks[0]?.active_due_date || childTasks[0]?.due_date || null,
    started_at: batchDoc?.started_at || getMaxDate(childTasks, "started_at"),
    completed_at: completedAt,
    approved_at: approvedAt,
    uploaded_at: uploadedAt,
    created_by: batchDoc?.created_by || childTasks[0]?.created_by || {},
    updated_by: batchDoc?.updated_by || childTasks[0]?.updated_by || {},
    reworked: {
      count: childTasks.reduce((sum, task) => sum + Number(task?.reworked?.count || task?.rework_count || 0), 0),
      before_approval_count: childTasks.reduce(
        (sum, task) => sum + Number(task?.reworked?.before_approval_count || 0),
        0,
      ),
      after_approval_count: childTasks.reduce(
        (sum, task) => sum + Number(task?.reworked?.after_approval_count || 0),
        0,
      ),
      comments: childTasks.flatMap((task) => Array.isArray(task?.reworked?.comments) ? task.reworked.comments : []),
    },
    rework_due_dates: childTasks.flatMap((task) =>
      Array.isArray(task?.rework_due_dates) ? task.rework_due_dates : [],
    ),
    is_batch_group: true,
    batch_status: batchDoc?.status || "",
    batch_counts: counts,
    child_tasks: childTasks,
  };
  const deadlineSummary = getWorkflowDeadlineSummary(groupDoc);
  return {
    ...groupDoc,
    deadline_summary: deadlineSummary,
    delay_stage: deadlineSummary.delay_stage,
    overdue_stage: deadlineSummary.overdue_stage,
  };
};

const groupTaskRowsForBoard = async (rows = []) => {
  const batchIds = uniqueIds((Array.isArray(rows) ? rows : []).map(getBatchRefId));
  if (batchIds.length === 0) {
    return rows.map((row) => serializeTask(row));
  }

  const [batchDocs, batchTaskRows] = await Promise.all([
    Batch.find({ _id: { $in: batchIds }, is_deleted: false }).lean(),
    populateTaskQuery(
      Task.find({
        batch: { $in: batchIds },
        is_deleted: false,
      }).sort({ task_no: 1, createdAt: 1 }),
    ),
  ]);
  const batchById = new Map(batchDocs.map((batch) => [normalizeId(batch?._id), batch]));
  const tasksByBatchId = batchTaskRows.reduce((acc, row) => {
    const batchId = getBatchRefId(row);
    if (!batchId) return acc;
    if (!acc.has(batchId)) acc.set(batchId, []);
    acc.get(batchId).push(row);
    return acc;
  }, new Map());
  const emittedBatchIds = new Set();
  const groupedRows = [];

  rows.forEach((row) => {
    const batchId = getBatchRefId(row);
    if (!batchId) {
      groupedRows.push(serializeTask(row));
      return;
    }
    if (emittedBatchIds.has(batchId)) return;
    emittedBatchIds.add(batchId);
    groupedRows.push(
      serializeBatchTaskGroup({
        batch: batchById.get(batchId) || row?.batch || {},
        tasks: tasksByBatchId.get(batchId) || [row],
      }),
    );
  });

  return groupedRows;
};

const buildWorkflowDashboardCounts = (doc = {}) =>
  DASHBOARD_COUNT_FIELDS.reduce((acc, key) => {
    acc[key] = Number(doc?.[key] || 0);
    return acc;
  }, {});

const buildTaskVisibilityMatch = (user = {}) => {
  if (isAdmin(user)) {
    return { is_deleted: false };
  }

  const userId = user?._id || user?.id || null;
  if (!userId) {
    return {
      is_deleted: false,
      $and: [{ _id: { $exists: false } }],
    };
  }

  return {
    is_deleted: false,
    $or: [
      { "assigned_to.user": userId },
      { "created_by.user": userId },
      { "assigned_by.user": userId },
      {
        upload_required: { $ne: false },
        "upload_assignees.user": userId,
      },
    ],
  };
};

const buildStatusMatch = (status = "") => {
  const normalizedStatus = normalizeKey(status);
  if (normalizedStatus === "open") {
    return { $in: PRE_TERMINAL_TASK_STATUS_VALUES };
  }
  if (normalizedStatus === "needs_approval") {
    return { $in: NEEDS_APPROVAL_STATUS_VALUES };
  }
  if (normalizedStatus === "upload_remaining") {
    return "approved";
  }

  const values = getWorkflowStatusFilterValues(status);
  if (values.length === 0) {
    return normalizeText(status).toLowerCase();
  }
  if (values.length === 1) {
    return values[0];
  }
  return { $in: values };
};

const buildEffectiveApprovedAtExpression = () => ({
  $ifNull: ["$approved_at", "$reviewed_at"],
});

const buildOpenTaskMatch = () => ({
  $or: [
    { status: { $in: PRE_TERMINAL_TASK_STATUS_VALUES } },
    {
      status: "approved",
      upload_required: { $ne: false },
    },
  ],
});

const buildCompleteTaskMatch = () => ({
  $or: [
    { status: { $in: ["uploaded", "completed"] } },
    {
      status: "approved",
      upload_required: false,
    },
  ],
});

const buildOpenTaskExpression = (statusExpression = "$normalized_status") => ({
  $or: [
    { $in: [statusExpression, PRE_TERMINAL_TASK_STATUSES] },
    {
      $and: [
        { $eq: [statusExpression, "approved"] },
        { $ne: ["$upload_required", false] },
      ],
    },
  ],
});

const buildCompleteTaskExpression = (statusExpression = "$normalized_status") => ({
  $or: [
    { $in: [statusExpression, ["uploaded", "completed"]] },
    {
      $and: [
        { $eq: [statusExpression, "approved"] },
        { $eq: ["$upload_required", false] },
      ],
    },
  ],
});

const buildIndianDayStartExpression = (dateExpression) => ({
  $dateFromString: {
    dateString: {
      $dateToString: {
        date: dateExpression,
        format: "%Y-%m-%d",
        timezone: WORKFLOW_DUE_TIMEZONE,
        onNull: null,
      },
    },
    format: "%Y-%m-%d",
    timezone: WORKFLOW_DUE_TIMEZONE,
    onError: null,
    onNull: null,
  },
});

const buildAddWorkflowDaysSkippingSundayExpression = (dayStartExpression, days = 2) => {
  const targetDays = Math.max(0, Number(days || 0));
  if (targetDays !== 2) {
    return { $add: [dayStartExpression, targetDays * DAY_MS] };
  }
  return {
    $let: {
      vars: {
        dayStart: dayStartExpression,
      },
      in: {
        $cond: [
          { $eq: ["$$dayStart", null] },
          null,
          {
            $add: [
              "$$dayStart",
              {
                $cond: [
                  {
                    $or: [
                      {
                        $eq: [
                          {
                            $dayOfWeek: {
                              date: { $add: ["$$dayStart", DAY_MS] },
                              timezone: WORKFLOW_DUE_TIMEZONE,
                            },
                          },
                          1,
                        ],
                      },
                      {
                        $eq: [
                          {
                            $dayOfWeek: {
                              date: { $add: ["$$dayStart", 2 * DAY_MS] },
                              timezone: WORKFLOW_DUE_TIMEZONE,
                            },
                          },
                          1,
                        ],
                      },
                    ],
                  },
                  3 * DAY_MS,
                  2 * DAY_MS,
                ],
              },
            ],
          },
        ],
      },
    },
  };
};

const buildLatestReworkDueDateExpression = () => ({
  $let: {
    vars: {
      dates: {
        $map: {
          input: {
            $filter: {
              input: { $ifNull: ["$rework_due_dates", []] },
              as: "reworkDueDate",
              cond: { $ne: ["$$reworkDueDate.date", null] },
            },
          },
          as: "reworkDueDate",
          in: "$$reworkDueDate.date",
        },
      },
    },
    in: {
      $cond: [
        { $gt: [{ $size: "$$dates" }, 0] },
        { $max: "$$dates" },
        null,
      ],
    },
  },
});

const buildActiveDueDateExpression = () => ({
  $let: {
    vars: {
      dates: {
        $filter: {
          input: ["$due_date", buildLatestReworkDueDateExpression()],
          as: "dueDateCandidate",
          cond: { $ne: ["$$dueDateCandidate", null] },
        },
      },
    },
    in: {
      $cond: [
        { $gt: [{ $size: "$$dates" }, 0] },
        { $max: "$$dates" },
        null,
      ],
    },
  },
});

// Workflow due dates are date-only, so the whole IST due date remains on time.
const buildDueDateCutoffExpression = () => ({
  $add: [buildIndianDayStartExpression(buildActiveDueDateExpression()), DAY_MS],
});

const buildOverdueDateCutoffExpression = () => ({
  $add: [buildDueDateCutoffExpression(), OVERDUE_COUNT_DELAY_MS],
});

const buildApprovalDeadlineDayStartExpression = () => {
  const activeDueDayStart = buildIndianDayStartExpression(buildActiveDueDateExpression());
  const completedPlusTwo = buildAddWorkflowDaysSkippingSundayExpression(
    buildIndianDayStartExpression("$completed_at"),
    2,
  );
  return {
    $cond: [
      { $ne: ["$completed_at", null] },
      { $max: [activeDueDayStart, completedPlusTwo] },
      buildAddWorkflowDaysSkippingSundayExpression(activeDueDayStart, 2),
    ],
  };
};

const buildApprovalDeadlineCutoffExpression = () => ({
  $add: [buildApprovalDeadlineDayStartExpression(), DAY_MS],
});

const buildUploadDeadlineDayStartExpression = () => {
  const effectiveApprovedAt = buildEffectiveApprovedAtExpression();
  const activeDueDayStart = buildIndianDayStartExpression(buildActiveDueDateExpression());
  const approvedDayStart = buildIndianDayStartExpression(effectiveApprovedAt);
  return {
    $cond: [
      { $ne: [effectiveApprovedAt, null] },
      buildAddWorkflowDaysSkippingSundayExpression(
        {
          $cond: [
            {
              $and: [
                { $ne: ["$hold.resumed_at", null] },
                { $ne: [activeDueDayStart, null] },
              ],
            },
            { $max: [approvedDayStart, activeDueDayStart] },
            approvedDayStart,
          ],
        },
        2,
      ),
      buildAddWorkflowDaysSkippingSundayExpression(buildApprovalDeadlineDayStartExpression(), 2),
    ],
  };
};

const buildUploadDeadlineCutoffExpression = () => ({
  $add: [buildUploadDeadlineDayStartExpression(), DAY_MS],
});

const buildPendingUploadExpression = (statusExpression = "$normalized_status") => ({
  $and: [
    { $ne: ["$upload_required", false] },
    { $in: [statusExpression, ["approved", "uploaded", "completed"]] },
    {
      $or: [
        {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ["$upload_statuses", []] },
                  as: "uploadStatus",
                  cond: { $ne: ["$$uploadStatus.status", "uploaded"] },
                },
              },
            },
            0,
          ],
        },
        { $eq: [{ $size: { $ifNull: ["$upload_statuses", []] } }, 0] },
      ],
    },
  ],
});

const buildCompletionDelayExpression = (statusExpression = "$normalized_status") => ({
  $and: [
    buildCompleteTaskExpression(statusExpression),
    { $ne: [buildActiveDueDateExpression(), null] },
    { $ne: ["$completed_at", null] },
    { $gt: ["$completed_at", buildDueDateCutoffExpression()] },
  ],
});

const buildApprovalDelayExpression = (statusExpression = "$normalized_status") => {
  const effectiveApprovedAt = buildEffectiveApprovedAtExpression();
  return {
    $and: [
      buildCompleteTaskExpression(statusExpression),
      { $ne: [buildActiveDueDateExpression(), null] },
      { $ne: ["$completed_at", null] },
      { $ne: [effectiveApprovedAt, null] },
      { $gt: [effectiveApprovedAt, buildApprovalDeadlineCutoffExpression()] },
    ],
  };
};

const buildUploadDelayExpression = (statusExpression = "$normalized_status") => ({
  $and: [
    buildCompleteTaskExpression(statusExpression),
    { $ne: ["$upload_required", false] },
    { $ne: [buildActiveDueDateExpression(), null] },
    { $ne: [buildEffectiveApprovedAtExpression(), null] },
    {
      $or: [
        { $gt: ["$uploaded_at", buildUploadDeadlineCutoffExpression()] },
        {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ["$upload_statuses", []] },
                  as: "uploadStatus",
                  cond: {
                    $and: [
                      { $ne: ["$$uploadStatus.uploaded_at", null] },
                      { $gt: ["$$uploadStatus.uploaded_at", buildUploadDeadlineCutoffExpression()] },
                    ],
                  },
                },
              },
            },
            0,
          ],
        },
      ],
    },
  ],
});

const buildCompletionOverdueExpression = (now = new Date(), statusExpression = "$normalized_status") => ({
  $and: [
    { $in: [statusExpression, OPEN_TASK_STATUS_VALUES] },
    { $ne: [buildActiveDueDateExpression(), null] },
    { $gte: [now, buildOverdueDateCutoffExpression()] },
  ],
});

const buildApprovalOverdueExpression = (now = new Date(), statusExpression = "$normalized_status") => ({
  $and: [
    { $in: [statusExpression, NEEDS_APPROVAL_STATUS_VALUES] },
    { $ne: [buildActiveDueDateExpression(), null] },
    { $ne: ["$completed_at", null] },
    { $eq: [buildEffectiveApprovedAtExpression(), null] },
    { $gte: [now, { $add: [buildApprovalDeadlineCutoffExpression(), OVERDUE_COUNT_DELAY_MS] }] },
  ],
});

const buildUploadOverdueExpression = (now = new Date(), statusExpression = "$normalized_status") => ({
  $and: [
    buildPendingUploadExpression(statusExpression),
    { $ne: [buildActiveDueDateExpression(), null] },
    { $ne: [buildEffectiveApprovedAtExpression(), null] },
    { $gte: [now, { $add: [buildUploadDeadlineCutoffExpression(), OVERDUE_COUNT_DELAY_MS] }] },
  ],
});

const buildNotApprovedByDueDateExpression = () => {
  const effectiveApprovedAt = buildEffectiveApprovedAtExpression();
  const dueDateCutoff = buildDueDateCutoffExpression();
  return {
    $or: [
      { $in: ["$status", PRE_TERMINAL_TASK_STATUS_VALUES] },
      { $eq: [effectiveApprovedAt, null] },
      { $gte: [effectiveApprovedAt, dueDateCutoff] },
    ],
  };
};

const buildOverdueTaskMatch = (now = new Date()) => {
  return {
    status: { $in: OPEN_TASK_STATUS_VALUES },
    $expr: {
      $and: [
        { $ne: [buildActiveDueDateExpression(), null] },
        { $gte: [now, buildOverdueDateCutoffExpression()] },
      ],
    },
  };
};

const buildDelayedTaskMatch = () => {
  return {
    ...buildCompleteTaskMatch(),
    $expr: {
      $and: [
        { $ne: [buildActiveDueDateExpression(), null] },
        { $ne: ["$completed_at", null] },
        { $gt: ["$completed_at", buildDueDateCutoffExpression()] },
        { $not: [buildApprovalDelayExpression("$status")] },
        { $not: [buildUploadDelayExpression("$status")] },
      ],
    },
  };
};

const buildApprovalOverdueTaskMatch = (now = new Date()) => ({
  status: { $in: NEEDS_APPROVAL_STATUS_VALUES },
  completed_at: { $ne: null },
  $expr: {
    $and: [
      { $ne: [buildActiveDueDateExpression(), null] },
      { $eq: [buildEffectiveApprovedAtExpression(), null] },
      { $gte: [now, { $add: [buildApprovalDeadlineCutoffExpression(), OVERDUE_COUNT_DELAY_MS] }] },
    ],
  },
});

const buildUploadOverdueTaskMatch = (now = new Date()) => ({
  upload_required: { $ne: false },
  status: { $in: ["approved", "uploaded"] },
  $expr: {
    $and: [
      { $ne: [buildActiveDueDateExpression(), null] },
      { $ne: [buildEffectiveApprovedAtExpression(), null] },
      { $gte: [now, { $add: [buildUploadDeadlineCutoffExpression(), OVERDUE_COUNT_DELAY_MS] }] },
    ],
  },
  $or: [
    { upload_statuses: { $elemMatch: { status: { $ne: "uploaded" } } } },
    { "upload_statuses.0": { $exists: false } },
  ],
});

const buildApprovalDelayedTaskMatch = () => ({
  ...buildCompleteTaskMatch(),
  $expr: {
    $and: [
      buildApprovalDelayExpression("$status"),
      { $not: [buildUploadDelayExpression("$status")] },
    ],
  },
});

const buildUploadDelayedTaskMatch = () => ({
  ...buildCompleteTaskMatch(),
  upload_required: { $ne: false },
  $expr: buildUploadDelayExpression("$status"),
});

const buildDueTodayTaskMatch = (now = new Date()) => {
  const todayStart = getIndianDayStart(now);
  const tomorrowStart = addDays(todayStart, 1);

  return {
    status: { $in: DUE_TRACKED_TASK_STATUS_VALUES },
    $expr: {
      $and: [
        { $ne: [buildActiveDueDateExpression(), null] },
        { $gte: [buildActiveDueDateExpression(), todayStart] },
        { $lt: [buildActiveDueDateExpression(), tomorrowStart] },
        buildNotApprovedByDueDateExpression(),
      ],
    },
  };
};

const addAndMatch = (match, condition) => {
  if (!condition || Object.keys(condition).length === 0) return;
  if (!Array.isArray(match.$and)) {
    match.$and = [];
  }
  match.$and.push(condition);
};

const buildTaskListMatch = ({ query = {}, user = {} } = {}) => {
  const privilegedReader = isAdmin(user);
  const match = buildTaskVisibilityMatch(user);
  const normalizedStatusFilter = normalizeKey(query?.status);
  const uploadPendingFilter =
    normalizedStatusFilter === "upload_remaining" ||
    normalizedStatusFilter === "upload_pending";

  if (normalizeText(query?.status)) {
    if (normalizedStatusFilter === "open") {
      addAndMatch(match, buildOpenTaskMatch());
    } else if (normalizedStatusFilter === "complete_done") {
      addAndMatch(match, buildCompleteTaskMatch());
    } else if (normalizedStatusFilter === "hold_approval_pending") {
      match["hold.status"] = "pending";
    } else if (normalizedStatusFilter === "overdue") {
      addAndMatch(match, buildOverdueTaskMatch());
    } else if (normalizedStatusFilter === "approval_overdue") {
      addAndMatch(match, buildApprovalOverdueTaskMatch());
    } else if (normalizedStatusFilter === "upload_overdue") {
      addAndMatch(match, buildUploadOverdueTaskMatch());
    } else if (normalizedStatusFilter === "delayed") {
      addAndMatch(match, buildDelayedTaskMatch());
    } else if (normalizedStatusFilter === "approval_delay") {
      addAndMatch(match, buildApprovalDelayedTaskMatch());
    } else if (normalizedStatusFilter === "upload_delay") {
      addAndMatch(match, buildUploadDelayedTaskMatch());
    } else if (normalizedStatusFilter === "due_today") {
      addAndMatch(match, buildDueTodayTaskMatch());
    } else if (normalizedStatusFilter === "complete_and_beyond") {
      match.status = {
        $in: [
          ...NEEDS_APPROVAL_STATUS_VALUES,
          "approved",
          "uploaded",
          "completed",
        ],
      };
    } else if (uploadPendingFilter) {
      match.upload_required = { $ne: false };
      if (!privilegedReader) {
        match["upload_assignees.user"] = user?._id || user?.id;
      }
      addAndMatch(match, {
        status: { $in: ["approved", "uploaded"] },
        $or: [
          {
            upload_statuses: {
              $elemMatch: privilegedReader
                ? { status: { $ne: "uploaded" } }
                : {
                    user: user?._id || user?.id,
                    status: { $ne: "uploaded" },
                  },
            },
          },
          { "upload_statuses.0": { $exists: false } },
        ],
      });
    } else {
      match.status = buildStatusMatch(query.status);
    }
  }
  if (normalizeText(query?.task_type_key)) {
    match.task_type_key = normalizeKey(query.task_type_key);
  }
  if (normalizeText(query?.batch) && mongoose.Types.ObjectId.isValid(query.batch)) {
    match.batch = new mongoose.Types.ObjectId(query.batch);
  }
  if (
    privilegedReader &&
    normalizeText(query?.assignee) &&
    mongoose.Types.ObjectId.isValid(query.assignee)
  ) {
    match[uploadPendingFilter ? "upload_assignees.user" : "assigned_to.user"] =
      new mongoose.Types.ObjectId(query.assignee);
  }
  if (normalizeText(query?.creator) && mongoose.Types.ObjectId.isValid(query.creator)) {
    match["created_by.user"] = new mongoose.Types.ObjectId(query.creator);
  }
  if (normalizeText(query?.department) && mongoose.Types.ObjectId.isValid(query.department)) {
    match.department = new mongoose.Types.ObjectId(query.department);
  }
  if (normalizeText(query?.brand)) {
    match.brand = normalizeText(query.brand);
  }

  const dueFrom = toDateOrNull(query?.due_date_from);
  const dueTo = toDateOrNull(query?.due_date_to);
  if (dueFrom || dueTo) {
    const dueDateRangeConditions = [{ $ne: [buildActiveDueDateExpression(), null] }];
    if (dueFrom) {
      dueDateRangeConditions.push({ $gte: [buildActiveDueDateExpression(), dueFrom] });
    }
    if (dueTo) {
      const nextDay = new Date(dueTo);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      dueDateRangeConditions.push({ $lt: [buildActiveDueDateExpression(), nextDay] });
    }
    addAndMatch(match, { $expr: { $and: dueDateRangeConditions } });
  }

  if (normalizeText(query?.search)) {
    const regex = new RegExp(escapeRegex(normalizeText(query.search)), "i");
    addAndMatch(match, {
      $or: [
        { task_no: regex },
        { title: regex },
        { source_folder_name: regex },
        { source_folder_path: regex },
        { brand: regex },
      ],
    });
  }

  return {
    match: applyDataAccessMatch(match, user),
    privilegedReader,
  };
};

const findActiveTaskTypeForManualTask = async (taskTypeKey = "") => {
  const normalizedTaskTypeKey = normalizeKey(taskTypeKey);
  if (!normalizedTaskTypeKey) {
    throw new Error("task_type_key is required");
  }

  const taskType = await TaskType.findOne({
    key: normalizedTaskTypeKey,
    is_active: true,
  })
    .select(
      "_id key name category auto_create_mode default_department default_assignees default_priority requires_review is_active",
    )
    .lean();

  if (!taskType) {
    throw new Error("Selected task type was not found or is inactive");
  }

  return taskType;
};

const parseWorkflowDate = (value, fieldName) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(
      Date.UTC(year, month - 1, day) - INDIA_TIMEZONE_OFFSET_MS,
    );
    const shifted = new Date(parsed.getTime() + INDIA_TIMEZONE_OFFSET_MS);
    if (
      shifted.getUTCFullYear() !== year ||
      shifted.getUTCMonth() !== month - 1 ||
      shifted.getUTCDate() !== day
    ) {
      throw new Error(`${fieldName} is invalid`);
    }
    return parsed;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} is invalid`);
  }
  return parsed;
};

const parseDueDate = (value) => parseWorkflowDate(value, "due_date");

const parseAssignedAt = (value) => parseWorkflowDate(value, "assignment_date");

const normalizeTaskPriority = (value, fallback = "normal") => {
  const normalizedPriority = normalizeText(value || fallback).toLowerCase();
  if (!WORKFLOW_TASK_PRIORITIES.includes(normalizedPriority)) {
    throw new Error("priority is invalid");
  }
  return normalizedPriority;
};

const recalculateWorkflowBatchIfPresent = async (batchId) => {
  if (!batchId || !mongoose.Types.ObjectId.isValid(batchId)) {
    return null;
  }

  return recalculateWorkflowBatchFromTasks(batchId);
};

const emitWorkflowTaskMutation = ({
  realtimeSource = null,
  task = null,
  batch = null,
  actor = {},
  message = "",
  additionalUserIds = [],
  eventType = "updated",
  changedFields = [],
  shouldRefetch = false,
} = {}) => {
  if (!realtimeSource || !task) return;
  const uploadAssigneeIds = (Array.isArray(task?.upload_assignees) ? task.upload_assignees : [])
    .map((entry) => normalizeId(entry?.user?._id || entry?.user || entry))
    .filter(Boolean);

  const emitTaskEvent = eventType === "created"
    ? emitWorkflowTaskCreated
    : eventType === "deleted"
      ? emitWorkflowTaskDeleted
      : emitWorkflowTaskUpdated;

  emitTaskEvent(realtimeSource, task, batch, {
    changedBy: buildAuditActor(actor),
    message,
    additionalUserIds: uniqueIds([...additionalUserIds, ...uploadAssigneeIds]),
    changedFields,
    shouldRefetch,
  });

  if (batch) {
    emitWorkflowBatchUpdated(realtimeSource, batch, {
      message,
      changedFields: ["counts"],
      shouldRefetch: true,
      additionalUserIds: uniqueIds([...additionalUserIds, ...uploadAssigneeIds]),
    });
  }

  notifyWorkflowTaskEvent({
    realtimeSource,
    task,
    actor,
    eventType,
    changedFields,
    additionalUserIds: uniqueIds([...additionalUserIds, ...uploadAssigneeIds]),
    message,
  }).catch((error) => {
    console.error("Workflow notification creation failed:", error);
  });
};

const buildUploadStatusEntriesFromAssignees = (assignees = []) =>
  (Array.isArray(assignees) ? assignees : [])
    .map((entry) => {
      const userId = getUserRefId(entry);
      return userId
        ? {
            user: userId,
            status: "pending",
            uploaded_by: {},
            uploaded_at: null,
          }
        : null;
    })
    .filter(Boolean);

const resetTaskUploadStatuses = (task) => {
  if (!task) return;
  task.upload_statuses = task.upload_required === false
    ? []
    : buildUploadStatusEntriesFromAssignees(task.upload_assignees);
};

const getTaskByIdForUser = async (id, user = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid task id");
  }

  const match = buildTaskVisibilityMatch(user);
  match._id = id;
  const task = await populateTaskQuery(
    Task.findOne(applyDataAccessMatch(match, user)),
  );
  return task ? serializeTask(task) : null;
};

const getMutableTaskById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid task id");
  }

  const task = await Task.findById(id);
  if (!task || task.is_deleted) {
    throw new Error("Workflow task not found");
  }
  return task;
};

const buildTaskDetail = async (taskId, user = {}) => {
  const task = await getTaskByIdForUser(taskId, user);
  if (!task) return null;

  const [assignments, history, comments] = await Promise.all([
    TaskAssignment.find({ task: task._id })
      .populate("assignee", "name email role")
      .populate("department", "name key")
      .populate("assigned_by.user", "name email role")
      .populate("removed_by.user", "name email role")
      .sort({ assigned_at: -1 })
      .lean(),
    TaskStatusHistory.find({ task: task._id })
      .populate("changed_by.user", "name email role")
      .sort({ changed_at: -1, createdAt: -1 })
      .lean(),
    Comment.find({ task: task._id, is_deleted: false })
      .populate("created_by.user", "name email role")
      .populate("updated_by.user", "name email role")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return {
    ...task,
    completion_comment: task.completion_comment || getLatestCompletionComment(comments),
    assignments,
    status_history: history,
    comments,
  };
};

const listWorkflowTasks = async ({ query = {}, user = {} } = {}) => {
  const page = parsePositiveInt(query?.page, 1);
  const limit = Math.min(MAX_PAGE_LIMIT, parsePositiveInt(query?.limit, DEFAULT_PAGE_LIMIT));
  const skip = (page - 1) * limit;
  const normalizedStatusFilter = normalizeKey(query?.status);

  if (normalizedStatusFilter === "complete" || normalizedStatusFilter === "complete_done") {
    const queryWithoutStatus = { ...query, status: "" };
    const { match: unitMatch } = buildTaskListMatch({ query: queryWithoutStatus, user });
    const rows = await populateTaskQuery(
      Task.find(unitMatch).sort({ createdAt: -1, task_no: 1 }),
    );
    const completionCommentMap = await getLatestCompletionCommentMap(
      rows.map((row) => row?._id),
    );
    const rowsWithCompletionComments = rows.map((row) => ({
      ...row,
      completion_comment: completionCommentMap.get(normalizeId(row?._id)) || null,
    }));
    const groupedRows = await groupTaskRowsForBoard(rowsWithCompletionComments);
    const completeRows = groupedRows.filter((row) => {
      const rowStatus = normalizeWorkflowTaskStatus(row?.status, { fallback: "" });
      if (normalizedStatusFilter === "complete") {
        return rowStatus === "complete";
      }
      return (
        ["uploaded", "completed"].includes(rowStatus) ||
        (rowStatus === "approved" && row?.upload_required === false)
      );
    });
    const pagedRows = completeRows.slice(skip, skip + limit);

    return {
      rows: pagedRows,
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(completeRows.length / limit)),
        totalRecords: completeRows.length,
      },
    };
  }

  const { match } = buildTaskListMatch({ query, user });

  const [rows, totalRecords] = await Promise.all([
    populateTaskQuery(
      Task.find(match)
        .sort({ createdAt: -1, task_no: 1 })
        .skip(skip)
        .limit(limit),
    ),
    Task.countDocuments(match),
  ]);
  const completionCommentMap = await getLatestCompletionCommentMap(
    rows.map((row) => row?._id),
  );

  const rowsWithCompletionComments = rows.map((row) => ({
    ...row,
    completion_comment: completionCommentMap.get(normalizeId(row?._id)) || null,
  }));

  return {
    rows: await groupTaskRowsForBoard(rowsWithCompletionComments),
    pagination: {
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
      totalRecords,
    },
  };
};

const createWorkflowTask = async ({
  payload = {},
  actor = {},
  realtimeSource = null,
} = {}) => {
  const title = normalizeText(payload?.title || payload?.name);
  if (!title) {
    throw new Error("Task name is required");
  }

  const taskType = await findActiveTaskTypeForManualTask(payload?.task_type_key);

  const assigneeIds = payload?.assignee_ids !== undefined
    ? payload.assignee_ids
    : (Array.isArray(taskType?.default_assignees)
        ? taskType.default_assignees.map((entry) => normalizeId(entry?.user || entry))
        : []);
  const assignees = await validateAssigneeUsers(assigneeIds || []);
  if (assignees.length === 0) {
    throw new Error("At least one assignee is required");
  }
  const uploadRequired = payload?.upload_required !== undefined
    ? Boolean(payload.upload_required)
    : true;
  const defaultUploadAssigneeIds = uniqueIds([
    actor?._id || actor?.id,
    ...assignees.map((user) => user?._id),
  ]);
  const uploadAssigneeIds = uploadRequired
    ? uniqueIds(
        payload?.upload_assignee_ids !== undefined
          ? payload.upload_assignee_ids
          : defaultUploadAssigneeIds,
      )
    : [];
  const uploadAssignees = uploadRequired
    ? await validateAssigneeUsers(uploadAssigneeIds)
    : [];
  if (uploadRequired && uploadAssignees.length === 0) {
    throw new Error("At least one upload user is required when upload is required");
  }

  const department = payload?.department !== undefined
    ? await ensureDepartmentExists(payload.department)
    : (taskType?.default_department || null);
  const dueDate = parseDueDate(payload?.due_date);
  if (!dueDate) {
    throw new Error("due_date is required");
  }
  const reviewRequired = payload?.review_required !== undefined
    ? Boolean(payload.review_required)
    : taskType?.requires_review !== false;
  const priority = normalizeTaskPriority(
    payload?.priority,
    taskType?.default_priority || "normal",
  );
  const taskId = new mongoose.Types.ObjectId();
  const taskNo = buildWorkflowManualTaskNo(taskId, new Date());
  const auditActor = buildAuditActor(actor);
  const assignedUserRefs = assignees.map((user) => ({ user: user._id }));
  const initialStatus = "assigned";
  const assignedAtInput = payload?.assigned_at !== undefined
    ? payload.assigned_at
    : payload?.assignment_date;
  const assignedAt = parseAssignedAt(assignedAtInput) || new Date();

  const task = await Task.create({
    _id: taskId,
    batch: null,
    batch_no: "",
    task_no: taskNo,
    title,
    description: normalizeText(payload?.description),
    task_type: taskType._id,
    task_type_key: taskType.key,
    task_type_name: taskType.name,
    department,
    brand: normalizeText(payload?.brand),
    source_folder_name: "",
    source_folder_path: "",
    source_files: [],
    status: initialStatus,
    priority,
    assigned_to: assignedUserRefs,
    assigned_by: auditActor,
    assigned_at: assignedAt,
    upload_required: uploadRequired,
    upload_assignees: uploadAssignees.map((user) => ({ user: user._id })),
    upload_statuses: buildUploadStatusEntriesFromAssignees(uploadAssignees),
    due_date: dueDate,
    review_required: reviewRequired,
    tags: [taskType.key],
    created_by: auditActor,
    updated_by: auditActor,
  });

  if (assignees.length > 0) {
    await TaskAssignment.insertMany(
      assignees.map((user) => ({
        task: task._id,
        batch: null,
        assignee: user._id,
        department: task.department || null,
        status: "active",
        assigned_at: assignedAt,
        assigned_by: auditActor,
        note: "Task created with assignee",
      })),
      { ordered: true },
    );
  }

  await TaskStatusHistory.create({
    task: task._id,
    batch: null,
    from_status: "",
    to_status: initialStatus,
    changed_by: auditActor,
    changed_at: new Date(),
    note: normalizeText(payload?.creation_note),
    metadata: {
      initial_creation: true,
      manual_creation: true,
    },
  });

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: "Workflow task created",
    eventType: "created",
    changedFields: ["created"],
    shouldRefetch: false,
  });

  return taskDetail;
};

const getWorkflowDashboardSummary = async ({ query = {}, user = {} } = {}) => {
  if (!isAdmin(user)) {
    throw new Error("Only admins can view the workflow dashboard");
  }

  const { match } = buildTaskListMatch({ query, user });
  const now = new Date();
  const todayStart = getIndianDayStart(now);
  const tomorrowStart = addDays(todayStart, 1);

  const statusCount = (status) => ({
    $sum: {
      $cond: [{ $eq: ["$normalized_status", status] }, 1, 0],
    },
  });

  const openTaskExpression = buildOpenTaskExpression();
  const completeTaskExpression = buildCompleteTaskExpression();
  const openTaskCount = {
    $sum: {
      $cond: [openTaskExpression, 1, 0],
    },
  };
  const uploadRemainingCount = {
    $sum: {
      $cond: [
        {
          $and: [
            { $in: ["$normalized_status", ["approved", "uploaded"]] },
            { $ne: ["$upload_required", false] },
            {
              $or: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: { $ifNull: ["$upload_statuses", []] },
                          as: "uploadStatus",
                          cond: { $ne: ["$$uploadStatus.status", "uploaded"] },
                        },
                      },
                    },
                    0,
                  ],
                },
                { $eq: [{ $size: { $ifNull: ["$upload_statuses", []] } }, 0] },
              ],
            },
          ],
        },
        1,
        0,
      ],
    },
  };

  const notApprovedByDueDate = buildNotApprovedByDueDateExpression();
  const completionOverdueExpression = buildCompletionOverdueExpression(now);
  const approvalOverdueExpression = buildApprovalOverdueExpression(now);
  const uploadOverdueExpression = buildUploadOverdueExpression(now);
  const uploadDelayExpression = buildUploadDelayExpression();
  const approvalDelayExpression = buildApprovalDelayExpression();
  const completionDelayExpression = buildCompletionDelayExpression();

  const overdueCount = {
    $sum: {
      $cond: [completionOverdueExpression, 1, 0],
    },
  };
  const approvalOverdueCount = {
    $sum: {
      $cond: [approvalOverdueExpression, 1, 0],
    },
  };
  const uploadOverdueCount = {
    $sum: {
      $cond: [uploadOverdueExpression, 1, 0],
    },
  };

  const delayedCount = {
    $sum: {
      $cond: [
        {
          $and: [
            completionDelayExpression,
            { $not: [approvalDelayExpression] },
            { $not: [uploadDelayExpression] },
          ],
        },
        1,
        0,
      ],
    },
  };
  const approvalDelayedCount = {
    $sum: {
      $cond: [
        {
          $and: [
            approvalDelayExpression,
            { $not: [uploadDelayExpression] },
          ],
        },
        1,
        0,
      ],
    },
  };
  const uploadDelayedCount = {
    $sum: {
      $cond: [uploadDelayExpression, 1, 0],
    },
  };

  const dueTodayCount = {
    $sum: {
      $cond: [
        {
          $and: [
            { $in: ["$normalized_status", DUE_TRACKED_TASK_STATUSES] },
            { $ne: [buildActiveDueDateExpression(), null] },
            { $gte: [buildActiveDueDateExpression(), todayStart] },
            { $lt: [buildActiveDueDateExpression(), tomorrowStart] },
            notApprovedByDueDate,
          ],
        },
        1,
        0,
      ],
    },
  };

  const baseGroup = {
    total_tasks: { $sum: 1 },
    open_tasks: openTaskCount,
    assigned_tasks: statusCount("assigned"),
    started_tasks: statusCount("started"),
    complete_tasks: statusCount("complete"),
    complete_done_tasks: {
      $sum: {
        $cond: [completeTaskExpression, 1, 0],
      },
    },
    hold_tasks: statusCount("hold"),
    hold_approval_pending_tasks: {
      $sum: {
        $cond: [{ $eq: ["$hold.status", "pending"] }, 1, 0],
      },
    },
    approved_tasks: statusCount("approved"),
    uploaded_tasks: statusCount("uploaded"),
    upload_remaining_tasks: uploadRemainingCount,
    reworked_tasks: {
      $sum: {
        $cond: [{ $gt: ["$normalized_rework_count", 0] }, 1, 0],
      },
    },
    reworked_before_approval_tasks: {
      $sum: {
        $cond: [{ $gt: ["$normalized_rework_before_approval_count", 0] }, 1, 0],
      },
    },
    reworked_after_approval_tasks: {
      $sum: {
        $cond: [{ $gt: ["$normalized_rework_after_approval_count", 0] }, 1, 0],
      },
    },
    needs_approval_tasks: statusCount("complete"),
    overdue_tasks: overdueCount,
    approval_overdue_tasks: approvalOverdueCount,
    upload_overdue_tasks: uploadOverdueCount,
    delayed_tasks: delayedCount,
    approval_delayed_tasks: approvalDelayedCount,
    upload_delayed_tasks: uploadDelayedCount,
    due_today_tasks: dueTodayCount,
  };

  const [summary] = await Task.aggregate([
    { $match: match },
    {
      $addFields: {
        normalized_status: buildWorkflowTaskStatusNormalizationExpression(),
        normalized_rework_count: {
          $ifNull: ["$reworked.count", { $ifNull: ["$rework_count", 0] }],
        },
        normalized_rework_before_approval_count: {
          $ifNull: ["$reworked.before_approval_count", 0],
        },
        normalized_rework_after_approval_count: {
          $ifNull: ["$reworked.after_approval_count", 0],
        },
      },
    },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: null,
              ...baseGroup,
              unassigned_tasks: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        {
                          $size: { $ifNull: ["$assigned_to", []] },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        users: [
          { $unwind: "$assigned_to" },
          {
            $match: {
              "assigned_to.user": { $ne: null },
            },
          },
          {
            $group: {
              _id: "$assigned_to.user",
              ...baseGroup,
              last_task_update_at: { $max: "$updatedAt" },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: {
              path: "$user",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 0,
              user_id: "$_id",
              name: {
                $ifNull: ["$user.name", "Unknown User"],
              },
              email: {
                $ifNull: ["$user.email", ""],
              },
              role: {
                $ifNull: ["$user.role", ""],
              },
              last_task_update_at: 1,
              total_tasks: 1,
              open_tasks: 1,
              assigned_tasks: 1,
              started_tasks: 1,
              complete_tasks: 1,
              complete_done_tasks: 1,
              hold_tasks: 1,
              hold_approval_pending_tasks: 1,
              approved_tasks: 1,
              uploaded_tasks: 1,
              upload_remaining_tasks: 1,
              reworked_tasks: 1,
              reworked_before_approval_tasks: 1,
              reworked_after_approval_tasks: 1,
              needs_approval_tasks: 1,
              overdue_tasks: 1,
              approval_overdue_tasks: 1,
              upload_overdue_tasks: 1,
              delayed_tasks: 1,
              approval_delayed_tasks: 1,
              upload_delayed_tasks: 1,
              due_today_tasks: 1,
            },
          },
          {
            $sort: {
              open_tasks: -1,
              overdue_tasks: -1,
              needs_approval_tasks: -1,
              total_tasks: -1,
              name: 1,
            },
          },
        ],
        uploadUsers: [
          {
            $match: {
              normalized_status: "approved",
              upload_required: { $ne: false },
            },
          },
          { $unwind: "$upload_assignees" },
          {
            $match: {
              "upload_assignees.user": { $ne: null },
            },
          },
          {
            $group: {
              _id: "$upload_assignees.user",
              upload_remaining_tasks: { $sum: 1 },
              last_task_update_at: { $max: "$updatedAt" },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "user",
            },
          },
          {
            $unwind: {
              path: "$user",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              _id: 0,
              user_id: "$_id",
              name: {
                $ifNull: ["$user.name", "Unknown User"],
              },
              email: {
                $ifNull: ["$user.email", ""],
              },
              role: {
                $ifNull: ["$user.role", ""],
              },
              last_task_update_at: 1,
              upload_remaining_tasks: 1,
            },
          },
        ],
      },
    },
  ]);

  const overall = {
    ...buildWorkflowDashboardCounts(summary?.overall?.[0]),
    unassigned_tasks: Number(summary?.overall?.[0]?.unassigned_tasks || 0),
  };

  const [unitOverallSummary] = await Task.aggregate([
    { $match: match },
    {
      $addFields: {
        normalized_status: buildWorkflowTaskStatusNormalizationExpression(),
        normalized_rework_count: {
          $ifNull: ["$reworked.count", { $ifNull: ["$rework_count", 0] }],
        },
        normalized_rework_before_approval_count: {
          $ifNull: ["$reworked.before_approval_count", 0],
        },
        normalized_rework_after_approval_count: {
          $ifNull: ["$reworked.after_approval_count", 0],
        },
      },
    },
    {
      $addFields: {
        workflow_unit_key: {
          $cond: [
            { $ne: ["$batch", null] },
            { $concat: ["batch:", { $toString: "$batch" }] },
            { $concat: ["task:", { $toString: "$_id" }] },
          ],
        },
        unit_is_open: openTaskExpression,
        unit_is_complete_done: completeTaskExpression,
        unit_is_hold: { $eq: ["$normalized_status", "hold"] },
        unit_is_hold_approval_pending: { $eq: ["$hold.status", "pending"] },
        unit_is_started_or_beyond: {
          $in: ["$normalized_status", ["started", "complete", "approved", "uploaded"]],
        },
        unit_is_complete_or_beyond: {
          $or: [
            { $in: ["$normalized_status", ["complete", "approved", "uploaded"]] },
            completeTaskExpression,
          ],
        },
        unit_is_approved_or_beyond: {
          $or: [
            { $in: ["$normalized_status", ["approved", "uploaded"]] },
            completeTaskExpression,
          ],
        },
        unit_is_overdue: completionOverdueExpression,
        unit_is_approval_overdue: approvalOverdueExpression,
        unit_is_upload_overdue: uploadOverdueExpression,
        unit_is_delayed: {
          $and: [
            completionDelayExpression,
            { $not: [approvalDelayExpression] },
            { $not: [uploadDelayExpression] },
          ],
        },
        unit_is_approval_delayed: {
          $and: [
            approvalDelayExpression,
            { $not: [uploadDelayExpression] },
          ],
        },
        unit_is_upload_delayed: uploadDelayExpression,
        unit_is_due_today: {
          $and: [
            { $in: ["$normalized_status", DUE_TRACKED_TASK_STATUSES] },
            { $ne: [buildActiveDueDateExpression(), null] },
            { $gte: [buildActiveDueDateExpression(), todayStart] },
            { $lt: [buildActiveDueDateExpression(), tomorrowStart] },
            notApprovedByDueDate,
          ],
        },
      },
    },
    {
      $group: {
        _id: "$workflow_unit_key",
        child_count: { $sum: 1 },
        open_count: { $sum: { $cond: ["$unit_is_open", 1, 0] } },
        complete_done_count: { $sum: { $cond: ["$unit_is_complete_done", 1, 0] } },
        hold_count: { $sum: { $cond: ["$unit_is_hold", 1, 0] } },
        hold_approval_pending_count: {
          $sum: { $cond: ["$unit_is_hold_approval_pending", 1, 0] },
        },
        started_or_beyond_count: { $sum: { $cond: ["$unit_is_started_or_beyond", 1, 0] } },
        complete_or_beyond_count: { $sum: { $cond: ["$unit_is_complete_or_beyond", 1, 0] } },
        approved_or_beyond_count: { $sum: { $cond: ["$unit_is_approved_or_beyond", 1, 0] } },
        reworked_count: {
          $sum: {
            $cond: [{ $gt: ["$normalized_rework_count", 0] }, 1, 0],
          },
        },
        reworked_before_approval_count: {
          $sum: {
            $cond: [{ $gt: ["$normalized_rework_before_approval_count", 0] }, 1, 0],
          },
        },
        reworked_after_approval_count: {
          $sum: {
            $cond: [{ $gt: ["$normalized_rework_after_approval_count", 0] }, 1, 0],
          },
        },
        overdue_count: { $sum: { $cond: ["$unit_is_overdue", 1, 0] } },
        approval_overdue_count: { $sum: { $cond: ["$unit_is_approval_overdue", 1, 0] } },
        upload_overdue_count: { $sum: { $cond: ["$unit_is_upload_overdue", 1, 0] } },
        delayed_count: { $sum: { $cond: ["$unit_is_delayed", 1, 0] } },
        approval_delayed_count: { $sum: { $cond: ["$unit_is_approval_delayed", 1, 0] } },
        upload_delayed_count: { $sum: { $cond: ["$unit_is_upload_delayed", 1, 0] } },
        due_today_count: { $sum: { $cond: ["$unit_is_due_today", 1, 0] } },
      },
    },
    {
      $addFields: {
        is_uploaded_unit: { $eq: ["$complete_done_count", "$child_count"] },
        is_hold_unit: { $gt: ["$hold_count", 0] },
        is_hold_approval_pending_unit: { $gt: ["$hold_approval_pending_count", 0] },
        is_approved_unit: { $eq: ["$approved_or_beyond_count", "$child_count"] },
        is_complete_unit: { $eq: ["$complete_or_beyond_count", "$child_count"] },
        is_started_unit: { $gt: ["$started_or_beyond_count", 0] },
        is_open_unit: { $gt: ["$open_count", 0] },
        is_reworked_unit: { $gt: ["$reworked_count", 0] },
        is_reworked_before_approval_unit: { $gt: ["$reworked_before_approval_count", 0] },
        is_reworked_after_approval_unit: { $gt: ["$reworked_after_approval_count", 0] },
      },
    },
    {
      $group: {
        _id: null,
        total_tasks: { $sum: 1 },
        open_tasks: { $sum: { $cond: ["$is_open_unit", 1, 0] } },
        assigned_tasks: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $not: ["$is_started_unit"] },
                  { $not: ["$is_complete_unit"] },
                  { $not: ["$is_approved_unit"] },
                  { $not: ["$is_uploaded_unit"] },
                  { $not: ["$is_hold_unit"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        started_tasks: {
          $sum: {
            $cond: [
              {
                $and: [
                  "$is_started_unit",
                  { $not: ["$is_complete_unit"] },
                  { $not: ["$is_approved_unit"] },
                  { $not: ["$is_uploaded_unit"] },
                  { $not: ["$is_hold_unit"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        complete_tasks: {
          $sum: {
            $cond: [
              {
                $and: [
                  "$is_complete_unit",
                  { $not: ["$is_approved_unit"] },
                  { $not: ["$is_uploaded_unit"] },
                  { $not: ["$is_hold_unit"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        complete_done_tasks: { $sum: { $cond: ["$is_uploaded_unit", 1, 0] } },
        hold_tasks: { $sum: { $cond: ["$is_hold_unit", 1, 0] } },
        hold_approval_pending_tasks: {
          $sum: { $cond: ["$is_hold_approval_pending_unit", 1, 0] },
        },
        approved_tasks: {
          $sum: {
            $cond: [
              {
                $and: [
                  "$is_approved_unit",
                  { $not: ["$is_uploaded_unit"] },
                  { $not: ["$is_hold_unit"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        uploaded_tasks: { $sum: { $cond: ["$is_uploaded_unit", 1, 0] } },
        upload_remaining_tasks: {
          $sum: {
            $cond: [
              {
                $and: [
                  "$is_approved_unit",
                  { $not: ["$is_uploaded_unit"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        reworked_tasks: { $sum: { $cond: ["$is_reworked_unit", 1, 0] } },
        reworked_before_approval_tasks: {
          $sum: { $cond: ["$is_reworked_before_approval_unit", 1, 0] },
        },
        reworked_after_approval_tasks: {
          $sum: { $cond: ["$is_reworked_after_approval_unit", 1, 0] },
        },
        needs_approval_tasks: {
          $sum: {
            $cond: [
              {
                $and: [
                  "$is_complete_unit",
                  { $not: ["$is_approved_unit"] },
                  { $not: ["$is_uploaded_unit"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        overdue_tasks: { $sum: { $cond: [{ $gt: ["$overdue_count", 0] }, 1, 0] } },
        approval_overdue_tasks: {
          $sum: { $cond: [{ $gt: ["$approval_overdue_count", 0] }, 1, 0] },
        },
        upload_overdue_tasks: {
          $sum: { $cond: [{ $gt: ["$upload_overdue_count", 0] }, 1, 0] },
        },
        delayed_tasks: { $sum: { $cond: [{ $gt: ["$delayed_count", 0] }, 1, 0] } },
        approval_delayed_tasks: {
          $sum: { $cond: [{ $gt: ["$approval_delayed_count", 0] }, 1, 0] },
        },
        upload_delayed_tasks: {
          $sum: { $cond: [{ $gt: ["$upload_delayed_count", 0] }, 1, 0] },
        },
        due_today_tasks: { $sum: { $cond: [{ $gt: ["$due_today_count", 0] }, 1, 0] } },
      },
    },
  ]);

  Object.assign(overall, buildWorkflowDashboardCounts(unitOverallSummary || overall));

  const userById = new Map();
  (Array.isArray(summary?.users) ? summary.users : []).forEach((entry) => {
    const userId = normalizeId(entry?.user_id);
    if (!userId) return;
    userById.set(userId, {
        user_id: entry?.user_id || null,
        name: normalizeText(entry?.name) || "Unknown User",
        email: normalizeText(entry?.email),
        role: normalizeText(entry?.role),
        last_task_update_at: entry?.last_task_update_at || null,
        counts: {
          ...buildWorkflowDashboardCounts(entry),
          upload_remaining_tasks: 0,
        },
      });
  });
  (Array.isArray(summary?.uploadUsers) ? summary.uploadUsers : []).forEach((entry) => {
    const userId = normalizeId(entry?.user_id);
    if (!userId) return;
    const current = userById.get(userId) || {
      user_id: entry?.user_id || null,
      name: normalizeText(entry?.name) || "Unknown User",
      email: normalizeText(entry?.email),
      role: normalizeText(entry?.role),
      last_task_update_at: entry?.last_task_update_at || null,
      counts: buildWorkflowDashboardCounts({}),
    };
    current.counts.upload_remaining_tasks = Number(entry?.upload_remaining_tasks || 0);
    if (
      entry?.last_task_update_at &&
      (
        !current.last_task_update_at ||
        new Date(entry.last_task_update_at).getTime() >
          new Date(current.last_task_update_at).getTime()
      )
    ) {
      current.last_task_update_at = entry.last_task_update_at;
    }
    userById.set(userId, current);
  });

  const users = [...userById.values()].sort(
    (left, right) =>
      Number(right?.counts?.open_tasks || 0) - Number(left?.counts?.open_tasks || 0)
      || Number(right?.counts?.overdue_tasks || 0) - Number(left?.counts?.overdue_tasks || 0)
      || Number(right?.counts?.needs_approval_tasks || 0) -
        Number(left?.counts?.needs_approval_tasks || 0)
      || Number(right?.counts?.upload_remaining_tasks || 0) -
        Number(left?.counts?.upload_remaining_tasks || 0)
      || Number(right?.counts?.total_tasks || 0) - Number(left?.counts?.total_tasks || 0)
      || normalizeText(left?.name).localeCompare(normalizeText(right?.name)),
  );

  return {
    generated_at: now.toISOString(),
    overall: {
      ...overall,
      users_with_tasks: users.length,
      users_with_overdue_tasks: users.filter(
        (entry) =>
          Number(entry?.counts?.overdue_tasks || 0) +
            Number(entry?.counts?.approval_overdue_tasks || 0) +
            Number(entry?.counts?.upload_overdue_tasks || 0) >
          0,
      ).length,
    },
    users,
  };
};

const ensureAllowedStatusTransition = (fromStatus = "", toStatus = "") => {
  const allowedTargets = WORKFLOW_ALLOWED_STATUS_TRANSITIONS[fromStatus] || [];
  if (!allowedTargets.includes(toStatus)) {
    throw new Error(`Task status cannot move from ${fromStatus} to ${toStatus}`);
  }
};

const updateAssignmentCompletionState = async (task, toStatus, actor, note = "") => {
  if (!Array.isArray(task?.assigned_to) || task.assigned_to.length === 0) {
    return;
  }

  const activeAssigneeIds = task.assigned_to.map((entry) => entry.user).filter(Boolean);
  if (activeAssigneeIds.length === 0) {
    return;
  }

  if (toStatus === "complete") {
    await TaskAssignment.updateMany(
      {
        task: task._id,
        assignee: { $in: activeAssigneeIds },
        status: "active",
      },
      {
        $set: {
          status: "completed",
          completed_at: new Date(),
          note: normalizeText(note) || "Task marked complete",
        },
      },
    );
    return;
  }

  if (toStatus === "assigned") {
    await TaskAssignment.updateMany(
      {
        task: task._id,
        assignee: { $in: activeAssigneeIds },
      },
      {
        $set: {
          status: "active",
          completed_at: null,
          removed_at: null,
          removed_by: {},
          note: normalizeText(note) || "Task returned for rework",
        },
      },
    );
  }
};

const createTransitionCommentIfNeeded = async ({
  task,
  actor,
  note = "",
  commentType = "system",
}) => {
  const normalizedNote = normalizeText(note);
  if (!normalizedNote) return;

  await Comment.create({
    task: task._id,
    batch: task.batch || null,
    comment: normalizedNote,
    comment_type: WORKFLOW_TASK_COMMENT_TYPES.includes(commentType)
      ? commentType
      : "system",
    created_by: buildAuditActor(actor),
    updated_by: buildAuditActor(actor),
  });
};

const applyTaskTransition = async ({
  task,
  actor,
  toStatus,
  note = "",
  commentType = "system",
  realtimeSource = null,
  successMessage = "",
}) => {
  const auditActor = buildAuditActor(actor);
  const fromStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: "assigned",
  }) || "assigned";
  ensureAllowedStatusTransition(fromStatus, toStatus);

  task.status = fromStatus;
  task.status = toStatus;
  task.updated_by = auditActor;

  if (toStatus === "started") {
    task.started_at = new Date();
    task.completed_at = null;
    task.approved_at = null;
    task.approved_by = {};
    task.reviewed_at = null;
    task.reviewed_by = {};
    task.uploaded_at = null;
    task.uploaded_by = {};
    resetTaskUploadStatuses(task);
  }
  if (toStatus === "complete") {
    task.started_at = task.started_at || new Date();
    task.completed_at = new Date();
    task.approved_at = null;
    task.approved_by = {};
    task.reviewed_at = null;
    task.reviewed_by = {};
    task.uploaded_at = null;
    task.uploaded_by = {};
    resetTaskUploadStatuses(task);
  }
  if (toStatus === "approved") {
    task.started_at = task.started_at || new Date();
    task.completed_at = task.completed_at || new Date();
    task.approved_by = auditActor;
    task.approved_at = new Date();
    task.reviewed_by = auditActor;
    task.reviewed_at = task.approved_at;
    task.uploaded_at = null;
    task.uploaded_by = {};
    resetTaskUploadStatuses(task);
  }
  if (toStatus === "uploaded") {
    task.started_at = task.started_at || new Date();
    task.completed_at = task.completed_at || new Date();
    task.uploaded_by = auditActor;
    task.uploaded_at = new Date();
  }

  await task.save();

  if (toStatus === "approved" && task.task_type_key === "cad_files") {
    try {
      const SampleWorkflow = require("../../models/sampleWorkflow.model");
      const isSampleWorkflowTask = await SampleWorkflow.exists({ code: task.title });
      if (isSampleWorkflowTask) {
        const User = require("../../models/user.model");
        const gaurav = await User.findOne({ username: { $regex: /^Gaurav$/i } });
        const ekta = await User.findOne({ username: { $regex: /^Ekta$/i } });
        const ajit = await User.findOne({ username: { $regex: /^Ajit$/i } });

        const taskTypeMisc = await TaskType.findOne({ key: "miscellaneous" });
        const deptOperations = await Department.findOne({ key: "operations" });

        const taskType3D = await TaskType.findOne({ key: "3d_by_cad" });
        const dept3D = await Department.findOne({ key: "3d_files" });

        if (gaurav) {
          const actorObj = {
            _id: gaurav._id,
            name: gaurav.name,
            email: gaurav.email,
            role: gaurav.role,
          };

          const due = addWorkflowDaysSkippingSunday(new Date(), 2);
          const year = due.getFullYear();
          const month = String(due.getMonth() + 1).padStart(2, "0");
          const day = String(due.getDate()).padStart(2, "0");
          const dueDateString = `${year}-${month}-${day}`;

          // Task 1: Ekta, miscellaneous, operations
          if (ekta && taskTypeMisc && deptOperations) {
            await createWorkflowTask({
              payload: {
                title: task.title,
                task_type_key: "miscellaneous",
                assignee_ids: [ekta._id.toString()],
                upload_required: false,
                department: deptOperations._id.toString(),
                due_date: dueDateString,
                brand: task.brand || "Sample Brand",
                description: `Operations task for Sample Workflow ${task.title}`,
                priority: "normal",
                creation_note: `Automatically triggered by approval of AutoCAD task: ${task.task_no}`,
              },
              actor: actorObj,
              realtimeSource,
            });
          } else {
            console.warn("Could not create miscellaneous task: user, task type, or department missing");
          }

          // Task 2: Ajit, 3d_by_cad, 3d_files
          if (ajit && taskType3D && dept3D) {
            await createWorkflowTask({
              payload: {
                title: task.title,
                task_type_key: "3d_by_cad",
                assignee_ids: [ajit._id.toString()],
                upload_required: false,
                department: dept3D._id.toString(),
                due_date: dueDateString,
                brand: task.brand || "Sample Brand",
                description: `3D CAD task for Sample Workflow ${task.title}`,
                priority: "normal",
                creation_note: `Automatically triggered by approval of AutoCAD task: ${task.task_no}`,
              },
              actor: actorObj,
              realtimeSource,
            });
          } else {
            console.warn("Could not create 3d_by_cad task: user, task type, or department missing");
          }
        } else {
          console.warn("Auto task creation failed: User 'Gaurav' not found");
        }
      }
    } catch (triggerError) {
      console.error("Failed to trigger follow-up sample workflow tasks on approval:", triggerError);
    }
  }

  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch || null,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: auditActor,
    changed_at: new Date(),
    note: normalizeText(note),
    metadata: {},
  });
  await updateAssignmentCompletionState(task, toStatus, actor, note);
  await createTransitionCommentIfNeeded({
    task,
    actor,
    note,
    commentType,
  });
  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: successMessage || `Workflow task moved to ${toStatus}`,
    changedFields: ["status"],
    shouldRefetch: true,
  });

  return taskDetail;
};

const assertTransitionPermission = ({ task, actor, toStatus }) => {
  if (toStatus === "started" && !canCompleteWorkflowTask(actor, task)) {
    throw new Error("Only an assigned user can start this task");
  }

  if (["complete"].includes(toStatus) && !canCompleteWorkflowTask(actor, task)) {
    throw new Error("Only an assigned user can mark this task complete");
  }

  if (["uploaded"].includes(toStatus) && !canUploadWorkflowTask(actor, task)) {
    if (task?.upload_required === false) {
      throw new Error("Upload is not required for this task");
    }
    throw new Error("Only a selected upload user can mark this task uploaded");
  }

  if (["approved"].includes(toStatus) && !canApproveWorkflowTask(actor, task)) {
    throw new Error("Only the user who assigned this task can approve it");
  }

  if (toStatus === "__rework__") {
    if (
      !isManagerOrAdmin(actor) &&
      !isTaskCreatedByUser(task, actor?._id || actor?.id)
    ) {
      throw new Error("Only admin, manager, or the task creator can send this task to rework");
    }
  }

};

const assignWorkflowTask = async ({
  taskId,
  assigneeIds = [],
  actor = {},
  note = "",
  realtimeSource = null,
}) => {
  const task = await getMutableTaskById(taskId);
  if (!canEditWorkflowTaskDetails(actor, task)) {
    throw new Error("Only admins, task creators, or assigned users can reassign this workflow task");
  }

  if (normalizeWorkflowTaskStatus(task.status, { fallback: "" }) === "uploaded") {
    throw new Error("Uploaded tasks cannot be reassigned");
  }

  const nextAssignees = await validateAssigneeUsers(assigneeIds);
  if (nextAssignees.length === 0) {
    throw new Error("At least one assignee is required");
  }
  const nextAssigneeIds = nextAssignees.map((user) => normalizeId(user._id));
  const currentAssigneeIds = (Array.isArray(task.assigned_to) ? task.assigned_to : [])
    .map((entry) => normalizeId(entry?.user))
    .filter(Boolean);

  const idsToRemove = currentAssigneeIds.filter((id) => !nextAssigneeIds.includes(id));
  const idsToAdd = nextAssigneeIds.filter((id) => !currentAssigneeIds.includes(id));
  const auditActor = buildAuditActor(actor);

  if (idsToRemove.length > 0) {
    await TaskAssignment.updateMany(
      {
        task: task._id,
        assignee: { $in: idsToRemove },
        status: "active",
      },
      {
        $set: {
          status: "removed",
          removed_at: new Date(),
          removed_by: auditActor,
          note: normalizeText(note) || "Assignee removed",
        },
      },
    );
  }

  if (idsToAdd.length > 0) {
    await TaskAssignment.insertMany(
      idsToAdd.map((id) => ({
        task: task._id,
        batch: task.batch || null,
        assignee: id,
        department: task.department || null,
        status: "active",
        assigned_at: new Date(),
        assigned_by: auditActor,
        note: normalizeText(note) || "Assignee added",
      })),
      { ordered: false },
    );
  }

  const fromStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: "assigned",
  }) || "assigned";
  const shouldResetStatus = fromStatus !== "assigned" && idsToAdd.length > 0;
  const toStatus = shouldResetStatus ? "assigned" : fromStatus;
  const assignedAt = new Date();

  task.assigned_to = nextAssignees.map((user) => ({ user: user._id }));
  task.assigned_by = auditActor;
  task.assigned_at = assignedAt;
  task.updated_by = auditActor;
  task.status = toStatus;
  resetTaskUploadStatuses(task);
  if (toStatus === "assigned") {
    task.started_at = null;
    task.completed_at = null;
    task.approved_at = null;
    task.approved_by = {};
    task.uploaded_at = null;
    task.uploaded_by = {};
  }
  await task.save();

  if (fromStatus !== toStatus) {
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: auditActor,
      changed_at: new Date(),
      note: normalizeText(note) || "Task assignment updated",
      metadata: {
        assignment_change: true,
      },
    });
  }

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: "Workflow task assignment updated",
    additionalUserIds: currentAssigneeIds,
    changedFields: ["assigned_to", "status"],
    shouldRefetch: true,
  });

  return taskDetail;
};

const startWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "started" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "started",
    note,
    commentType: "system",
    realtimeSource,
    successMessage: "Workflow task started",
  });
};

const completeWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "complete" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "complete",
    note,
    commentType: "complete",
    realtimeSource,
    successMessage: "Workflow task marked complete",
  });
};

const uploadWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  uploadUserId = "",
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "uploaded" });

  const fromStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: "assigned",
  }) || "assigned";

  const actorId = normalizeId(actor?._id || actor?.id);
  const targetUploadUserId = normalizeId(uploadUserId);
  const auditActor = buildAuditActor(actor);
  const currentUploadStatuses = buildWorkflowUploadStatuses(task);
  const nextUploadStatuses = currentUploadStatuses.length > 0
    ? currentUploadStatuses
    : buildWorkflowUploadStatuses({
        ...task.toObject(),
        upload_statuses: buildUploadStatusEntriesFromAssignees(task.upload_assignees),
      });
  const hasPendingUploadsBefore = nextUploadStatuses.some(
    (entry) => normalizeKey(entry?.status) !== "uploaded",
  );
  if (fromStatus !== "approved" && !(fromStatus === "uploaded" && hasPendingUploadsBefore)) {
    throw new Error("Only approved tasks can be marked uploaded");
  }
  const uploadIndex = targetUploadUserId
    ? nextUploadStatuses.findIndex((entry) => getUserRefId(entry) === targetUploadUserId)
    : nextUploadStatuses.findIndex((entry) => normalizeKey(entry?.status) !== "uploaded");

  if (uploadIndex < 0) {
    throw new Error("Select a pending upload stage before marking this task uploaded");
  }

  if (normalizeKey(nextUploadStatuses[uploadIndex]?.status) === "uploaded") {
    throw new Error("This upload stage is already marked uploaded");
  }

  const uploadedAt = new Date();
  nextUploadStatuses[uploadIndex] = {
    user: getUserRefId(nextUploadStatuses[uploadIndex]),
    status: "uploaded",
    uploaded_by: auditActor,
    uploaded_at: uploadedAt,
  };
  task.upload_statuses = nextUploadStatuses.map((entry) => ({
    user: getUserRefId(entry),
    status: normalizeKey(entry?.status) === "uploaded" ? "uploaded" : "pending",
    uploaded_by: entry?.uploaded_by || {},
    uploaded_at: entry?.uploaded_at || null,
  }));
  task.updated_by = auditActor;

  const allUploadsComplete = task.upload_statuses.length > 0 &&
    task.upload_statuses.every((entry) => normalizeKey(entry?.status) === "uploaded");
  const transitionFromStatus = fromStatus === "uploaded" && hasPendingUploadsBefore
    ? "approved"
    : fromStatus;

  if (allUploadsComplete) {
    ensureAllowedStatusTransition(transitionFromStatus, "uploaded");
    task.status = "uploaded";
    task.started_at = task.started_at || new Date();
    task.completed_at = task.completed_at || new Date();
    task.uploaded_by = auditActor;
    task.uploaded_at = uploadedAt;
  } else if (fromStatus === "uploaded") {
    task.status = "approved";
    task.uploaded_by = {};
    task.uploaded_at = null;
  }

  await task.save();

  if (allUploadsComplete) {
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: transitionFromStatus,
      to_status: "uploaded",
      changed_by: auditActor,
      changed_at: uploadedAt,
      note: normalizeText(note),
      metadata: {
        upload_complete: true,
      },
    });
    await updateAssignmentCompletionState(task, "uploaded", actor, note);
  }

  await createTransitionCommentIfNeeded({
    task,
    actor,
    note,
    commentType: "upload",
  });

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: allUploadsComplete
      ? "Workflow task marked uploaded"
      : "Workflow task upload status updated",
    changedFields: allUploadsComplete
      ? ["status", "upload_statuses"]
      : ["upload_statuses"],
    shouldRefetch: allUploadsComplete,
  });

  return taskDetail;
};

const approveWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "approved" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "approved",
    note,
    commentType: "approval",
    realtimeSource,
    successMessage: "Workflow task approved",
  });
};

const reworkWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  dueDate = "",
  realtimeSource = null,
} = {}) => {
  if (!normalizeText(note)) {
    throw new Error("A rework reason is required");
  }

  const task = await getMutableTaskById(taskId);
  const fromStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: "assigned",
  }) || "assigned";

  if (!["complete", "approved", "uploaded"].includes(fromStatus)) {
    throw new Error("Only completed, approved, or uploaded tasks can be sent to rework");
  }

  assertTransitionPermission({ task, actor, toStatus: "__rework__" });

  const auditActor = buildAuditActor(actor);
  const currentReworked = getTaskReworkPayload(task);
  const currentReworkDueDates = getTaskReworkDueDatePayload(task);
  const nextDueDate = normalizeText(dueDate) ? parseDueDate(dueDate) : null;
  const reworkedAt = new Date();
  const reworkType = fromStatus === "complete" ? "before_approval" : "after_approval";
  task.status = "assigned";
  task.started_at = null;
  task.completed_at = null;
  task.approved_at = null;
  task.approved_by = {};
  task.reviewed_at = null;
  task.reviewed_by = {};
  task.uploaded_at = null;
  task.uploaded_by = {};
  resetTaskUploadStatuses(task);
  task.updated_by = auditActor;
  task.reworked = {
    count: currentReworked.count + 1,
    before_approval_count:
      Number(currentReworked.before_approval_count || 0) +
      (reworkType === "before_approval" ? 1 : 0),
    after_approval_count:
      Number(currentReworked.after_approval_count || 0) +
      (reworkType === "after_approval" ? 1 : 0),
    comments: [
      ...currentReworked.comments,
      {
        comment: normalizeText(note),
        rework_type: reworkType,
        from_status: fromStatus,
        created_at: reworkedAt,
        created_by: auditActor,
      },
    ],
  };
  if (nextDueDate) {
    task.rework_due_dates = [
      ...currentReworkDueDates,
      {
        date: nextDueDate,
        comment: normalizeText(note),
        source: "rework",
        created_at: reworkedAt,
        created_by: auditActor,
      },
    ];
  }
  task.rework_count = task.reworked.count;
  await task.save();

  if (task.task_type_key === "cad_files") {
    try {
      const SampleWorkflow = require("../../models/sampleWorkflow.model");
      const isSampleWorkflowTask = await SampleWorkflow.exists({ code: task.title });
      if (isSampleWorkflowTask) {
        const otherTasks = await Task.find({
          title: task.title,
          _id: { $ne: task._id },
          is_deleted: false,
        });

        for (const otherTask of otherTasks) {
          const otherStatus = normalizeWorkflowTaskStatus(otherTask.status, {
            fallback: "assigned",
          }) || "assigned";

          if (["complete", "approved", "uploaded"].includes(otherStatus)) {
            try {
              await reworkWorkflowTask({
                taskId: otherTask._id,
                actor,
                note: `Automatically sent to rework because AutoCAD task ${task.task_no} was sent to rework: ${note}`,
                dueDate: "",
                realtimeSource,
              });
            } catch (reworkErr) {
              console.error(`Failed to auto-rework task ${otherTask.task_no}:`, reworkErr);
            }
          } else if (otherStatus !== "hold") {
            try {
              const currentHold = getTaskHoldPayload(otherTask);
              otherTask.hold = {
                ...currentHold,
                status: "hold",
                previous_status: otherStatus,
                requested_comment: `Automatically put on hold because AutoCAD task ${task.task_no} was sent to rework`,
                requested_by: auditActor,
                requested_at: reworkedAt,
                approved_comment: `Automatically put on hold because AutoCAD task ${task.task_no} was sent to rework`,
                approved_by: auditActor,
                approved_at: reworkedAt,
                resumed_comment: "",
                resumed_by: {},
                resumed_at: null,
                rejected_comment: "",
                rejected_by: {},
                rejected_at: null,
                total_paused_ms: currentHold.total_paused_ms,
              };
              otherTask.status = "hold";
              otherTask.updated_by = auditActor;
              await otherTask.save();

              await TaskStatusHistory.create({
                task: otherTask._id,
                batch: otherTask.batch || null,
                from_status: otherStatus,
                to_status: "hold",
                changed_by: auditActor,
                changed_at: reworkedAt,
                note: `Automatically put on hold because AutoCAD task ${task.task_no} was sent to rework`,
                metadata: {
                  hold_requested: true,
                  hold_approved: true,
                  hold_previous_status: otherStatus,
                  auto_hold_due_to_cad_rework: true,
                },
              });

              await createTransitionCommentIfNeeded({
                task: otherTask,
                actor,
                note: `Automatically put on hold because AutoCAD task ${task.task_no} was sent to rework`,
                commentType: "hold",
              });

              const otherBatch = await recalculateWorkflowBatchIfPresent(otherTask.batch);
              const otherTaskDetail = await buildTaskDetail(otherTask._id, actor);

              emitWorkflowTaskMutation({
                realtimeSource,
                task: otherTaskDetail,
                batch: otherBatch,
                actor,
                message: "Workflow task put on hold automatically due to AutoCAD rework",
                changedFields: ["hold", "status"],
                shouldRefetch: true,
              });
            } catch (holdErr) {
              console.error(`Failed to auto-hold task ${otherTask.task_no}:`, holdErr);
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to automatically update follow-up tasks on AutoCAD rework:", err);
    }
  }

  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch || null,
    from_status: fromStatus,
    to_status: "assigned",
    changed_by: auditActor,
    changed_at: new Date(),
    note: normalizeText(note),
    metadata: {
      rework: true,
      rework_type: reworkType,
      from_status: fromStatus,
      rework_count: task.reworked.count,
      before_approval_rework_count: task.reworked.before_approval_count,
      after_approval_rework_count: task.reworked.after_approval_count,
      due_date_updated: Boolean(nextDueDate),
      due_date: nextDueDate,
    },
  });
  await updateAssignmentCompletionState(task, "assigned", actor, note);
  await createTransitionCommentIfNeeded({
    task,
    actor,
    note,
    commentType: "rework",
  });
  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: "Workflow task sent to rework",
    changedFields: ["status", "rework", "due_date"],
    shouldRefetch: true,
  });

  return taskDetail;
};

const requestWorkflowTaskHold = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
} = {}) => {
  const normalizedNote = normalizeText(note);
  if (!normalizedNote) {
    throw new Error("A hold comment is required");
  }

  const task = await getMutableTaskById(taskId);
  const privilegedHold = isAdmin(actor) || isTaskCreatedByUser(task, actor?._id || actor?.id);
  if (!privilegedHold && !canCompleteWorkflowTask(actor, task)) {
    throw new Error("Only admins, task creators, or assigned users can put workflow tasks on hold");
  }

  const fromStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: "assigned",
  }) || "assigned";
  if (fromStatus === "uploaded") {
    throw new Error("Uploaded tasks cannot be put on hold");
  }
  if (fromStatus === "hold") {
    throw new Error("This task is already on hold");
  }

  const auditActor = buildAuditActor(actor);
  const requestedAt = new Date();
  const currentHold = getTaskHoldPayload(task);

  task.hold = {
    ...currentHold,
    status: privilegedHold ? "hold" : "pending",
    previous_status: fromStatus,
    requested_comment: normalizedNote,
    requested_by: auditActor,
    requested_at: requestedAt,
    approved_comment: privilegedHold ? normalizedNote : "",
    approved_by: privilegedHold ? auditActor : {},
    approved_at: privilegedHold ? requestedAt : null,
    resumed_comment: "",
    resumed_by: {},
    resumed_at: null,
    rejected_comment: "",
    rejected_by: {},
    rejected_at: null,
    total_paused_ms: currentHold.total_paused_ms,
  };
  task.updated_by = auditActor;
  if (privilegedHold) {
    task.status = "hold";
  }
  await task.save();

  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch || null,
    from_status: fromStatus,
    to_status: privilegedHold ? "hold" : fromStatus,
    changed_by: auditActor,
    changed_at: requestedAt,
    note: normalizedNote,
    metadata: {
      hold_requested: true,
      hold_approved: privilegedHold,
      hold_previous_status: fromStatus,
    },
  });
  await createTransitionCommentIfNeeded({
    task,
    actor,
    note: normalizedNote,
    commentType: "hold",
  });

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: privilegedHold ? "Workflow task put on hold" : "Workflow task hold requested",
    changedFields: ["hold", "status"],
    shouldRefetch: true,
  });

  return taskDetail;
};

const approveWorkflowTaskHold = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  if (!isTaskHoldApprover(actor, task)) {
    throw new Error("Only the task creator or admin can approve hold");
  }

  const hold = getTaskHoldPayload(task);
  if (hold.status !== "pending") {
    throw new Error("This task does not have a pending hold request");
  }

  const fromStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: hold.previous_status || "assigned",
  }) || hold.previous_status || "assigned";
  if (fromStatus === "hold") {
    throw new Error("This task is already on hold");
  }

  const auditActor = buildAuditActor(actor);
  const approvedAt = new Date();
  const approvalNote = normalizeText(note) || hold.requested_comment;

  task.status = "hold";
  task.hold = {
    ...hold,
    status: "hold",
    previous_status: fromStatus,
    approved_comment: approvalNote,
    approved_by: auditActor,
    approved_at: approvedAt,
    resumed_comment: "",
    resumed_by: {},
    resumed_at: null,
    rejected_comment: "",
    rejected_by: {},
    rejected_at: null,
  };
  task.updated_by = auditActor;
  await task.save();

  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch || null,
    from_status: fromStatus,
    to_status: "hold",
    changed_by: auditActor,
    changed_at: approvedAt,
    note: approvalNote,
    metadata: {
      hold_approved: true,
      hold_previous_status: fromStatus,
    },
  });
  await createTransitionCommentIfNeeded({
    task,
    actor,
    note: approvalNote,
    commentType: "hold",
  });

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: "Workflow task hold approved",
    changedFields: ["hold", "status"],
    shouldRefetch: true,
  });

  return taskDetail;
};

const rejectWorkflowTaskHold = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  if (!isTaskHoldApprover(actor, task)) {
    throw new Error("Only the task creator or admin can reject hold");
  }

  const hold = getTaskHoldPayload(task);
  if (hold.status !== "pending") {
    throw new Error("This task does not have a pending hold request");
  }

  const currentStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: hold.previous_status || "assigned",
  }) || hold.previous_status || "assigned";
  const auditActor = buildAuditActor(actor);
  const rejectedAt = new Date();
  const rejectNote = normalizeText(note);

  task.hold = {
    ...hold,
    status: "none",
    rejected_comment: rejectNote,
    rejected_by: auditActor,
    rejected_at: rejectedAt,
  };
  task.updated_by = auditActor;
  await task.save();

  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch || null,
    from_status: currentStatus,
    to_status: currentStatus,
    changed_by: auditActor,
    changed_at: rejectedAt,
    note: rejectNote,
    metadata: {
      hold_rejected: true,
      hold_previous_status: hold.previous_status || currentStatus,
    },
  });
  await createTransitionCommentIfNeeded({
    task,
    actor,
    note: rejectNote || "Hold request rejected",
    commentType: "hold",
  });

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: "Workflow task hold rejected",
    changedFields: ["hold"],
    shouldRefetch: true,
  });

  return taskDetail;
};

const resumeWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  dueDate = "",
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  if (!isTaskHoldApprover(actor, task)) {
    throw new Error("Only the task creator or admin can resume this task");
  }

  const hold = getTaskHoldPayload(task);
  const fromStatus = normalizeWorkflowTaskStatus(task.status, { fallback: "" });
  if (fromStatus !== "hold" || hold.status !== "hold") {
    throw new Error("Only held tasks can be resumed");
  }

  const toStatus = normalizeWorkflowTaskStatus(hold.previous_status, {
    fallback: "assigned",
  }) || "assigned";
  if (toStatus === "hold" || toStatus === "uploaded") {
    throw new Error("This held task does not have a resumable previous status");
  }
  const nextDueDate = parseDueDate(dueDate);
  if (!nextDueDate) {
    throw new Error("A new due date is required to resume this task");
  }

  const auditActor = buildAuditActor(actor);
  const resumedAt = new Date();
  const pausedFrom = getDateOrNull(hold.approved_at);
  const pausedMs = pausedFrom
    ? Math.max(0, resumedAt.getTime() - pausedFrom.getTime())
    : 0;
  const resumeNote = normalizeText(note);

  task.status = toStatus;
  task.due_date = nextDueDate;
  task.rework_due_dates = [
    ...getTaskReworkDueDatePayload(task),
    {
      date: nextDueDate,
      comment: resumeNote || "Task resumed with new due date",
      source: "due_date",
      created_at: resumedAt,
      created_by: auditActor,
    },
  ];
  task.hold = {
    ...hold,
    status: "none",
    resumed_comment: resumeNote,
    resumed_by: auditActor,
    resumed_at: resumedAt,
    total_paused_ms: hold.total_paused_ms + pausedMs,
  };
  task.updated_by = auditActor;
  await task.save();

  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch || null,
    from_status: "hold",
    to_status: toStatus,
    changed_by: auditActor,
    changed_at: resumedAt,
    note: resumeNote,
    metadata: {
      hold_resumed: true,
      hold_previous_status: toStatus,
      paused_ms: pausedMs,
      total_paused_ms: task.hold.total_paused_ms,
      due_date_updated: true,
      due_date: nextDueDate,
    },
  });
  await createTransitionCommentIfNeeded({
    task,
    actor,
    note: resumeNote,
    commentType: "hold",
  });

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: "Workflow task resumed",
    changedFields: ["hold", "status", "due_date"],
    shouldRefetch: true,
  });

  return taskDetail;
};

const updateWorkflowTaskStatus = async ({
  taskId,
  actor = {},
  toStatus,
  note = "",
  uploadUserId = "",
  realtimeSource = null,
}) => {
  const normalizedStatus = normalizeWorkflowTaskStatus(toStatus, { fallback: "" });
  if (!WORKFLOW_TASK_STATUSES.includes(normalizedStatus)) {
    throw new Error("Invalid task status");
  }
  if (normalizedStatus === "assigned") {
    throw new Error("Use the task assignment or rework action to move a task back to assigned");
  }
  if (normalizedStatus === "uploaded") {
    return uploadWorkflowTask({
      taskId,
      actor,
      note,
      uploadUserId,
      realtimeSource,
    });
  }

  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: normalizedStatus });

  return applyTaskTransition({
    task,
    actor,
    toStatus: normalizedStatus,
    note,
    commentType:
      normalizedStatus === "complete"
        ? "complete"
        : normalizedStatus === "approved"
        ? "approval"
        : normalizedStatus === "uploaded"
        ? "upload"
        : "system",
    realtimeSource,
    successMessage: `Workflow task moved to ${normalizedStatus}`,
  });
};

const submitWorkflowTask = (args = {}) => completeWorkflowTask(args);

const reviewWorkflowTask = async () => {
  throw new Error("Review is no longer a separate workflow stage");
};

const updateWorkflowTaskDetails = async ({
  taskId,
  payload = {},
  actor = {},
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  if (!canEditWorkflowTaskDetails(actor, task)) {
    throw new Error("Only admins, task creators, or assigned users can edit this workflow task");
  }

  const auditActor = buildAuditActor(actor);
  const changedFields = [];
  const additionalRealtimeUserIds = [];
  let dueDateHistoryPayload = null;

  if (hasOwn(payload, "title") || hasOwn(payload, "name")) {
    const title = normalizeText(payload?.title || payload?.name);
    if (!title) {
      throw new Error("Task name is required");
    }
    if (task.title !== title) {
      task.title = title;
      changedFields.push("title");
    }
  }

  if (hasOwn(payload, "description")) {
    const description = normalizeText(payload.description);
    if (task.description !== description) {
      task.description = description;
      changedFields.push("description");
    }
  }

  if (hasOwn(payload, "brand")) {
    const brand = normalizeText(payload.brand);
    if (task.brand !== brand) {
      task.brand = brand;
      changedFields.push("brand");
    }
  }

  if (hasOwn(payload, "priority")) {
    const priority = normalizeTaskPriority(payload.priority, task.priority || "normal");
    if (task.priority !== priority) {
      task.priority = priority;
      changedFields.push("priority");
    }
  }

  if (hasOwn(payload, "due_date")) {
    const dueDate = parseDueDate(payload.due_date);
    if (!dueDate) {
      throw new Error("due_date is required");
    }
    const currentActiveDueDate = getActiveWorkflowDueDate(task) || task.due_date || null;
    if (!isSameIndianDay(currentActiveDueDate, dueDate)) {
      const dueDateNote = normalizeText(payload?.due_date_note || payload?.note || payload?.comment);
      if (!dueDateNote) {
        throw new Error("A due date update comment is required");
      }
      dueDateHistoryPayload = {
        previous_due_date: currentActiveDueDate,
        next_due_date: dueDate,
        note: dueDateNote,
      };
      task.due_date = dueDate;
      task.rework_due_dates = [
        ...getTaskReworkDueDatePayload(task),
        {
          date: dueDate,
          comment: dueDateNote,
          source: "due_date",
          created_at: new Date(),
          created_by: auditActor,
        },
      ];
      changedFields.push("due_date");
    }
  }

  if (hasOwn(payload, "upload_required")) {
    const uploadRequired = Boolean(payload.upload_required);
    const currentUploadRequired = task.upload_required !== false;
    if (currentUploadRequired !== uploadRequired) {
      task.upload_required = uploadRequired;
      resetTaskUploadStatuses(task);
      changedFields.push("upload_required");
    }
  }

  if (hasOwn(payload, "upload_assignee_ids")) {
    const uploadRequired = task.upload_required !== false;
    const nextUploadAssigneeIds = uploadRequired
      ? uniqueIds(payload.upload_assignee_ids)
      : [];
    const nextUploadAssignees = uploadRequired
      ? await validateAssigneeUsers(nextUploadAssigneeIds)
      : [];

    if (uploadRequired && nextUploadAssignees.length === 0) {
      throw new Error("At least one upload user is required when upload is required");
    }

    const currentUploadAssigneeIds = (Array.isArray(task.upload_assignees)
      ? task.upload_assignees
      : [])
      .map((entry) => normalizeId(entry?.user?._id || entry?.user || entry?._id || entry))
      .filter(Boolean);
    const normalizedNextIds = nextUploadAssignees.map((user) => normalizeId(user._id));
    const hasUploadAssigneeChange =
      currentUploadAssigneeIds.length !== normalizedNextIds.length ||
      currentUploadAssigneeIds.some((id) => !normalizedNextIds.includes(id)) ||
      normalizedNextIds.some((id) => !currentUploadAssigneeIds.includes(id));

    if (hasUploadAssigneeChange) {
      additionalRealtimeUserIds.push(...currentUploadAssigneeIds, ...normalizedNextIds);
      task.upload_assignees = nextUploadAssignees.map((user) => ({ user: user._id }));
      resetTaskUploadStatuses(task);
      changedFields.push("upload_assignees");
    }
  }

  if (hasOwn(payload, "assigned_at") || hasOwn(payload, "assignment_date")) {
    const assignedAtInput = hasOwn(payload, "assigned_at")
      ? payload.assigned_at
      : payload.assignment_date;
    const assignedAt = parseAssignedAt(assignedAtInput);
    const currentTime = task.assigned_at ? task.assigned_at.getTime() : null;
    const nextTime = assignedAt ? assignedAt.getTime() : null;
    if (currentTime !== nextTime) {
      task.assigned_at = assignedAt;
      changedFields.push("assigned_at");
    }
  }

  if (hasOwn(payload, "department")) {
    const department = await ensureDepartmentExists(payload.department, "department");
    const currentDepartment = normalizeId(task.department);
    const nextDepartment = normalizeId(department);
    if (currentDepartment !== nextDepartment) {
      task.department = department;
      changedFields.push("department");
    }
  }

  if (changedFields.length === 0) {
    return buildTaskDetail(task._id, actor);
  }

  task.updated_by = auditActor;
  await task.save();

  if (changedFields.includes("assigned_at")) {
    await TaskAssignment.updateMany(
      {
        task: task._id,
        status: "active",
      },
      {
        $set: {
          assigned_at: task.assigned_at || null,
        },
      },
    );
  }

  if (dueDateHistoryPayload) {
    const currentStatus = normalizeWorkflowTaskStatus(task.status, {
      fallback: "assigned",
    }) || "assigned";
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: currentStatus,
      to_status: currentStatus,
      changed_by: auditActor,
      changed_at: new Date(),
      note: dueDateHistoryPayload.note,
      metadata: {
        due_date_updated: true,
        previous_due_date: dueDateHistoryPayload.previous_due_date,
        due_date: dueDateHistoryPayload.next_due_date,
      },
    });
    await createTransitionCommentIfNeeded({
      task,
      actor,
      note: dueDateHistoryPayload.note,
      commentType: "system",
    });
  }

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);
  const taskDetail = await buildTaskDetail(task._id, actor);

  emitWorkflowTaskMutation({
    realtimeSource,
    task: taskDetail,
    batch,
    actor,
    message: "Workflow task details updated",
    additionalUserIds: additionalRealtimeUserIds,
    changedFields,
    shouldRefetch: changedFields.some((field) =>
      [
        "status",
        "assigned_to",
        "upload_assignees",
        "upload_required",
        "due_date",
        "department",
        "brand",
        "task_type_key",
      ].includes(field),
    ),
  });

  return taskDetail;
};

const addWorkflowTaskComment = async ({
  taskId,
  actor = {},
  comment = "",
  commentType = "general",
  realtimeSource = null,
}) => {
  const normalizedComment = normalizeText(comment);
  if (!normalizedComment) {
    throw new Error("Comment is required");
  }

  const task = await getMutableTaskById(taskId);
  if (!canReadWorkflowTask(actor, task)) {
    throw new Error("You do not have access to comment on this task");
  }

  const normalizedCommentType = normalizeText(commentType).toLowerCase();
  const savedComment = await Comment.create({
    task: task._id,
    batch: task.batch || null,
    comment: normalizedComment,
    comment_type: WORKFLOW_TASK_COMMENT_TYPES.includes(normalizedCommentType)
      ? normalizedCommentType
      : "general",
    created_by: buildAuditActor(actor),
    updated_by: buildAuditActor(actor),
  });

  const commentDetail = await Comment.findById(savedComment._id)
    .populate("created_by.user", "name email role")
    .populate("updated_by.user", "name email role")
    .lean();

  emitWorkflowCommentAdded(realtimeSource, commentDetail, task, {
    message: "Workflow task comment added",
  });
  notifyWorkflowCommentAdded({
    realtimeSource,
    task,
    comment: commentDetail,
    actor,
  }).catch((error) => {
    console.error("Workflow comment notification failed:", error);
  });

  return commentDetail;
};

const deleteWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
}) => {
  const task = await getMutableTaskById(taskId);
  if (!canDeleteWorkflowTask(actor, task)) {
    throw new Error("Only admins or the task creator can delete workflow tasks");
  }

  const auditActor = buildAuditActor(actor);
  const normalizedNote = normalizeText(note) || "Workflow task deleted";
  const fromStatus = normalizeWorkflowTaskStatus(task.status, {
    fallback: "assigned",
  }) || "assigned";

  task.is_deleted = true;
  task.updated_by = auditActor;
  await task.save();

  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch || null,
    from_status: fromStatus,
    to_status: fromStatus,
    changed_by: auditActor,
    changed_at: new Date(),
    note: normalizedNote,
    metadata: {
      deleted_by_admin: isAdmin(actor),
      deleted_by_creator: !isAdmin(actor),
      task_deleted: true,
    },
  });

  await TaskAssignment.updateMany(
    {
      task: task._id,
      status: { $in: ["active", "completed"] },
    },
    {
      $set: {
        status: "removed",
        removed_at: new Date(),
        removed_by: auditActor,
        note: normalizedNote,
      },
    },
  );

  await Comment.updateMany(
    {
      task: task._id,
      is_deleted: false,
    },
    {
      $set: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: auditActor,
        updated_by: auditActor,
      },
    },
  );

  const batch = await recalculateWorkflowBatchIfPresent(task.batch);

  emitWorkflowTaskMutation({
    realtimeSource,
    task,
    batch,
    actor,
    message: "Workflow task deleted",
    eventType: "deleted",
    changedFields: ["is_deleted"],
    shouldRefetch: true,
  });

  return {
    _id: task._id,
    batch: task.batch,
    task_no: task.task_no,
    is_deleted: true,
  };
};

const normalizeTaskTypeDefaultAssignees = async (entries = []) => {
  if (!Array.isArray(entries)) {
    throw new Error("default_assignees must be an array");
  }

  const users = await validateAssigneeUsers(
    entries.map((entry) => normalizeId(entry?.user || entry)),
  );
  return users.map((user) => ({ user: user._id }));
};

const ensureDepartmentExists = async (departmentId, fieldLabel = "default_department") => {
  const normalizedId = normalizeId(departmentId);
  if (!normalizedId) return null;
  if (!mongoose.Types.ObjectId.isValid(normalizedId)) {
    throw new Error(`${fieldLabel} is invalid`);
  }

  const department = await Department.findById(normalizedId).select("_id").lean();
  if (!department) {
    throw new Error(`${fieldLabel} was not found`);
  }
  return department._id;
};

const normalizeDepartmentMembers = async (entries = [], actor = {}) => {
  if (!Array.isArray(entries)) {
    throw new Error("members must be an array");
  }

  const requestedIds = entries.map((entry) => normalizeId(entry?.user)).filter(Boolean);
  const invalidId = requestedIds.find((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidId) {
    throw new Error("Department members must reference valid users");
  }
  const users = requestedIds.length > 0
    ? await User.find({ _id: { $in: requestedIds } }).select("_id").lean()
    : [];
  const userById = new Map(users.map((user) => [normalizeId(user._id), user]));
  const auditActor = buildAuditActor(actor);

  return entries.map((entry) => {
    const normalizedUserId = normalizeId(entry?.user);
    if (!normalizedUserId || !mongoose.Types.ObjectId.isValid(normalizedUserId)) {
      throw new Error("Department members must reference valid users");
    }
    if (!userById.has(normalizedUserId)) {
      throw new Error("One or more department members were not found");
    }

    return {
      user: normalizedUserId,
      role: normalizeText(entry?.role || "member") || "member",
      added_at: entry?.added_at ? new Date(entry.added_at) : new Date(),
      added_by: auditActor,
      is_active: entry?.is_active !== false,
    };
  });
};

const listWorkflowTaskTypes = async (user = {}) => {
  const match = isPrivilegedWorkflowReader(user) ? {} : { is_active: true };
  return TaskType.find(match)
    .populate("default_department", "name key description is_active")
    .populate("default_assignees.user", "name email role")
    .sort({ name: 1, key: 1 })
    .lean();
};

const createWorkflowTaskType = async (payload = {}, actor = {}) => {
  const nextPayload = {
    key: payload?.key,
    name: payload?.name,
    description: payload?.description,
    category: payload?.category,
    default_department: await ensureDepartmentExists(payload?.default_department),
    default_assignees: await normalizeTaskTypeDefaultAssignees(
      payload?.default_assignees || [],
    ),
    default_priority: payload?.default_priority,
    auto_create_mode: payload?.auto_create_mode,
    file_match_rule: payload?.file_match_rule || {},
    estimated_minutes: payload?.estimated_minutes,
    requires_review: payload?.requires_review,
    is_active: payload?.is_active,
  };

  const doc = await TaskType.create({
    ...nextPayload,
    created_by: buildAuditActor(actor),
    updated_by: buildAuditActor(actor),
  });

  return TaskType.findById(doc._id)
    .populate("default_department", "name key description is_active")
    .populate("default_assignees.user", "name email role")
    .lean();
};

const updateWorkflowTaskType = async (id, payload = {}, actor = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid task type id");
  }

  const doc = await TaskType.findById(id);
  if (!doc) {
    throw new Error("Workflow task type not found");
  }

  [
    "key",
    "name",
    "description",
    "category",
    "default_priority",
    "auto_create_mode",
    "file_match_rule",
    "estimated_minutes",
    "requires_review",
    "is_active",
  ].forEach((key) => {
    if (payload[key] !== undefined) {
      doc[key] = payload[key];
    }
  });
  if (payload?.default_department !== undefined) {
    doc.default_department = await ensureDepartmentExists(payload.default_department);
  }
  if (payload?.default_assignees !== undefined) {
    doc.default_assignees = await normalizeTaskTypeDefaultAssignees(
      payload.default_assignees,
    );
  }
  doc.updated_by = buildAuditActor(actor);
  await doc.save();

  return TaskType.findById(doc._id)
    .populate("default_department", "name key description is_active")
    .populate("default_assignees.user", "name email role")
    .lean();
};

const listWorkflowDepartments = async (user = {}) => {
  const match = isPrivilegedWorkflowReader(user) ? {} : { is_active: true };
  return Department.find(match)
    .populate("members.user", "name email role")
    .populate("members.added_by.user", "name email role")
    .sort({ name: 1, key: 1 })
    .lean();
};

const createWorkflowDepartment = async (payload = {}, actor = {}) => {
  const nextPayload = {
    name: payload?.name,
    key: payload?.key,
    description: payload?.description,
    members: await normalizeDepartmentMembers(payload?.members || [], actor),
    is_active: payload?.is_active,
  };

  const doc = await Department.create({
    ...nextPayload,
    created_by: buildAuditActor(actor),
    updated_by: buildAuditActor(actor),
  });

  return Department.findById(doc._id)
    .populate("members.user", "name email role")
    .populate("members.added_by.user", "name email role")
    .lean();
};

const updateWorkflowDepartment = async (id, payload = {}, actor = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid department id");
  }

  const doc = await Department.findById(id);
  if (!doc) {
    throw new Error("Workflow department not found");
  }

  ["name", "key", "description", "is_active"].forEach((key) => {
    if (payload[key] !== undefined) {
      doc[key] = payload[key];
    }
  });
  if (payload?.members !== undefined) {
    doc.members = await normalizeDepartmentMembers(payload.members, actor);
  }
  doc.updated_by = buildAuditActor(actor);
  await doc.save();

  return Department.findById(doc._id)
    .populate("members.user", "name email role")
    .populate("members.added_by.user", "name email role")
    .lean();
};

module.exports = {
  addWorkflowTaskComment,
  approveWorkflowTaskHold,
  approveWorkflowTask,
  assignWorkflowTask,
  buildTaskDetail,
  completeWorkflowTask,
  createWorkflowTask,
  createWorkflowDepartment,
  createWorkflowTaskType,
  deleteWorkflowTask,
  getTaskByIdForUser,
  getWorkflowDashboardSummary,
  listWorkflowDepartments,
  listWorkflowTaskTypes,
  listWorkflowTasks,
  reviewWorkflowTask,
  reworkWorkflowTask,
  rejectWorkflowTaskHold,
  requestWorkflowTaskHold,
  resumeWorkflowTask,
  startWorkflowTask,
  submitWorkflowTask,
  uploadWorkflowTask,
  updateWorkflowDepartment,
  updateWorkflowTaskDetails,
  updateWorkflowTaskStatus,
  updateWorkflowTaskType,
};
