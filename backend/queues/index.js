const { Queue, QueueEvents } = require("bullmq");
const {
  getRedisConnectionOptions,
  isRedisJobsEnabled,
  checkRedisConnection,
} = require("../config/redis");
const JOB_NAMES = require("./jobNames");

const QUEUE_NAMES = Object.freeze({
  orderImportQueue: "orderImportQueue",
  fileProcessingQueue: "fileProcessingQueue",
  calendarSyncQueue: "calendarSyncQueue",
  cbmRecalcQueue: "cbmRecalcQueue",
  imageProcessingQueue: "imageProcessingQueue",
});

const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: 1000,
  removeOnFail: 5000,
});

let queues = null;
let queueEvents = null;
let jobsAvailableUntil = 0;
let jobsUnavailableUntil = 0;
const queueLogAt = new Map();

const normalizeText = (value) => String(value ?? "").trim();

const sanitizeJobIdPart = (value = "") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";

const logThrottled = (key, level, message, payload = {}, intervalMs = 60000) => {
  const now = Date.now();
  const previous = Number(queueLogAt.get(key) || 0);
  if (previous && now - previous < intervalMs) return;
  queueLogAt.set(key, now);

  const logger = console[level] || console.log;
  logger(message, payload);
};

const createQueueEvents = (queueName, connection) => {
  const events = new QueueEvents(queueName, { connection });

  events.on("completed", ({ jobId }) => {
    console.info("[queue] job completed", { queue: queueName, jobId });
  });

  events.on("failed", ({ jobId, failedReason }) => {
    console.warn("[queue] job failed", {
      queue: queueName,
      jobId,
      reason: failedReason,
    });
  });

  events.on("error", (error) => {
    logThrottled(`${queueName}:events-error`, "warn", "[queue] events error", {
      queue: queueName,
      message: error?.message || String(error),
    });
  });

  return events;
};

const initializeQueues = () => {
  if (queues) return queues;

  queues = {};
  queueEvents = {};

  if (!isRedisJobsEnabled()) {
    console.info("[queue] Redis jobs disabled; queues will not be registered");
    return queues;
  }

  const connection = getRedisConnectionOptions({
    forBullMq: true,
    connectionName: "oms-queue",
  });

  for (const queueName of Object.values(QUEUE_NAMES)) {
    queues[queueName] = new Queue(queueName, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queueEvents[queueName] = createQueueEvents(queueName, connection);
  }

  return queues;
};

const getQueues = () => initializeQueues();

const getQueue = (queueName) => {
  const normalizedName = normalizeText(queueName);
  if (!normalizedName) return null;
  const registeredQueues = initializeQueues();
  return registeredQueues[normalizedName] || null;
};

const getQueueNames = () => Object.values(QUEUE_NAMES);

const ensureRedisJobsAvailable = async () => {
  if (!isRedisJobsEnabled()) return false;

  const now = Date.now();
  if (jobsAvailableUntil > now) return true;
  if (jobsUnavailableUntil > now) return false;

  const available = await checkRedisConnection({
    label: "jobs-health",
    forBullMq: true,
    timeoutMs: 1500,
  });

  if (available) {
    jobsAvailableUntil = now + 30000;
    jobsUnavailableUntil = 0;
    return true;
  }

  jobsUnavailableUntil = now + 30000;
  jobsAvailableUntil = 0;
  return false;
};

const getQueueIfAvailable = async (queueName) => {
  const available = await ensureRedisJobsAvailable();
  if (!available) return null;
  return getQueue(queueName);
};

const addJob = async (queueName, jobName, data = {}, options = {}) => {
  const available = await ensureRedisJobsAvailable();
  if (!available) return null;

  const queue = getQueue(queueName);
  if (!queue) return null;

  try {
    return await queue.add(jobName, data, options);
  } catch (error) {
    console.warn("[queue] failed to enqueue job", {
      queue: queueName,
      jobName,
      message: error?.message || String(error),
    });
    return null;
  }
};

const enqueueOrderCbmRecalc = ({ orderId } = {}) => {
  const safeOrderId = sanitizeJobIdPart(orderId);
  return addJob(
    QUEUE_NAMES.cbmRecalcQueue,
    JOB_NAMES.RECALCULATE_ORDER_CBM,
    { orderId },
    { jobId: `cbm:order:${safeOrderId}` },
  );
};

const enqueueAllOrderCbmRecalc = ({ batchSize = 500, dryRun = false } = {}) =>
  addJob(
    QUEUE_NAMES.cbmRecalcQueue,
    JOB_NAMES.RECALCULATE_ALL_ORDER_CBM,
    { batchSize, dryRun },
    { jobId: `cbm:all:${dryRun ? "dry-run" : "live"}:${Date.now()}` },
  );

const enqueueOrderGroupCalendarSync = ({ order_id, brand, vendor } = {}) =>
  addJob(
    QUEUE_NAMES.calendarSyncQueue,
    JOB_NAMES.SYNC_ORDER_GROUP_CALENDAR,
    { order_id, brand, vendor },
    {
      jobId: [
        "calendar:group",
        sanitizeJobIdPart(order_id),
        sanitizeJobIdPart(brand),
        sanitizeJobIdPart(vendor),
      ].join(":"),
    },
  );

const enqueueBrandCalendarResync = ({
  brand = "",
  batchSize = 5,
  timeoutMs = 300000,
} = {}) =>
  addJob(
    QUEUE_NAMES.calendarSyncQueue,
    JOB_NAMES.RESYNC_BRAND_CALENDAR,
    { brand, batchSize, timeoutMs },
    { jobId: `calendar:resync:${sanitizeJobIdPart(brand || "all")}` },
  );

const enqueuePisFileProcessing = ({
  itemId,
  itemCode,
  tempFilePath,
  originalName,
  previousStorageKey = "",
  checksum = "",
} = {}) =>
  addJob(
    QUEUE_NAMES.fileProcessingQueue,
    JOB_NAMES.PROCESS_PIS_FILE,
    {
      itemId,
      itemCode,
      tempFilePath,
      originalName,
      previousStorageKey,
    },
    {
      jobId: [
        "pis",
        sanitizeJobIdPart(itemId),
        sanitizeJobIdPart(checksum || originalName || "file"),
      ].join(":"),
    },
  );

const closeQueues = async () => {
  const registeredQueues = queues || {};
  const registeredEvents = queueEvents || {};
  queues = null;
  queueEvents = null;

  await Promise.allSettled([
    ...Object.values(registeredEvents).map((events) => events.close()),
    ...Object.values(registeredQueues).map((queue) => queue.close()),
  ]);
};

module.exports = {
  QUEUE_NAMES,
  DEFAULT_JOB_OPTIONS,
  getQueues,
  getQueue,
  getQueueIfAvailable,
  getQueueNames,
  ensureRedisJobsAvailable,
  addJob,
  enqueueOrderCbmRecalc,
  enqueueAllOrderCbmRecalc,
  enqueueOrderGroupCalendarSync,
  enqueueBrandCalendarResync,
  enqueuePisFileProcessing,
  closeQueues,
};
