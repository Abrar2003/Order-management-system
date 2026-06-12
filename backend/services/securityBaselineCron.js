const cron = require("node-cron");
const {
  recalculateAllUserBaselines,
} = require("./securityMonitoringService");

let baselineTask = null;

const startSecurityBaselineCron = () => {
  if (baselineTask) return baselineTask;

  baselineTask = cron.schedule(
    "30 2 * * *",
    async () => {
      try {
        const result = await recalculateAllUserBaselines();
        console.log("[security] baseline recalculation complete", result);
      } catch (error) {
        console.error("[security] baseline cron failed", error);
      }
    },
    {
      timezone: "Asia/Kolkata",
    },
  );

  return baselineTask;
};

const stopSecurityBaselineCron = () => {
  if (!baselineTask) return;
  baselineTask.stop();
  baselineTask = null;
};

module.exports = {
  startSecurityBaselineCron,
  stopSecurityBaselineCron,
};
