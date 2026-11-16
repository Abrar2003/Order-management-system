const QC = require("../models/qc.model");
const { getDropTestWaiver } = require("../helpers/dropTest");
const { APP_DATE_TIMEZONE, parseDateOnly } = require("../helpers/dateOnly");

const findDropTestWaiver = async (itemCode, inspectionDate = new Date()) => {
  const day = parseDateOnly(inspectionDate);
  if (!itemCode || !day) return null;
  // Two calendar months span at most 62 days. The helper applies the exact expiry in the app timezone.
  const since = new Date(day.getTime() - 63 * 86400_000);
  const recentPass = { test_type: "drop", result: "pass", completed_at: { $gte: since, $lte: new Date() } };
  const [latest] = await QC.aggregate([
    { $match: { "item.item_code": itemCode, test_runs: { $elemMatch: recentPass } } },
    { $unwind: "$test_runs" },
    { $match: {
      "test_runs.test_type": recentPass.test_type,
      "test_runs.result": recentPass.result,
      "test_runs.completed_at": recentPass.completed_at,
      $expr: { $lte: [
        { $dateToString: { date: "$test_runs.completed_at", format: "%Y-%m-%d", timezone: APP_DATE_TIMEZONE } },
        day.toISOString().slice(0, 10),
      ] },
    } },
    { $sort: { "test_runs.completed_at": -1 } },
    { $limit: 1 },
    { $project: { _id: 0, completed_at: "$test_runs.completed_at" } },
  ]);
  return getDropTestWaiver(latest?.completed_at, inspectionDate);
};

module.exports = { findDropTestWaiver };
