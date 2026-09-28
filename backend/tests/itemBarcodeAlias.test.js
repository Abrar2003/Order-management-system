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

test("PIS and inspected Logistics EAN values require a valid EAN-13", async () => {
  const item = new Item({
    code: "96574",
    pis_logistics_ean: "872-1274914153",
    inspected_logistics_ean: "8721274914153",
    pis_logistics_eans: ["872-1274914153", "4006381333931"],
    inspected_logistics_eans: ["8721274914153", "4006381333931"],
  });

  await item.validate();
  assert.equal(item.pis_logistics_ean, "8721274914153");
  assert.equal(item.inspected_logistics_ean, "8721274914153");
  assert.deepEqual(item.pis_logistics_eans, ["8721274914153", "4006381333931"]);
  assert.deepEqual(item.inspected_logistics_eans, ["8721274914153", "4006381333931"]);

  await assert.rejects(
    new Item({ code: "96575", pis_logistics_ean: "8721274914154" }).validate(),
    /Logistics EAN must be a valid 13-digit EAN/,
  );
  await assert.rejects(
    new Item({ code: "96576", pis_logistics_eans: ["8721274914154"] }).validate(),
    /Logistics EAN must be a valid 13-digit EAN/,
  );
});
