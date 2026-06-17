const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: {
    limitRecentInspectionsByItem,
    selectLatestInspectionPerLatestPo,
  },
} = require("../controllers/reports.controller");

const makeInspection = ({
  id,
  itemCode = "ITEM-1",
  po,
  orderDate,
  inspectionDate,
  recencyDate = inspectionDate,
  createdAt,
} = {}) => ({
  _id: id,
  item_code: itemCode,
  order_id: po,
  order_date_value: orderDate ? new Date(`${orderDate}T00:00:00.000Z`) : null,
  inspection_date_value: inspectionDate ? new Date(`${inspectionDate}T00:00:00.000Z`) : null,
  inspection_date_recency_value: recencyDate ? new Date(`${recencyDate}T00:00:00.000Z`) : null,
  createdAt: createdAt ? new Date(`${createdAt}T00:00:00.000Z`) : null,
});

const ids = (rows = []) => rows.map((row) => row?._id);

test("QC mismatch selection returns latest inspection from latest 3 POs by order date", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-3", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-4", po: "PO-4", orderDate: "2026-04-01", inspectionDate: "2026-04-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-4", "po-3", "po-2"]);
});

test("QC mismatch selection keeps only latest inspection inside each PO", () => {
  const selected = selectLatestInspectionPerLatestPo([
    makeInspection({ id: "po-3-old", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-05" }),
    makeInspection({ id: "po-3-new", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-3-new", "po-2", "po-1"]);
});

test("QC mismatch selection returns available PO groups when fewer than 3 exist", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-2", "po-1"]);
});

test("QC mismatch selection places missing order dates after dated POs", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "no-date-latest", po: "PO-X", inspectionDate: "2026-05-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-2", "po-1", "no-date-latest"]);
});

test("QC mismatch selection groups missing PO values into one N/A group", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "missing-old", inspectionDate: "2026-01-01" }),
    makeInspection({ id: "missing-new", inspectionDate: "2026-01-15" }),
  ]);

  assert.deepEqual(ids(selected), ["po-2", "missing-new"]);
});
