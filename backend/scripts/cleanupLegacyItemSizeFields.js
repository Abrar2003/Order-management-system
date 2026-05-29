const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Item = require("../models/item.model");
const {
  cleanupLegacyItemSizeFields,
} = require("../helpers/itemLegacySizeCleanup");

const hasFlag = (name) => process.argv.includes(`--${name}`);

const parsePositiveIntArg = (name, fallback = 0) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (!arg) return fallback;

  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const addCounts = (target, source = {}) => {
  Object.entries(source || {}).forEach(([key, value]) => {
    target[key] = (target[key] || 0) + Number(value || 0);
  });
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  await connectDB();

  const apply = hasFlag("apply");
  const dryRun = hasFlag("dry-run") || !apply;
  const limit = parsePositiveIntArg("limit", 0);

  const query = {
    $or: [
      { "inspected_item_sizes.0": { $exists: true } },
      { "inspected_box_sizes.0": { $exists: true } },
      { "pis_item_sizes.0": { $exists: true } },
      { "pis_box_sizes.0": { $exists: true } },
    ],
  };

  let cursorQuery = Item.find(query).sort({ code: 1, _id: 1 });
  if (limit > 0) {
    cursorQuery = cursorQuery.limit(limit);
  }

  const summary = {
    dry_run: dryRun,
    apply_requested: apply,
    scanned_items: 0,
    items_needing_cleanup: 0,
    cleaned_items: 0,
    unchanged_items: 0,
    failed: 0,
    counts_by_group: {},
    fields_to_unset: {},
    examples: [],
  };

  const cursor = cursorQuery.cursor();
  for await (const itemDoc of cursor) {
    summary.scanned_items += 1;

    try {
      const cleanupResult = cleanupLegacyItemSizeFields(itemDoc, { dryRun });

      if (!cleanupResult.changed) {
        summary.unchanged_items += 1;
        continue;
      }

      summary.items_needing_cleanup += 1;
      addCounts(summary.counts_by_group, cleanupResult.counts);
      cleanupResult.changedPaths.forEach((field) => {
        summary.fields_to_unset[field] = (summary.fields_to_unset[field] || 0) + 1;
      });

      if (summary.examples.length < 20) {
        summary.examples.push({
          item_id: String(itemDoc?._id || ""),
          code: itemDoc?.code || "",
          fields: cleanupResult.changedPaths,
        });
      }

      if (!dryRun) {
        await itemDoc.save();
        summary.cleaned_items += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error("Failed to cleanup legacy item size fields:", {
        item_id: String(itemDoc?._id || ""),
        code: itemDoc?.code || "",
        error: error?.message || String(error),
      });
    }
  }

  console.log(
    dryRun
      ? "Dry run complete. Re-run with --apply to save legacy item size cleanup."
      : "Legacy item size cleanup complete.",
  );
  console.log(JSON.stringify(summary, null, 2));
};

main()
  .catch((error) => {
    console.error("Legacy item size cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
