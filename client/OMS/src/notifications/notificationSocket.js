import { connectNotificationSocket as connectSocket } from "../realtime/notificationSocket";

export const connectNotificationSocket = () => {
  return connectSocket();
};

export const leaveNotificationSocket = (socket) => {
  // Keep the authenticated notification room for the socket session so route-level
  // Navbar remounts do not briefly drop live badge/toast delivery.
  void socket;
};
