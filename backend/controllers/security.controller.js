const mongoose = require("mongoose");
const SecurityActivityLog = require("../models/securityActivityLog.model");
const UserSecurityBaseline = require("../models/userSecurityBaseline.model");
const {
  SecurityAlert,
  SECURITY_ALERT_STATUSES,
} = require("../models/securityAlert.model");
const {
  recalculateUserBaseline,
} = require("../services/securityMonitoringService");

const toCleanString = (value) => String(value ?? "").trim();
const toPositiveInt = (value, fallback, max = 200) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const parseDate = (value, endOfDay = false) => {
  const raw = toCleanString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
};

const addDateRange = (match, from, to) => {
  const start = parseDate(from);
  const end = parseDate(to, true);
  if (!start && !end) return;
  match.created_at = {};
  if (start) match.created_at.$gte = start;
  if (end) match.created_at.$lte = end;
};

const normalizeObjectId = (value) => {
  const raw = toCleanString(value);
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const getPagination = (query = {}) => {
  const page = toPositiveInt(query.page, 1, 100000);
  const limit = toPositiveInt(query.limit, 25, 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const buildPaginationPayload = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

const userPopulate = { path: "user", select: "name username email role" };

const getSecuritySummary = async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      openAlerts,
      highCriticalOpenAlerts,
      recentActivity,
      topRiskyUsers,
      recentAlerts,
    ] = await Promise.all([
      SecurityAlert.countDocuments({ status: "open" }),
      SecurityAlert.countDocuments({
        status: "open",
        severity: { $in: ["high", "critical"] },
      }),
      SecurityActivityLog.countDocuments({ created_at: { $gte: since24h } }),
      SecurityActivityLog.aggregate([
        { $match: { created_at: { $gte: since24h }, user: { $ne: null } } },
        {
          $group: {
            _id: "$user",
            total_score: { $sum: "$risk_score" },
            max_score: { $max: "$risk_score" },
            activity_count: { $sum: 1 },
          },
        },
        { $sort: { total_score: -1, max_score: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            user: {
              _id: "$user._id",
              name: "$user.name",
              username: "$user.username",
              email: "$user.email",
              role: "$user.role",
            },
            total_score: 1,
            max_score: 1,
            activity_count: 1,
          },
        },
      ]),
      SecurityAlert.find({})
        .sort({ created_at: -1 })
        .limit(5)
        .populate(userPopulate)
        .lean(),
    ]);

    return res.json({
      success: true,
      data: {
        open_alerts: openAlerts,
        high_critical_open_alerts: highCriticalOpenAlerts,
        activity_last_24h: recentActivity,
        top_risky_users: topRiskyUsers,
        recent_alerts: recentAlerts,
      },
    });
  } catch (error) {
    console.error("Security summary error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch security summary" });
  }
};

const getAlerts = async (req, res) => {
  try {
    const match = {};
    const status = toCleanString(req.query.status).toLowerCase();
    const severity = toCleanString(req.query.severity).toLowerCase();
    const userId = normalizeObjectId(req.query.user);
    if (status) match.status = status;
    if (severity) match.severity = severity;
    if (userId) match.user = userId;
    addDateRange(match, req.query.from, req.query.to);

    const { page, limit, skip } = getPagination(req.query);
    const [rows, total] = await Promise.all([
      SecurityAlert.find(match)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate(userPopulate)
        .populate({ path: "activity_log" })
        .lean(),
      SecurityAlert.countDocuments(match),
    ]);

    return res.json({
      success: true,
      data: rows,
      pagination: buildPaginationPayload(page, limit, total),
    });
  } catch (error) {
    console.error("Security alerts error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch security alerts" });
  }
};

const getAlertById = async (req, res) => {
  try {
    const alertId = normalizeObjectId(req.params.id);
    if (!alertId) return res.status(400).json({ success: false, message: "Invalid alert id" });

    const alert = await SecurityAlert.findById(alertId)
      .populate(userPopulate)
      .populate({ path: "activity_log" })
      .populate({ path: "status_history.changed_by", select: "name username email role" })
      .lean();
    if (!alert) return res.status(404).json({ success: false, message: "Security alert not found" });

    return res.json({ success: true, data: alert });
  } catch (error) {
    console.error("Security alert detail error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch security alert" });
  }
};

const patchAlertStatus = async (req, res) => {
  try {
    const alertId = normalizeObjectId(req.params.id);
    if (!alertId) return res.status(400).json({ success: false, message: "Invalid alert id" });

    const status = toCleanString(req.body?.status).toLowerCase();
    const note = toCleanString(req.body?.note);
    if (!SECURITY_ALERT_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid alert status" });
    }

    const update = {
      $set: {
        status,
        notes: note,
      },
      $push: {
        status_history: {
          status,
          note,
          changed_by: req.user?._id || null,
          changed_at: new Date(),
        },
      },
    };
    if (status === "resolved" || status === "dismissed") {
      update.$set.resolved_by = req.user?._id || null;
      update.$set.resolved_at = new Date();
    } else {
      update.$set.resolved_by = null;
      update.$set.resolved_at = null;
    }

    const alert = await SecurityAlert.findByIdAndUpdate(alertId, update, { new: true })
      .populate(userPopulate)
      .populate({ path: "activity_log" })
      .lean();
    if (!alert) return res.status(404).json({ success: false, message: "Security alert not found" });

    return res.json({ success: true, data: alert });
  } catch (error) {
    console.error("Security alert status error:", error);
    return res.status(500).json({ success: false, message: "Failed to update security alert" });
  }
};

const getActivity = async (req, res) => {
  try {
    const match = {};
    const userId = normalizeObjectId(req.query.user);
    const action = toCleanString(req.query.action).toLowerCase();
    const resourceType = toCleanString(req.query.resource_type).toLowerCase();
    const minRiskScore = Number(req.query.min_risk_score);
    if (userId) match.user = userId;
    if (action) match.action = action;
    if (resourceType) match.resource_type = resourceType;
    if (Number.isFinite(minRiskScore)) match.risk_score = { $gte: minRiskScore };
    addDateRange(match, req.query.from, req.query.to);

    const { page, limit, skip } = getPagination(req.query);
    const [rows, total] = await Promise.all([
      SecurityActivityLog.find(match)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate(userPopulate)
        .lean(),
      SecurityActivityLog.countDocuments(match),
    ]);

    return res.json({
      success: true,
      data: rows,
      pagination: buildPaginationPayload(page, limit, total),
    });
  } catch (error) {
    console.error("Security activity error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch security activity" });
  }
};

const getUserBaseline = async (req, res) => {
  try {
    const userId = normalizeObjectId(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid user id" });
    const baseline = await UserSecurityBaseline.findOne({ user: userId })
      .populate(userPopulate)
      .lean();
    return res.json({ success: true, data: baseline });
  } catch (error) {
    console.error("Security baseline error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch user baseline" });
  }
};

const postRecalculateUserBaseline = async (req, res) => {
  try {
    const baseline = await recalculateUserBaseline(req.params.userId);
    return res.json({ success: true, data: baseline });
  } catch (error) {
    console.error("Security baseline recalculation error:", error);
    const status = String(error?.message || "").includes("Invalid") ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: error?.message || "Failed to recalculate user baseline",
    });
  }
};

module.exports = {
  getActivity,
  getAlertById,
  getAlerts,
  getSecuritySummary,
  getUserBaseline,
  patchAlertStatus,
  postRecalculateUserBaseline,
};
