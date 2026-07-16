const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Item = require("../models/item.model");

test("item country follows its vendor country", async () => {
  const item = new Item({
    code: "VENDOR-COUNTRY-CHECK",
    vendors: [{
      name: "Vallabh",
      vendor_id: new mongoose.Types.ObjectId(),
      country: "India",
    }],
  });

  await item.validate();
  assert.equal(item.country_of_origin, "India");
});
