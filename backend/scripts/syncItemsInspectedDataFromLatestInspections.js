const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Inspection = require("../models/inspection.model");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const {
  applyLatestInspectionToItem,
  getInspectionSortTime,
  getQcItemCode,
  hasModernInspectionData,
} = require("../services/inspectionItemSync.service");
const {
  syncTotalPoCbmForItem,
} = require("../services/orderCbm.service");

const parsePositiveIntArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) return fallback;

  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLookupKey = (value) => normalizeText(value).toLowerCase();

const escapeRegex = (value = "") =>
  normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildItemCodeQuery = (codes = []) => ({
  $or: codes.map((code) => ({
    code: { $regex: `^${escapeRegex(code)}$`, $options: "i" },
  })),
});

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  await connectDB();

  const apply = hasFlag("apply");
  const dryRun = hasFlag("dry-run") || !apply;
  const limit = parsePositiveIntArg("limit", 0);

  const inspectionsQuery = {};
  const inspections = await Inspection.find(inspectionsQuery)
    .select(
      [
        "_id",
        "qc",
        "inspection_date",
        "createdAt",
        "updatedAt",
        "barcode",
        "master_barcode",
        "inner_barcode",
        "packed_size",
        "finishing",
        "branding",
        "kd",
        "inspected_item_sizes",
        "inspected_box_sizes",
        "inspected_box_mode",
      ].join(" "),
    )
    .sort({ inspection_date: -1, createdAt: -1, _id: -1 })
    .lean();

  const qcIds = [
    ...new Set(
      inspections
        .map((inspection) => String(inspection?.qc || "").trim())
        .filter((value) => mongoose.Types.ObjectId.isValid(value)),
    ),
  ];

  const qcs = qcIds.length > 0
    ? await QC.find({
        _id: { $in: qcIds.map((value) => new mongoose.Types.ObjectId(value)) },
      })
        .select(
          "_id item.item_code order.item_code order_meta.item_code quantities last_inspected_date",
        )
        .lean()
    : [];
  const qcById = new Map(qcs.map((qcDoc) => [String(qcDoc?._id || ""), qcDoc]));
  const latestByItemCode = new Map();

  for (const inspection of inspections) {
    const qcDoc = qcById.get(String(inspection?.qc || ""));
    if (!qcDoc) continue;

    const itemCode = getQcItemCode(qcDoc);
    const itemCodeKey = normalizeLookupKey(itemCode);
    if (!itemCodeKey) continue;
    if (!hasModernInspectionData(inspection)) continue;

    const sortTime = getInspectionSortTime(inspection);
    const existing = latestByItemCode.get(itemCodeKey);
    if (existing && existing.sortTime >= sortTime) continue;

    latestByItemCode.set(itemCodeKey, {
      itemCode,
      qcDoc,
      inspection,
      sortTime,
    });
  }

  const latestEntries = [...latestByItemCode.values()].slice(
    0,
    limit > 0 ? limit : latestByItemCode.size,
  );
  const itemCodes = latestEntries.map((entry) => entry.itemCode).filter(Boolean);
  const items = itemCodes.length > 0
    ? await Item.find(buildItemCodeQuery(itemCodes))
    : [];
  const itemByCode = new Map(
    items.map((itemDoc) => [normalizeLookupKey(itemDoc?.code), itemDoc]),
  );

  const summary = {
    dry_run: dryRun,
    apply_requested: apply,
    scanned_inspections: inspections.length,
    latest_item_matches: latestEntries.length,
    matched_items: 0,
    updated_items: 0,
    unchanged_items: 0,
    skipped_missing_item: 0,
    skipped_without_inspection_data: 0,
    failed: 0,
  };

  for (const entry of latestEntries) {
    const itemDoc = itemByCode.get(normalizeLookupKey(entry.itemCode));
    if (!itemDoc) {
      summary.skipped_missing_item += 1;
      continue;
    }
    if (!hasModernInspectionData(entry.inspection)) {
      summary.skipped_without_inspection_data += 1;
      continue;
    }

    summary.matched_items += 1;
    try {
      const changed = applyLatestInspectionToItem({
        itemDoc,
        inspectionRecord: entry.inspection,
        qcDoc: entry.qcDoc,
      });

      if (!changed) {
        summary.unchanged_items += 1;
        continue;
      }

      summary.updated_items += 1;
    if (!dryRun) {
      await itemDoc.save();
      await syncTotalPoCbmForItem(itemDoc.toObject());
    }
    } catch (error) {
      summary.failed += 1;
      console.error("Failed to sync item inspected data:", {
        item_code: entry.itemCode,
        inspection_id: entry?.inspection?._id,
        error: error?.message || String(error),
      });
    }
  }

  console.log(
    dryRun
      ? "Dry run complete. Re-run with --apply to save item inspected data updates."
      : "Item inspected data sync from latest inspections complete.",
  );
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error("Item inspected data sync from latest inspections failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
