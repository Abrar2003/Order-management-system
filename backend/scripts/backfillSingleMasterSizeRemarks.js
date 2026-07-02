const path = require("path");

const mongoose = require("mongoose");

const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Item = require("../models/item.model");
const {
  normalizeKey,
  needsSingleMasterItemRemarkBackfill,
  needsSingleMasterBoxRemarkBackfill,
} = require("../helpers/masterSizeRemarks");

const hasFlag = (name) => process.argv.includes(`--${name}`);

const getCandidateQuery = () => ({
  $or: [
    {
      $expr: {
        $eq: [{ $size: { $ifNull: ["$master_item_sizes", []] } }, 1],
      },
    },
    {
      $expr: {
        $eq: [{ $size: { $ifNull: ["$master_box_sizes", []] } }, 1],
      },
    },
  ],
});

const sortCodes = (codes = []) =>
  [...codes].sort((left, right) =>
    String(left).localeCompare(String(right), undefined, { sensitivity: "base" }),
  );

const summarizeDocs = ({ totalItems = 0, docs = [] } = {}) => {
  const touchedCodes = new Set();
  const itemUpdateCodes = new Set();
  const boxUpdateCodes = new Set();
  const examples = [];
  const summary = {
    totalItems,
    singleMasterItemSizeRows: 0,
    singleMasterItemAlreadyItem: 0,
    singleMasterItemBlankToUpdate: 0,
    singleMasterItemOtherRemarks: 0,
    singleMasterBoxSizeRows: 0,
    singleMasterBoxAlreadyBox: 0,
    singleMasterBoxBlankToUpdate: 0,
    singleMasterBoxOtherRemarks: 0,
    totalItemDocumentsToTouch: 0,
    itemRemarkUpdateDocuments: 0,
    boxRemarkUpdateDocuments: 0,
    affectedCodes: [],
    examples,
  };

  docs.forEach((doc) => {
    const code = String(doc?.code || doc?._id || "").trim();
    const itemSizes = Array.isArray(doc?.master_item_sizes)
      ? doc.master_item_sizes
      : [];
    const boxSizes = Array.isArray(doc?.master_box_sizes)
      ? doc.master_box_sizes
      : [];
    const itemNeedsUpdate = needsSingleMasterItemRemarkBackfill(itemSizes);
    const boxNeedsUpdate = needsSingleMasterBoxRemarkBackfill(boxSizes);

    if (itemSizes.length === 1) {
      summary.singleMasterItemSizeRows += 1;
      const remark = normalizeKey(itemSizes[0]?.remark);
      if (!remark) {
        summary.singleMasterItemBlankToUpdate += 1;
      } else if (remark === "item") {
        summary.singleMasterItemAlreadyItem += 1;
      } else {
        summary.singleMasterItemOtherRemarks += 1;
      }
    }

    if (boxSizes.length === 1) {
      summary.singleMasterBoxSizeRows += 1;
      const remark = normalizeKey(boxSizes[0]?.remark);
      if (!remark) {
        summary.singleMasterBoxBlankToUpdate += 1;
      } else if (remark === "box") {
        summary.singleMasterBoxAlreadyBox += 1;
      } else {
        summary.singleMasterBoxOtherRemarks += 1;
      }
    }

    if (itemNeedsUpdate) {
      itemUpdateCodes.add(code);
      touchedCodes.add(code);
    }
    if (boxNeedsUpdate) {
      boxUpdateCodes.add(code);
      touchedCodes.add(code);
    }
    if ((itemNeedsUpdate || boxNeedsUpdate) && examples.length < 20) {
      examples.push({
        code,
        item_remark_before:
          itemSizes.length === 1 ? String(itemSizes[0]?.remark ?? "") : null,
        item_remark_after: itemNeedsUpdate ? "item" : null,
        box_remark_before:
          boxSizes.length === 1 ? String(boxSizes[0]?.remark ?? "") : null,
        box_remark_after: boxNeedsUpdate ? "box" : null,
      });
    }
  });

  summary.totalItemDocumentsToTouch = touchedCodes.size;
  summary.itemRemarkUpdateDocuments = itemUpdateCodes.size;
  summary.boxRemarkUpdateDocuments = boxUpdateCodes.size;
  summary.affectedCodes = sortCodes([...touchedCodes]);

  return summary;
};

const buildBulkOps = (docs = []) =>
  docs
    .map((doc) => {
      const $set = {};
      if (needsSingleMasterItemRemarkBackfill(doc?.master_item_sizes)) {
        $set["master_item_sizes.0.remark"] = "item";
      }
      if (needsSingleMasterBoxRemarkBackfill(doc?.master_box_sizes)) {
        $set["master_box_sizes.0.remark"] = "box";
      }
      if (Object.keys($set).length === 0) return null;

      return {
        updateOne: {
          filter: { _id: doc._id },
          update: { $set },
        },
      };
    })
    .filter(Boolean);

const printSummary = (summary, { apply = false, result = null } = {}) => {
  console.log("Single-entry Master size remark backfill");
  console.log(`Mode: ${apply ? "apply" : "preview"}`);
  console.log(`Total items: ${summary.totalItems}`);
  console.log(`Single Master item-size rows: ${summary.singleMasterItemSizeRows}`);
  console.log(`  Already item: ${summary.singleMasterItemAlreadyItem}`);
  console.log(`  Blank/missing remark to update: ${summary.singleMasterItemBlankToUpdate}`);
  console.log(`  Other nonblank remarks unchanged: ${summary.singleMasterItemOtherRemarks}`);
  console.log(`Single Master box-size rows: ${summary.singleMasterBoxSizeRows}`);
  console.log(`  Already box: ${summary.singleMasterBoxAlreadyBox}`);
  console.log(`  Blank/missing remark to update: ${summary.singleMasterBoxBlankToUpdate}`);
  console.log(`  Other nonblank remarks unchanged: ${summary.singleMasterBoxOtherRemarks}`);
  console.log(`Total item documents to touch: ${summary.totalItemDocumentsToTouch}`);
  console.log(`Item remark update documents: ${summary.itemRemarkUpdateDocuments}`);
  console.log(`Box remark update documents: ${summary.boxRemarkUpdateDocuments}`);
  console.log(`Affected item codes: ${summary.affectedCodes.join(", ") || "None"}`);

  if (result) {
    console.log(`Mongo matched: ${result.matchedCount || 0}`);
    console.log(`Mongo modified: ${result.modifiedCount || 0}`);
  } else if (!apply) {
    console.log("No changes written. Re-run with --apply after approval to update MongoDB.");
  }
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
    preserveExistingEnv: true,
  });

  const apply = hasFlag("apply");
  const preview = hasFlag("preview") || !apply;
  if (apply && preview) {
    throw new Error("Use either --preview or --apply, not both");
  }

  await connectDB();

  const [totalItems, docs] = await Promise.all([
    Item.countDocuments({}),
    Item.find(getCandidateQuery())
      .select("code master_item_sizes master_box_sizes")
      .lean(),
  ]);

  const summary = summarizeDocs({ totalItems, docs });
  const ops = buildBulkOps(docs);

  if (!apply) {
    printSummary(summary, { apply: false });
    return;
  }

  const result = ops.length > 0
    ? await Item.bulkWrite(ops, { ordered: false })
    : { matchedCount: 0, modifiedCount: 0 };

  printSummary(summary, { apply: true, result });
};

main()
  .catch((error) => {
    console.error("Single-entry Master size remark backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
