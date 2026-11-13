const assert = require("node:assert/strict");
const test = require("node:test");
const { Types } = require("mongoose");
const { checkItemPis } = require("../controllers/item.controller");
const Item = require("../models/item.model");

test("only managers and admins can record a named PIS check, and a retry keeps the original reviewer", async (t) => {
  const itemId = new Types.ObjectId();
  const reviewerId = new Types.ObjectId();
  const item = { _id: itemId, pis_checked_flag: true };
  const updateItem = t.mock.method(Item.collection, "findOneAndUpdate", (match, { $set }) => {
    assert.equal(String(match.$and[0]._id), String(itemId));
    const [, { $or: unchecked }] = match.$and;
    if (item.pis_checked_flag === unchecked[0].pis_checked_flag.$ne &&
      !unchecked[1]["pis_checked_by.name"].$in.includes(item.pis_checked_by?.name ?? null)) {
      return null;
    }
    Object.assign(item, $set);
    return item;
  });
  t.mock.method(Item.collection, "findOne", () => item);

  const check = async (role, name) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await checkItemPis({
      params: { id: String(itemId) },
      user: { _id: reviewerId, role, name },
      body: { pis_checked_by: { name: "Other name" } },
    }, res);
    return res;
  };

  assert.equal((await check("QC", "Inspector")).statusCode, 403);
  assert.equal(updateItem.mock.callCount(), 0);
  const first = await check("manager", "First reviewer");
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.pis_checked_flag, true);
  assert.equal(first.body.pis_checked_by.name, "First reviewer");
  assert.equal(String(first.body.pis_checked_by.user), String(reviewerId));
  assert.ok(first.body.pis_checked_by.checked_at instanceof Date);
  const retry = await check("admin", "Second reviewer");
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.body, first.body);
});
