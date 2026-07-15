const test = require("node:test");
const assert = require("node:assert/strict");

const Brand = require("../models/brand.model");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const UploadLog = require("../models/uploadLog.model");
const Vendor = require("../models/vendor.model");
const orderController = require("../controllers/order.controller");

const GIGA_ID = "64b000000000000000000001";
const BY_BOO_ID = "64b000000000000000000002";
const VENDOR_ID = "64c000000000000000000001";

const makeResponse = () => ({
  statusVal: 200,
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

const asQuery = (value) => ({
  select() {
    return this;
  },
  lean: async () => value,
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const validBody = (overrides = {}) => ({
  po: {
    order_id: "PO-1",
    brand: "Giga",
    vendor: "Jodhana",
    order_date: "2026-07-15",
    ETD: "2026-10-15",
    ...(overrides.po || {}),
  },
  items: overrides.items || [
    { item_code: "ITEM-1", description: "Chair", quantity: 2 },
  ],
});

const requestFor = (body, user = {}) => ({
  body,
  user: {
    role: "admin",
    allowed_brands: [],
    allowed_vendors: ["all"],
    brand_scope: "all",
    ...user,
  },
});

const stubItemLookup = (t, docs = []) => {
  t.mock.method(Item, "find", () => asQuery(docs));
};

const stubManualOrderWrites = (t, { associatedBrand = "Giga" } = {}) => {
  const inserted = [];
  const brands = [
    { _id: GIGA_ID, name: "Giga" },
    { _id: BY_BOO_ID, name: "By Boo" },
  ];

  t.mock.method(Brand, "find", () => asQuery(brands));
  t.mock.method(Vendor, "find", () => asQuery([
    {
      _id: VENDOR_ID,
      name: "Jodhana",
      brands: [{
        brand_id: associatedBrand === "Giga" ? GIGA_ID : BY_BOO_ID,
        brand_name: associatedBrand,
      }],
      vendor_code: [],
      is_active: true,
    },
  ]));
  t.mock.method(Order, "aggregate", async () => []);
  t.mock.method(Order, "find", () => asQuery([]));
  t.mock.method(Order, "insertMany", async (orders) => {
    inserted.push(...orders);
    return orders;
  });
  t.mock.method(Item, "findOne", async () => null);
  t.mock.method(Item.prototype, "save", async function save() {
    return this;
  });
  t.mock.method(UploadLog, "create", async () => ({ _id: "upload-log-1" }));
  t.mock.method(console, "error", () => {});

  const googleEnvKeys = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_REFRESH_TOKEN",
  ];
  const originalGoogleEnv = Object.fromEntries(
    googleEnvKeys.map((key) => [key, process.env[key]]),
  );
  googleEnvKeys.forEach((key) => delete process.env[key]);
  t.after(() => {
    googleEnvKeys.forEach((key) => {
      if (originalGoogleEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalGoogleEnv[key];
    });
  });

  return inserted;
};

test("rejects missing grouped PO fields", async (t) => {
  stubItemLookup(t, [{
    code: "ITEM-1",
    description: "Master Chair",
    brand: "Giga",
    vendors: ["Jodhana"],
  }]);
  const res = makeResponse();

  await orderController.createOrdersManually(
    requestFor(validBody({
      po: { order_id: "", brand: "", vendor: "", ETD: "" },
    })),
    res,
  );

  assert.equal(res.statusVal, 400);
  assert.deepEqual(res.jsonVal.missing_required_fields[0].missing_fields, [
    "PO",
    "Brand",
    "Vendor",
    "ETD",
  ]);
});

test("rejects invalid manual item quantities", async (t) => {
  stubItemLookup(t);
  const res = makeResponse();

  await orderController.createOrdersManually(
    requestFor(validBody({
      items: [{ item_code: "ITEM-1", description: "Chair", quantity: 0 }],
    })),
    res,
  );

  assert.equal(res.statusVal, 400);
  assert.deepEqual(res.jsonVal.missing_required_fields[0].missing_fields, [
    "Quantity (> 0)",
  ]);
});

for (const [field, value, reason] of [
  ["order_date", "2026-02-30", "invalid_order_date"],
  ["ETD", "not-a-date", "invalid_etd"],
]) {
  test(`rejects an invalid ${field}`, async (t) => {
    stubItemLookup(t);
    const res = makeResponse();

    await orderController.createOrdersManually(
      requestFor(validBody({ po: { [field]: value } })),
      res,
    );

    assert.equal(res.statusVal, 400);
    assert.deepEqual(res.jsonVal.invalid_entries, [{
      order_id: "PO-1",
      item_code: "ITEM-1",
      reason,
    }]);
  });
}

test("skips duplicate item codes within the grouped PO", async (t) => {
  stubItemLookup(t);
  const inserted = stubManualOrderWrites(t);
  const res = makeResponse();

  await orderController.createOrdersManually(
    requestFor(validBody({
      items: [
        { item_code: "ITEM-1", description: "Chair", quantity: 2 },
        { item_code: "item-1", description: "Chair duplicate", quantity: 3 },
      ],
    })),
    res,
  );

  assert.equal(res.statusVal, 201);
  assert.equal(inserted.length, 1);
  assert.equal(res.jsonVal.duplicate_count, 1);
  assert.equal(res.jsonVal.duplicate_entries[0].reason, "duplicate_in_payload");
});

test("rejects a vendor that is not associated with the selected brand", async (t) => {
  stubItemLookup(t);
  const inserted = stubManualOrderWrites(t, { associatedBrand: "By Boo" });
  const res = makeResponse();

  await orderController.createOrdersManually(requestFor(validBody()), res);

  assert.equal(res.statusVal, 400);
  assert.equal(res.jsonVal.message, "Manual order add failed");
  assert.match(res.jsonVal.error, /not associated with the selected brand/i);
  assert.equal(inserted.length, 0);
});

test("manual options expose only Giga associations to a Giga-scoped user", async (t) => {
  t.mock.method(Brand, "find", () => asQuery([
    { _id: GIGA_ID, name: "Giga" },
    { _id: BY_BOO_ID, name: "By Boo" },
  ]));
  t.mock.method(Vendor, "find", () => asQuery([
    {
      _id: VENDOR_ID,
      name: "Jodhana",
      brands: [{ brand_id: GIGA_ID, brand_name: "Giga" }],
      vendor_code: [],
    },
    {
      _id: "64c000000000000000000002",
      name: "Dutch Vendor",
      brands: [{ brand_id: BY_BOO_ID, brand_name: "By Boo" }],
      vendor_code: [],
    },
    {
      _id: "64c000000000000000000003",
      name: "Mixed Vendor",
      brands: [
        { brand_id: GIGA_ID, brand_name: "Giga" },
        { brand_id: BY_BOO_ID, brand_name: "By Boo" },
      ],
      vendor_code: [],
    },
  ]));
  t.mock.method(Order, "aggregate", async () => []);
  const res = makeResponse();

  await orderController.getManualOrderOptions(
    requestFor({}, { brand_scope: "giga" }),
    res,
  );

  assert.equal(res.statusVal, 200);
  assert.deepEqual(res.jsonVal.brands, ["Giga"]);
  assert.deepEqual(
    res.jsonVal.vendors.map((vendor) => ({
      name: vendor.name,
      brands: vendor.brands,
    })),
    [
      { name: "Jodhana", brands: ["Giga"] },
      { name: "Mixed Vendor", brands: ["Giga"] },
    ],
  );
});
