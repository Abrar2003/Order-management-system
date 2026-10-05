const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Item = require("../models/item.model");
const QC = require("../models/qc.model");

const hasFlag = (name) => process.argv.includes(`--${name}`);
const key = (value) => String(value || "").trim().toLowerCase();
const timestamp = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, "..") });
  await connectDB();

  const [items, qcRows] = await Promise.all([
    Item.find({}).select("_id code").lean(),
    QC.find({ "item.item_code": { $exists: true, $ne: "" } })
      .select("item.item_code shipping_mark_updated last_inspected_date updatedAt createdAt")
      .lean(),
  ]);
  const latestByItem = new Map();
  for (const qc of qcRows) {
    const itemKey = key(qc?.item?.item_code);
    const latestAt = Math.max(
      timestamp(qc?.last_inspected_date),
      timestamp(qc?.updatedAt),
      timestamp(qc?.createdAt),
    );
    if (!itemKey || latestByItem.get(itemKey)?.latestAt >= latestAt) continue;
    latestByItem.set(itemKey, { latestAt, value: qc?.shipping_mark_updated === true });
  }

  const operations = items.map((item) => {
    const latest = latestByItem.get(key(item?.code));
    return {
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { shipping_mark_updated: latest?.value === true } },
      },
    };
  });

  console.log("Shipping-mark item-status backfill");
  console.log(`Mode: ${hasFlag("apply") ? "apply" : "dry-run"}`);
  console.log(`Items with a matching QC status: ${latestByItem.size}`);
  console.log(`Items to initialize: ${operations.length}`);
  if (!hasFlag("apply")) {
    console.log("No changes written. Re-run with --apply to update items.");
    return;
  }
  const result = operations.length ? await Item.bulkWrite(operations) : { matchedCount: 0, modifiedCount: 0 };
  console.log(`Items matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
};

main()
  .catch((error) => {
    console.error("Shipping-mark item-status backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
