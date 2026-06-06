const mongoose = require("mongoose");
const User = require("../models/user.model");
const { Notification } = require("../models/notification.model");
const { Task } = require("../models/workflow");
const {
  normalizeText,
  normalizeWorkflowTaskStatus,
} = require("../helpers/workflow");

const INDIA_TIMEZONE_OFFSET_MS = 330 * 60 * 1000;

const NOTIFICATION_EVENTS = Object.freeze({
  new: "notification:new",
  unreadCount: "notification:unread_count",
  summaryUpdated: "notification:summary_updated",
});

const WORKFLOW_DOCK_VIEWS = Object.freeze({
  tasksDueToday: "tasks_due_today",
  approvalPending: "approval_pending",
  holdApprovalPending: "hold_approval_pending",
  uploadPending: "upload_pending",
  criticalOverdue: "critical_overdue",
});

// Escalation foundation: when a scheduler pattern is added, reuse this shape for
// overdue +6h assignee, +12h manager, and +24h admin escalation notifications.
const WORKFLOW_ESCALATION_STEPS = Object.freeze([
  { afterHours: 6, audience: "assignee" },
  { afterHours: 12, audience: "manager" },
  { afterHours: 24, audience: "admin" },
]);

const normalizeId = (value) => String(value?._id || value?.id || value || "").trim();
const uniqueIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))];

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

const addDays = (date, days = 1) => new Date(date.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000);

const subtractDays = (date, days = 1) => new Date(date.getTime() - Number(days || 0) * 24 * 60 * 60 * 1000);

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getEffectiveTaskDueDate = (task = {}) => {
  const candidates = [
    task?.due_date,
    ...(Array.isArray(task?.rework_due_dates)
      ? task.rework_due_dates.map((entry) => entry?.date)
      : []),
  ]
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && !Number.isNaN(value.getTime()));
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, value) =>
    value.getTime() > latest.getTime() ? value : latest,
  );
};

const isUploadedOrHiddenTask = (task = {}) =>
  !task || task.is_deleted === true || normalizeText(task.status).toLowerCase() === "uploaded";

const isActiveDueTask = (task = {}) =>
  !isUploadedOrHiddenTask(task) && ["assigned", "started"].includes(normalizeText(task.status).toLowerCase());

const formatDisplayDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const resolveIo = (reqOrIo) => {
  if (reqOrIo && typeof reqOrIo.emit === "function" && typeof reqOrIo.to === "function") {
    return reqOrIo;
  }
  if (reqOrIo?.app && typeof reqOrIo.app.get === "function") {
    return reqOrIo.app.get("io") || null;
  }
  if (reqOrIo && typeof reqOrIo.get === "function") {
    return reqOrIo.get("io") || null;
  }
  return null;
};

const buildNotificationUserRoom = (userId) => `notification:user:${normalizeId(userId)}`;

const formatTaskStatus = (status = "") => {
  const normalized = normalizeWorkflowTaskStatus(status, { fallback: normalizeText(status).toLowerCase() });
  const labels = {
    assigned: "Assigned",
    started: "Started",
    complete: "Completed",
    approved: "Approved",
    uploaded: "Uploaded",
    cancelled: "Cancelled",
    hold: "On Hold",
    pending: "Pending",
    submitted: "Submitted",
    review: "In Review",
  };
  return labels[normalized] || normalizeText(status).replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const getTaskAssigneeNames = (task = {}) => {
  const names = (Array.isArray(task?.assigned_to) ? task.assigned_to : [])
    .map((entry) => {
      const user = entry?.user || entry;
      return normalizeText(user?.name || user?.email || entry?.name || entry?.email);
    })
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : "Unassigned";
};

const getTaskAssignedByName = (task = {}) => {
  const actor = task?.assigned_by || {};
  const user = actor?.user || {};
  return normalizeText(actor?.name || user?.name || user?.email);
};

const getTaskTypeLabel = (task = {}) =>
  normalizeText(task?.task_type_name) ||
  normalizeText(task?.task_type_key) ||
  normalizeText(task?.task_type?.name) ||
  "";

const getNotificationCommentText = (notification = {}) => {
  const metadata = notification?.metadata || {};
  return (
    normalizeText(metadata.comment_text) ||
    normalizeText(metadata.comment) ||
    normalizeText(metadata.note) ||
    (normalizeText(notification?.category) === "comment" ? normalizeText(notification?.message) : "")
  );
};

const getNotificationHeading = (notification = {}, task = null) => {
  const type = normalizeText(notification?.type);
  const category = normalizeText(notification?.category);
  const priority = normalizeText(notification?.priority);
  const status = normalizeWorkflowTaskStatus(task?.status || notification?.metadata?.status, {
    fallback: "",
  });

  const byType = {
    workflow_task_assigned: "Task Assigned",
    workflow_task_due_today: "Task Due Today",
    workflow_task_overdue: "Task Overdue",
    workflow_approval_pending: "Task Approval Pending",
    workflow_upload_pending: "Task Upload Pending",
    workflow_upload_completed: "Upload Completed",
    workflow_task_rework: "Task Moved to Rework",
    workflow_comment_mention: "Comment Mentioned You",
    workflow_comment_added: "New Comment Added",
    workflow_hold_pending: "Task Hold Approval Pending",
    workflow_hold_updated: "Task Hold Updated",
  };
  if (byType[type]) return byType[type];

  if (type === "workflow_task_status_changed") {
    if (status === "started") return "Task Has Started";
    if (status === "complete") return "Task Completed";
    if (status) return "Task Status Changed";
  }

  if (category === "comment") return "New Comment Added";
  if (category === "approval") return "Task Approval Pending";
  if (category === "upload") return status === "uploaded" ? "Upload Completed" : "Task Upload Pending";
  if (category === "hold") return "Task Hold Updated";
  if (priority === "critical") return "Critical Notification";

  return normalizeText(notification?.title) || "Notification";
};

const buildNotificationCard = (notification = {}, relatedTask = null) => {
  const priority = normalizeText(notification.priority || "normal");
  const category = normalizeText(notification.category || "system");
  const deepLink = normalizeText(notification.deep_link) ||
    (relatedTask?._id ? buildTaskDeepLink(relatedTask) : "");
  const taskTitle =
    (relatedTask ? getTaskDisplayTitle(relatedTask) : "") ||
    normalizeText(notification?.metadata?.task_title) ||
    normalizeText(notification?.title) ||
    normalizeText(notification?.message);

  return {
    heading: getNotificationHeading(notification, relatedTask),
    taskTitle,
    assigneeNames: relatedTask ? getTaskAssigneeNames(relatedTask) : "",
    assignedByName: relatedTask ? getTaskAssignedByName(relatedTask) : "",
    comment: getNotificationCommentText(notification),
    status: relatedTask
      ? formatTaskStatus(relatedTask.status)
      : formatTaskStatus(notification?.metadata?.status),
    taskType: relatedTask ? getTaskTypeLabel(relatedTask) : "",
    deepLink,
    priority,
    category,
  };
};

const buildTaskAttentionCard = (task = {}, heading = "Workflow Task") => ({
  heading,
  taskTitle: getTaskDisplayTitle(task),
  assigneeNames: getTaskAssigneeNames(task),
  assignedByName: getTaskAssignedByName(task),
  comment: "",
  status: formatTaskStatus(task?.status),
  taskType: getTaskTypeLabel(task),
  dueDate: task?.active_due_date || getEffectiveTaskDueDate(task) || task?.due_date || null,
  dueDateText: formatDisplayDate(task?.active_due_date || getEffectiveTaskDueDate(task) || task?.due_date),
  deepLink: buildTaskDeepLink(task),
  priority: normalizeText(task?.priority || "normal"),
  category: "task",
});

const serializeNotification = (notification = {}, relatedTask = null) => ({
  _id: normalizeId(notification._id),
  type: normalizeText(notification.type),
  title: normalizeText(notification.title),
  message: normalizeText(notification.message),
  priority: normalizeText(notification.priority || "normal"),
  category: normalizeText(notification.category || "system"),
  read: Boolean(notification.read),
  archived: Boolean(notification.archived),
  entity_type: normalizeText(notification.entity_type),
  entity_id: notification.entity_id || null,
  deep_link: normalizeText(notification.deep_link),
  metadata: notification.metadata || {},
  created_at: notification.created_at || notification.createdAt || new Date(),
  card: buildNotificationCard(notification, relatedTask),
});

const getWorkflowTaskIdsForNotifications = (notifications = []) =>
  uniqueIds(
    (Array.isArray(notifications) ? notifications : [])
      .filter((entry) => normalizeText(entry?.entity_type) === "workflow_task")
      .map((entry) => entry?.entity_id),
  );

const loadNotificationTaskMap = async (notifications = []) => {
  const taskIds = getWorkflowTaskIdsForNotifications(notifications);
  if (taskIds.length === 0) return new Map();
  const tasks = await Task.find({
    _id: { $in: taskIds },
  })
    .select("_id task_no title status is_deleted assigned_to assigned_by task_type task_type_name task_type_key priority due_date rework_due_dates")
    .populate("assigned_to.user", "name email")
    .populate("assigned_by.user", "name email")
    .populate("task_type", "name key")
    .lean();
  return new Map(tasks.map((task) => [normalizeId(task._id), task]));
};

const serializeNotificationsWithCards = async (notifications = []) => {
  const taskById = await loadNotificationTaskMap(notifications);
  return (Array.isArray(notifications) ? notifications : []).map((notification) =>
    serializeNotification(notification, taskById.get(normalizeId(notification?.entity_id)) || null),
  );
};

const getVisibleNotifications = async (notifications = []) => {
  const rows = Array.isArray(notifications) ? notifications : [];
  const taskById = await loadNotificationTaskMap(rows);
  return rows.filter((notification) => {
    if (normalizeText(notification?.entity_type) !== "workflow_task") return true;
    const task = taskById.get(normalizeId(notification?.entity_id));
    return !isUploadedOrHiddenTask(task);
  });
};

const countVisibleNotifications = async (match = {}) => {
  const rows = await Notification.find(match)
    .select("_id entity_type entity_id")
    .lean();
  return (await getVisibleNotifications(rows)).length;
};

const emitNotificationState = async (reqOrIo, userId, notification = null) => {
  const io = resolveIo(reqOrIo);
  if (!io || !userId) return;
  const room = buildNotificationUserRoom(userId);
  const unreadCount = await getUnreadCount(userId);
  if (notification && notification.priority !== "silent") {
    const [serialized] = await serializeNotificationsWithCards([notification]);
    io.to(room).emit(NOTIFICATION_EVENTS.new, serialized || serializeNotification(notification));
  }
  io.to(room).emit(NOTIFICATION_EVENTS.unreadCount, { unreadCount });
  io.to(room).emit(NOTIFICATION_EVENTS.summaryUpdated, { unreadCount });
};

const buildDedupeKey = (data = {}) =>
  normalizeText(data?.metadata?.dedupe_key)
  || [
    normalizeId(data.user),
    normalizeText(data.type),
    normalizeText(data.entity_type),
    normalizeId(data.entity_id),
    normalizeText(data.metadata?.day_key),
  ].filter(Boolean).join(":");

const createNotification = async (data = {}, { realtimeSource = null, dedupe = true } = {}) => {
  const userId = normalizeId(data.user);
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;
  const dedupeKey = buildDedupeKey(data);
  const metadata = {
    ...(data.metadata || {}),
    dedupe_key: dedupeKey,
  };

  if (dedupe && dedupeKey) {
    const existing = await Notification.findOne({
      user: userId,
      type: normalizeText(data.type),
      entity_type: normalizeText(data.entity_type),
      entity_id: data.entity_id || null,
      archived: false,
      "metadata.dedupe_key": dedupeKey,
    }).lean();
    if (existing) {
      const refreshed = await Notification.findByIdAndUpdate(
        existing._id,
        {
          $set: {
            title: normalizeText(data.title || existing.title || "Notification"),
            message: normalizeText(data.message || existing.message),
            priority: normalizeText(data.priority || existing.priority || "normal"),
            category: normalizeText(data.category || existing.category || "system"),
            deep_link: normalizeText(data.deep_link || existing.deep_link),
            metadata: {
              ...(existing.metadata || {}),
              ...metadata,
            },
          },
        },
        { new: true },
      ).lean();
      return refreshed || existing;
    }
  }

  const notification = await Notification.create({
    user: userId,
    type: normalizeText(data.type || "system"),
    title: normalizeText(data.title || "Notification"),
    message: normalizeText(data.message),
    priority: normalizeText(data.priority || "normal"),
    category: normalizeText(data.category || "system"),
    entity_type: normalizeText(data.entity_type),
    entity_id: data.entity_id || null,
    deep_link: normalizeText(data.deep_link),
    metadata,
    created_by: data.created_by || null,
    expires_at: data.expires_at || null,
  });

  await emitNotificationState(realtimeSource, userId, notification.toObject());
  return notification.toObject();
};

const createManyNotifications = async (list = [], options = {}) => {
  const results = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const created = await createNotification(entry, options);
    if (created) results.push(created);
  }
  return results;
};

const archiveWorkflowTaskNotifications = async (taskId, realtimeSource = null) => {
  const normalizedTaskId = normalizeId(taskId);
  if (!normalizedTaskId || !mongoose.Types.ObjectId.isValid(normalizedTaskId)) return 0;
  const affectedUserIds = await Notification.distinct("user", {
    entity_type: "workflow_task",
    entity_id: normalizedTaskId,
    archived: false,
  });
  const result = await Notification.updateMany(
    {
      entity_type: "workflow_task",
      entity_id: normalizedTaskId,
      archived: false,
    },
    {
      $set: {
        archived: true,
        archived_at: new Date(),
        read: true,
        read_at: new Date(),
      },
    },
  );
  await Promise.all(
    uniqueIds(affectedUserIds).map((userId) => emitNotificationState(realtimeSource, userId)),
  );
  return Number(result?.modifiedCount || result?.nModified || 0);
};

const notifyUser = (userId, notification, options = {}) =>
  createNotification({ ...notification, user: userId }, options);

const notifyUsers = (userIds = [], notificationData = {}, options = {}) =>
  createManyNotifications(
    uniqueIds(userIds).map((userId) => ({ ...notificationData, user: userId })),
    options,
  );

const markAsRead = async (userId, notificationId, realtimeSource = null) => {
  const updated = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId, archived: false },
    { $set: { read: true, read_at: new Date() } },
    { new: true },
  ).lean();
  if (!updated) return null;
  await emitNotificationState(realtimeSource, userId);
  const [serialized] = await serializeNotificationsWithCards([updated]);
  return serialized || serializeNotification(updated);
};

const markAllAsRead = async (userId, realtimeSource = null) => {
  await Notification.updateMany(
    { user: userId, read: false, archived: false },
    { $set: { read: true, read_at: new Date() } },
  );
  const unreadCount = await getUnreadCount(userId);
  await emitNotificationState(realtimeSource, userId);
  return unreadCount;
};

const archiveNotification = async (userId, notificationId, realtimeSource = null) => {
  const updated = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { $set: { archived: true, archived_at: new Date(), read: true, read_at: new Date() } },
    { new: true },
  ).lean();
  if (!updated) return null;
  await emitNotificationState(realtimeSource, userId);
  const [serialized] = await serializeNotificationsWithCards([updated]);
  return serialized || serializeNotification(updated);
};

const getUnreadCount = async (userId) =>
  countVisibleNotifications({ user: userId, read: false, archived: false });

const buildTaskDeepLink = (task = {}) => `/workflow/tasks?task=${normalizeId(task._id)}`;

const getTaskAudienceUserIds = (task = {}) =>
  uniqueIds([
    ...(Array.isArray(task.assigned_to) ? task.assigned_to : []).map((entry) => entry?.user || entry),
    ...(Array.isArray(task.upload_assignees) ? task.upload_assignees : []).map((entry) => entry?.user || entry),
    task.assigned_by?.user,
    task.created_by?.user,
  ]);

const buildWorkflowNotificationPayload = ({
  task = {},
  type = "workflow_task_updated",
  title = "",
  message = "",
  priority = "normal",
  category = "task",
  metadata = {},
  actor = null,
} = {}) => ({
  type,
  title,
  message,
  priority,
  category,
  entity_type: "workflow_task",
  entity_id: task._id,
  deep_link: buildTaskDeepLink(task),
  metadata: {
    task_no: task.task_no,
    task_title: getTaskDisplayTitle(task),
    status: task.status,
    ...metadata,
  },
  created_by: actor?._id || actor?.id || actor?.user || null,
});

const getTaskDisplayTitle = (task = {}) =>
  normalizeText(task.title) || normalizeText(task.task_type_name) || normalizeText(task.task_no) || "Workflow task";

const notifyWorkflowTaskEvent = async ({
  realtimeSource = null,
  task = {},
  actor = {},
  eventType = "updated",
  changedFields = [],
  additionalUserIds = [],
  message = "",
} = {}) => {
  if (!task?._id) return [];
  const actorId = normalizeId(actor?._id || actor?.id || actor?.user);
  const status = normalizeWorkflowTaskStatus(task.status, { fallback: "" });
  const recipients = new Set(getTaskAudienceUserIds(task));
  additionalUserIds.forEach((id) => recipients.add(normalizeId(id)));

  const notifications = [];
  const taskTitle = getTaskDisplayTitle(task);

  if (status === "uploaded") {
    await archiveWorkflowTaskNotifications(task._id, realtimeSource);
    return [];
  }

  if (eventType === "created" || changedFields.includes("assigned_to")) {
    (Array.isArray(task.assigned_to) ? task.assigned_to : []).forEach((entry) => {
      const userId = normalizeId(entry?.user || entry);
      if (userId && userId !== actorId) {
        notifications.push({
          ...buildWorkflowNotificationPayload({
            task,
            type: "workflow_task_assigned",
            title: "New workflow task assigned",
            message: taskTitle,
            priority: "normal",
            category: "task",
            actor,
            metadata: { dedupe_key: `${userId}:assigned:${task._id}` },
          }),
          user: userId,
        });
      }
    });
  }

  if (status === "complete") {
    const approverId = normalizeId(task.assigned_by?.user);
    if (approverId && approverId !== actorId) {
      notifications.push({
        ...buildWorkflowNotificationPayload({
          task,
          type: "workflow_approval_pending",
          title: "Approval pending",
          message: `${taskTitle} is waiting for approval.`,
          priority: "high",
          category: "approval",
          actor,
          metadata: { dedupe_key: `${approverId}:approval:${task._id}` },
        }),
        user: approverId,
      });
    }
  }

  if (status === "approved" && task.upload_required !== false) {
    (Array.isArray(task.upload_assignees) ? task.upload_assignees : []).forEach((entry) => {
      const userId = normalizeId(entry?.user || entry);
      if (userId && userId !== actorId) {
        notifications.push({
          ...buildWorkflowNotificationPayload({
            task,
            type: "workflow_upload_pending",
            title: "Upload pending",
            message: `${taskTitle} is approved and needs upload.`,
            priority: "high",
            category: "upload",
            actor,
            metadata: { dedupe_key: `${userId}:upload:${task._id}` },
          }),
          user: userId,
        });
      }
    });
  }

  if (status === "uploaded") {
    recipients.forEach((userId) => {
      if (userId && userId !== actorId) {
        notifications.push({
          ...buildWorkflowNotificationPayload({
            task,
            type: "workflow_upload_completed",
            title: "Upload completed",
            message: `${taskTitle} upload is complete.`,
            priority: "normal",
            category: "upload",
            actor,
            metadata: { dedupe_key: `${userId}:uploaded:${task._id}` },
          }),
          user: userId,
        });
      }
    });
  }

  if (changedFields.includes("status") && !["complete", "approved", "uploaded"].includes(status)) {
    recipients.forEach((userId) => {
      if (userId && userId !== actorId) {
        notifications.push({
          ...buildWorkflowNotificationPayload({
            task,
            type: status === "assigned" ? "workflow_task_rework" : "workflow_task_status_changed",
            title: status === "assigned" && task.rework_count ? "Task moved to rework" : "Workflow task updated",
            message: message || `${taskTitle} moved to ${status}.`,
            priority: status === "assigned" && task.rework_count ? "high" : "normal",
            category: "task",
            actor,
            metadata: { dedupe_key: `${userId}:status:${task._id}:${status}` },
          }),
          user: userId,
        });
      }
    });
  }

  if (changedFields.includes("hold")) {
    const holdStatus = normalizeText(task?.hold?.status);
    const targetUsers = holdStatus === "pending"
      ? uniqueIds([task.created_by?.user, task.assigned_by?.user])
      : [...recipients];
    targetUsers.forEach((userId) => {
      if (userId && userId !== actorId) {
        notifications.push({
          ...buildWorkflowNotificationPayload({
            task,
            type: holdStatus === "pending" ? "workflow_hold_pending" : "workflow_hold_updated",
            title: holdStatus === "pending" ? "Hold approval pending" : "Workflow hold updated",
            message: holdStatus === "pending"
              ? `${taskTitle} has a hold request pending.`
              : `${taskTitle} hold status changed.`,
            priority: holdStatus === "pending" ? "high" : "normal",
            category: "hold",
            actor,
            metadata: { dedupe_key: `${userId}:hold:${task._id}:${holdStatus}` },
          }),
          user: userId,
        });
      }
    });
  }

  return createManyNotifications(notifications, { realtimeSource });
};

const extractMentionNames = (comment = "") =>
  [...String(comment || "").matchAll(/@([A-Za-z][A-Za-z0-9 ._-]{1,40})/g)]
    .map((match) => normalizeText(match[1]).toLowerCase())
    .filter(Boolean);

const notifyWorkflowCommentAdded = async ({
  realtimeSource = null,
  task = {},
  comment = {},
  actor = {},
} = {}) => {
  if (!task?._id || !comment?._id) return [];
  const actorId = normalizeId(actor?._id || actor?.id || actor?.user);
  const recipients = getTaskAudienceUserIds(task).filter((userId) => userId !== actorId);
  const mentionNames = extractMentionNames(comment.comment);
  let mentionedUsers = [];
  if (mentionNames.length > 0) {
    mentionedUsers = await User.find({
      $or: [
        { name: { $in: mentionNames.map((name) => new RegExp(`^${escapeRegex(name)}$`, "i")) } },
        { username: { $in: mentionNames.map((name) => new RegExp(`^${escapeRegex(name)}$`, "i")) } },
      ],
    }).select("_id").lean();
  }
  const mentionIds = mentionedUsers.map((user) => normalizeId(user._id));
  const allRecipients = uniqueIds([...recipients, ...mentionIds]);
  const notifications = allRecipients.map((userId) => ({
    ...buildWorkflowNotificationPayload({
      task,
      type: mentionIds.includes(userId) ? "workflow_comment_mention" : "workflow_comment_added",
      title: mentionIds.includes(userId) ? "You were mentioned" : "New workflow comment",
      message: `${getTaskDisplayTitle(task)}: ${normalizeText(comment.comment).slice(0, 140)}`,
      priority: mentionIds.includes(userId) ? "high" : "normal",
      category: "comment",
      actor,
      metadata: {
        comment_text: normalizeText(comment.comment),
        dedupe_key: `${userId}:comment:${comment._id}`,
      },
    }),
    user: userId,
  }));
  return createManyNotifications(notifications, { realtimeSource });
};

const notifyWorkflowBatchEvent = async ({
  realtimeSource = null,
  batch = {},
  userIds = [],
  actor = {},
  type = "workflow_batch_updated",
  title = "Workflow batch updated",
  message = "",
} = {}) => {
  const actorId = normalizeId(actor?._id || actor?.id || actor?.user);
  const notifications = uniqueIds(userIds)
    .filter((userId) => userId !== actorId)
    .map((userId) => ({
      user: userId,
      type,
      title,
      message: message || `${batch.batch_no || "Batch"} was updated.`,
      priority: "low",
      category: "batch",
      entity_type: "workflow_batch",
      entity_id: batch._id,
      deep_link: `/workflow/batches/${batch._id}`,
      metadata: {
        batch_no: batch.batch_no,
        dedupe_key: `${userId}:${type}:${batch._id}:${normalizeText(batch.status)}`,
      },
      created_by: actorId || null,
    }));
  return createManyNotifications(notifications, { realtimeSource });
};

const buildUserTaskMatch = (userId) => ({
  is_deleted: false,
  $or: [
    { "assigned_to.user": userId },
    { "upload_assignees.user": userId },
    { "assigned_by.user": userId },
    { "created_by.user": userId },
  ],
});

const ensureWorkflowReminderNotifications = async (userId, realtimeSource = null) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return [];
  const todayStart = getIndianDayStart(new Date());
  const tomorrowStart = addDays(todayStart, 1);
  const dayKey = todayStart.toISOString().slice(0, 10);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const tasks = await Task.find({
    ...buildUserTaskMatch(userObjectId),
    status: { $in: ["assigned", "started", "complete", "approved"] },
  }).select("_id task_no title status due_date rework_due_dates assigned_to upload_assignees assigned_by created_by upload_required upload_statuses brand task_type_key task_type_name").lean();

  const notifications = [];
  tasks.forEach((task) => {
    const dueDate = getEffectiveTaskDueDate(task);
    const dueDay = dueDate ? getIndianDayStart(dueDate) : null;
    if (dueDay && dueDay >= todayStart && dueDay < tomorrowStart && ["assigned", "started"].includes(task.status)) {
      notifications.push({
        ...buildWorkflowNotificationPayload({
          task,
          type: "workflow_task_due_today",
          title: "Task due today",
          message: getTaskDisplayTitle(task),
          priority: "high",
          category: "task",
          metadata: { day_key: dayKey, dedupe_key: `${userId}:due_today:${task._id}:${dayKey}` },
        }),
        user: userId,
      });
    }
    if (dueDay && dueDay < todayStart && ["assigned", "started"].includes(task.status)) {
      notifications.push({
        ...buildWorkflowNotificationPayload({
          task,
          type: "workflow_task_overdue",
          title: "Task overdue",
          message: getTaskDisplayTitle(task),
          priority: "critical",
          category: "task",
          metadata: { day_key: dayKey, dedupe_key: `${userId}:overdue:${task._id}:${dayKey}` },
        }),
        user: userId,
      });
    }
  });

  return createManyNotifications(notifications, { realtimeSource });
};

const buildLiveTaskNotificationRow = (task = {}, view = "workflow_task", heading = "Workflow Task") => {
  const dueDate = task?.active_due_date || getEffectiveTaskDueDate(task) || task?.due_date || null;
  const card = buildTaskAttentionCard({ ...task, active_due_date: dueDate }, heading);
  return {
    _id: `live:${view}:${normalizeId(task._id)}`,
    type: `live_${view}`,
    title: heading,
    message: getTaskDisplayTitle(task),
    priority: view === WORKFLOW_DOCK_VIEWS.criticalOverdue ? "critical" : normalizeText(task?.priority || "normal"),
    category: view === WORKFLOW_DOCK_VIEWS.uploadPending
      ? "upload"
      : view === WORKFLOW_DOCK_VIEWS.approvalPending
        ? "approval"
        : view === WORKFLOW_DOCK_VIEWS.holdApprovalPending
          ? "hold"
          : "task",
    read: true,
    archived: false,
    entity_type: "workflow_task",
    entity_id: task._id || null,
    deep_link: buildTaskDeepLink(task),
    metadata: {
      task_no: task.task_no,
      task_title: getTaskDisplayTitle(task),
      status: task.status,
      live_view: view,
      due_date: dueDate,
    },
    created_at: task.updatedAt || task.createdAt || new Date(),
    is_live_task: true,
    card: {
      ...card,
      priority: view === WORKFLOW_DOCK_VIEWS.criticalOverdue ? "critical" : card.priority,
      category: view === WORKFLOW_DOCK_VIEWS.uploadPending
        ? "upload"
        : view === WORKFLOW_DOCK_VIEWS.approvalPending
          ? "approval"
          : view === WORKFLOW_DOCK_VIEWS.holdApprovalPending
            ? "hold"
            : "task",
    },
  };
};

const getWorkflowDockViewMatch = (view, userObjectId) => {
  const baseMatch = buildUserTaskMatch(userObjectId);
  if (view === WORKFLOW_DOCK_VIEWS.approvalPending) {
    return {
      match: { is_deleted: false, status: "complete", "assigned_by.user": userObjectId },
      heading: "Task Approval Pending",
    };
  }
  if (view === WORKFLOW_DOCK_VIEWS.holdApprovalPending) {
    return {
      match: { is_deleted: false, "hold.status": "pending", $or: [{ "created_by.user": userObjectId }, { "assigned_by.user": userObjectId }] },
      heading: "Task Hold Approval Pending",
    };
  }
  if (view === WORKFLOW_DOCK_VIEWS.uploadPending) {
    return {
      match: {
        is_deleted: false,
        status: "approved",
        upload_required: { $ne: false },
        upload_assignees: { $elemMatch: { user: userObjectId } },
        $nor: [
          { upload_statuses: { $elemMatch: { user: userObjectId, status: "uploaded" } } },
        ],
      },
      heading: "Task Upload Pending",
    };
  }
  return {
    match: { ...baseMatch, status: { $in: ["assigned", "started"] } },
    heading: view === WORKFLOW_DOCK_VIEWS.criticalOverdue ? "Task Overdue" : "Task Due Today",
  };
};

const listWorkflowDockTasks = async (userId, query = {}) => {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { rows: [], pagination: { page: 1, limit: 20, totalRecords: 0, totalPages: 1 } };
  }
  const view = normalizeText(query.view);
  const page = Math.max(1, Number.parseInt(String(query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || "20"), 10) || 20));
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const todayStart = getIndianDayStart(new Date());
  const tomorrowStart = addDays(todayStart, 1);
  const criticalStart = subtractDays(todayStart, 2);
  const { match, heading } = getWorkflowDockViewMatch(view, userObjectId);
  const rows = await Task.find(match)
    .sort({ due_date: 1, updatedAt: -1 })
    .select("_id task_no title status due_date rework_due_dates priority brand task_type task_type_name task_type_key assigned_to assigned_by upload_statuses createdAt updatedAt")
    .populate("assigned_to.user", "name email")
    .populate("assigned_by.user", "name email")
    .populate("task_type", "name key")
    .lean();

  const filteredRows = rows
    .filter((task) => {
      if (isUploadedOrHiddenTask(task)) return false;
      if (view === WORKFLOW_DOCK_VIEWS.tasksDueToday || view === WORKFLOW_DOCK_VIEWS.criticalOverdue) {
        if (!isActiveDueTask(task)) return false;
        const dueDate = getEffectiveTaskDueDate(task);
        const dueDay = dueDate ? getIndianDayStart(dueDate) : null;
        if (!dueDay) return false;
        if (view === WORKFLOW_DOCK_VIEWS.criticalOverdue) return dueDay <= criticalStart;
        return dueDay >= todayStart && dueDay < tomorrowStart;
      }
      return true;
    })
    .map((task) => ({
      ...task,
      active_due_date: getEffectiveTaskDueDate(task),
    }))
    .sort((left, right) => {
      const leftDue = getEffectiveTaskDueDate(left)?.getTime() || new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightDue = getEffectiveTaskDueDate(right)?.getTime() || new Date(right.updatedAt || right.createdAt || 0).getTime();
      return leftDue - rightDue;
    });

  const start = (page - 1) * limit;
  return {
    rows: filteredRows
      .slice(start, start + limit)
      .map((task) => buildLiveTaskNotificationRow(task, view, heading)),
    pagination: {
      page,
      limit,
      totalRecords: filteredRows.length,
      totalPages: Math.max(1, Math.ceil(filteredRows.length / limit)),
    },
  };
};

const listNotifications = async (userId, query = {}) => {
  await ensureWorkflowReminderNotifications(userId);
  const page = Math.max(1, Number.parseInt(String(query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || "20"), 10) || 20));
  const view = normalizeText(query.view);
  if (Object.values(WORKFLOW_DOCK_VIEWS).includes(view)) {
    return listWorkflowDockTasks(userId, query);
  }
  const match = { user: userId, archived: false };
  if (String(query.unreadOnly) === "true") match.read = false;
  if (query.category) match.category = normalizeText(query.category);
  if (query.priority) match.priority = normalizeText(query.priority);
  if (query.fromDate || query.toDate) {
    match.created_at = {};
    if (query.fromDate) match.created_at.$gte = new Date(query.fromDate);
    if (query.toDate) match.created_at.$lte = new Date(query.toDate);
  }
  const search = normalizeText(query.search);
  if (search) {
    match.$or = [
      { title: new RegExp(escapeRegex(search), "i") },
      { message: new RegExp(escapeRegex(search), "i") },
      { type: new RegExp(escapeRegex(search), "i") },
    ];
  }
  const allRows = await Notification.find(match).sort({ created_at: -1 }).lean();
  const visibleRows = await getVisibleNotifications(allRows);
  const rows = visibleRows.slice((page - 1) * limit, page * limit);
  return {
    rows: await serializeNotificationsWithCards(rows),
    pagination: {
      page,
      limit,
      totalRecords: visibleRows.length,
      totalPages: Math.max(1, Math.ceil(visibleRows.length / limit)),
    },
  };
};

const getWorkflowCountsForUser = async (userId) => {
  const todayStart = getIndianDayStart(new Date());
  const tomorrowStart = addDays(todayStart, 1);
  const criticalStart = subtractDays(todayStart, 2);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const baseMatch = buildUserTaskMatch(userObjectId);
  const [
    dueCandidateTasks,
    approvalPendingCount,
    holdPendingCount,
    uploadPendingCount,
  ] = await Promise.all([
    Task.find({ ...baseMatch, status: { $in: ["assigned", "started"] } })
      .select("_id due_date rework_due_dates")
      .lean(),
    Task.countDocuments({ is_deleted: false, status: "complete", "assigned_by.user": userObjectId }),
    Task.countDocuments({ is_deleted: false, "hold.status": "pending", $or: [{ "created_by.user": userObjectId }, { "assigned_by.user": userObjectId }] }),
    Task.countDocuments({
      is_deleted: false,
      status: "approved",
      upload_required: { $ne: false },
      upload_assignees: { $elemMatch: { user: userObjectId } },
      $nor: [
        { upload_statuses: { $elemMatch: { user: userObjectId, status: "uploaded" } } },
      ],
    }),
  ]);
  const dueBuckets = dueCandidateTasks.reduce(
    (acc, task) => {
      const dueDate = getEffectiveTaskDueDate(task);
      const dueDay = dueDate ? getIndianDayStart(dueDate) : null;
      if (dueDay && dueDay >= todayStart && dueDay < tomorrowStart) acc.todayDueTasksCount += 1;
      if (dueDay && dueDay < todayStart) acc.overdueTasksCount += 1;
      if (dueDay && dueDay <= criticalStart) acc.criticalOverdueTasksCount += 1;
      return acc;
    },
    { todayDueTasksCount: 0, overdueTasksCount: 0, criticalOverdueTasksCount: 0 },
  );
  return {
    ...dueBuckets,
    approvalPendingCount,
    holdPendingCount,
    uploadPendingCount,
  };
};

const getNotificationSummary = async (userId) => {
  await ensureWorkflowReminderNotifications(userId);
  const [
    unreadCount,
    latestNotifications,
    workflowCounts,
  ] = await Promise.all([
    getUnreadCount(userId),
    Notification.find({ user: userId, archived: false }).sort({ created_at: -1 }).limit(100).lean(),
    getWorkflowCountsForUser(userId),
  ]);
  const visibleLatestNotifications = (await getVisibleNotifications(latestNotifications)).slice(0, 5);
  return {
    unreadCount,
    criticalCount: Number(workflowCounts.criticalOverdueTasksCount || 0),
    ...workflowCounts,
    latestNotifications: await serializeNotificationsWithCards(visibleLatestNotifications),
  };
};

const loadTaskRows = async (match, limit = 8, heading = "Workflow Task") => {
  const rows = await Task.find(match)
    .sort({ due_date: 1, updatedAt: -1 })
    .limit(limit)
    .select("_id task_no title status due_date priority brand task_type task_type_name task_type_key assigned_to assigned_by")
    .populate("assigned_to.user", "name email")
    .populate("assigned_by.user", "name email")
    .populate("task_type", "name key")
    .lean();
  return rows.map((task) => ({
    ...task,
    card: buildTaskAttentionCard(task, heading),
  }));
};

const loadDueTaskRows = async ({ match = {}, bucket = "today", todayStart, tomorrowStart, criticalStart = null, limit = 8 } = {}) => {
  const rows = await Task.find(match)
    .sort({ updatedAt: -1 })
    .select("_id task_no title status due_date rework_due_dates priority brand task_type task_type_name task_type_key assigned_to assigned_by")
    .populate("assigned_to.user", "name email")
    .populate("assigned_by.user", "name email")
    .populate("task_type", "name key")
    .lean();
  return rows
    .filter((task) => {
      if (!isActiveDueTask(task)) return false;
      const dueDate = getEffectiveTaskDueDate(task);
      const dueDay = dueDate ? getIndianDayStart(dueDate) : null;
      if (!dueDay) return false;
      if (bucket === "critical") return criticalStart ? dueDay <= criticalStart : dueDay < todayStart;
      if (bucket === "overdue") return dueDay < todayStart;
      return dueDay >= todayStart && dueDay < tomorrowStart;
    })
    .sort((left, right) => {
      const leftDue = getEffectiveTaskDueDate(left)?.getTime() || 0;
      const rightDue = getEffectiveTaskDueDate(right)?.getTime() || 0;
      return leftDue - rightDue;
    })
    .slice(0, limit)
    .map((task) => ({
      ...task,
      active_due_date: getEffectiveTaskDueDate(task),
      card: buildTaskAttentionCard(
        task,
        bucket === "critical" || bucket === "overdue" ? "Task Overdue" : "Task Due Today",
      ),
    }));
};

const getLoginSummary = async (user = {}) => {
  const userId = normalizeId(user?._id || user?.id);
  await ensureWorkflowReminderNotifications(userId);
  const popupEnabled = user?.notification_preferences?.popupEnabled !== false;
  const todayStart = getIndianDayStart(new Date());
  const tomorrowStart = addDays(todayStart, 1);
  const criticalStart = subtractDays(todayStart, 2);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const baseMatch = buildUserTaskMatch(userObjectId);
  const [
    todayDueTasks,
    overdueTasks,
    approvalPending,
    holdPending,
    uploadPending,
    criticalNotifications,
  ] = await Promise.all([
    loadDueTaskRows({ match: { ...baseMatch, status: { $in: ["assigned", "started"] } }, bucket: "today", todayStart, tomorrowStart }),
    loadDueTaskRows({ match: { ...baseMatch, status: { $in: ["assigned", "started"] } }, bucket: "overdue", todayStart, tomorrowStart }),
    loadTaskRows({ is_deleted: false, status: "complete", "assigned_by.user": userObjectId }, 8, "Task Approval Pending"),
    loadTaskRows({ is_deleted: false, "hold.status": "pending", $or: [{ "created_by.user": userObjectId }, { "assigned_by.user": userObjectId }] }, 8, "Task Hold Approval Pending"),
    loadTaskRows({
      is_deleted: false,
      status: "approved",
      upload_required: { $ne: false },
      upload_assignees: { $elemMatch: { user: userObjectId } },
      $nor: [
        { upload_statuses: { $elemMatch: { user: userObjectId, status: "uploaded" } } },
      ],
    }, 8, "Task Upload Pending"),
    loadDueTaskRows({ match: { ...baseMatch, status: { $in: ["assigned", "started"] } }, bucket: "critical", todayStart, tomorrowStart, criticalStart }),
  ]);
  const importantCount =
    todayDueTasks.length +
    overdueTasks.length +
    approvalPending.length +
    holdPending.length +
    uploadPending.length +
    criticalNotifications.length;
  return {
    showPopup: popupEnabled && importantCount > 0,
    todayDueTasks,
    overdueTasks,
    approvalPending,
    holdPending,
    uploadPending,
    criticalNotifications,
  };
};

const markPopupSeen = async (userId) => {
  await User.findByIdAndUpdate(userId, {
    $set: { last_notification_popup_seen_at: new Date() },
  });
  return { success: true };
};

module.exports = {
  NOTIFICATION_EVENTS,
  archiveNotification,
  buildNotificationUserRoom,
  buildWorkflowNotificationPayload,
  createManyNotifications,
  createNotification,
  emitNotificationState,
  ensureWorkflowReminderNotifications,
  getLoginSummary,
  getNotificationSummary,
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
  markPopupSeen,
  notifyUser,
  notifyUsers,
  notifyWorkflowBatchEvent,
  notifyWorkflowCommentAdded,
  notifyWorkflowTaskEvent,
  serializeNotification,
};
