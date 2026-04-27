const { getQueueIfAvailable, getQueueNames } = require("../queues");

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
