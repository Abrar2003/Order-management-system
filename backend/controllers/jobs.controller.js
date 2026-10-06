const { getQueueIfAvailable, getQueueNames } = require("../queues");
const {
  listFollowUps,
  retryFollowUp,
} = require("../services/qcUpdateFollowUp.service");
const { normalizeUserRoleKey } = require("../helpers/userRole");

const QC_FOLLOW_UP_ROLE_KEYS = new Set(["admin", "super_admin", "inspection_manager"]);

const SENSITIVE_RESULT_KEYS = new Set([
  "path",
  "filepath",
  "file_path",
  "tempfilepath",
  "temp_file_path",
  "buffer",
  "password",
  "secret",
  "token",
  "authorization",
  "key",
  "storagekey",
  "storage_key",
]);

const normalizeText = (value) => String(value ?? "").trim();

const sanitizeMessage = (value = "") =>
  normalizeText(value)
    .replace(/\/(?:[^/\s"'`]+\/)+[^/\s"'`]+/g, "[path]")
    .replace(/[A-Za-z]:\\(?:[^\\\s"'`]+\\)+[^\\\s"'`]+/g, "[path]");

const sanitizeForResponse = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForResponse(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (SENSITIVE_RESULT_KEYS.has(normalizedKey)) {
      return accumulator;
    }
    accumulator[key] = sanitizeForResponse(entryValue);
    return accumulator;
  }, {});
};

const resolveQueue = async (queueName) => {
  const queue = await getQueueIfAvailable(queueName);
  if (!queue) {
    const error = new Error("Queue is not available");
    error.statusCode = 404;
    throw error;
  }
  return queue;
};

const canManageQcFollowUps = (user) =>
  QC_FOLLOW_UP_ROLE_KEYS.has(normalizeUserRoleKey(user?.role));

exports.listQcUpdateFollowUps = async (req, res) => {
  if (!canManageQcFollowUps(req.user)) {
    return res.status(403).json({ message: "QC sync failures are restricted to admins and inspection managers." });
  }
  try {
    const result = await listFollowUps(req.query || {});
    return res.status(200).json({
      success: true,
      data: result.rows.map((row) => ({
        id: String(row._id),
        qc_id: String(row.qc || ""),
        order_id: row.payload?.order_id || "",
        state: row.state,
        attempts: row.attempts,
        last_error: row.last_error || "",
        next_attempt_at: row.next_attempt_at || null,
        failed_at: row.failed_at || null,
        updated_at: row.updatedAt || null,
      })),
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load QC sync failures" });
  }
};

exports.retryQcUpdateFollowUp = async (req, res) => {
  if (!canManageQcFollowUps(req.user)) {
    return res.status(403).json({ message: "QC sync retries are restricted to admins and inspection managers." });
  }
  try {
    const followUp = await retryFollowUp(req.params.id);
    if (!followUp) return res.status(404).json({ success: false, message: "Failed QC sync not found" });
    return res.status(200).json({
      success: true,
      message: "QC sync retry queued",
      data: { id: String(followUp._id), state: followUp.state },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to retry QC sync" });
  }
};

exports.getJobStatus = async (req, res) => {
  try {
    const queueName = normalizeText(req.params.queueName);
    const jobId = normalizeText(req.params.jobId);
    const queue = await resolveQueue(queueName);
    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
        queues: getQueueNames(),
      });
    }

    const state = await job.getState();

    return res.status(200).json({
      success: true,
      queue: queueName,
      job_id: job.id,
      name: job.name,
      state,
      progress: job.progress,
      attempts_made: job.attemptsMade,
      failed_reason: job.failedReason ? sanitizeMessage(job.failedReason) : null,
      result: sanitizeForResponse(job.returnvalue || null),
      timestamp: job.timestamp,
      processed_on: job.processedOn || null,
      finished_on: job.finishedOn || null,
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to read job status",
      queues: getQueueNames(),
    });
  }
};

exports.getQueueCounts = async (req, res) => {
  try {
    const queueName = normalizeText(req.params.queueName);
    const queue = await resolveQueue(queueName);
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
    );

    return res.status(200).json({
      success: true,
      queue: queueName,
      counts,
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to read queue counts",
      queues: getQueueNames(),
    });
  }
};

exports.retryJob = async (req, res) => {
  try {
    const queueName = normalizeText(req.params.queueName);
    const jobId = normalizeText(req.params.jobId);
    const queue = await resolveQueue(queueName);
    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    const state = await job.getState();
    if (state !== "failed") {
      return res.status(400).json({
        success: false,
        message: `Only failed jobs can be retried. Current state: ${state}`,
      });
    }

    await job.retry();

    return res.status(200).json({
      success: true,
      message: "Job retry queued",
      queue: queueName,
      job_id: job.id,
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to retry job",
    });
  }
};
