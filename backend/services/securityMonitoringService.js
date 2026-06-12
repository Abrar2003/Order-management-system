const crypto = require("crypto");
const mongoose = require("mongoose");
const SecurityActivityLog = require("../models/securityActivityLog.model");
const UserSecurityBaseline = require("../models/userSecurityBaseline.model");
const {
  SecurityAlert,
} = require("../models/securityAlert.model");

const ALERT_THRESHOLDS = Object.freeze({
  critical: 85,
  high: 60,
  medium: 40,
});

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pwd|token|jwt|secret|cookie|authorization|refresh|access[_-]?token|api[_-]?key|session)/i;
const MAX_METADATA_DEPTH = 4;
const MAX_ARRAY_LENGTH = 25;
const MAX_STRING_LENGTH = 500;

const toCleanString = (value) => String(value ?? "").trim();

const normalizeAction = (value) =>
  toCleanString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const getClientIp = (req = {}) => {
  const forwarded = toCleanString(req.headers?.["x-forwarded-for"]);
  if (forwarded) return toCleanString(forwarded.split(",")[0]);
  return toCleanString(req.ip || req.socket?.remoteAddress || "");
};

const getUserAgent = (req = {}) => toCleanString(req.headers?.["user-agent"]);

const normalizeObjectId = (value) => {
  const raw = toCleanString(value?._id || value?.id || value);
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const hashDevice = (userAgent, ip) =>
  crypto
    .createHash("sha256")
    .update(`${toCleanString(userAgent)}|${toCleanString(ip)}`)
    .digest("hex");

const sanitizeMetadataValue = (value, depth = 0) => {
  if (depth > MAX_METADATA_DEPTH) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeMetadataValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, entry]) => {
      const normalizedKey = toCleanString(key);
      if (!normalizedKey) return acc;
      acc[normalizedKey] = SENSITIVE_KEY_PATTERN.test(normalizedKey)
        ? "[redacted]"
        : sanitizeMetadataValue(entry, depth + 1);
      return acc;
    }, {});
  }
  return toCleanString(value);
};

const sanitizeMetadata = (metadata = {}) => sanitizeMetadataValue(metadata) || {};

const getIstHour = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
  const parsed = Number.parseInt(formatter.format(date), 10);
  return Number.isFinite(parsed) ? parsed : date.getHours();
};

const getSeverityForScore = (score) => {
  if (score >= ALERT_THRESHOLDS.critical) return "critical";
  if (score >= ALERT_THRESHOLDS.high) return "high";
  if (score >= ALERT_THRESHOLDS.medium) return "medium";
  return "";
};

const getReason = (label, points) => `${label} (+${points})`;

const calculateRiskScore = async (req = {}, actionInput = "", metadataInput = {}) => {
  const action = normalizeAction(actionInput);
  const metadata = sanitizeMetadata(metadataInput);
  const userId = normalizeObjectId(metadata.user_id || req.user?._id);
  const username =
    toCleanString(metadata.username) ||
    toCleanString(req.user?.username || req.body?.username).toLowerCase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const deviceHash = hashDevice(userAgent, ip);
  const reasons = [];
  let score = 0;

  const addRisk = (label, points) => {
    score += points;
    reasons.push(getReason(label, points));
  };

  const baseline = userId
    ? await UserSecurityBaseline.findOne({ user: userId }).lean()
    : null;

  if (baseline) {
    const knownIps = new Set((baseline.top_ips || []).map((entry) => entry.value));
    const knownDevices = new Set((baseline.top_devices || []).map((entry) => entry.value));
    const commonHours = new Set((baseline.common_hours || []).map((hour) => Number(hour)));

    if (ip && !knownIps.has(ip)) addRisk("New IP address", 20);
    if (deviceHash && !knownDevices.has(deviceHash)) addRisk("New device", 20);
    if (commonHours.size > 0 && !commonHours.has(getIstHour())) {
      addRisk("Activity outside common hours", 15);
    }

    const rows = Number(metadata.rows || 0);
    const records = Number(metadata.records || 0);
    const avgDailyExports = Number(baseline.avg_daily_exports || 0);
    const avgDailyViews = Number(baseline.avg_daily_views || 0);

    if (rows > avgDailyExports * 10) {
      addRisk("Export volume exceeds baseline", 40);
    }
    if (records > avgDailyViews * 10) {
      addRisk("View volume exceeds baseline", 30);
    }
  }

  if (action === "export_excel") addRisk("Excel export", 20);
  if (action === "download_file") addRisk("File download", 15);

  const roleKey = toCleanString(req.user?.role || metadata.role)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    ["admin", "super_admin"].includes(roleKey) &&
    baseline &&
    deviceHash &&
    !(baseline.top_devices || []).some((entry) => entry.value === deviceHash)
  ) {
    addRisk("Admin action from new device", 40);
  }

  if (action === "login_failed") {
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const match = {
      action: "login_failed",
      created_at: { $gte: since },
      $or: [
        ...(userId ? [{ user: userId }] : []),
        ...(username ? [{ username }] : []),
        ...(ip ? [{ ip }] : []),
        ...(deviceHash ? [{ device_hash: deviceHash }] : []),
      ],
    };
    if (match.$or.length > 0) {
      const recentFailures = await SecurityActivityLog.countDocuments(match);
      if (recentFailures + 1 > 5) {
        addRisk("More than 5 failed logins in 15 minutes", 50);
      }
    }
  }

  return {
    score,
    reasons,
    ip,
    user_agent: userAgent,
    device_hash: deviceHash,
    user_id: userId,
    username,
    metadata,
  };
};

const createSecurityAlertIfNeeded = async (req, activityLog, score, reasons = []) => {
  const severity = getSeverityForScore(Number(score || 0));
  if (!severity || !activityLog?._id) return null;

  return SecurityAlert.create({
    user: activityLog.user || null,
    activity_log: activityLog._id,
    severity,
    score,
    reasons,
    status: "open",
    status_history: [
      {
        status: "open",
        note: "Security alert created automatically.",
        changed_by: null,
      },
    ],
  });
};

const logSecurityActivity = async (
  req = {},
  { action, resource_type: resourceType, resource_id: resourceId, metadata = {} } = {},
) => {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return null;

  const risk = await calculateRiskScore(req, normalizedAction, metadata);
  const activityLog = await SecurityActivityLog.create({
    user: risk.user_id,
    username: risk.username,
    action: normalizedAction,
    resource_type: normalizeAction(resourceType),
    resource_id: toCleanString(resourceId || metadata.resource_id),
    ip: risk.ip,
    user_agent: risk.user_agent,
    device_hash: risk.device_hash,
    metadata: risk.metadata,
    risk_score: risk.score,
    risk_reasons: risk.reasons,
  });

  await createSecurityAlertIfNeeded(req, activityLog, risk.score, risk.reasons);
  return activityLog;
};

const topEntries = (rows = [], field = "") => {
  const counts = new Map();
  rows.forEach((row) => {
    const value = toCleanString(row?.[field]);
    if (!value) return;
    counts.set(value, Number(counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));
};

const calculateDailyAverage = (rows = [], metricKey = "") => {
  const totalsByDay = new Map();
  rows.forEach((row) => {
    const dateKey = row.created_at?.toISOString?.().slice(0, 10);
    if (!dateKey) return;
    const metadata = row.metadata || {};
    const value = Number(metadata[metricKey] || 1);
    totalsByDay.set(dateKey, Number(totalsByDay.get(dateKey) || 0) + (Number.isFinite(value) ? value : 1));
  });
  if (totalsByDay.size === 0) return 0;
  const total = [...totalsByDay.values()].reduce((sum, value) => sum + value, 0);
  return Number((total / totalsByDay.size).toFixed(2));
};

const recalculateUserBaseline = async (userId, { windowDays = 30 } = {}) => {
  const normalizedUserId = normalizeObjectId(userId);
  if (!normalizedUserId) {
    throw new Error("Invalid user id");
  }

  const calculatedTo = new Date();
  const calculatedFrom = new Date(calculatedTo.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await SecurityActivityLog.find({
    user: normalizedUserId,
    created_at: { $gte: calculatedFrom, $lte: calculatedTo },
  }).lean();

  const hourCounts = new Map();
  rows.forEach((row) => {
    const hour = getIstHour(row.created_at || new Date());
    hourCounts.set(hour, Number(hourCounts.get(hour) || 0) + 1);
  });
  const commonHours = [...hourCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([hour]) => hour)
    .sort((left, right) => left - right);

  const exportRows = rows.filter((row) => row.action === "export_excel");
  const viewRows = rows.filter((row) => row.action === "view");

  return UserSecurityBaseline.findOneAndUpdate(
    { user: normalizedUserId },
    {
      $set: {
        top_ips: topEntries(rows, "ip"),
        top_devices: topEntries(rows, "device_hash"),
        common_hours: commonHours,
        avg_daily_exports: calculateDailyAverage(exportRows, "rows"),
        avg_daily_views: calculateDailyAverage(viewRows, "records"),
        window_days: windowDays,
        calculated_from: calculatedFrom,
        calculated_to: calculatedTo,
        last_recalculated_at: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

const recalculateAllUserBaselines = async () => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const userIds = await SecurityActivityLog.distinct("user", {
    user: { $ne: null },
    created_at: { $gte: since },
  });

  const results = {
    total: userIds.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const userId of userIds) {
    try {
      await recalculateUserBaseline(userId);
      results.succeeded += 1;
    } catch (error) {
      results.failed += 1;
      results.errors.push({
        user: toCleanString(userId),
        message: error?.message || String(error),
      });
      console.warn("[security] baseline recalculation failed", {
        user: toCleanString(userId),
        message: error?.message || String(error),
      });
    }
  }

  return results;
};

module.exports = {
  calculateRiskScore,
  createSecurityAlertIfNeeded,
  hashDevice,
  logSecurityActivity,
  recalculateAllUserBaselines,
  recalculateUserBaseline,
  sanitizeMetadata,
};
