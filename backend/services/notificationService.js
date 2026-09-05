const mongoose = require("mongoose");
const { Notification } = require("../models/notification.model");

const normalizeId = (value) => String(value?._id || value?.id || value || "").trim();
const normalizeText = (value) => String(value || "").trim();
const buildNotificationUserRoom = (userId) =>
  `notification:user:${normalizeId(userId)}`;

const activeNotificationMatch = (userId) => ({
  user: new mongoose.Types.ObjectId(normalizeId(userId)),
  archived: false,
  entity_type: { $nin: ["workflow_task", "workflow_batch"] },
});

const resolveIo = (reqOrIo) => {
  if (reqOrIo?.to && reqOrIo?.emit) return reqOrIo;
  return reqOrIo?.app?.get?.("io") || null;
};

const serializeNotification = (notification = {}) => {
  const row = typeof notification?.toObject === "function"
    ? notification.toObject()
    : notification;
  return {
    ...row,
    _id: normalizeId(row?._id),
    user: normalizeId(row?.user),
    entity_id: normalizeId(row?.entity_id),
    created_by: normalizeId(row?.created_by),
  };
};

const getUnreadCount = (userId) =>
  Notification.countDocuments({ ...activeNotificationMatch(userId), read: false });

const emitNotificationState = async (reqOrIo, userId, notification = null) => {
  const io = resolveIo(reqOrIo);
  if (!io) return;
  const room = buildNotificationUserRoom(userId);
  if (notification) io.to(room).emit("notification:new", serializeNotification(notification));
  io.to(room).emit("notification:unread_count", {
    unreadCount: await getUnreadCount(userId),
  });
};

const createNotification = async (
  data = {},
  { realtimeSource = null, dedupe = true } = {},
) => {
  const userId = normalizeId(data.user);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Notification user id is invalid");
  }

  const payload = {
    ...data,
    user: new mongoose.Types.ObjectId(userId),
    title: normalizeText(data.title) || "Notification",
  };
  const dedupeKey = normalizeText(data?.metadata?.dedupe_key);
  let notification;

  if (dedupe && dedupeKey) {
    notification = await Notification.findOneAndUpdate(
      {
        ...activeNotificationMatch(userId),
        type: normalizeText(data.type).toLowerCase(),
        "metadata.dedupe_key": dedupeKey,
      },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  } else {
    notification = await Notification.create(payload);
  }

  await emitNotificationState(realtimeSource, userId, notification);
  return serializeNotification(notification);
};

const createManyNotifications = async (list = [], options = {}) =>
  Promise.all((Array.isArray(list) ? list : []).map((entry) =>
    createNotification(entry, options)));

const notifyUser = (userId, notification, options = {}) =>
  createNotification({ ...notification, user: userId }, options);

const notifyUsers = (userIds = [], notificationData = {}, options = {}) =>
  createManyNotifications(
    [...new Set(userIds.map(normalizeId).filter(Boolean))].map((user) => ({
      ...notificationData,
      user,
    })),
    options,
  );

const listNotifications = async (userId, query = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const match = activeNotificationMatch(userId);

  if (String(query.unreadOnly).toLowerCase() === "true") match.read = false;
  if (normalizeText(query.category)) match.category = normalizeText(query.category).toLowerCase();
  if (normalizeText(query.priority)) match.priority = normalizeText(query.priority).toLowerCase();
  if (normalizeText(query.search)) {
    const escaped = normalizeText(query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match.$or = ["title", "message"].map((field) => ({
      [field]: { $regex: escaped, $options: "i" },
    }));
  }

  const [rows, totalRecords] = await Promise.all([
    Notification.find(match)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(match),
  ]);

  return {
    rows: rows.map(serializeNotification),
    pagination: {
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
      totalRecords,
    },
  };
};

const markAsRead = async (userId, notificationId, realtimeSource = null) => {
  if (!mongoose.Types.ObjectId.isValid(notificationId)) return null;
  const notification = await Notification.findOneAndUpdate(
    { ...activeNotificationMatch(userId), _id: notificationId },
    { $set: { read: true, read_at: new Date() } },
    { new: true },
  );
  await emitNotificationState(realtimeSource, userId);
  return notification ? serializeNotification(notification) : null;
};

const markAllAsRead = async (userId, realtimeSource = null) => {
  await Notification.updateMany(
    { ...activeNotificationMatch(userId), read: false },
    { $set: { read: true, read_at: new Date() } },
  );
  await emitNotificationState(realtimeSource, userId);
  return 0;
};

const archiveNotification = async (userId, notificationId, realtimeSource = null) => {
  if (!mongoose.Types.ObjectId.isValid(notificationId)) return null;
  const notification = await Notification.findOneAndUpdate(
    { ...activeNotificationMatch(userId), _id: notificationId },
    { $set: { archived: true, archived_at: new Date() } },
    { new: true },
  );
  await emitNotificationState(realtimeSource, userId);
  return notification ? serializeNotification(notification) : null;
};

const getNotificationSummary = async (userId) => ({
  unreadCount: await getUnreadCount(userId),
});

module.exports = {
  archiveNotification,
  buildNotificationUserRoom,
  createManyNotifications,
  createNotification,
  emitNotificationState,
  getNotificationSummary,
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
  notifyUser,
  notifyUsers,
  serializeNotification,
};
