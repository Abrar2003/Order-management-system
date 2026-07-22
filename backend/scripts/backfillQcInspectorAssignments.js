const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const uriArg = process.argv.find((arg) => arg.startsWith("--uri="));
const limit = Math.max(0, Number.parseInt(limitArg?.split("=")[1] || "0", 10) || 0);

const id = (value) => String(value?._id || value || "").trim();
const timestamp = (record) => {
  const value = Date.parse(record?.inspection_date || record?.requested_date || record?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
};

const latest = (records) =>
  [...records].sort((left, right) => timestamp(right) - timestamp(left))[0] || null;

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, "..") });
  process.env.MONGO_URI = uriArg?.slice("--uri=".length) || process.env.MONGO_URI_SCRIPT;
  await connectDB();

  const qcs = await QC.find({ request_history: { $exists: true, $ne: [] } })
    .select("inspector request_history")
    .limit(limit)
    .lean();
  const inspections = await Inspection.find({ qc: { $in: qcs.map((qc) => qc._id) } })
    .select("qc request_history_id inspector inspection_date requested_date createdAt")
    .lean();
  const byQc = new Map();
  for (const inspection of inspections) {
    const key = id(inspection.qc);
    if (!byQc.has(key)) byQc.set(key, []);
    byQc.get(key).push(inspection);
  }

  const summary = { dry_run: !apply, scanned: qcs.length, matched: 0, updated: 0 };
  for (const qc of qcs) {
    const qcInspections = byQc.get(id(qc)) || [];
    const history = Array.isArray(qc.request_history) ? qc.request_history : [];
    let changed = false;

    for (const entry of history) {
      const entryId = id(entry);
      const inspection = latest(
        qcInspections.filter((record) => id(record.request_history_id) === entryId),
      );
      const inspectorId = id(inspection?.inspector);
      if (!inspectorId || inspectorId === id(entry.inspector)) continue;
      entry.inspector = inspectorId;
      changed = true;
    }

    const latestRequest = history[history.length - 1];
    const nextQcInspector = id(latestRequest?.inspector);
    if (nextQcInspector && nextQcInspector !== id(qc.inspector)) {
      changed = true;
    }
    if (!changed) continue;

    summary.matched += 1;
    if (!apply) continue;

    const update = { request_history: history };
    if (nextQcInspector) update.inspector = nextQcInspector;
    await QC.updateOne({ _id: qc._id }, { $set: update });
    summary.updated += 1;
  }

  console.log(JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error("QC inspector backfill failed:", error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
