const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const User = require("../models/user.model");
const { Task } = require("../models/workflow");
const { userHasPermission } = require("../services/permission.service");
const {
  isPrivilegedWorkflowReader,
} = require("../services/workflow/workflowPermissionService");

const WORKFLOW_DASHBOARD_ROOM = "workflow:dashboard";

const normalizeText = (value) => String(value || "").trim();

const buildWorkflowBatchRoom = (batchId) =>
  `workflow:batch:${normalizeText(batchId)}`;

const buildWorkflowUserRoom = (userId) =>
  `workflow:user:${normalizeText(userId)}`;

const buildNotificationUserRoom = (userId) =>
  `notification:user:${normalizeText(userId)}`;

const getSocketToken = (socket = {}) => {
  const authToken = normalizeText(socket?.handshake?.auth?.token);
  if (authToken) return authToken;

  const authorizationHeader = normalizeText(socket?.handshake?.headers?.authorization);
  if (authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return normalizeText(authorizationHeader.slice("bearer ".length));
  }

  return "";
};

const authenticateSocketUser = async (socket = {}) => {
  const jwtSecret = normalizeText(process.env.JWT_SECRET);
  if (!jwtSecret) {
    throw new Error("Socket authentication is not configured");
  }

  const token = getSocketToken(socket);
  if (!token) {
    throw new Error("Socket token is required");
  }

  const decoded = jwt.verify(token, jwtSecret);
  const userId = normalizeText(decoded?.id || decoded?._id || decoded?.sub);
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Socket token is invalid");
  }

  const user = await User.findById(userId).select("-password").lean();
  if (!user) {
    throw new Error("Socket user was not found");
  }

  return user;
};

const hasWorkflowView = (user = {}) => userHasPermission(user, "workflow", "view");

const canJoinWorkflowDashboard = async (user = {}) =>
  Boolean(await hasWorkflowView(user)) && isPrivilegedWorkflowReader(user);

const canJoinWorkflowBatch = async (user = {}, batchId = "") => {
  if (!mongoose.Types.ObjectId.isValid(batchId)) return false;
  if (!(await hasWorkflowView(user))) return false;
  if (isPrivilegedWorkflowReader(user)) return true;

  const userId = user?._id || user?.id || null;
  const accessibleTask = await Task.exists({
    batch: batchId,
    is_deleted: false,
    $or: [
      { "assigned_to.user": userId },
      { "upload_assignees.user": userId },
      { "assigned_by.user": userId },
      { "created_by.user": userId },
    ],
  });

  return Boolean(accessibleTask);
};

const canJoinWorkflowUserRoom = async (user = {}, targetUserId = "") => {
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) return false;
  if (!(await hasWorkflowView(user))) return false;

  const socketUserId = normalizeText(user?._id || user?.id);
  if (socketUserId && socketUserId === normalizeText(targetUserId)) return true;
  return isPrivilegedWorkflowReader(user);
};

const acknowledgeResult = (acknowledge, payload) => {
  if (typeof acknowledge === "function") {
    acknowledge(payload);
  }
};

const registerWorkflowRealtimeHandlers = (io) => {
  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocketUser(socket);
      socket.data.user = user;
      socket.data.userId = normalizeText(user?._id);
      next();
    } catch (error) {
      next(error);
    }
  });

  io.on("connection", (socket) => {
    if (socket.data.userId) {
      socket.join(buildNotificationUserRoom(socket.data.userId));
    }

    socket.on("workflow:join_dashboard", async (acknowledge) => {
      try {
        if (!(await canJoinWorkflowDashboard(socket.data.user))) {
          acknowledgeResult(acknowledge, { success: false, message: "Dashboard access denied" });
          return;
        }

        socket.join(WORKFLOW_DASHBOARD_ROOM);
        acknowledgeResult(acknowledge, { success: true });
      } catch (error) {
        console.error("workflow:join_dashboard failed:", error);
        acknowledgeResult(acknowledge, { success: false, message: "Failed to join dashboard" });
      }
    });

    socket.on("workflow:leave_dashboard", (acknowledge) => {
      socket.leave(WORKFLOW_DASHBOARD_ROOM);
      acknowledgeResult(acknowledge, { success: true });
    });

    socket.on("workflow:join_batch", async (batchId, acknowledge) => {
      try {
        const normalizedBatchId = normalizeText(batchId);
        if (!(await canJoinWorkflowBatch(socket.data.user, normalizedBatchId))) {
          acknowledgeResult(acknowledge, { success: false, message: "Batch access denied" });
          return;
        }

        socket.join(buildWorkflowBatchRoom(normalizedBatchId));
        acknowledgeResult(acknowledge, { success: true });
      } catch (error) {
        console.error("workflow:join_batch failed:", error);
        acknowledgeResult(acknowledge, { success: false, message: "Failed to join batch" });
      }
    });

    socket.on("workflow:leave_batch", (batchId, acknowledge) => {
      const normalizedBatchId = normalizeText(batchId);
      if (normalizedBatchId) {
        socket.leave(buildWorkflowBatchRoom(normalizedBatchId));
      }
      acknowledgeResult(acknowledge, { success: true });
    });

    socket.on("workflow:join_user", async (userId, acknowledge) => {
      try {
        const normalizedUserId = normalizeText(userId);
        if (!(await canJoinWorkflowUserRoom(socket.data.user, normalizedUserId))) {
          acknowledgeResult(acknowledge, { success: false, message: "User room access denied" });
          return;
        }

        socket.join(buildWorkflowUserRoom(normalizedUserId));
        acknowledgeResult(acknowledge, { success: true });
      } catch (error) {
        console.error("workflow:join_user failed:", error);
        acknowledgeResult(acknowledge, { success: false, message: "Failed to join user room" });
      }
    });

    socket.on("workflow:leave_user", (userId, acknowledge) => {
      const normalizedUserId = normalizeText(userId);
      if (normalizedUserId) {
        socket.leave(buildWorkflowUserRoom(normalizedUserId));
      }
      acknowledgeResult(acknowledge, { success: true });
    });

    socket.on("notification:join_user", async (acknowledge) => {
      try {
        const userId = normalizeText(socket.data.userId);
        if (!userId) {
          acknowledgeResult(acknowledge, { success: false, message: "User room access denied" });
          return;
        }
        socket.join(buildNotificationUserRoom(userId));
        acknowledgeResult(acknowledge, { success: true });
      } catch (error) {
        console.error("notification:join_user failed:", error);
        acknowledgeResult(acknowledge, { success: false, message: "Failed to join notification room" });
      }
    });

    socket.on("notification:leave_user", (acknowledge) => {
      const userId = normalizeText(socket.data.userId);
      if (userId) {
        socket.leave(buildNotificationUserRoom(userId));
      }
      acknowledgeResult(acknowledge, { success: true });
    });
  });
};

const createWorkflowSocketServer = ({
  server,
  allowedOrigins = [],
  allowCredentials = false,
} = {}) => {
  const io = new Server(server, {
    cors: {
      origin: Array.isArray(allowedOrigins) ? allowedOrigins : [],
      methods: ["GET", "POST"],
      credentials: Boolean(allowCredentials),
    },
  });

  registerWorkflowRealtimeHandlers(io);
  return io;
};

module.exports = {
  WORKFLOW_DASHBOARD_ROOM,
  buildNotificationUserRoom,
  buildWorkflowBatchRoom,
  buildWorkflowUserRoom,
  createWorkflowSocketServer,
};
