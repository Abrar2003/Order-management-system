const {
  buildWorkflowBatchRoom,
  buildWorkflowUserRoom,
  WORKFLOW_DASHBOARD_ROOM,
} = require("../../realtime/workflowSocket");
const {
  normalizeWorkflowTaskStatus,
} = require("../../helpers/workflow");

const WORKFLOW_EVENTS = Object.freeze({
  taskCreated: "workflow:task_created",
  taskUpdated: "workflow:task_updated",
  taskDeleted: "workflow:task_deleted",
  batchUpdated: "workflow:batch_updated",
  commentAdded: "workflow:comment_added",
  forceRefetch: "workflow:force_refetch",
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

const uniqueIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean))];

const extractAssignedUserIds = (assignedTo = [], extraUserIds = []) =>
  uniqueIds([
    ...(Array.isArray(assignedTo) ? assignedTo : []),
    ...(Array.isArray(extraUserIds) ? extraUserIds : []),
  ].map(extractUserId));

const extractTaskAudienceUserIds = (task = {}, extraUserIds = []) =>
  uniqueIds([
    ...extractAssignedUserIds(task?.assigned_to),
    ...extractAssignedUserIds(task?.upload_assignees),
    extractUserId(task?.assigned_by),
    extractUserId(task?.created_by),
    ...(Array.isArray(extraUserIds) ? extraUserIds : []),
  ]);

const normalizeCounts = (counts = {}) =>
  Object.entries(counts || {}).reduce((acc, [key, value]) => {
    acc[key] = Number(value || 0);
    return acc;
  }, {});

const emitToRooms = (io, roomNames = [], eventName, payload) => {
  uniqueIds(roomNames).forEach((roomName) => {
    io.to(roomName).emit(eventName, payload);
  });
};

const toUserRefs = (entries = []) =>
  (Array.isArray(entries) ? entries : []).map((entry) => {
    const user = entry?.user || entry;
    return {
      user: user?._id || user?.id || user || null,
      name: user?.name || entry?.name || "",
      email: user?.email || entry?.email || "",
      role: user?.role || entry?.role || "",
    };
  }).filter((entry) => entry.user);

const buildTaskPayload = (task = {}, {
  changedFields = [],
  shouldRefetch = false,
  message = "",
} = {}) => ({
  _id: normalizeText(task?._id),
  task_no: normalizeText(task?.task_no),
  title: normalizeText(task?.title),
  status: normalizeWorkflowTaskStatus(task?.status, { fallback: "assigned" }) || "assigned",
  priority: normalizeText(task?.priority || "normal"),
  due_date: task?.active_due_date || task?.due_date || null,
  assigned_to: toUserRefs(task?.assigned_to),
  upload_assignees: toUserRefs(task?.upload_assignees),
  upload_statuses: Array.isArray(task?.upload_statuses) ? task.upload_statuses : [],
  batch: task?.batch?._id || task?.batch || null,
  batchId: normalizeText(task?.batch?._id || task?.batch),
  batch_no: normalizeText(task?.batch_no || task?.batch?.batch_no),
  task_type_key: normalizeText(task?.task_type_key || task?.task_type?.key),
  task_type_name: normalizeText(task?.task_type_name || task?.task_type?.name),
  brand: normalizeText(task?.brand),
  updatedAt: task?.updatedAt || new Date(),
  changedFields: uniqueIds(changedFields),
  shouldRefetch: Boolean(shouldRefetch),
  message: normalizeText(message),
});

const buildBatchPayload = (batch = {}, {
  changedFields = [],
  shouldRefetch = false,
  message = "",
} = {}) => ({
  _id: normalizeText(batch?._id),
  batchId: normalizeText(batch?._id),
  batch_no: normalizeText(batch?.batch_no),
  name: normalizeText(batch?.name),
  status: normalizeText(batch?.status).toLowerCase(),
  brand: normalizeText(batch?.brand),
  task_type_key: normalizeText(batch?.task_type_key || batch?.task_type?.key),
  task_type_name: normalizeText(batch?.task_type_name || batch?.task_type?.name),
  due_date: batch?.due_date || null,
  counts: normalizeCounts(batch?.counts),
  updatedAt: batch?.updatedAt || new Date(),
  is_deleted: Boolean(batch?.is_deleted),
  changedFields: uniqueIds(changedFields),
  shouldRefetch: Boolean(shouldRefetch),
  message: normalizeText(message),
});

const buildCommentPayload = (comment = {}, task = {}, {
  message = "",
} = {}) => ({
  _id: normalizeText(comment?._id),
  commentId: normalizeText(comment?._id),
  taskId: normalizeText(task?._id || comment?.task?._id || comment?.task),
  batch: task?.batch?._id || task?.batch || comment?.batch?._id || comment?.batch || null,
  batchId: normalizeText(task?.batch?._id || task?.batch || comment?.batch?._id || comment?.batch),
  comment: normalizeText(comment?.comment),
  comment_type: normalizeText(comment?.comment_type).toLowerCase() || "general",
  createdAt: comment?.createdAt || comment?.created_at || new Date(),
  created_by: comment?.created_by || {},
  message: normalizeText(message),
});

const buildTaskRooms = (task = {}, additionalUserIds = []) => {
  const batchId = normalizeText(task?.batch?._id || task?.batch);
  return [
    WORKFLOW_DASHBOARD_ROOM,
    batchId ? buildWorkflowBatchRoom(batchId) : "",
    ...extractTaskAudienceUserIds(task, additionalUserIds).map(buildWorkflowUserRoom),
  ];
};

const emitWorkflowTaskCreated = (reqOrIo, task, options = {}) => {
  const io = resolveIo(reqOrIo);
  if (!io || !task) return null;
  const payload = buildTaskPayload(task, options);
  emitToRooms(io, buildTaskRooms(task, options.additionalUserIds), WORKFLOW_EVENTS.taskCreated, payload);
  return payload;
};

const emitWorkflowTaskUpdated = (reqOrIo, task, _batch = null, options = {}) => {
  const io = resolveIo(reqOrIo);
  if (!io || !task) return null;
  const payload = buildTaskPayload(task, options);
  emitToRooms(io, buildTaskRooms(task, options.additionalUserIds), WORKFLOW_EVENTS.taskUpdated, payload);
  return payload;
};

const emitWorkflowTaskDeleted = (reqOrIo, taskOrTaskId, _batch = null, options = {}) => {
  const io = resolveIo(reqOrIo);
  if (!io || !taskOrTaskId) return null;
  const task = typeof taskOrTaskId === "object" ? taskOrTaskId : { _id: taskOrTaskId };
  const payload = {
    _id: normalizeText(task?._id || taskOrTaskId),
    taskId: normalizeText(task?._id || taskOrTaskId),
    batch: task?.batch || null,
    updatedAt: new Date(),
    changedFields: ["is_deleted"],
    shouldRefetch: Boolean(options.shouldRefetch),
    message: normalizeText(options.message),
  };
  emitToRooms(io, buildTaskRooms(task, options.additionalUserIds), WORKFLOW_EVENTS.taskDeleted, payload);
  return payload;
};

const emitWorkflowBatchUpdated = (reqOrIo, batch, options = {}) => {
  const io = resolveIo(reqOrIo);
  if (!io || !batch) return null;
  const payload = buildBatchPayload(batch, options);
  emitToRooms(
    io,
    [
      WORKFLOW_DASHBOARD_ROOM,
      payload.batchId ? buildWorkflowBatchRoom(payload.batchId) : "",
      ...(Array.isArray(options.additionalUserIds) ? options.additionalUserIds : []).map(buildWorkflowUserRoom),
    ],
    WORKFLOW_EVENTS.batchUpdated,
    payload,
  );
  return payload;
};

const emitWorkflowCommentAdded = (reqOrIo, comment, task, options = {}) => {
  const io = resolveIo(reqOrIo);
  if (!io || !comment || !task) return null;
  const payload = buildCommentPayload(comment, task, options);
  emitToRooms(io, buildTaskRooms(task, options.additionalUserIds), WORKFLOW_EVENTS.commentAdded, payload);
  return payload;
};

const emitWorkflowForceRefetch = (reqOrIo, { batchId = "", userIds = [], reason = "" } = {}) => {
  const io = resolveIo(reqOrIo);
  if (!io) return null;
  const payload = {
    batchId: normalizeText(batchId),
    reason: normalizeText(reason),
    updatedAt: new Date(),
  };
  emitToRooms(
    io,
    [
      WORKFLOW_DASHBOARD_ROOM,
      batchId ? buildWorkflowBatchRoom(batchId) : "",
      ...uniqueIds(userIds).map(buildWorkflowUserRoom),
    ],
    WORKFLOW_EVENTS.forceRefetch,
    payload,
  );
  return payload;
};

module.exports = {
  WORKFLOW_EVENTS,
  buildTaskPayload,
  emitWorkflowBatchUpdated,
  emitWorkflowCommentAdded,
  emitWorkflowForceRefetch,
  emitWorkflowTaskCreated,
  emitWorkflowTaskDeleted,
  emitWorkflowTaskUpdated,
  extractAssignedUserIds,
  extractTaskAudienceUserIds,
  resolveIo,
};
