const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const QC = require("../models/qc.model");
const {
  recomputeLatestInspectionForItem,
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

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  await connectDB();

  const apply = hasFlag("apply");
  const dryRun = hasFlag("dry-run") || !apply;
  const limit = parsePositiveIntArg("limit", 0);

  const qcRows = await QC.find({
    "item.item_code": { $exists: true, $ne: "" },
  })
    .select("item.item_code")
    .lean();
  const itemCodes = [
    ...new Map(
      qcRows
        .map((qcDoc) => normalizeText(qcDoc?.item?.item_code))
        .filter(Boolean)
        .map((itemCode) => [normalizeLookupKey(itemCode), itemCode]),
    ).values(),
  ].slice(
    0,
    limit > 0 ? limit : undefined,
  );

  const summary = {
    dry_run: dryRun,
    apply_requested: apply,
    scanned_qc_rows: qcRows.length,
    item_codes: itemCodes.length,
    matched_items: 0,
    updated_items: 0,
    unchanged_items: 0,
    skipped_missing_item: 0,
    skipped_missing_latest_inspection: 0,
    failed: 0,
  };

  for (const itemCode of itemCodes) {
    try {
      const result = await recomputeLatestInspectionForItem(itemCode, {
        save: !dryRun,
        route: "scripts/syncItemsInspectedDataFromLatestInspections.js",
        source: "sync_items_inspected_data_script",
      });

      if (!result?.matched && result?.skipped_reason === "missing_item") {
        summary.skipped_missing_item += 1;
        continue;
      }
      if (result?.skipped_reason === "missing_latest_inspection") {
        summary.skipped_missing_latest_inspection += 1;
        continue;
      }

      summary.matched_items += 1;
      if (!result?.updated) {
        summary.unchanged_items += 1;
        continue;
      }

      summary.updated_items += 1;
      if (!dryRun && result?.item_doc) {
        await syncTotalPoCbmForItem(result.item_doc.toObject());
      }
    } catch (error) {
      summary.failed += 1;
      console.error("Failed to sync item inspected data:", {
        item_code: itemCode,
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
