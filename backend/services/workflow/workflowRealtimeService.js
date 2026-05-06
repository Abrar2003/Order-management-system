const {
  buildWorkflowBatchRoom,
  buildWorkflowUserRoom,
  WORKFLOW_DASHBOARD_ROOM,
} = require("../../realtime/socket");
const {
  normalizeWorkflowTaskStatus,
} = require("../../helpers/workflow");

const WORKFLOW_EVENTS = Object.freeze({
  taskUpdated: "workflow:task_updated",
  batchUpdated: "workflow:batch_updated",
  commentAdded: "workflow:comment_added",
});

const normalizeText = (value) => String(value || "").trim();

const resolveIo = (reqOrIo) => {
  if (reqOrIo && typeof reqOrIo.emit === "function" && typeof reqOrIo.to === "function") {
    return reqOrIo;
  }

  if (reqOrIo?.app && typeof reqOrIo.app.get === "function") {
    const io = reqOrIo.app.get("io");
    if (io && typeof io.emit === "function" && typeof io.to === "function") {
      return io;
    }
  }

  if (reqOrIo && typeof reqOrIo.get === "function") {
    const io = reqOrIo.get("io");
    if (io && typeof io.emit === "function" && typeof io.to === "function") {
      return io;
    }
  }

  return null;
};

const extractUserId = (entry = {}) =>
  normalizeText(
    entry?._id
      || entry?.id
      || entry?.user?._id
      || entry?.user?.id
      || entry?.user,
  );

const extractAssignedUserIds = (assignedTo = [], extraUserIds = []) =>
  [
    ...new Set(
      [
        ...(Array.isArray(assignedTo) ? assignedTo : []),
        ...(Array.isArray(extraUserIds) ? extraUserIds : []),
      ]
        .map(extractUserId)
        .filter(Boolean),
    ),
  ];

const normalizeCounts = (counts = {}) =>
  Object.entries(counts || {}).reduce((acc, [key, value]) => {
    acc[key] = Number(value || 0);
    return acc;
  }, {});

const emitToRooms = (io, roomNames = [], eventName, payload) => {
  const uniqueRooms = [...new Set((Array.isArray(roomNames) ? roomNames : []).filter(Boolean))];
  uniqueRooms.forEach((roomName) => {
    io.to(roomName).emit(eventName, payload);
  });
};

const buildTaskEventPayload = ({
  task = {},
  batch = null,
  changedBy = null,
  message = "",
} = {}) => ({
  taskId: normalizeText(task?._id),
  batchId: normalizeText(batch?._id || task?.batch?._id || task?.batch),
  status: normalizeWorkflowTaskStatus(task?.status, { fallback: "assigned" }) || "assigned",
  assigned_to: extractAssignedUserIds(task?.assigned_to),
  updatedAt: task?.updatedAt || new Date(),
  changedBy: changedBy || task?.updated_by || {},
  message: normalizeText(message),
});

const buildBatchEventPayload = ({
  batch = {},
  message = "",
} = {}) => ({
  batchId: normalizeText(batch?._id),
  status: normalizeText(batch?.status).toLowerCase(),
  counts: normalizeCounts(batch?.counts),
  updatedAt: batch?.updatedAt || new Date(),
  message: normalizeText(message),
  is_deleted: Boolean(batch?.is_deleted),
});

const buildCommentEventPayload = ({
  comment = {},
  task = {},
  message = "",
} = {}) => ({
  commentId: normalizeText(comment?._id),
  taskId: normalizeText(task?._id || comment?.task?._id || comment?.task),
  batchId: normalizeText(task?.batch?._id || task?.batch || comment?.batch?._id || comment?.batch),
  commentType: normalizeText(comment?.comment_type).toLowerCase() || "general",
  createdAt: comment?.createdAt || comment?.created_at || new Date(),
  createdBy: comment?.created_by || {},
  message: normalizeText(message),
});

const emitWorkflowTaskUpdated = (
  reqOrIo,
  task,
  batch = null,
  {
    changedBy = null,
    message = "",
    additionalUserIds = [],
  } = {},
) => {
  const io = resolveIo(reqOrIo);
  if (!io || !task) return null;

  const payload = buildTaskEventPayload({
    task,
    batch,
    changedBy,
    message,
  });

  emitToRooms(
    io,
    [
      WORKFLOW_DASHBOARD_ROOM,
      payload.batchId ? buildWorkflowBatchRoom(payload.batchId) : "",
      ...extractAssignedUserIds(task?.assigned_to, additionalUserIds).map(
        buildWorkflowUserRoom,
      ),
    ],
    WORKFLOW_EVENTS.taskUpdated,
    payload,
  );

  return payload;
};

const emitWorkflowBatchUpdated = (reqOrIo, batch, { message = "" } = {}) => {
  const io = resolveIo(reqOrIo);
  if (!io || !batch) return null;

  const payload = buildBatchEventPayload({
    batch,
    message,
  });

  emitToRooms(
    io,
    [
      WORKFLOW_DASHBOARD_ROOM,
      payload.batchId ? buildWorkflowBatchRoom(payload.batchId) : "",
    ],
    WORKFLOW_EVENTS.batchUpdated,
    payload,
  );

  return payload;
};

const emitWorkflowCommentAdded = (
  reqOrIo,
  comment,
  task,
  {
    message = "",
    additionalUserIds = [],
  } = {},
) => {
  const io = resolveIo(reqOrIo);
  if (!io || !comment || !task) return null;

  const payload = buildCommentEventPayload({
    comment,
    task,
    message,
  });

  emitToRooms(
    io,
    [
      WORKFLOW_DASHBOARD_ROOM,
      payload.batchId ? buildWorkflowBatchRoom(payload.batchId) : "",
      ...extractAssignedUserIds(task?.assigned_to, additionalUserIds).map(
        buildWorkflowUserRoom,
      ),
    ],
    WORKFLOW_EVENTS.commentAdded,
    payload,
  );

  return payload;
};

module.exports = {
  WORKFLOW_EVENTS,
  emitWorkflowBatchUpdated,
  emitWorkflowCommentAdded,
  emitWorkflowTaskUpdated,
  extractAssignedUserIds,
  resolveIo,
};
