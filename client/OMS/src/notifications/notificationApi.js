import api from "../api/axios";

export const getNotifications = async (params = {}) => {
  const res = await api.get("/notifications", { params });
  return res.data;
};

export const getNotificationSummary = async () => {
  const res = await api.get("/notifications/summary");
  return res.data;
};

export const getNotificationLoginSummary = async () => {
  const res = await api.get("/notifications/login-summary");
  return res.data;
};

export const markNotificationRead = async (id) => {
  const res = await api.patch(`/notifications/${encodeURIComponent(id)}/read`);
  return res.data;
};

export const markAllNotificationsRead = async () => {
  const res = await api.patch("/notifications/read-all");
  return res.data;
};

export const archiveNotification = async (id) => {
  const res = await api.patch(`/notifications/${encodeURIComponent(id)}/archive`);
  return res.data;
};

export const markNotificationPopupSeen = async () => {
  const res = await api.post("/notifications/popup-seen");
  return res.data;
};
