const assert = require("node:assert/strict");
const test = require("node:test");
const Item = require("../models/item.model");
const { __test__ } = require("../services/itemSync");

test("items save one canonical brand", async () => {
  const item = new Item({
    code: "BRAND-TEST-1",
    brand: "By Boo",
    brand_name: "Eleonora",
    brands: ["By Boo", "Eleonora"],
  });

  await item.validate();
  assert.deepEqual([item.brand, item.brand_name, item.brands], ["By Boo", "By Boo", ["By Boo"]]);
});

test("PO sync does not add a second item brand", () => {
  const item = { brand: "By Boo", brand_name: "By Boo", brands: ["By Boo"], vendors: [], source: {} };
  __test__.applyOrderSnapshot(item, { brand: "Eleonora", item: { description: "Lamp" } });

  assert.deepEqual([item.brand, item.brand_name, item.brands], ["By Boo", "By Boo", ["By Boo"]]);
});
