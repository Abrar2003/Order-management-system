const path = require("node:path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const { buildAqlPassedBackfill } = require("../services/aqlPassedBackfill.service");

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  await connectDB();
  const counts = { mode: apply ? "apply" : "dry-run", qcs: 0, inspections: 0, unresolved: 0 };
  const cursor = QC.find({ $or: [{ request_type: "AQL" }, { "request_history.request_type": "AQL" }] })
    .select("request_type request_history quantities updatedAt").lean().cursor({ batchSize: 100 });
  for await (const qc of cursor) {
    const records = await Inspection.find({ qc: qc._id }).lean();
    const result = buildAqlPassedBackfill(qc, records);
    const changed = result.visits.filter((visit, index) =>
      visit.aql_passed !== records[index].aql_passed || visit.pending_after !== records[index].pending_after);
    counts.qcs += 1;
    counts.inspections += changed.length;
    counts.unresolved += result.unresolved.length;
    if (result.unresolved.length) console.log(JSON.stringify({ qc: String(qc._id), unresolved_inspections: result.unresolved }));
    if (!apply) continue;
    if (changed.length) {
      const outcome = await Inspection.bulkWrite(changed.map((visit) => ({ updateOne: {
        filter: { _id: visit._id, updatedAt: visit.updatedAt || null },
        update: { $set: { aql_passed: visit.aql_passed, pending_after: visit.pending_after } },
        timestamps: false,
      } })), { ordered: false });
      if (outcome.matchedCount !== changed.length) throw new Error(`QC ${qc._id} changed during backfill; rerun to refresh derived fields.`);
    }
    const totals = Object.fromEntries(["qc_checked", "vendor_provision", "qc_rejected", "qc_passed", "pending"]
      .filter((key) => result.quantities[key] !== qc.quantities?.[key])
      .map((key) => [`quantities.${key}`, result.quantities[key]]));
    if (Object.keys(totals).length) {
      const outcome = await QC.updateOne({ _id: qc._id, updatedAt: qc.updatedAt || null }, { $set: totals }, { timestamps: false });
      if (!outcome.matchedCount) throw new Error(`QC ${qc._id} changed during backfill; rerun to refresh derived fields.`);
    }
  }
  console.log(JSON.stringify(counts));
};

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());

module.exports = { main };
