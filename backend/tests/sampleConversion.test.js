const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Item = require("../models/item.model");
const Sample = require("../models/sample.model");
const sampleController = require("../controllers/sample.controller");
const wasabiStorage = require("../services/wasabiStorage.service");
const { getVendorName } = require("../helpers/vendorRef");

const makeResponse = () => ({
  statusVal: 0,
  jsonVal: null,
  status(status) {
    this.statusVal = status;
    return this;
  },
  json(payload) {
    this.jsonVal = payload;
    return this;
  },
});

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

test("getSamples includes product image thumbnail fields only when requested", async () => {
  const originalFind = Sample.find;
  const originalCountDocuments = Sample.countDocuments;
  const originalDistinct = Sample.distinct;
  const sampleRow = {
    _id: new mongoose.Types.ObjectId(),
    code: "SAMPLE-IMG-1",
    image: {
      link: "https://example.test/sample-1.png",
      originalName: "sample-1.png",
      contentType: "image/png",
      size: 12,
    },
  };

  Sample.find = () => ({
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => [sampleRow],
  });
  Sample.countDocuments = async () => 1;
  Sample.distinct = async () => [];

  try {
    const withoutThumbnail = makeResponse();
    await sampleController.getSamples(
      { query: {}, user: { role: "admin" } },
      withoutThumbnail,
    );
    assert.equal(withoutThumbnail.statusVal, 200);
    assert.equal("product_image" in withoutThumbnail.jsonVal.data[0], false);
    assert.equal("product_image_url" in withoutThumbnail.jsonVal.data[0], false);

    const withThumbnail = makeResponse();
    await sampleController.getSamples(
      {
        query: { include_product_image_thumbnail: "true" },
        user: { role: "admin" },
      },
      withThumbnail,
    );
    assert.equal(withThumbnail.statusVal, 200);
    assert.equal(withThumbnail.jsonVal.data[0].product_image.originalName, "sample-1.png");
    assert.equal(withThumbnail.jsonVal.data[0].product_image_url, "https://example.test/sample-1.png");
  } finally {
    Sample.find = originalFind;
    Sample.countDocuments = originalCountDocuments;
    Sample.distinct = originalDistinct;
  }
});

test("uploadSampleFile rejects invalid product image file type", async () => {
  const res = makeResponse();

  await sampleController.uploadSampleFile(
    {
      params: { id: new mongoose.Types.ObjectId().toString() },
      body: { file_type: "product_image" },
      file: {
        originalname: "sample.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("pdf"),
        size: 3,
      },
    },
    res,
  );

  assert.equal(res.statusVal, 400);
  assert.match(res.jsonVal.message, /JPG, JPEG, and PNG/i);
});

test("uploadSampleFile stores a valid product image and replaces the previous image", async () => {
  const originalFindOne = Sample.findOne;
  const originalIsConfigured = wasabiStorage.isConfigured;
  const originalCreateStorageKey = wasabiStorage.createStorageKey;
  const originalUploadBuffer = wasabiStorage.uploadBuffer;
  const originalDeleteObject = wasabiStorage.deleteObject;
  const sampleId = new mongoose.Types.ObjectId();
  const deletedKeys = [];
  let saved = false;
  let uploadArgs = null;

  Sample.findOne = async () => ({
    _id: sampleId,
    code: "SAMPLE-IMG-2",
    image: { key: "samples/images/old.png" },
    save: async function save() {
      saved = true;
      return this;
    },
  });
  wasabiStorage.isConfigured = () => true;
  wasabiStorage.createStorageKey = ({ folder, extension }) => `${folder}/new-image${extension}`;
  wasabiStorage.uploadBuffer = async (args) => {
    uploadArgs = args;
    return { key: args.key, size: args.buffer.length };
  };
  wasabiStorage.deleteObject = async (key) => {
    deletedKeys.push(key);
  };

  try {
    const res = makeResponse();
    await sampleController.uploadSampleFile(
      {
        params: { id: sampleId.toString() },
        body: { file_type: "product_image" },
        file: {
          originalname: "new-image.png",
          mimetype: "image/png",
          buffer: Buffer.from("image"),
          size: 5,
        },
        user: { role: "admin", name: "Tester" },
      },
      res,
    );

    assert.equal(res.statusVal, 200);
    assert.equal(saved, true);
    assert.equal(uploadArgs.key, "samples/images/new-image.png");
    assert.equal(res.jsonVal.data.key, "samples/images/new-image.png");
    assert.deepEqual(deletedKeys, ["samples/images/old.png"]);
  } finally {
    Sample.findOne = originalFindOne;
    wasabiStorage.isConfigured = originalIsConfigured;
    wasabiStorage.createStorageKey = originalCreateStorageKey;
    wasabiStorage.uploadBuffer = originalUploadBuffer;
    wasabiStorage.deleteObject = originalDeleteObject;
  }
});

test("convertToItem rejects duplicate item code", async () => {
  const originalSampleFindOne = Sample.findOne;
  const originalItemFindOne = Item.findOne;
  const sampleId = new mongoose.Types.ObjectId();

  Sample.findOne = async () => ({
    _id: sampleId,
    code: "SAMPLE-CONV-DUP",
    brand: "Brand A",
    vendor: ["Vendor A"],
  });
  Item.findOne = () => ({
    select: async () => ({ _id: new mongoose.Types.ObjectId(), code: "ITEM-DUP" }),
  });

  try {
    const res = makeResponse();
    await sampleController.convertToItem(
      {
        params: { id: sampleId.toString() },
        body: { code: "ITEM-DUP", name: "Item Dup", description: "Desc" },
        user: { role: "admin" },
      },
      res,
    );

    assert.equal(res.statusVal, 400);
    assert.match(res.jsonVal.message, /already exists/i);
  } finally {
    Sample.findOne = originalSampleFindOne;
    Item.findOne = originalItemFindOne;
  }
});

test("convertToItem rejects samples without brand or vendor", async () => {
  const originalSampleFindOne = Sample.findOne;
  const sampleId = new mongoose.Types.ObjectId();

  try {
    Sample.findOne = async () => ({
      _id: sampleId,
      code: "SAMPLE-NO-BRAND",
      brand: "",
      vendor: ["Vendor A"],
    });
    const missingBrand = makeResponse();
    await sampleController.convertToItem(
      {
        params: { id: sampleId.toString() },
        body: { code: "ITEM-NO-BRAND", name: "Item", description: "Desc" },
        user: { role: "admin" },
      },
      missingBrand,
    );
    assert.equal(missingBrand.statusVal, 400);
    assert.match(missingBrand.jsonVal.message, /brand/i);

    Sample.findOne = async () => ({
      _id: sampleId,
      code: "SAMPLE-NO-VENDOR",
      brand: "Brand A",
      vendor: [],
    });
    const missingVendor = makeResponse();
    await sampleController.convertToItem(
      {
        params: { id: sampleId.toString() },
        body: { code: "ITEM-NO-VENDOR", name: "Item", description: "Desc" },
        user: { role: "admin" },
      },
      missingVendor,
    );
    assert.equal(missingVendor.statusVal, 400);
    assert.match(missingVendor.jsonVal.message, /vendor/i);
  } finally {
    Sample.findOne = originalSampleFindOne;
  }
});

test("convertToItem creates an item from sample data and copies the sample image", async () => {
  const originalSampleFindOne = Sample.findOne;
  const originalItemFindOne = Item.findOne;
  const originalItemSave = Item.prototype.save;
  const originalIsConfigured = wasabiStorage.isConfigured;
  const originalGetObjectBuffer = wasabiStorage.getObjectBuffer;
  const originalCreateStorageKey = wasabiStorage.createStorageKey;
  const originalUploadBuffer = wasabiStorage.uploadBuffer;
  const originalDeleteObject = wasabiStorage.deleteObject;
  const sampleId = new mongoose.Types.ObjectId();
  const sampleDoc = {
    _id: sampleId,
    code: "SAMPLE-CONV-2",
    name: "Sample Name",
    description: "Sample Desc",
    brand: "Brand A",
    vendor: ["Vendor A"],
    item_sizes: [
      { remark: "item", L: 1, B: 2, H: 3, net_weight: 4, gross_weight: 0 },
      { remark: "stretcher", L: 5, B: 6, H: 7, net_weight: 8, gross_weight: 0 },
    ],
    box_mode: "carton",
    box_sizes: [
      {
        remark: "inner",
        box_type: "inner",
        L: 10,
        B: 20,
        H: 30,
        gross_weight: 0,
        item_count_in_inner: 2,
      },
      {
        remark: "master",
        box_type: "master",
        L: 40,
        B: 50,
        H: 60,
        gross_weight: 15,
        box_count_in_master: 3,
      },
    ],
    cbm: 0,
    image: {
      key: "samples/images/source.jpg",
      originalName: "source.jpg",
      contentType: "image/jpeg",
      size: 6,
    },
    save: async function save() {
      this.saved = true;
      return this;
    },
  };
  let savedItem = null;
  const deletedKeys = [];

  Sample.findOne = async () => sampleDoc;
  Item.findOne = () => ({ select: async () => null });
  Item.prototype.save = async function save() {
    this._id = this._id || new mongoose.Types.ObjectId();
    savedItem = this;
    return this;
  };
  wasabiStorage.isConfigured = () => true;
  wasabiStorage.getObjectBuffer = async (key) => {
    assert.equal(key, "samples/images/source.jpg");
    return {
      buffer: Buffer.from("copied"),
      contentType: "image/jpeg",
      size: 6,
    };
  };
  wasabiStorage.createStorageKey = ({ folder, extension }) => `${folder}/copied${extension}`;
  wasabiStorage.uploadBuffer = async (args) => ({
    key: args.key,
    size: args.buffer.length,
  });
  wasabiStorage.deleteObject = async (key) => {
    deletedKeys.push(key);
  };

  try {
    const res = makeResponse();
    await sampleController.convertToItem(
      {
        params: { id: sampleId.toString() },
        body: {
          code: "ITEM-CONV-2",
          name: "Converted Name",
          description: "Converted Desc",
        },
        user: { role: "admin", name: "Tester" },
      },
      res,
    );

    assert.equal(res.statusVal, 201);
    assert.equal(savedItem.code, "ITEM-CONV-2");
    assert.equal(savedItem.name, "Converted Name");
    assert.equal(savedItem.brand, "Brand A");
    assert.deepEqual(savedItem.vendors.map(getVendorName), ["Vendor A"]);
    assert.deepEqual(
      savedItem.inspected_item_sizes.map((entry) => entry.remark),
      ["item", "stretcher"],
    );
    assert.equal(savedItem.inspected_box_mode, "carton");
    assert.equal(savedItem.inspected_box_sizes[0].box_type, "inner");
    assert.equal(savedItem.image.key, "item-image/copied.jpg");
    assert.notEqual(savedItem.image.key, sampleDoc.image.key);
    assert.equal(sampleDoc.converted_item.code, "ITEM-CONV-2");
    assert.equal(sampleDoc.saved, true);
    assert.deepEqual(deletedKeys, []);
  } finally {
    Sample.findOne = originalSampleFindOne;
    Item.findOne = originalItemFindOne;
    Item.prototype.save = originalItemSave;
    wasabiStorage.isConfigured = originalIsConfigured;
    wasabiStorage.getObjectBuffer = originalGetObjectBuffer;
    wasabiStorage.createStorageKey = originalCreateStorageKey;
    wasabiStorage.uploadBuffer = originalUploadBuffer;
    wasabiStorage.deleteObject = originalDeleteObject;
  }
});
