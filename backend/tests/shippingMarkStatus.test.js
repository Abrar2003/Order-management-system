const assert = require("node:assert/strict");
const test = require("node:test");

const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const { updateShippingMarkUpdated } = require("../controllers/qc.controller");
const {
  updateShippingMarkUpdated: updateItemShippingMarkUpdated,
} = require("../controllers/item.controller");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("manager can mark an item shipping mark as updated through a QC record", async (t) => {
  let update = null;
  t.mock.method(QC, "findOne", () => ({
    select() { return this; },
    lean: async () => ({ item: { item_code: "ITEM-1" } }),
  }));
  t.mock.method(Item, "findOneAndUpdate", (_filter, nextUpdate) => {
    update = nextUpdate;
    return { lean: async () => ({ shipping_mark_updated: true }) };
  });
  const res = createResponse();

  await updateShippingMarkUpdated(
    {
      params: { id: "507f1f77bcf86cd799439011" },
      body: { shipping_mark_updated: true },
      user: { _id: "507f1f77bcf86cd799439012", role: "manager" },
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { shipping_mark_updated: true });
  assert.equal(update.$set.shipping_mark_updated, true);
});

test("manager can mark an item shipping mark as updated without a QC record", async (t) => {
  let update = null;
  t.mock.method(Item, "findOneAndUpdate", (_filter, nextUpdate) => {
    update = nextUpdate;
    return { lean: async () => ({ shipping_mark_updated: true }) };
  });
  const res = createResponse();

  await updateItemShippingMarkUpdated(
    {
      params: { id: "507f1f77bcf86cd799439011" },
      body: { shipping_mark_updated: true },
      user: { _id: "507f1f77bcf86cd799439012", role: "manager" },
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { shipping_mark_updated: true });
  assert.equal(update.$set.shipping_mark_updated, true);
});

test("QC users cannot change shipping mark status", async () => {
  const res = createResponse();

  await updateShippingMarkUpdated(
    {
      params: { id: "507f1f77bcf86cd799439011" },
      body: { shipping_mark_updated: true },
      user: { _id: "507f1f77bcf86cd799439012", role: "qc" },
    },
    res,
  );

  assert.equal(res.statusCode, 403);
});
