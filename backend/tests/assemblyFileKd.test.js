const assert = require("node:assert/strict");
const test = require("node:test");

const Item = require("../models/item.model");

test("an uploaded assembly file keeps K/D enabled", async () => {
  const item = new Item({
    code: "ASSEMBLY-KD-TEST",
    kd: false,
    assembly_file: { key: "item-assembly/example.pdf" },
  });

  await item.validate();

  assert.equal(item.kd, true);
});
