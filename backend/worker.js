const path = require("path");
const mongoose = require("mongoose");

const { loadEnvFiles } = require("./config/loadEnv");

loadEnvFiles({
  cwd: path.resolve(__dirname),
  preserveExistingEnv: true,
});

const connectDB = require("./config/connectDB");
const {
  isRedisJobsEnabled,
  checkRedisConnection,
  closeRedisClients,
} = require("./config/redis");
const { closeQueues } = require("./queues");
const { startWorkers, closeWorkers } = require("./workers");
const { startQcUpdateFollowUpWorker } = require("./services/qcUpdateFollowUp.service");

let idleTimer = null;
let shuttingDown = false;
let stopQcUpdateFollowUpWorker = null;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received. Starting graceful shutdown...`);

  if (idleTimer) clearInterval(idleTimer);

  try {
    stopQcUpdateFollowUpWorker?.();
    await closeWorkers();
    await closeQueues();
    await closeRedisClients();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }
    console.log("[worker] shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("[worker] shutdown failed:", error);
    process.exit(1);
  }
};

const main = async () => {
  await connectDB();
  stopQcUpdateFollowUpWorker = startQcUpdateFollowUpWorker({
    intervalMs: parsePositiveInt(process.env.QC_UPDATE_FOLLOW_UP_POLL_MS, 1000),
    concurrency: parsePositiveInt(process.env.QC_UPDATE_FOLLOW_UP_CONCURRENCY, 1),
  });
  console.log("[worker] QC update follow-up worker started");

  if (!isRedisJobsEnabled()) {
    console.log("[worker] REDIS_JOBS_ENABLED=false; BullMQ workers are disabled");
    return;
  }

  const redisAvailable = await checkRedisConnection({
    label: "worker-jobs-health",
    forBullMq: true,
    timeoutMs: 1500,
  });
  if (!redisAvailable) {
    console.warn("[worker] Redis jobs enabled but Redis is unavailable; worker is waiting");
    idleTimer = setInterval(async () => {
      if (shuttingDown) return;
      try {
        const isAvailable = await checkRedisConnection({
          label: "worker-jobs-health",
          forBullMq: true,
          timeoutMs: 1500,
        });
        if (!isAvailable || shuttingDown) return;

        clearInterval(idleTimer);
        idleTimer = null;
        startWorkers();
      } catch (error) {
        console.error("[worker] delayed worker start failed:", error);
      }
    }, 30000);
    return;
  }

  startWorkers();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[worker] failed to start:", error);
  process.exit(1);
});
