import { io } from "socket.io-client";

const normalizeText = (value) => String(value || "").trim();

const resolveSocketBaseUrl = () => {
  const configuredSocketUrl = normalizeText(import.meta.env.VITE_NOTIFICATION_SOCKET_BASE_URL);
  if (configuredSocketUrl) return configuredSocketUrl;

  const apiBaseUrl = normalizeText(import.meta.env.VITE_API_BASE_URL);
  if (/^https?:\/\//i.test(apiBaseUrl)) {
    const parsedUrl = new URL(apiBaseUrl);
    return `${parsedUrl.protocol}//${parsedUrl.host}`;
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname, origin, port } = window.location;
    if (apiBaseUrl.startsWith("/") && ["localhost", "127.0.0.1"].includes(hostname) && ["5173", "5174"].includes(port)) {
      return `${protocol}//${hostname}:8008`;
    }
    return origin;
  }

  return apiBaseUrl || "";
};

let notificationSocket = null;

export const reconnectNotificationSocket = () => notificationSocket?.disconnect().connect();
export const disconnectNotificationSocket = () => notificationSocket?.disconnect();

export const connectNotificationSocket = () => {
  if (!notificationSocket) {
    notificationSocket = io(resolveSocketBaseUrl(), {
      autoConnect: false,
      withCredentials: true,
      // A single WebSocket works across PM2 workers without polling session affinity.
      transports: ["websocket"],
      reconnection: true,
      timeout: 10000,
    });
  }
  if (!notificationSocket.connected) notificationSocket.connect();
  return notificationSocket;
};
