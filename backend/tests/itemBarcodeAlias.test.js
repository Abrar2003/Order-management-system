const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const Item = require("../models/item.model");

test("comment-only item saves preserve unselected barcode fields", async () => {
  const item = Item.hydrate(
    {
      _id: new mongoose.Types.ObjectId(),
      code: "96573",
      qc_mismatch_comments: [],
    },
    { code: 1, qc_mismatch_comments: 1 },
  );

  item.qc_mismatch_comments.push({ comment: "Item Weight Change in QC Reports" });
  await item.validate();

  assert.deepEqual(item.modifiedPaths(), ["qc_mismatch_comments"]);
});

test("loaded barcode aliases remain synchronized", async () => {
  const item = new Item({ code: "96573", pis_barcode: " 8719087034571 " });

  await item.validate();

  assert.equal(item.pis_barcode, "8719087034571");
  assert.equal(item.pis_master_barcode, "8719087034571");
});
