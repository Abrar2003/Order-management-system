const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Order = require("../models/order.model");
const orderController = require("../controllers/order.controller");

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

test("getArchivedOrders filters archived orders by item code or description", async () => {
  const originalFind = Order.find;
  const originalCountDocuments = Order.countDocuments;
  const originalDistinct = Order.distinct;
  const orderId = new mongoose.Types.ObjectId();
  let findMatch = null;
  let countMatch = null;

  Order.find = (match) => {
    findMatch = match;
    return {
      select() {
        return this;
      },
      sort() {
        return this;
      },
      skip() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => [
        {
          _id: orderId,
          order_id: "PO-ARCH-1",
          brand: "Brand A",
          vendor: "Vendor A",
          item: {
            item_code: "CHAIR.01",
            description: "Dining chair",
          },
          quantity: 0,
          archived: true,
          archived_previous_status: "Pending",
        },
      ],
    };
  };
  Order.countDocuments = async (match) => {
    countMatch = match;
    return 1;
  };
  Order.distinct = async () => [];

  try {
    const res = makeResponse();
    await orderController.getArchivedOrders(
      {
        query: { item: "chair.01" },
        user: { role: "admin" },
      },
      res,
    );

    assert.equal(res.statusVal, 200);
    assert.equal(res.jsonVal.data[0].restore_status, "Pending");
    assert.deepEqual(findMatch.$or, [
      { "item.item_code": { $regex: "chair\\.01", $options: "i" } },
      { "item.description": { $regex: "chair\\.01", $options: "i" } },
    ]);
    assert.deepEqual(countMatch.$or, findMatch.$or);
  } finally {
    Order.find = originalFind;
    Order.countDocuments = originalCountDocuments;
    Order.distinct = originalDistinct;
  }
});
