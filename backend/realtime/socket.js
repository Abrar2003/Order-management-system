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

const getSocketToken = (socket = {}) => {
  const authToken = normalizeText(socket?.handshake?.auth?.token);
  if (authToken) return authToken;

  const authorizationHeader = normalizeText(
    socket?.handshake?.headers?.authorization,
  );
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

const canJoinWorkflowDashboard = async (user = {}) =>
  userHasPermission(user, "workflow", "view");

const canJoinWorkflowBatch = async (user = {}, batchId = "") => {
  if (!mongoose.Types.ObjectId.isValid(batchId)) {
    return false;
  }

  if (!(await userHasPermission(user, "workflow", "view"))) {
    return false;
  }

  if (isPrivilegedWorkflowReader(user)) {
    return true;
  }

  const accessibleTask = await Task.exists({
    batch: batchId,
    is_deleted: false,
    "assigned_to.user": user?._id || null,
  });

  return Boolean(accessibleTask);
};

const canJoinWorkflowUserRoom = async (user = {}, targetUserId = "") => {
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return false;
  }

  if (!(await userHasPermission(user, "workflow", "view"))) {
    return false;
  }

  const normalizedUserId = normalizeText(user?._id);
  if (normalizedUserId && normalizedUserId === normalizeText(targetUserId)) {
    return true;
  }

  return isPrivilegedWorkflowReader(user);
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
    socket.on("workflow:join_dashboard", async (acknowledge) => {
      try {
        const allowed = await canJoinWorkflowDashboard(socket.data.user);
        if (!allowed) {
          acknowledge?.({ success: false, message: "Workflow access is required" });
          return;
        }

        socket.join(WORKFLOW_DASHBOARD_ROOM);
        acknowledge?.({ success: true });
      } catch (error) {
        console.error("workflow:join_dashboard failed:", error);
        acknowledge?.({ success: false, message: "Failed to join workflow dashboard" });
      }
    });

    socket.on("workflow:join_batch", async (batchId, acknowledge) => {
      try {
        const normalizedBatchId = normalizeText(batchId);
        const allowed = await canJoinWorkflowBatch(
          socket.data.user,
          normalizedBatchId,
        );
        if (!allowed) {
          acknowledge?.({ success: false, message: "Batch access denied" });
          return;
        }

        socket.join(buildWorkflowBatchRoom(normalizedBatchId));
        acknowledge?.({ success: true });
      } catch (error) {
        console.error("workflow:join_batch failed:", error);
        acknowledge?.({ success: false, message: "Failed to join workflow batch" });
      }
    });

    socket.on("workflow:leave_batch", (batchId, acknowledge) => {
      const normalizedBatchId = normalizeText(batchId);
      if (normalizedBatchId) {
        socket.leave(buildWorkflowBatchRoom(normalizedBatchId));
      }
      acknowledge?.({ success: true });
    });

    socket.on("workflow:join_user", async (userId, acknowledge) => {
      try {
        const normalizedUserId = normalizeText(userId);
        const allowed = await canJoinWorkflowUserRoom(
          socket.data.user,
          normalizedUserId,
        );
        if (!allowed) {
          acknowledge?.({ success: false, message: "User room access denied" });
          return;
        }

        socket.join(buildWorkflowUserRoom(normalizedUserId));
        acknowledge?.({ success: true });
      } catch (error) {
        console.error("workflow:join_user failed:", error);
        acknowledge?.({ success: false, message: "Failed to join workflow user room" });
      }
    });
  });
};

const createSocketServer = ({
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
  buildWorkflowBatchRoom,
  buildWorkflowUserRoom,
  createSocketServer,
};
