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

test("finishes require a front image and allow a temporary back image", async () => {
  await new Finish({
    ...finishData,
    front_image: { key: "finish/front.webp" },
  }).validate();

  await assert.rejects(
    new Finish({
      ...finishData,
      back_image: { key: "finish/back.webp" },
    }).validate(),
    /front_image/i,
  );
});
