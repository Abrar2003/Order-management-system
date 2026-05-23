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

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getEffectiveTaskDueDate = (task = {}) => {
  const reworkDueDates = Array.isArray(task.rework_due_dates) ? task.rework_due_dates : [];
  const latestReworkDueDate = reworkDueDates.length > 0
    ? reworkDueDates[reworkDueDates.length - 1]?.date
    : null;
  const candidate = latestReworkDueDate || task.due_date;
  const parsed = candidate ? new Date(candidate) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
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

const serializeNotification = (notification = {}) => ({
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
});

const emitNotificationState = async (reqOrIo, userId, notification = null) => {
  const io = resolveIo(reqOrIo);
  if (!io || !userId) return;
  const room = buildNotificationUserRoom(userId);
  const unreadCount = await getUnreadCount(userId);
  if (notification && notification.priority !== "silent") {
    io.to(room).emit(NOTIFICATION_EVENTS.new, serializeNotification(notification));
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
  return serializeNotification(updated);
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
  return serializeNotification(updated);
};

const getUnreadCount = async (userId) =>
  Notification.countDocuments({ user: userId, read: false, archived: false });

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
      metadata: { dedupe_key: `${userId}:comment:${comment._id}` },
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

const listNotifications = async (userId, query = {}) => {
  await ensureWorkflowReminderNotifications(userId);
  const page = Math.max(1, Number.parseInt(String(query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || "20"), 10) || 20));
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
  const [rows, totalRecords] = await Promise.all([
    Notification.find(match).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(match),
  ]);
  return {
    rows: rows.map(serializeNotification),
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
    },
  };
};

const getWorkflowCountsForUser = async (userId) => {
  const todayStart = getIndianDayStart(new Date());
  const tomorrowStart = addDays(todayStart, 1);
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
    Task.countDocuments({ is_deleted: false, status: "approved", upload_required: { $ne: false }, "upload_assignees.user": userObjectId }),
  ]);
  const dueBuckets = dueCandidateTasks.reduce(
    (acc, task) => {
      const dueDate = getEffectiveTaskDueDate(task);
      const dueDay = dueDate ? getIndianDayStart(dueDate) : null;
      if (dueDay && dueDay >= todayStart && dueDay < tomorrowStart) acc.todayDueTasksCount += 1;
      if (dueDay && dueDay < todayStart) acc.overdueTasksCount += 1;
      return acc;
    },
    { todayDueTasksCount: 0, overdueTasksCount: 0 },
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
    criticalCount,
    latestNotifications,
    workflowCounts,
  ] = await Promise.all([
    getUnreadCount(userId),
    Notification.countDocuments({ user: userId, archived: false, read: false, priority: "critical" }),
    Notification.find({ user: userId, archived: false }).sort({ created_at: -1 }).limit(5).lean(),
    getWorkflowCountsForUser(userId),
  ]);
  return {
    unreadCount,
    criticalCount,
    ...workflowCounts,
    latestNotifications: latestNotifications.map(serializeNotification),
  };
};

const loadTaskRows = (match, limit = 8) =>
  Task.find(match)
    .sort({ due_date: 1, updatedAt: -1 })
    .limit(limit)
    .select("_id task_no title status due_date priority brand task_type_name")
    .lean();

const loadDueTaskRows = async ({ match = {}, bucket = "today", todayStart, tomorrowStart, limit = 8 } = {}) => {
  const rows = await Task.find(match)
    .sort({ updatedAt: -1 })
    .select("_id task_no title status due_date rework_due_dates priority brand task_type_name")
    .lean();
  return rows
    .filter((task) => {
      const dueDate = getEffectiveTaskDueDate(task);
      const dueDay = dueDate ? getIndianDayStart(dueDate) : null;
      if (!dueDay) return false;
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
    }));
};

const getLoginSummary = async (user = {}) => {
  const userId = normalizeId(user?._id || user?.id);
  await ensureWorkflowReminderNotifications(userId);
  const popupEnabled = user?.notification_preferences?.popupEnabled !== false;
  const todayStart = getIndianDayStart(new Date());
  const tomorrowStart = addDays(todayStart, 1);
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
    loadTaskRows({ is_deleted: false, status: "complete", "assigned_by.user": userObjectId }),
    loadTaskRows({ is_deleted: false, "hold.status": "pending", $or: [{ "created_by.user": userObjectId }, { "assigned_by.user": userObjectId }] }),
    loadTaskRows({ is_deleted: false, status: "approved", upload_required: { $ne: false }, "upload_assignees.user": userObjectId }),
    Notification.find({ user: userId, archived: false, read: false, priority: "critical" }).sort({ created_at: -1 }).limit(8).lean(),
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
    criticalNotifications: criticalNotifications.map(serializeNotification),
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
