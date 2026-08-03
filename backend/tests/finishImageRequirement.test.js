const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const Finish = require("../models/finish.model");

const finishData = {
  color: "Black",
  color_code: "BLK",
  vendor: {
    name: "Vendor",
    vendor_id: new mongoose.Types.ObjectId(),
  },
  vendor_code: "VND",
  item_codes: ["ITEM-1"],
  unique_code: "VND-BLK",
};

test("finishes require a front and back image", async () => {
  await assert.rejects(
    new Finish({
      ...finishData,
      front_image: { key: "finish/front.webp" },
    }).validate(),
    /back_image/i,
  );

  await new Finish({
    ...finishData,
    front_image: { key: "finish/front.webp" },
    back_image: { key: "finish/back.webp" },
  }).validate();
});
