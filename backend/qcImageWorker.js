const path = require("path");
const mongoose = require("mongoose");
const { Worker } = require("bullmq");

const { loadEnvFiles } = require("./config/loadEnv");

loadEnvFiles({
  cwd: path.resolve(__dirname),
  preserveExistingEnv: true,
});

const connectDB = require("./config/connectDB");
const {
  closeRedisClients,
  getRedisConnectionOptions,
  isRedisJobsEnabled,
  checkRedisConnection,
} = require("./config/redis");
const {
  QUEUE_NAMES,
  closeQueues,
  getQueues,
} = require("./queues");
const JOB_NAMES = require("./queues/jobNames");
const {
  cleanupAbandonedUploadSessions,
  getSharpImageRuntimeSupport,
  processQcImageDerivatives,
  scanAndEnqueuePendingQcImages,
} = require("./services/qcImageProcessing.service");
const {
  DEFAULT_TZ,
  isWithinProcessingWindow,
} = require("./services/qcImageProcessingWindow");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const PROCESSOR_CONCURRENCY = parsePositiveInt(
  process.env.QC_IMAGE_PROCESSOR_CONCURRENCY,
  2,
);
const SCAN_INTERVAL_MS = parsePositiveInt(
  process.env.QC_IMAGE_PROCESSOR_SCAN_INTERVAL_MS,
  10 * 60 * 1000,
);
const WINDOW_CHECK_INTERVAL_MS = parsePositiveInt(
  process.env.QC_IMAGE_PROCESSOR_WINDOW_CHECK_MS,
  60 * 1000,
);

let worker = null;
let windowTimer = null;
let scanTimer = null;
let workerRunning = false;
let scanInFlight = false;
let shuttingDown = false;

const getWindowConfig = () => ({
  timeZone: process.env.QC_IMAGE_PROCESSING_TZ || DEFAULT_TZ,
  start: process.env.QC_IMAGE_WINDOW_START || "21:00",
  end: process.env.QC_IMAGE_WINDOW_END || "07:00",
});

const isWindowOpen = () => isWithinProcessingWindow(getWindowConfig());

const scanPendingImages = async (reason = "timer") => {
  if (scanInFlight || shuttingDown || !isWindowOpen()) return;
  scanInFlight = true;
  try {
    const cleanup = await cleanupAbandonedUploadSessions({
      olderThan: new Date(),
    });
    const result = await scanAndEnqueuePendingQcImages({
      limit: parsePositiveInt(process.env.QC_IMAGE_PROCESSOR_SCAN_LIMIT, 500),
    });
    console.info("[qc-image-worker] scan complete", {
      reason,
      ...result,
      abandoned_cleaned: cleanup.cleaned,
    });
  } catch (error) {
    console.error("[qc-image-worker] scan failed", {
      reason,
      message: error?.message || String(error),
    });
  } finally {
    scanInFlight = false;
  }
};

const ensureWorkerRunningState = async () => {
  if (!worker || shuttingDown) return;

  if (isWindowOpen()) {
    if (!workerRunning) {
      worker.run();
      workerRunning = true;
      console.info("[qc-image-worker] processing window open; worker running", getWindowConfig());
      await scanPendingImages("window-open");
    }
    return;
  }

  if (workerRunning) {
    console.info("[qc-image-worker] processing window closed; pausing new jobs", getWindowConfig());
    await worker.pause(true);
    workerRunning = false;
  }
};

const createQcImageWorker = () => {
  const nextWorker = new Worker(
    QUEUE_NAMES.qcImageProcessingQueue,
    async (job) => {
      if (job.name !== JOB_NAMES.PROCESS_QC_IMAGE_DERIVATIVES) {
        return { skipped: true, reason: "unsupported_job", jobName: job.name };
      }

      await job.updateProgress(10);
      const result = await processQcImageDerivatives({
        qcId: job.data?.qcId,
        inspectionId: job.data?.inspectionId,
        imageField: job.data?.imageField,
        imageId: job.data?.imageId,
        ownerModel: job.data?.ownerModel,
      });
      await job.updateProgress(100);
      return result;
    },
    {
      autorun: false,
      connection: getRedisConnectionOptions({
        forBullMq: true,
        connectionName: "oms-qc-image-worker",
      }),
      concurrency: PROCESSOR_CONCURRENCY,
    },
  );

  nextWorker.on("completed", (job) => {
    console.info("[qc-image-worker] job completed", {
      jobId: job.id,
      imageId: job.data?.imageId,
    });
  });

  nextWorker.on("failed", (job, error) => {
    console.warn("[qc-image-worker] job failed", {
      jobId: job?.id,
      imageId: job?.data?.imageId,
      message: error?.message || String(error),
    });
  });

  nextWorker.on("error", (error) => {
    console.warn("[qc-image-worker] worker error", {
      message: error?.message || String(error),
    });
  });

  return nextWorker;
};

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[qc-image-worker] ${signal} received. Starting graceful shutdown...`);

  if (windowTimer) clearInterval(windowTimer);
  if (scanTimer) clearInterval(scanTimer);

  try {
    if (worker) {
      await worker.close();
      worker = null;
    }
    await closeQueues();
    await closeRedisClients();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
    console.log("[qc-image-worker] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("[qc-image-worker] shutdown failed:", error);
    process.exit(1);
  }
};

const main = async () => {
  if (!isRedisJobsEnabled()) {
    console.log("[qc-image-worker] REDIS_JOBS_ENABLED=false; worker is idle");
    windowTimer = setInterval(() => {}, 60 * 60 * 1000);
    return;
  }

  const redisAvailable = await checkRedisConnection({
    label: "qc-image-worker-health",
    forBullMq: true,
    timeoutMs: 1500,
  });
  if (!redisAvailable) {
    throw new Error("Redis jobs are enabled but Redis is unavailable");
  }

  await connectDB();
  const imageRuntimeSupport = getSharpImageRuntimeSupport();
  console.info("[qc-image-worker] sharp image runtime support", imageRuntimeSupport);
  if (!imageRuntimeSupport.heifInput) {
    console.warn(
      "[qc-image-worker] HEIC/HEIF decode support is not reported by Sharp/libvips; HEIC uploads will fail nightly processing until VPS validation passes.",
    );
  }

  getQueues();
  worker = createQcImageWorker();

  windowTimer = setInterval(() => {
    ensureWorkerRunningState().catch((error) => {
      console.error("[qc-image-worker] window state update failed:", error);
    });
  }, WINDOW_CHECK_INTERVAL_MS);
  scanTimer = setInterval(() => {
    scanPendingImages("interval").catch(() => {});
  }, SCAN_INTERVAL_MS);

  await ensureWorkerRunningState();
  console.info("[qc-image-worker] started", {
    queue: QUEUE_NAMES.qcImageProcessingQueue,
    concurrency: PROCESSOR_CONCURRENCY,
    scan_interval_ms: SCAN_INTERVAL_MS,
    window: getWindowConfig(),
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[qc-image-worker] failed to start:", error);
  process.exit(1);
});
