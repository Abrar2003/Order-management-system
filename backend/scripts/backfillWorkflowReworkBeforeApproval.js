const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.production") });

const connectDB = require("../config/connectDB");
const { Task } = require("../models/workflow");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getValue = (name) => {
    const prefix = `${name}=`;
    const match = args.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : "";
  };

  const limitValue = Number.parseInt(getValue("--limit"), 10);
  const sampleValue = Number.parseInt(getValue("--sample"), 10);

  return {
    apply: args.includes("--apply"),
    limit: Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 0,
    sampleSize: Number.isFinite(sampleValue) && sampleValue > 0 ? sampleValue : 20,
  };
};

const toNonNegativeInteger = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
};

const getReworkCount = (task = {}) => {
  const commentCount = Array.isArray(task?.reworked?.comments)
    ? task.reworked.comments.length
    : 0;
  return Math.max(
    toNonNegativeInteger(task?.reworked?.count),
    toNonNegativeInteger(task?.rework_count),
    commentCount,
  );
};

const buildMatch = () => ({
  is_deleted: { $ne: true },
  $and: [
    {
      $or: [
        { "reworked.count": { $gt: 0 } },
        { rework_count: { $gt: 0 } },
        { "reworked.comments.0": { $exists: true } },
      ],
    },
    {
      $or: [
        { "reworked.after_approval_count": { $exists: false } },
        { "reworked.after_approval_count": { $lte: 0 } },
        { "reworked.after_approval_count": null },
      ],
    },
  ],
});

const buildUpdateForTask = (task = {}) => {
  const reworkCount = getReworkCount(task);
  const existingReworked = task.reworked && typeof task.reworked === "object"
    ? task.reworked
    : {};
  const comments = Array.isArray(existingReworked.comments)
    ? existingReworked.comments.map((entry) => ({
        ...entry,
        rework_type: String(entry?.rework_type || "").trim() || "before_approval",
      }))
    : [];

  return {
    $set: {
      "reworked.count": reworkCount,
      "reworked.before_approval_count": reworkCount,
      "reworked.after_approval_count": 0,
      "reworked.comments": comments,
      rework_count: reworkCount,
    },
  };
};

const main = async () => {
  const { apply, limit, sampleSize } = parseArgs();
  await connectDB();

  const match = buildMatch();
  const query = Task.find(match)
    .select("_id task_no title status reworked rework_count")
    .sort({ updatedAt: -1, _id: 1 })
    .lean();

  if (limit > 0) {
    query.limit(limit);
  }

  const tasks = await query;
  const samples = tasks.slice(0, sampleSize).map((task) => ({
    _id: String(task._id),
    task_no: task.task_no,
    status: task.status,
    rework_count: getReworkCount(task),
    current_before_approval_count: toNonNegativeInteger(task?.reworked?.before_approval_count),
    current_after_approval_count: toNonNegativeInteger(task?.reworked?.after_approval_count),
    comment_count: Array.isArray(task?.reworked?.comments) ? task.reworked.comments.length : 0,
  }));

  console.log("Workflow rework before-approval backfill");
  console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`Matched tasks${limit > 0 ? ` (limited to ${limit})` : ""}: ${tasks.length}`);
  console.log("Sample:");
  console.table(samples);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write these changes.");
    return;
  }

  let modifiedCount = 0;
  for (const task of tasks) {
    const update = buildUpdateForTask(task);
    const result = await Task.updateOne({ _id: task._id }, update);
    modifiedCount += Number(result.modifiedCount || 0);
  }

  console.log("Update complete:", {
    matchedCount: tasks.length,
    modifiedCount,
  });
};

main()
  .catch((error) => {
    console.error("Workflow rework before-approval backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
