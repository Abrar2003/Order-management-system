const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const {
  backfillTotalPoCbmForOrders,
} = require("../services/orderCbm.service");

const parsePositiveIntArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) return fallback;

  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  await connectDB();

  const batchSize = parsePositiveIntArg("batch-size", 500);
  const dryRun = hasFlag("dry-run");

  const summary = await backfillTotalPoCbmForOrders({
    batchSize,
    dryRun,
  });

  console.log("total_po_cbm backfill completed");
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error("total_po_cbm backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
