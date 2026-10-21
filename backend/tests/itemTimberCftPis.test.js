const test = require("node:test");
const assert = require("node:assert/strict");
const Item = require("../models/item.model");
const PisUpdateLog = require("../models/pisUpdateLog.model");
const { createItem, updateItem, updateItemPis } = require("../controllers/item.controller");

const itemId = "507f1f77bcf86cd799439011";
const response = () => ({
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

test("Timber_CFT can be set and cleared through PIS with an audit entry", async (t) => {
  const item = new Item({ _id: itemId, code: "TEST-1", barcode_exempted: true });
  const logs = [];
  t.mock.method(Item, "findOne", async () => item);
  t.mock.method(item, "save", async () => item);
  t.mock.method(PisUpdateLog, "create", async (entry) => { logs.push(entry); });

  for (const [input, expected] of [["1.234", 1.234], ["", null]]) {
    const res = response();
    await updateItemPis({ params: { id: itemId }, body: { timber_cft: input }, user: { role: "admin" } }, res);
    assert.equal(res.code, 200);
    assert.equal(item.timber_cft, expected);
  }
  assert.equal(logs.length, 2);
  assert.match(JSON.stringify(logs), /Timber CFT per item/);
  assert.equal(item.update_history.at(-1).action, "pis_update");

  const invalid = response();
  await updateItemPis({ params: { id: itemId }, body: { timber_cft: "1.2345" }, user: { role: "admin" } }, invalid);
  assert.equal(invalid.code, 400);
  assert.equal(item.timber_cft, null);
});

test("general item endpoints cannot change Timber_CFT", async (t) => {
  t.mock.method(Item, "findOne", () => { throw new Error("should not query item"); });
  const updated = response();
  await updateItem({ params: { id: itemId }, body: { timber_cft: 1 }, user: { role: "admin" } }, updated);
  assert.equal(updated.code, 400);
  assert.match(updated.body.message, /read-only.*timber_cft/i);

  const created = response();
  await createItem({ body: { timber_cft: 1 }, user: { role: "admin" } }, created);
  assert.equal(created.code, 400);
  assert.match(created.body.message, /PIS update/);
});

test("PIS saves HS metadata on its own without a legacy ledger", async (t) => {
  const item = new Item({ _id: itemId, code: "TEST-HS", barcode_exempted: true, timber_cft: 2 });
  t.mock.method(Item, "findOne", async () => item);
  t.mock.method(item, "save", async () => item);
  t.mock.method(PisUpdateLog, "create", async () => {});
  const res = response();
  await updateItemPis({ params: { id: itemId }, body: { hs_code: "9403 60" }, user: { role: "admin" } }, res);
  assert.equal(res.code, 200);
  assert.equal(item.hs_code, "940360");
  assert.equal(item.timber_cft, 2);
});
