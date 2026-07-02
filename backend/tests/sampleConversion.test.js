const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Item = require("../models/item.model");
const Sample = require("../models/sample.model");
const sampleController = require("../controllers/sample.controller");

test("Mongoose Sample model schema includes converted_item field validation", () => {
  const sample = new Sample({
    code: "SAMPLE-CONV-1",
    converted_item: {
      item: new mongoose.Types.ObjectId(),
      code: "ITEM-CONV-1",
      name: "Converted Item Name",
      description: "Converted description",
      converted_at: new Date(),
      converted_by: { id: "user-1", name: "User" },
    },
  });

  const error = sample.validateSync();
  assert.equal(error, undefined);
  assert.equal(sample.converted_item.code, "ITEM-CONV-1");
  assert.equal(sample.converted_item.name, "Converted Item Name");
});

test("convertToItem returns error 400 if input code is missing", async () => {
  let statusVal = 0;
  let jsonVal = null;
  const req = {
    params: { id: new mongoose.Types.ObjectId().toString() },
    body: { code: "", name: "Test Item", description: "Desc" },
  };
  const res = {
    status(s) {
      statusVal = s;
      return this;
    },
    json(j) {
      jsonVal = j;
      return this;
    },
  };

  await sampleController.convertToItem(req, res);
  assert.equal(statusVal, 400);
  assert.equal(jsonVal.success, false);
  assert.match(jsonVal.message, /code/i);
});

test("convertToItem returns error 404 if sample is not found", async () => {
  let statusVal = 0;
  let jsonVal = null;
  const sampleId = new mongoose.Types.ObjectId();
  const req = {
    params: { id: sampleId.toString() },
    body: { code: "ITEM-NEW-1", name: "Test Item", description: "Desc" },
    user: { id: "123", name: "Tester", role: "admin" },
  };
  const res = {
    status(s) {
      statusVal = s;
      return this;
    },
    json(j) {
      jsonVal = j;
      return this;
    },
  };

  const originalFindOne = Sample.findOne;
  Sample.findOne = async () => null;

  try {
    await sampleController.convertToItem(req, res);
    assert.equal(statusVal, 404);
    assert.equal(jsonVal.success, false);
    assert.match(jsonVal.message, /not found/i);
  } finally {
    Sample.findOne = originalFindOne;
  }
});
