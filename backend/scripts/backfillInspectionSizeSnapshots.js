const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Inspection = require("../models/inspection.model");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const {
  buildInspectionSizeSnapshot,
} = require("../helpers/inspectionSizeSnapshot");

const INSPECTION_SIZE_SOURCE_SELECT = [
  "code",
  "inspected_item_sizes",
  "inspected_box_sizes",
  "inspected_box_mode",
  "inspected_item_LBH",
  "inspected_item_top_LBH",
  "inspected_item_bottom_LBH",
  "inspected_box_LBH",
  "inspected_box_top_LBH",
  "inspected_box_bottom_LBH",
  "inspected_top_LBH",
  "inspected_bottom_LBH",
  "inspected_weight",
].join(" ");

const parsePositiveIntArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) return fallback;

  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const escapeRegex = (value = "") =>
  String(value)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLookupKey = (value) => normalizeText(value).toLowerCase();

const hasSnapshotData = (snapshot = {}) =>
  (Array.isArray(snapshot?.inspected_item_sizes) && snapshot.inspected_item_sizes.length > 0) ||
  (Array.isArray(snapshot?.inspected_box_sizes) && snapshot.inspected_box_sizes.length > 0) ||
  Boolean(normalizeText(snapshot?.inspected_box_mode));

const buildInspectionQuery = () => ({
  $or: [
    { inspected_item_sizes: { $exists: false } },
    { inspected_box_sizes: { $exists: false } },
    { inspected_box_mode: { $exists: false } },
    {
      $and: [
        { inspected_item_sizes: { $size: 0 } },
        { inspected_box_sizes: { $size: 0 } },
      ],
    },
  ],
});

const chunkArray = (items = [], size = 100) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  await connectDB();

  const apply = hasFlag("apply");
  const dryRun = hasFlag("dry-run") || !apply;
  const limit = parsePositiveIntArg("limit", 500);
  const batchSize = parsePositiveIntArg("batch-size", 100);

  const inspections = await Inspection.find(buildInspectionQuery())
    .select("_id qc inspected_item_sizes inspected_box_sizes inspected_box_mode")
    .sort({ _id: 1 })
    .limit(limit)
    .lean();

  const qcIds = [
    ...new Set(
      (Array.isArray(inspections) ? inspections : [])
        .map((inspection) => String(inspection?.qc || "").trim())
        .filter((value) => mongoose.Types.ObjectId.isValid(value)),
    ),
  ];
  const qcs = qcIds.length > 0
    ? await QC.find({
        _id: {
          $in: qcIds.map((value) => new mongoose.Types.ObjectId(value)),
        },
      })
        .select("_id item.item_code order.item_code")
        .lean()
    : [];
  const qcById = new Map(
    (Array.isArray(qcs) ? qcs : []).map((qcDoc) => [String(qcDoc?._id || ""), qcDoc]),
  );

  const itemCodes = [
    ...new Set(
      (Array.isArray(qcs) ? qcs : [])
        .map((qcDoc) => normalizeText(qcDoc?.item?.item_code || qcDoc?.order?.item?.item_code))
        .filter(Boolean),
    ),
  ];
  const items = itemCodes.length > 0
    ? await Item.find({
        $or: itemCodes.map((code) => ({
          code: {
            $regex: `^${escapeRegex(code)}$`,
            $options: "i",
          },
        })),
      })
        .select(INSPECTION_SIZE_SOURCE_SELECT)
        .lean()
    : [];
  const itemByCode = new Map(
    (Array.isArray(items) ? items : []).map((itemDoc) => [
      normalizeLookupKey(itemDoc?.code),
      itemDoc,
    ]),
  );

  const summary = {
    dry_run: dryRun,
    apply_requested: apply,
    limit,
    batch_size: batchSize,
    scanned: Array.isArray(inspections) ? inspections.length : 0,
    matched_qc: 0,
    matched_item: 0,
    prepared_updates: 0,
    applied_updates: 0,
    skipped_missing_qc: 0,
    skipped_missing_item: 0,
    skipped_without_snapshot_data: 0,
  };

  const bulkOps = [];

  for (const inspection of Array.isArray(inspections) ? inspections : []) {
    const qcDoc = qcById.get(String(inspection?.qc || "").trim());
    if (!qcDoc) {
      summary.skipped_missing_qc += 1;
      continue;
    }
    summary.matched_qc += 1;

    const itemCodeKey = normalizeLookupKey(
      qcDoc?.item?.item_code || qcDoc?.order?.item?.item_code || "",
    );
    const itemDoc = itemByCode.get(itemCodeKey);
    if (!itemDoc) {
      summary.skipped_missing_item += 1;
      continue;
    }
    summary.matched_item += 1;

    const snapshot = buildInspectionSizeSnapshot({
      qcDoc,
      currentSource: itemDoc,
    });
    if (!hasSnapshotData(snapshot)) {
      summary.skipped_without_snapshot_data += 1;
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: inspection._id },
        update: {
          $set: {
            inspected_item_sizes: snapshot.inspected_item_sizes,
            inspected_box_sizes: snapshot.inspected_box_sizes,
            inspected_box_mode: snapshot.inspected_box_mode,
          },
        },
      },
    });
    summary.prepared_updates += 1;
  }

  if (!dryRun && bulkOps.length > 0) {
    const chunks = chunkArray(bulkOps, batchSize);
    for (const chunk of chunks) {
      await Inspection.bulkWrite(chunk, { ordered: false });
      summary.applied_updates += chunk.length;
      console.log(`Applied ${summary.applied_updates}/${bulkOps.length} snapshot updates...`);
    }
  }

  console.log(
    "Inspection size snapshot backfill completed. Backfilled rows use current item inspected sizes, so they are not historical originals.",
  );
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error("Inspection size snapshot backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
