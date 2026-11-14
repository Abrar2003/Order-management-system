const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const Item = require("../models/item.model");
const PisUpdateLog = require("../models/pisUpdateLog.model");
const { CYCLE_VERSION, MASTER_FIELDS, key } = require("../helpers/masterWorkflow");
const { parseDateTime } = require("../helpers/dateOnly");
const { getMasterComparisonSource, getFirstMasterDate, getLegacyMasterCreationDates } = require("../helpers/qcMismatchMaster");

const laterStages = ["master_1", "master_2", "final_master", "finalized"];
const targetFilter = { "master_workflow.stage": { $in: laterStages } };
const isLaterHistory = (entry) => entry.source === "master_workflow" && laterStages.includes(entry.metadata?.stage);

const buildReset = (item, auditDates) => {
  const workflow = item.master_workflow;
  const original = workflow.reviews?.filter((review) => review.stage === "master") || [];
  const openingReview = original[0];
  const snapshot = openingReview ? openingReview.master : workflow.legacy_master;
  const startedAt = openingReview ? parseDateTime(openingReview.reviewed_at) :
    getFirstMasterDate(item, { started_at: workflow.legacy_master_created_at }, auditDates);
  const safeSnapshot = snapshot && MASTER_FIELDS.every((field) => field.endsWith("_sizes")
    ? Array.isArray(snapshot[field]) && snapshot[field].every((row) => row && typeof row === "object" && !Array.isArray(row))
    : typeof snapshot[field] === "string") &&
    typeof snapshot.calculated_master_total === "string" &&
    snapshot.calculated_master_total.trim() !== "" && Number.isFinite(Number(snapshot.calculated_master_total));
  if (workflow.cycle_version !== CYCLE_VERSION || original.length > 1 || !safeSnapshot ||
      (!openingReview && !getMasterComparisonSource(snapshot)) ||
      (openingReview && (!Array.isArray(openingReview.evidence) || openingReview.evidence.length !== 1 || !key(openingReview.evidence[0]?.po))) ||
      (openingReview && !startedAt) ||
      !Number.isSafeInteger(workflow.revision + 1) || !Number.isInteger(workflow.revision) || workflow.revision < 1) {
    throw new Error(`Item ${item.code || item._id} lacks a restorable Master snapshot or workflow history.`);
  }
  return {
    ...Object.fromEntries(MASTER_FIELDS.map((field) => [field, snapshot[field]])),
    "cbm.calculated_master_total": snapshot.calculated_master_total,
    master_workflow: {
      cycle_version: workflow.cycle_version,
      stage: "master",
      started_at: startedAt,
      revision: workflow.revision + 1,
      reviews: original,
      events: (workflow.events || []).filter((event) => event.stage === "master" && event.action === "review"),
      consumed_pos: openingReview ? [key(openingReview.evidence[0].po)] : [],
      ...(workflow.legacy_master ? { legacy_master: workflow.legacy_master } : {}),
      ...(!openingReview && startedAt ? { legacy_master_created_at: startedAt } : {}),
    },
    update_history: (item.update_history || []).filter((entry) => !isLaterHistory(entry)),
  };
};

const readReset = async (session) => {
  const items = await Item.collection.find(targetFilter, { session }).sort({ _id: 1 }).toArray();
  const dates = await getLegacyMasterCreationDates(items.filter((item) => !item.master_workflow.reviews?.some((review) => review.stage === "master")), session);
  const resets = items.map((item) => buildReset(item, dates.get(String(item._id))));
  const logFilter = {
    item: { $in: items.map((item) => item._id) },
    source: /^master_workflow_/,
    "metadata.stage": { $in: laterStages },
  };
  const logs = await PisUpdateLog.collection.find(logFilter, { session }).sort({ _id: 1 }).toArray();
  return { items, resets, logs, logFilter };
};

const run = async () => {
  const [mode, expectedArg, backupPath] = process.argv.slice(2);
  if (process.env.NODE_ENV !== "production" ||
      (mode !== "--preview" && (mode !== "--apply" || !/^[1-9]\d*$/.test(expectedArg || "") ||
        !backupPath || !path.isAbsolute(backupPath) || process.platform !== "linux"))) {
    throw new Error("Use NODE_ENV=production with --preview or --apply <expected item count> <absolute backup path>.");
  }
  const { loadEnvFiles } = require("../config/loadEnv");
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  const connection = await require("../config/connectDB")();
  const preview = await readReset();
  const counts = {
    items: preview.items.length,
    laterLogs: preview.logs.length,
    missingMasterDates: preview.resets.filter((reset) => !reset.master_workflow.started_at).length,
  };
  console.log(JSON.stringify(counts));
  if (mode === "--preview") return;
  if (counts.items !== Number(expectedArg)) throw new Error("Affected item count changed. Run a new preview.");
  if (connection.connection.$supportsTransactions !== true) throw new Error("MongoDB transactions are required.");
  const parent = fs.statSync(path.dirname(backupPath));
  if (parent.uid !== process.getuid() || (parent.mode & 0o077)) throw new Error("Backup directory must be private to the operator.");
  const serialize = (value) => mongoose.mongo.BSON.EJSON.stringify(value, { relaxed: false });
  const backup = serialize({ items: preview.items, logs: preview.logs });
  const file = fs.openSync(backupPath, "wx", 0o600);
  try {
    fs.writeFileSync(file, backup);
    fs.fsyncSync(file);
  } finally {
    fs.closeSync(file);
  }
  if (fs.readFileSync(backupPath, "utf8") !== backup) throw new Error("Backup verification failed.");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await readReset(session);
      if (serialize({ items: current.items, logs: current.logs }) !== backup ||
          serialize(current.resets) !== serialize(preview.resets)) {
        throw new Error("Production records changed after backup. Keep writes paused and take a new preview.");
      }
      // This one-time maintenance operation intentionally includes locked Final Masters.
      const result = await Item.collection.bulkWrite(current.items.map((item, index) => ({
        updateOne: { filter: { _id: item._id }, update: { $set: current.resets[index] } },
      })), { session });
      const deleted = await PisUpdateLog.collection.deleteMany(current.logFilter, { session });
      const restored = await Item.collection.find({ _id: current.logFilter.item }, { session }).sort({ _id: 1 }).toArray();
      const restoredValues = restored.map((item) => ({
        ...Object.fromEntries(MASTER_FIELDS.map((field) => [field, item[field]])),
        "cbm.calculated_master_total": item.cbm?.calculated_master_total,
        master_workflow: item.master_workflow,
        update_history: item.update_history,
      }));
      if (result.modifiedCount !== counts.items || deleted.deletedCount !== counts.laterLogs ||
          serialize(restoredValues) !== serialize(current.resets) ||
          await Item.collection.countDocuments(targetFilter, { session }) ||
          await PisUpdateLog.collection.countDocuments(current.logFilter, { session })) {
        throw new Error("Reset verification failed. Transaction aborted.");
      }
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
  const { invalidateItemCaches } = require("../services/cacheInvalidation.service");
  await invalidateItemCaches();
  const readyForQueue = await Item.collection.countDocuments({
    _id: { $in: preview.items.map((item) => item._id) },
    "master_workflow.stage": "master",
    qc_mismatch_reviewed_at: { $type: "date" },
  });
  console.log(JSON.stringify({ restored: counts.items, removedLogs: counts.laterLogs, finalPisCheckItems: readyForQueue }));
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => Promise.all([mongoose.disconnect(), require("../config/redis").closeRedisClients()]));
}

module.exports = { buildReset };
