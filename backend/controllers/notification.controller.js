const {
  archiveNotification,
  getLoginSummary,
  getNotificationSummary,
  listNotifications,
  markAllAsRead,
  markAsRead,
  markPopupSeen,
} = require("../services/notificationService");

const getErrorStatusCode = (error = {}) => {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not found")) return 404;
  if (message.includes("invalid")) return 400;
  return 500;
};

const getNotifications = async (req, res) => {
  try {
    const result = await listNotifications(req.user?._id, req.query || {});
    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Get Notifications Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch notifications",
    });
  }
};

const getSummary = async (req, res) => {
  try {
    const data = await getNotificationSummary(req.user?._id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Get Notification Summary Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch notification summary",
    });
  }
};

const getLoginPopupSummary = async (req, res) => {
  try {
    const data = await getLoginSummary(req.user);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Get Notification Login Summary Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch notification login summary",
    });
  }
};

const patchRead = async (req, res) => {
  try {
    const data = await markAsRead(req.user?._id, req.params.id, req);
    if (!data) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Mark Notification Read Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to mark notification read",
    });
  }
};

const patchReadAll = async (req, res) => {
  try {
    const unreadCount = await markAllAsRead(req.user?._id, req);
    return res.status(200).json({ success: true, data: { unreadCount } });
  } catch (error) {
    console.error("Mark All Notifications Read Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to mark notifications read",
    });
  }
};

const patchArchive = async (req, res) => {
  try {
    const data = await archiveNotification(req.user?._id, req.params.id, req);
    if (!data) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Archive Notification Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to archive notification",
    });
  }
};

const postPopupSeen = async (req, res) => {
  try {
    const data = await markPopupSeen(req.user?._id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Notification Popup Seen Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to save popup state",
    });
  }
};

module.exports = {
  getLoginPopupSummary,
  getNotifications,
  getSummary,
  patchArchive,
  patchRead,
  patchReadAll,
  postPopupSeen,
};
