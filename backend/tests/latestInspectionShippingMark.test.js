const assert = require("node:assert/strict");
const test = require("node:test");

const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const { getItemDetails } = require("../controllers/item.controller");
const {
  __test__: { buildLatestInspectionReportLookup },
} = require("../controllers/item.controller");

test("latest inspection lookup keeps only inspection metadata", async (t) => {
  t.mock.method(QC, "find", () => ({
    select() { return this; },
    lean: async () => [{
      _id: "qc-1",
      item: { item_code: "ITEM-1" },
      last_inspected_date: "2026-09-23",
    }],
  }));

  const lookup = await buildLatestInspectionReportLookup(["ITEM-1"]);

  assert.deepEqual(lookup.get("item-1"), {
    qc_id: "qc-1",
    last_inspected_date: "2026-09-23",
    sortTimestamp: Date.parse("2026-09-23"),
  });
});

test("item details select the persisted shipping mark approval flag", async (t) => {
  t.mock.method(Item, "findOne", () => ({
    select(fields) {
      assert.ok(fields.split(" ").includes("shipping_mark_updated"));
      assert.ok(fields.split(" ").includes("shipping_marks"));
      return this;
    },
    lean: async () => null,
  }));
  const res = { status(code) { this.statusCode = code; return this; }, json() {} };
  await getItemDetails({ params: { itemCode: "ITEM-1" }, user: {} }, res);
  assert.equal(res.statusCode, 404);
});
