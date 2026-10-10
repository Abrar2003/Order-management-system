const QC = require("../models/qc.model");
const Order = require("../models/order.model");
const QcEditLog = require("../models/qcEditLog.model");
const OrderEditLog = require("../models/orderEditLog.model");
const User = require("../models/user.model");
const { QcUpdateFollowUp } = require("../models/qcUpdateFollowUp.model");
const { upsertItemFromQc } = require("./itemSync");
const { syncLatestInspectionToItem } = require("./inspectionItemSync.service");
const { applyTotalPoCbmToOrder } = require("./orderCbm.service");
const { notifyUsers } = require("./notificationService");

const MAX_ATTEMPTS = 5;
const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const LEASE_MS = parsePositiveInt(process.env.QC_UPDATE_FOLLOW_UP_LEASE_MS, 5 * 60 * 1000);
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
const normalizeText = (value) => String(value || "").trim();

const retryDelayForAttempt = (attempt) =>
  RETRY_DELAYS_MS[Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, attempt - 1))];

const getDueFollowUp = async (now = new Date()) =>
  QcUpdateFollowUp.findOneAndUpdate(
    {
      $or: [
        { state: { $in: ["pending", "retrying"] }, next_attempt_at: { $lte: now } },
        { state: "running", locked_until: { $lte: now } },
      ],
    },
    {
      $set: { state: "running", locked_until: new Date(now.getTime() + LEASE_MS) },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { next_attempt_at: 1, createdAt: 1 } },
  );

const writeAuditLog = async (Model, payload, followUpId) => {
  if (!payload) return;
  await Model.updateOne(
    { source_follow_up: followUpId },
    { $setOnInsert: { ...payload, source_follow_up: followUpId } },
    { upsert: true },
  );
};

const processFollowUp = async (followUp) => {
  const qc = await QC.findById(followUp.qc);
  if (!qc) return { skipped: "qc_not_found" };

  const actor = followUp.payload?.actor || null;
  const inspectionId = normalizeText(followUp.inspection);
  if (inspectionId) {
    await syncLatestInspectionToItem(inspectionId, {
      user: actor,
      route: "PATCH /qc/update-qc/:id",
      source: "qc_update_follow_up",
    });
  }

  await upsertItemFromQc(qc, {
    user: actor,
    source: "qc_update_follow_up",
    route: "PATCH /qc/update-qc/:id",
  });

  const order = followUp.order ? await Order.findById(followUp.order) : null;
  if (order && followUp.payload?.recalculate_order_cbm) {
    await applyTotalPoCbmToOrder(order);
    await order.save();
  }

  await writeAuditLog(QcEditLog, followUp.payload?.qc_edit_log, followUp._id);
  await writeAuditLog(OrderEditLog, followUp.payload?.order_edit_log, followUp._id);
  return { qc_id: String(qc._id), inspection_id: inspectionId || null };
};

const notifyFailure = async (followUp) => {
  const recipients = await User.find({
    role: { $in: ["admin", "super admin", "inspection manager"] },
  }).select("_id").lean();
  const userIds = recipients.map((user) => user._id);
  if (userIds.length === 0) return;

  await notifyUsers(userIds, {
    type: "qc_update_follow_up_failed",
    title: "QC sync needs attention",
    message: `QC follow-up for ${normalizeText(followUp.payload?.order_id) || "an order"} failed after ${followUp.attempts} attempts.`,
    priority: "high",
    category: "system",
    entity_type: "qc",
    entity_id: followUp.qc,
    deep_link: "/qc?follow_up_state=failed",
    metadata: { dedupe_key: `qc-update-follow-up:${followUp._id}` },
    created_by: followUp.payload?.actor?._id || null,
  });
};

const notifyFailedFollowUp = async (followUp) => {
  await notifyFailure(followUp);
  await QcUpdateFollowUp.updateOne(
    { _id: followUp._id, state: "failed", failure_notified_at: null },
    { $set: { failure_notified_at: new Date() } },
  );
};

const notifyUnnotifiedFailures = async (limit = 2) => {
  const followUps = await QcUpdateFollowUp.find({
    state: "failed",
    failure_notified_at: null,
  }).sort({ failed_at: 1 }).limit(Math.max(1, limit));
  await Promise.all(followUps.map((followUp) =>
    notifyFailedFollowUp(followUp).catch((error) => {
      console.error("QC update failure notification failed:", error?.message || String(error));
    })));
};

const completeFollowUp = (followUp) =>
  QcUpdateFollowUp.updateOne(
    { _id: followUp._id, state: "running" },
    { $set: { state: "completed", completed_at: new Date(), locked_until: null, last_error: "" } },
  );

const failFollowUp = async (followUp, error) => {
  const lastError = normalizeText(error?.message || error).slice(0, 2000);
  const failed = followUp.attempts >= MAX_ATTEMPTS;
  const update = failed
    ? { state: "failed", failed_at: new Date(), locked_until: null, last_error: lastError }
    : {
        state: "retrying",
        locked_until: null,
        last_error: lastError,
        next_attempt_at: new Date(Date.now() + retryDelayForAttempt(followUp.attempts)),
      };
  await QcUpdateFollowUp.updateOne({ _id: followUp._id, state: "running" }, { $set: update });
  if (failed) {
    await notifyFailedFollowUp({ ...followUp.toObject(), ...update }).catch((notificationError) => {
      console.error("QC update failure notification failed:", notificationError?.message || String(notificationError));
    });
  }
};

const runOneFollowUp = async () => {
  const followUp = await getDueFollowUp();
  if (!followUp) return false;
  try {
    await processFollowUp(followUp);
    await completeFollowUp(followUp);
  } catch (error) {
    console.error("QC update follow-up failed:", { id: followUp._id, error: error?.message || String(error) });
    await failFollowUp(followUp, error);
  }
  return true;
};

const listFollowUps = async ({ state = "failed", page = 1, limit = 25 } = {}) => {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
  const match = state ? { state } : {};
  const [rows, total] = await Promise.all([
    QcUpdateFollowUp.find(match).sort({ updatedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    QcUpdateFollowUp.countDocuments(match),
  ]);
  return { rows, pagination: { page: safePage, limit: safeLimit, totalRecords: total, totalPages: Math.max(1, Math.ceil(total / safeLimit)) } };
};

const retryFollowUp = async (id) =>
  QcUpdateFollowUp.findOneAndUpdate(
    { _id: id, state: "failed" },
    { $set: { state: "pending", attempts: 0, next_attempt_at: new Date(), locked_until: null, failed_at: null, failure_notified_at: null, last_error: "" } },
    { new: true },
  );

const startQcUpdateFollowUpWorker = ({ intervalMs = 1000, concurrency = 2 } = {}) => {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await notifyUnnotifiedFailures(Math.max(1, concurrency));
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runOneFollowUp()));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => tick().catch((error) => console.error("QC follow-up worker tick failed:", error)), intervalMs);
  tick().catch((error) => console.error("QC follow-up worker start failed:", error));
  return () => { stopped = true; clearInterval(timer); };
};

module.exports = {
  MAX_ATTEMPTS,
  LEASE_MS,
  RETRY_DELAYS_MS,
  getDueFollowUp,
  listFollowUps,
  notifyUnnotifiedFailures,
  processFollowUp,
  retryDelayForAttempt,
  retryFollowUp,
  runOneFollowUp,
  startQcUpdateFollowUpWorker,
};
