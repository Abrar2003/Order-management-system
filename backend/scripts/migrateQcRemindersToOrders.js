const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const QC = require("../models/qc.model");
const Order = require("../models/order.model");

const shouldApply = process.argv.includes("--apply");

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, "..") });
  await connectDB();

  const qcs = await QC.find({ "reminders.0": { $exists: true } })
    .select("_id order reminders")
    .lean();
  const operations = [];

  for (const qc of qcs) {
    if (!qc?.order) continue;
    for (const reminder of Array.isArray(qc.reminders) ? qc.reminders : []) {
      if (!reminder?._id) continue;
      operations.push({
        updateOne: {
          filter: { _id: qc.order, "reminders._id": { $ne: reminder._id } },
          update: {
            $push: {
              reminders: {
                ...reminder,
                type: "qc",
                status: "pending",
                linked_qc: qc._id,
                resolved_by: null,
                resolvedAt: null,
              },
            },
          },
        },
      });
    }
  }

  console.log("QC reminder migration");
  console.log(`Mode: ${shouldApply ? "apply" : "dry-run"}`);
  console.log(`Legacy reminders found: ${operations.length}`);
  if (!shouldApply) {
    console.log("No changes written. Re-run with --apply to migrate reminders.");
    return;
  }

  const result = operations.length ? await Order.bulkWrite(operations, { ordered: false }) : {};
  console.log(`Orders matched: ${result.matchedCount || 0}, modified: ${result.modifiedCount || 0}`);
};

main()
  .catch((error) => {
    console.error("QC reminder migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
