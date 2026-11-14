const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const { closeRedisClients } = require("../config/redis");
const Item = require("../models/item.model");
const { invalidateItemCaches } = require("../services/cacheInvalidation.service");

// Only comments that existed when this change was requested qualify automatically.
const cutoff = new Date("2026-11-14T07:13:22.000Z");
const backfillQcMismatchReviews = () => Item.updateMany(
  {
    qc_mismatch_reviewed_at: null,
    qc_mismatch_comments: { $elemMatch: { created_at: { $lte: cutoff }, comment: /\S/ } },
  },
  { $set: { qc_mismatch_reviewed_at: cutoff } },
  { timestamps: false },
);

if (require.main === module) {
  loadEnvFiles({ preserveExistingEnv: true });
  const connectDB = require("../config/connectDB");
  connectDB().then(async () => {
    const result = await backfillQcMismatchReviews();
    await invalidateItemCaches();
    console.log(`Marked ${result.modifiedCount} items with existing QC mismatch comments as reviewed.`);
  }).catch((error) => {
    console.error("QC mismatch review backfill failed:", error.message);
    process.exitCode = 1;
  }).finally(() => Promise.all([mongoose.disconnect(), closeRedisClients()]));
}

module.exports = { backfillQcMismatchReviews };
