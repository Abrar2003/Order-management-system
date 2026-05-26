const path = require("path");

const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Item = require("../models/item.model");
const Inspection = require("../models/inspection.model");

const hasFlag = (name) => process.argv.includes(`--${name}`);

const buildItemLegacyKdQuery = () => ({
  $or: [
    { kd: true },
    { inspected_k_d: true },
    { pis_k_d: true },
    { master_k_d: true },
  ],
});

const buildInspectionLegacyKdQuery = () => ({
  $or: [
    { kd: true },
    { inspected_k_d: true },
    { pis_k_d: true },
  ],
});

const itemKdUpdatePipeline = [
  {
    $set: {
      kd: {
        $or: [
          { $eq: ["$kd", true] },
          { $eq: ["$inspected_k_d", true] },
          { $eq: ["$pis_k_d", true] },
          { $eq: ["$master_k_d", true] },
        ],
      },
    },
  },
];

const inspectionKdUpdatePipeline = [
  {
    $set: {
      kd: {
        $or: [
          { $eq: ["$kd", true] },
          { $eq: ["$inspected_k_d", true] },
          { $eq: ["$pis_k_d", true] },
        ],
      },
    },
  },
];

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  await connectDB();

  const apply = hasFlag("apply");
  const unsetLegacy = hasFlag("unset-legacy");

  const itemQuery = buildItemLegacyKdQuery();
  const inspectionQuery = buildInspectionLegacyKdQuery();
  const [matchingItems, matchingInspections] = await Promise.all([
    Item.countDocuments(itemQuery),
    Inspection.countDocuments(inspectionQuery),
  ]);

  console.log("K/D legacy backfill");
  console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
  console.log(`Items matching legacy K/D true: ${matchingItems}`);
  console.log(`Inspection records matching legacy K/D true: ${matchingInspections}`);

  if (!apply) {
    console.log("No changes written. Re-run with --apply to update kd.");
    return;
  }

  const [itemResult, inspectionResult] = await Promise.all([
    Item.updateMany(itemQuery, itemKdUpdatePipeline),
    Inspection.updateMany(inspectionQuery, inspectionKdUpdatePipeline),
  ]);

  console.log(`Items matched: ${itemResult.matchedCount}, modified: ${itemResult.modifiedCount}`);
  console.log(
    `Inspection records matched: ${inspectionResult.matchedCount}, modified: ${inspectionResult.modifiedCount}`,
  );

  if (unsetLegacy) {
    const [itemUnsetResult, inspectionUnsetResult] = await Promise.all([
      Item.updateMany(
        {},
        { $unset: { inspected_k_d: "", pis_k_d: "", master_k_d: "" } },
        { strict: false },
      ),
      Inspection.updateMany(
        {},
        { $unset: { inspected_k_d: "", pis_k_d: "" } },
        { strict: false },
      ),
    ]);
    console.log(
      `Legacy item fields unset. Matched: ${itemUnsetResult.matchedCount}, modified: ${itemUnsetResult.modifiedCount}`,
    );
    console.log(
      `Legacy inspection fields unset. Matched: ${inspectionUnsetResult.matchedCount}, modified: ${inspectionUnsetResult.modifiedCount}`,
    );
  }
};

main()
  .catch((error) => {
    console.error("K/D legacy backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Item.db.close();
  });
