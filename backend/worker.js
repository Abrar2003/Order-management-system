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

let idleTimer = null;
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received. Starting graceful shutdown...`);

  if (idleTimer) clearInterval(idleTimer);

  try {
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
  if (!isRedisJobsEnabled()) {
    console.log("[worker] REDIS_JOBS_ENABLED=false; worker is idle");
    idleTimer = setInterval(() => {}, 60 * 60 * 1000);
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
        await connectDB();
        startWorkers();
      } catch (error) {
        console.error("[worker] delayed worker start failed:", error);
      }
    }, 30000);
    return;
  }

  await connectDB();
  startWorkers();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[worker] failed to start:", error);
  process.exit(1);
});
