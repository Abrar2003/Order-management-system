const assert = require("node:assert/strict");
const test = require("node:test");

const Item = require("../models/item.model");
const {
  normalizeSingleMasterItemSizeRemarks,
  normalizeSingleMasterBoxSizeRemarks,
  normalizeSingleMasterSizeRemarks,
  needsSingleMasterItemRemarkBackfill,
  needsSingleMasterBoxRemarkBackfill,
} = require("../helpers/masterSizeRemarks");

test("single Master item entry with blank remark becomes item", () => {
  const result = normalizeSingleMasterItemSizeRemarks([
    { L: 100, B: 50, H: 75, remark: "" },
  ]);

  assert.equal(result[0].remark, "item");
});

test("single Master box entry with blank remark becomes box", () => {
  const result = normalizeSingleMasterBoxSizeRemarks([
    { L: 60, B: 40, H: 30, remark: "   " },
  ]);

  assert.equal(result[0].remark, "box");
});

test("multi-entry Master sizes keep their existing remarks", () => {
  const result = normalizeSingleMasterSizeRemarks({
    masterItemSizes: [
      { remark: "item", L: 100 },
      { remark: "top", L: 100 },
    ],
    masterBoxSizes: [
      { remark: "box1", L: 60 },
      { remark: "box2", L: 40 },
    ],
  });

  assert.deepEqual(
    result.master_item_sizes.map((entry) => entry.remark),
    ["item", "top"],
  );
  assert.deepEqual(
    result.master_box_sizes.map((entry) => entry.remark),
    ["box1", "box2"],
  );
});

test("already-correct single Master entries remain unchanged", () => {
  const itemSizes = normalizeSingleMasterItemSizeRemarks([
    { L: 100, B: 50, H: 75, remark: "item" },
  ]);
  const boxSizes = normalizeSingleMasterBoxSizeRemarks([
    { L: 60, B: 40, H: 30, remark: "box" },
  ]);

  assert.equal(itemSizes[0].remark, "item");
  assert.equal(boxSizes[0].remark, "box");
  assert.equal(needsSingleMasterItemRemarkBackfill(itemSizes), false);
  assert.equal(needsSingleMasterBoxRemarkBackfill(boxSizes), false);
});

test("Item validation normalizes blank single Master size remarks before save", async () => {
  const item = new Item({
    code: "MASTER-SINGLE-REMARK",
    master_item_sizes: [{ L: 100, B: 50, H: 75, remark: "" }],
    master_box_sizes: [{ L: 60, B: 40, H: 30, remark: "" }],
  });

  await item.validate();

  assert.equal(item.master_item_sizes[0].remark, "item");
  assert.equal(item.master_box_sizes[0].remark, "box");
});
