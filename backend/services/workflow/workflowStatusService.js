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
  Department,
  Task,
  TaskAssignment,
  TaskStatusHistory,
  TaskType,
} = require("../../models/workflow");
const {
  canApproveWorkflowTask,
  canCompleteWorkflowTask,
  canReadWorkflowTask,
  canUploadWorkflowTask,
  isAdmin,
  isManagerOrAdmin,
  isPrivilegedWorkflowReader,
} = require("./workflowPermissionService");
const { validateAssigneeUsers } = require("./workflowTaskGenerationService");
const {
  recalculateWorkflowBatchFromTasks,
} = require("./workflowBatchAggregationService");
const {
  emitWorkflowBatchUpdated,
  emitWorkflowCommentAdded,
  emitWorkflowTaskUpdated,
} = require("./workflowRealtimeService");

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const ACTIVE_TASK_STATUSES = Object.freeze([
  "assigned",
  "complete",
  "approved",
]);
const DASHBOARD_COUNT_FIELDS = Object.freeze([
  "total_tasks",
  "open_tasks",
  "assigned_tasks",
  "complete_tasks",
  "approved_tasks",
  "uploaded_tasks",
  "reworked_tasks",
  "needs_approval_tasks",
  "overdue_tasks",
  "due_today_tasks",
]);

const normalizeId = (value) => String(value || "").trim();

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const toDateOrNull = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const populateTaskQuery = (query) =>
  query
    .populate("batch", "batch_no name brand source_folder_name status")
    .populate("task_type", "key name category auto_create_mode default_priority requires_review is_active")
    .populate("department", "name key description is_active")
    .populate("assigned_to.user", "name email role")
    .populate("assigned_by.user", "name email role")
    .populate("created_by.user", "name email role")
    .populate("updated_by.user", "name email role")
    .populate("reviewed_by.user", "name email role")
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
    comments,
  };
};

const serializeTask = (doc = {}) => {
  const normalizedStatus = normalizeWorkflowTaskStatus(doc?.status, {
    fallback: "assigned",
  }) || "assigned";
  const reworked = getTaskReworkPayload(doc);

  return {
    ...doc,
    status: normalizedStatus,
    task_type_key: normalizeKey(doc?.task_type_key || doc?.task_type?.key),
    task_type_name: normalizeText(doc?.task_type_name || doc?.task_type?.name),
    approved_at: doc?.approved_at || doc?.reviewed_at || null,
    approved_by:
      doc?.approved_by?.user || doc?.approved_by?.name || doc?.approved_by?.email
        ? doc.approved_by
        : doc?.reviewed_by || {},
    reworked,
  };
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

  return {
    is_deleted: false,
    "assigned_to.user": user?._id || null,
  };
};

const buildStatusMatch = (status = "") => {
  const values = getWorkflowStatusFilterValues(status);
  if (values.length === 0) {
    return normalizeText(status).toLowerCase();
  }
  if (values.length === 1) {
    return values[0];
  }
  return { $in: values };
};

const buildTaskListMatch = ({ query = {}, user = {} } = {}) => {
  const privilegedReader = isAdmin(user);
  const match = buildTaskVisibilityMatch(user);

  if (normalizeText(query?.status)) {
    match.status = buildStatusMatch(query.status);
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
    match["assigned_to.user"] = new mongoose.Types.ObjectId(query.assignee);
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
    match.due_date = {};
    if (dueFrom) {
      match.due_date.$gte = dueFrom;
    }
    if (dueTo) {
      const nextDay = new Date(dueTo);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      match.due_date.$lt = nextDay;
    }
  }

  if (normalizeText(query?.search)) {
    const regex = new RegExp(escapeRegex(normalizeText(query.search)), "i");
    match.$or = [
      { task_no: regex },
      { title: regex },
      { source_folder_name: regex },
      { source_folder_path: regex },
      { brand: regex },
    ];
  }

  return {
    match,
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

const parseDueDate = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("due_date is invalid");
  }
  return parsed;
};

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
} = {}) => {
  if (!realtimeSource || !task) return;

  emitWorkflowTaskUpdated(realtimeSource, task, batch, {
    changedBy: buildAuditActor(actor),
    message,
    additionalUserIds,
  });

  if (batch) {
    emitWorkflowBatchUpdated(realtimeSource, batch, { message });
  }
};

const getTaskByIdForUser = async (id, user = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid task id");
  }

  const match = buildTaskVisibilityMatch(user);
  match._id = id;
  const task = await populateTaskQuery(Task.findOne(match));
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
    assignments,
    status_history: history,
    comments,
  };
};

const listWorkflowTasks = async ({ query = {}, user = {} } = {}) => {
  const page = parsePositiveInt(query?.page, 1);
  const limit = Math.min(MAX_PAGE_LIMIT, parsePositiveInt(query?.limit, DEFAULT_PAGE_LIMIT));
  const skip = (page - 1) * limit;
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

  return {
    rows: rows.map(serializeTask),
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
  if (!isManagerOrAdmin(actor)) {
    throw new Error("Only admin or manager can create workflow tasks");
  }

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

  const department = payload?.department !== undefined
    ? await ensureDepartmentExists(payload.department)
    : (taskType?.default_department || null);
  const dueDate = payload?.due_date !== undefined ? parseDueDate(payload.due_date) : null;
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
  const assignedAt = new Date();

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
  });

  return taskDetail;
};

const getWorkflowDashboardSummary = async ({ query = {}, user = {} } = {}) => {
  if (!isAdmin(user)) {
    throw new Error("Only admins can view the workflow dashboard");
  }

  const { match } = buildTaskListMatch({ query, user });
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const statusCount = (status) => ({
    $sum: {
      $cond: [{ $eq: ["$normalized_status", status] }, 1, 0],
    },
  });

  const openTaskCount = {
    $sum: {
      $cond: [{ $in: ["$normalized_status", ACTIVE_TASK_STATUSES] }, 1, 0],
    },
  };

  const overdueCount = {
    $sum: {
      $cond: [
        {
          $and: [
            { $in: ["$normalized_status", ACTIVE_TASK_STATUSES] },
            { $ne: ["$due_date", null] },
            { $lt: ["$due_date", now] },
          ],
        },
        1,
        0,
      ],
    },
  };

  const dueTodayCount = {
    $sum: {
      $cond: [
        {
          $and: [
            { $in: ["$normalized_status", ACTIVE_TASK_STATUSES] },
            { $ne: ["$due_date", null] },
            { $gte: ["$due_date", todayStart] },
            { $lt: ["$due_date", tomorrowStart] },
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
    complete_tasks: statusCount("complete"),
    approved_tasks: statusCount("approved"),
    uploaded_tasks: statusCount("uploaded"),
    reworked_tasks: {
      $sum: {
        $cond: [{ $gt: ["$normalized_rework_count", 0] }, 1, 0],
      },
    },
    needs_approval_tasks: statusCount("complete"),
    overdue_tasks: overdueCount,
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
              complete_tasks: 1,
              approved_tasks: 1,
              uploaded_tasks: 1,
              reworked_tasks: 1,
              needs_approval_tasks: 1,
              overdue_tasks: 1,
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
      },
    },
  ]);

  const overall = {
    ...buildWorkflowDashboardCounts(summary?.overall?.[0]),
    unassigned_tasks: Number(summary?.overall?.[0]?.unassigned_tasks || 0),
  };

  const users = Array.isArray(summary?.users)
    ? summary.users.map((entry) => ({
        user_id: entry?.user_id || null,
        name: normalizeText(entry?.name) || "Unknown User",
        email: normalizeText(entry?.email),
        role: normalizeText(entry?.role),
        last_task_update_at: entry?.last_task_update_at || null,
        counts: buildWorkflowDashboardCounts(entry),
      }))
    : [];

  return {
    generated_at: now.toISOString(),
    overall: {
      ...overall,
      users_with_tasks: users.length,
      users_with_overdue_tasks: users.filter(
        (entry) => Number(entry?.counts?.overdue_tasks || 0) > 0,
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

  if (toStatus === "complete") {
    task.completed_at = new Date();
    task.approved_at = null;
    task.approved_by = {};
    task.uploaded_at = null;
    task.uploaded_by = {};
  }
  if (toStatus === "approved") {
    task.approved_by = auditActor;
    task.approved_at = new Date();
    task.reviewed_by = auditActor;
    task.reviewed_at = task.approved_at;
    task.uploaded_at = null;
    task.uploaded_by = {};
  }
  if (toStatus === "uploaded") {
    task.uploaded_by = auditActor;
    task.uploaded_at = new Date();
  }

  await task.save();
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
  });

  return taskDetail;
};

const assertTransitionPermission = ({ task, actor, toStatus }) => {
  if (["complete"].includes(toStatus) && !canCompleteWorkflowTask(actor, task)) {
    throw new Error("Only an assigned user can mark this task complete");
  }

  if (["uploaded"].includes(toStatus) && !canUploadWorkflowTask(actor, task)) {
    throw new Error("Only the assignee or an admin can mark this task uploaded");
  }

  if (["approved"].includes(toStatus) && !canApproveWorkflowTask(actor, task)) {
    throw new Error("Only admins can approve this task");
  }

  if (toStatus === "__rework__") {
    if (!isManagerOrAdmin(actor)) {
      throw new Error("Only admin or manager can send this task to rework");
    }
  }

  if (toStatus === "assigned" && !isManagerOrAdmin(actor)) {
    throw new Error("Only admin or manager can assign a task");
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
  if (toStatus === "assigned") {
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
  });

  return taskDetail;
};

const startWorkflowTask = async ({ taskId, actor = {}, note = "" }) => {
  throw new Error("Start is no longer a separate workflow stage");
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
  realtimeSource = null,
} = {}) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "uploaded" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "uploaded",
    note,
    commentType: "upload",
    realtimeSource,
    successMessage: "Workflow task marked uploaded",
  });
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
  task.status = "assigned";
  task.completed_at = null;
  task.approved_at = null;
  task.approved_by = {};
  task.uploaded_at = null;
  task.uploaded_by = {};
  task.updated_by = auditActor;
  task.reworked = {
    count: currentReworked.count + 1,
    comments: [
      ...currentReworked.comments,
      {
        comment: normalizeText(note),
        created_at: new Date(),
        created_by: auditActor,
      },
    ],
  };
  task.rework_count = task.reworked.count;
  await task.save();

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
      rework_count: task.reworked.count,
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
  });

  return taskDetail;
};

const updateWorkflowTaskStatus = async ({
  taskId,
  actor = {},
  toStatus,
  note = "",
  realtimeSource = null,
}) => {
  const normalizedStatus = normalizeWorkflowTaskStatus(toStatus, { fallback: "" });
  if (!WORKFLOW_TASK_STATUSES.includes(normalizedStatus)) {
    throw new Error("Invalid task status");
  }
  if (normalizedStatus === "assigned") {
    throw new Error("Use the task assignment or rework action to move a task back to assigned");
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

  return commentDetail;
};

const deleteWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
  realtimeSource = null,
}) => {
  if (!isAdmin(actor)) {
    throw new Error("Only admins can delete workflow tasks");
  }

  const task = await getMutableTaskById(taskId);
  const auditActor = buildAuditActor(actor);
  const normalizedNote = normalizeText(note) || "Workflow task deleted by admin";
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
      deleted_by_admin: true,
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

const ensureDepartmentExists = async (departmentId) => {
  const normalizedId = normalizeId(departmentId);
  if (!normalizedId) return null;
  if (!mongoose.Types.ObjectId.isValid(normalizedId)) {
    throw new Error("default_department is invalid");
  }

  const department = await Department.findById(normalizedId).select("_id").lean();
  if (!department) {
    throw new Error("default_department was not found");
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
  startWorkflowTask,
  submitWorkflowTask,
  uploadWorkflowTask,
  updateWorkflowDepartment,
  updateWorkflowTaskStatus,
  updateWorkflowTaskType,
};
