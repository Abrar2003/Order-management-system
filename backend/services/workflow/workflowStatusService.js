const mongoose = require("mongoose");
const { buildAuditActor } = require("../../helpers/permissions");
const User = require("../../models/user.model");
const {
  WORKFLOW_ALLOWED_STATUS_TRANSITIONS,
  WORKFLOW_TASK_COMMENT_TYPES,
  WORKFLOW_TASK_STATUSES,
  normalizeKey,
  normalizeText,
} = require("../../helpers/workflow");
const { Comment, Department, Task, TaskAssignment, TaskStatusHistory, TaskType } = require("../../models/workflow");
const {
  canApproveWorkflowTask,
  canReadWorkflowTask,
  canStartWorkflowTask,
  canSubmitWorkflowTask,
  isAdmin,
  isManagerOrAdmin,
  isPrivilegedWorkflowReader,
} = require("./workflowPermissionService");
const { validateAssigneeUsers } = require("./workflowTaskGenerationService");
const {
  recalculateWorkflowBatchFromTasks,
} = require("./workflowBatchAggregationService");

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const ACTIVE_TASK_STATUSES = Object.freeze([
  "pending",
  "assigned",
  "in_progress",
  "submitted",
  "review",
  "rework",
]);
const AWAITING_REVIEW_TASK_STATUSES = Object.freeze([
  "submitted",
  "review",
]);
const DASHBOARD_COUNT_FIELDS = Object.freeze([
  "total_tasks",
  "open_tasks",
  "pending_tasks",
  "assigned_tasks",
  "in_progress_tasks",
  "submitted_tasks",
  "review_tasks",
  "rework_tasks",
  "completed_tasks",
  "cancelled_tasks",
  "awaiting_review_tasks",
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

const serializeTask = (doc = {}) => ({
  ...doc,
  task_type_key: normalizeKey(doc?.task_type_key || doc?.task_type?.key),
  task_type_name: normalizeText(doc?.task_type_name || doc?.task_type?.name),
});

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

const buildTaskListMatch = ({ query = {}, user = {} } = {}) => {
  const privilegedReader = isAdmin(user);
  const match = buildTaskVisibilityMatch(user);

  if (normalizeText(query?.status)) {
    match.status = normalizeText(query.status).toLowerCase();
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
      $cond: [{ $eq: ["$status", status] }, 1, 0],
    },
  });

  const openTaskCount = {
    $sum: {
      $cond: [{ $in: ["$status", ACTIVE_TASK_STATUSES] }, 1, 0],
    },
  };

  const awaitingReviewCount = {
    $sum: {
      $cond: [{ $in: ["$status", AWAITING_REVIEW_TASK_STATUSES] }, 1, 0],
    },
  };

  const overdueCount = {
    $sum: {
      $cond: [
        {
          $and: [
            { $in: ["$status", ACTIVE_TASK_STATUSES] },
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
            { $in: ["$status", ACTIVE_TASK_STATUSES] },
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
    pending_tasks: statusCount("pending"),
    assigned_tasks: statusCount("assigned"),
    in_progress_tasks: statusCount("in_progress"),
    submitted_tasks: statusCount("submitted"),
    review_tasks: statusCount("review"),
    rework_tasks: statusCount("rework"),
    completed_tasks: statusCount("completed"),
    cancelled_tasks: statusCount("cancelled"),
    awaiting_review_tasks: awaitingReviewCount,
    overdue_tasks: overdueCount,
    due_today_tasks: dueTodayCount,
  };

  const [summary] = await Task.aggregate([
    { $match: match },
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
              pending_tasks: 1,
              assigned_tasks: 1,
              in_progress_tasks: 1,
              submitted_tasks: 1,
              review_tasks: 1,
              rework_tasks: 1,
              completed_tasks: 1,
              cancelled_tasks: 1,
              awaiting_review_tasks: 1,
              overdue_tasks: 1,
              due_today_tasks: 1,
            },
          },
          {
            $sort: {
              open_tasks: -1,
              overdue_tasks: -1,
              awaiting_review_tasks: -1,
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

  if (toStatus === "completed") {
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
          note: normalizeText(note) || "Task completed",
        },
      },
    );
    return;
  }

  if (toStatus === "cancelled") {
    await TaskAssignment.updateMany(
      {
        task: task._id,
        assignee: { $in: activeAssigneeIds },
        status: "active",
      },
      {
        $set: {
          status: "removed",
          removed_at: new Date(),
          removed_by: buildAuditActor(actor),
          note: normalizeText(note) || "Task cancelled",
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
    batch: task.batch,
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
}) => {
  const fromStatus = task.status;
  ensureAllowedStatusTransition(fromStatus, toStatus);

  task.status = toStatus;
  task.updated_by = buildAuditActor(actor);

  if (toStatus === "in_progress" && !task.started_at) {
    task.started_at = new Date();
  }
  if (toStatus === "submitted") {
    task.submitted_at = new Date();
  }
  if (toStatus === "review") {
    task.reviewed_by = buildAuditActor(actor);
    task.reviewed_at = new Date();
  }
  if (toStatus === "rework") {
    task.reviewed_by = buildAuditActor(actor);
    task.reviewed_at = new Date();
    task.rework_count = Number(task.rework_count || 0) + 1;
  }
  if (toStatus === "completed") {
    task.reviewed_by = buildAuditActor(actor);
    task.reviewed_at = new Date();
    task.completed_at = new Date();
  }
  if (toStatus === "cancelled") {
    task.blocked_reason = normalizeText(note) || task.blocked_reason;
  }

  await task.save();
  await TaskStatusHistory.create({
    task: task._id,
    batch: task.batch,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: buildAuditActor(actor),
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
  await recalculateWorkflowBatchFromTasks(task.batch);

  return buildTaskDetail(task._id, actor);
};

const assertTransitionPermission = ({ task, actor, toStatus }) => {
  if (["in_progress"].includes(toStatus) && !canStartWorkflowTask(actor, task)) {
    throw new Error("Only an assigned user can start this task");
  }

  if (["submitted"].includes(toStatus) && !canSubmitWorkflowTask(actor, task)) {
    throw new Error("Only an assigned user can submit this task");
  }

  if (["review", "cancelled"].includes(toStatus) && !isManagerOrAdmin(actor)) {
    throw new Error("Only admin or manager can change this task to the requested status");
  }

  if (["completed"].includes(toStatus) && !canApproveWorkflowTask(actor, task)) {
    throw new Error("Only admins can approve this task");
  }

  if (["rework"].includes(toStatus)) {
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
}) => {
  const task = await getMutableTaskById(taskId);
  if (["completed", "cancelled"].includes(task.status)) {
    throw new Error("Completed or cancelled tasks cannot be reassigned");
  }

  const nextAssignees = await validateAssigneeUsers(assigneeIds);
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
        batch: task.batch,
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

  const fromStatus = task.status;
  const toStatus = nextAssigneeIds.length > 0
    ? (task.status === "pending" ? "assigned" : task.status)
    : (task.status === "assigned" ? "pending" : task.status);

  task.assigned_to = nextAssignees.map((user) => ({ user: user._id }));
  task.assigned_by = nextAssigneeIds.length > 0 ? auditActor : {};
  task.assigned_at = nextAssigneeIds.length > 0 ? new Date() : null;
  task.updated_by = auditActor;
  task.status = toStatus;
  await task.save();

  if (fromStatus !== toStatus) {
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch,
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

  await recalculateWorkflowBatchFromTasks(task.batch);
  return buildTaskDetail(task._id, actor);
};

const startWorkflowTask = async ({ taskId, actor = {}, note = "" }) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "in_progress" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "in_progress",
    note,
    commentType: "system",
  });
};

const submitWorkflowTask = async ({ taskId, actor = {}, note = "" }) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "submitted" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "submitted",
    note,
    commentType: "system",
  });
};

const reviewWorkflowTask = async ({ taskId, actor = {}, note = "" }) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "review" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "review",
    note,
    commentType: "review",
  });
};

const approveWorkflowTask = async ({ taskId, actor = {}, note = "" }) => {
  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "completed" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "completed",
    note,
    commentType: "review",
  });
};

const reworkWorkflowTask = async ({ taskId, actor = {}, note = "" }) => {
  if (!normalizeText(note)) {
    throw new Error("A rework reason is required");
  }

  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: "rework" });
  return applyTaskTransition({
    task,
    actor,
    toStatus: "rework",
    note,
    commentType: "rework",
  });
};

const updateWorkflowTaskStatus = async ({
  taskId,
  actor = {},
  toStatus,
  note = "",
}) => {
  const normalizedStatus = normalizeText(toStatus).toLowerCase();
  if (!WORKFLOW_TASK_STATUSES.includes(normalizedStatus)) {
    throw new Error("Invalid task status");
  }
  if (normalizedStatus === "assigned") {
    throw new Error("Use the task assignment endpoint to assign this task");
  }

  const task = await getMutableTaskById(taskId);
  assertTransitionPermission({ task, actor, toStatus: normalizedStatus });

  if (normalizedStatus === "rework" && !normalizeText(note)) {
    throw new Error("A rework reason is required");
  }

  return applyTaskTransition({
    task,
    actor,
    toStatus: normalizedStatus,
    note,
    commentType:
      normalizedStatus === "review"
        ? "review"
        : normalizedStatus === "rework"
        ? "rework"
        : "system",
  });
};

const addWorkflowTaskComment = async ({
  taskId,
  actor = {},
  comment = "",
  commentType = "general",
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
    batch: task.batch,
    comment: normalizedComment,
    comment_type: WORKFLOW_TASK_COMMENT_TYPES.includes(normalizedCommentType)
      ? normalizedCommentType
      : "general",
    created_by: buildAuditActor(actor),
    updated_by: buildAuditActor(actor),
  });

  return Comment.findById(savedComment._id)
    .populate("created_by.user", "name email role")
    .populate("updated_by.user", "name email role")
    .lean();
};

const deleteWorkflowTask = async ({
  taskId,
  actor = {},
  note = "",
}) => {
  if (!isAdmin(actor)) {
    throw new Error("Only admins can delete workflow tasks");
  }

  const task = await getMutableTaskById(taskId);
  const auditActor = buildAuditActor(actor);
  const normalizedNote = normalizeText(note) || "Workflow task deleted by admin";
  const fromStatus = task.status;
  const shouldCancelTask = !["completed", "cancelled"].includes(fromStatus);

  if (shouldCancelTask) {
    task.status = "cancelled";
    task.blocked_reason = normalizedNote;

    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch,
      from_status: fromStatus,
      to_status: "cancelled",
      changed_by: auditActor,
      changed_at: new Date(),
      note: normalizedNote,
      metadata: {
        deleted_by_admin: true,
        task_deleted: true,
      },
    });
  }

  task.is_deleted = true;
  task.updated_by = auditActor;
  await task.save();

  await TaskAssignment.updateMany(
    {
      task: task._id,
      status: "active",
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

  await recalculateWorkflowBatchFromTasks(task.batch);

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
  updateWorkflowDepartment,
  updateWorkflowTaskStatus,
  updateWorkflowTaskType,
};
