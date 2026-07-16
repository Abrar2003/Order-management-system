const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const {
  applyMongoDnsServersFromEnv,
  formatMongoConnectionError,
} = require("../helpers/mongoConnectionDiagnostics");
const Vendor = require("../models/vendor.model");
const { getVendorId, getVendorName } = require("../helpers/vendorRef");
const text = (value) => String(value ?? "").trim();

loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });

const apply = process.argv.includes("--apply");

const main = async () => {
  const uri = String(process.env.MONGO_URI_SCRIPT || "").trim();
  if (!uri) throw new Error("MONGO_URI_SCRIPT is not configured");
  applyMongoDnsServersFromEnv();
  try {
    await mongoose.connect(uri);
  } catch (error) {
    throw new Error(formatMongoConnectionError(error, uri));
  }

  const vendors = await Vendor.find({
    $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
  }).select("_id name country").lean();
  const byId = new Map(vendors.map((v) => [String(v._id), text(v.country)]));
  const byName = new Map(vendors.map((v) => [text(v.name).toLowerCase(), text(v.country)]));
  const items = mongoose.connection.collection("items");
  const cursor = items.find({ vendors: { $exists: true, $ne: [] } });
  const writes = [];
  let scanned = 0, updated = 0, skipped = 0;

  while (await cursor.hasNext()) {
    const item = await cursor.next();
    scanned++;
    const countries = [...new Set((Array.isArray(item.vendors) ? item.vendors : [])
      .map((v) => byId.get(getVendorId(v)) || byName.get(getVendorName(v).toLowerCase()))
      .filter(Boolean))];
    if (countries.length !== 1 || item.country_of_origin === countries[0]) {
      skipped++;
      continue;
    }
    updated++;
    writes.push({ updateOne: { filter: { _id: item._id }, update: { $set: { country_of_origin: countries[0] } } } });
    if (writes.length >= 500) {
      if (apply) await items.bulkWrite(writes);
      writes.length = 0;
    }
  }
  if (apply && writes.length) await items.bulkWrite(writes);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, updated, skipped }, null, 2));
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
