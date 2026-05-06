import { io } from "socket.io-client";
import { getToken } from "../auth/auth.service";

const normalizeText = (value) => String(value || "").trim();

const resolveSocketBaseUrl = () => {
  const configuredSocketUrl = normalizeText(import.meta.env.VITE_SOCKET_BASE_URL);
  if (configuredSocketUrl) {
    return configuredSocketUrl;
  }

  const apiBaseUrl = normalizeText(import.meta.env.VITE_API_BASE_URL);
  if (/^https?:\/\//i.test(apiBaseUrl)) {
    const parsedUrl = new URL(apiBaseUrl);
    return `${parsedUrl.protocol}//${parsedUrl.host}`;
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, origin, port } = window.location;
    if (apiBaseUrl.startsWith("/")) {
      if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "5173") {
        return `${protocol}//${hostname}:8008`;
      }
      return origin;
    }

    return origin;
  }

  return apiBaseUrl || "";
};

let workflowSocket = null;

export const getWorkflowSocket = () => {
  if (!workflowSocket) {
    workflowSocket = io(resolveSocketBaseUrl(), {
      autoConnect: false,
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      timeout: 10000,
    });
  }

  return workflowSocket;
};

export const connectWorkflowSocket = () => {
  const socket = getWorkflowSocket();
  socket.auth = {
    token: getToken(),
  };

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
};

export const disconnectWorkflowSocket = () => {
  if (workflowSocket) {
    workflowSocket.disconnect();
  }
};
