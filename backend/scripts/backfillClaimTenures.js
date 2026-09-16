const path = require("path");

const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Item = require("../models/item.model");
const Tenure = require("../models/tenure.model");

const hasFlag = (name) => process.argv.includes(`--${name}`);
const normalizeText = (value) => String(value ?? "").trim();
const toIsoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
const getItemBrand = (item = {}) => normalizeText(item.brand_name || item.brand || item.brands?.[0]);
const percentage = (claims = []) => {
  const totals = claims.reduce((summary, claim) => ({
    delivered: summary.delivered + Number(claim.delivered_quantity || 0),
    rejected: summary.rejected + Number(claim.rejected_quantity || 0),
  }), { delivered: 0, rejected: 0 });
  return totals.delivered > 0 ? Number(((totals.rejected / totals.delivered) * 100).toFixed(2)) : 0;
};

const MANUAL_CLAIM = Object.freeze({
  code: "96587",
  from_date: "2026-05-19",
  to_date: "2026-08-13",
  delivered_quantity: 43,
  rejected_quantity: 11,
});

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, "..") });
  await connectDB();

  const apply = hasFlag("apply");
  const items = await Item.collection.find({
    $or: [
      { "claim_tenures.from_date": { $exists: true } },
      { code: MANUAL_CLAIM.code, claim_percentage: { $gt: 0 }, "claim_tenures.0": { $exists: false } },
    ],
  }).toArray();
  const plans = [];
  const unmappable = [];

  for (const item of items) {
    const brand = getItemBrand(item);
    const oldClaims = Array.isArray(item.claim_tenures) ? item.claim_tenures : [];
    const legacyClaims = oldClaims.filter((claim) => !claim?.tenure_id && claim?.from_date && claim?.to_date);
    if (legacyClaims.length === 0 && item.code === MANUAL_CLAIM.code && oldClaims.length === 0) {
      legacyClaims.push(MANUAL_CLAIM);
    }
    if (legacyClaims.length === 0) continue;
    if (!brand) {
      unmappable.push({ code: item.code || String(item._id), reason: "missing brand" });
      continue;
    }

    const normalizedClaims = legacyClaims.map((claim) => ({
      brand,
      from_date: toIsoDate(claim.from_date),
      to_date: toIsoDate(claim.to_date),
      delivered_quantity: Number(claim.delivered_quantity),
      rejected_quantity: Number(claim.rejected_quantity),
    }));
    if (normalizedClaims.some((claim) => !claim.from_date || !claim.to_date || !Number.isInteger(claim.delivered_quantity) || claim.delivered_quantity < 1 || !Number.isInteger(claim.rejected_quantity) || claim.rejected_quantity < 0 || claim.rejected_quantity > claim.delivered_quantity)) {
      unmappable.push({ code: item.code || String(item._id), reason: "invalid claim tenure data" });
      continue;
    }
    plans.push({ item, legacyClaims: normalizedClaims });
  }

  const tenureKeys = new Map();
  plans.flatMap((plan) => plan.legacyClaims).forEach((claim) => {
    tenureKeys.set(`${claim.brand}\u0000${claim.from_date}\u0000${claim.to_date}`, claim);
  });

  console.log("Claim tenure backfill");
  console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`Items to migrate: ${plans.length}`);
  console.log(`Claim entries to migrate: ${plans.reduce((sum, plan) => sum + plan.legacyClaims.length, 0)}`);
  console.log(`Brand tenures to upsert: ${tenureKeys.size}`);
  console.log(`Unmappable items: ${unmappable.length}`);
  unmappable.forEach((entry) => console.log(`  ${entry.code}: ${entry.reason}`));

  if (!apply) {
    console.log("No changes written. Re-run with --apply to migrate claim data.");
    return;
  }
  if (unmappable.length > 0) {
    throw new Error("Backfill cancelled because one or more items cannot be mapped");
  }

  const tenureByKey = new Map();
  for (const [key, claim] of tenureKeys) {
    const tenure = await Tenure.findOneAndUpdate(
      { brand: claim.brand, from_date: new Date(`${claim.from_date}T00:00:00.000Z`), to_date: new Date(`${claim.to_date}T00:00:00.000Z`) },
      { $setOnInsert: { brand: claim.brand, from_date: new Date(`${claim.from_date}T00:00:00.000Z`), to_date: new Date(`${claim.to_date}T00:00:00.000Z`) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    tenureByKey.set(key, tenure);
  }

  const operations = plans.map(({ item, legacyClaims }) => {
    const retainedClaims = (Array.isArray(item.claim_tenures) ? item.claim_tenures : [])
      .filter((claim) => claim?.tenure_id)
      .map((claim) => ({
        tenure_id: claim.tenure_id,
        delivered_quantity: Number(claim.delivered_quantity),
        rejected_quantity: Number(claim.rejected_quantity),
      }));
    const migratedClaims = legacyClaims.map((claim) => ({
      tenure_id: tenureByKey.get(`${claim.brand}\u0000${claim.from_date}\u0000${claim.to_date}`)._id,
      delivered_quantity: claim.delivered_quantity,
      rejected_quantity: claim.rejected_quantity,
    }));
    const claimByTenure = new Map(retainedClaims.map((claim) => [String(claim.tenure_id), claim]));
    migratedClaims.forEach((claim) => claimByTenure.set(String(claim.tenure_id), claim));
    const claimTenures = [...claimByTenure.values()];
    return {
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { claim_tenures: claimTenures, claim_percentage: percentage(claimTenures), updatedAt: new Date() } },
      },
    };
  });
  const result = operations.length > 0 ? await Item.collection.bulkWrite(operations) : { matchedCount: 0, modifiedCount: 0 };
  console.log(`Items matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
};

main()
  .catch((error) => {
    console.error("Claim tenure backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Item.db.close();
  });
