const mongoose = require("mongoose");
const { Server } = require("socket.io");
const User = require("../models/user.model");
const {
  ACCESS_COOKIE_NAME,
  getCookie,
  verifyAccessToken,
} = require("../services/authToken.service");

const normalizeText = (value) => String(value || "").trim();
const buildNotificationUserRoom = (userId) =>
  `notification:user:${normalizeText(userId)}`;

const getSocketToken = (socket = {}) => {
  const cookieToken = normalizeText(
    getCookie({ headers: { cookie: socket?.handshake?.headers?.cookie || "" } }, ACCESS_COOKIE_NAME),
  );
  if (cookieToken) return cookieToken;

  const authToken = normalizeText(socket?.handshake?.auth?.token);
  if (authToken) return authToken;

  const authorizationHeader = normalizeText(socket?.handshake?.headers?.authorization);
  return authorizationHeader.toLowerCase().startsWith("bearer ")
    ? normalizeText(authorizationHeader.slice("bearer ".length))
    : "";
};

const authenticateSocketUser = async (socket = {}) => {
  if (!normalizeText(process.env.JWT_SECRET)) {
    throw new Error("Socket authentication is not configured");
  }

  const decoded = verifyAccessToken(getSocketToken(socket));
  const userId = normalizeText(decoded?.id || decoded?._id || decoded?.sub);
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Socket token is invalid");
  }

  const user = await User.findById(userId).select("-password").lean();
  if (!user) throw new Error("Socket user was not found");
  return user;
};

const createNotificationSocketServer = ({
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

  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocketUser(socket);
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
  });

  return io;
};

module.exports = {
  buildNotificationUserRoom,
  createNotificationSocketServer,
};
