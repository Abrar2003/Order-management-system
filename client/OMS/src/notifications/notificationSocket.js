import { connectWorkflowSocket } from "../realtime/workflowSocket";

export const connectNotificationSocket = () => {
  const socket = connectWorkflowSocket();
  socket.emit("notification:join_user");
  return socket;
};

export const leaveNotificationSocket = (socket) => {
  // Keep the authenticated notification room for the socket session so route-level
  // Navbar remounts do not briefly drop live badge/toast delivery.
  void socket;
};
