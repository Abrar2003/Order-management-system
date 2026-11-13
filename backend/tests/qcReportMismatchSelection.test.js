const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: {
    limitRecentInspectionsByItem,
    selectPostMasterOneInspections,
    selectLatestInspectionPerLatestPo,
    canCreateQcMismatchComment,
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

test("QC mismatch selection excludes an item when fewer than 3 distinct POs exist", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), []);
});

test("QC mismatch comments allow every manager role and QC", () => {
  for (const role of [
    "admin",
    "super admin",
    "manager",
    "product manager",
    "inspection manager",
    "operation manager",
    "QC",
  ]) {
    assert.equal(canCreateQcMismatchComment({ role }), true, role);
  }
  assert.equal(canCreateQcMismatchComment({ role: "user" }), false);
});

test("QC mismatch selection places missing order dates after dated POs", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "no-date-latest", po: "PO-X", inspectionDate: "2026-05-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-2", "po-1", "no-date-latest"]);
});

test("QC mismatch selection does not count missing PO values toward eligibility", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-3", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "missing-old", inspectionDate: "2026-01-01" }),
    makeInspection({ id: "missing-new", inspectionDate: "2026-01-15" }),
  ]);

  assert.deepEqual(ids(selected), []);
});

test("QC mismatch selection includes one latest inspection from exactly 3 distinct POs", () => {
  const selected = limitRecentInspectionsByItem([
    makeInspection({ id: "po-3", po: "PO-3", orderDate: "2026-03-01", inspectionDate: "2026-03-10" }),
    makeInspection({ id: "po-2", po: "PO-2", orderDate: "2026-02-01", inspectionDate: "2026-02-10" }),
    makeInspection({ id: "po-1", po: "PO-1", orderDate: "2026-01-01", inspectionDate: "2026-01-10" }),
  ]);

  assert.deepEqual(ids(selected), ["po-3", "po-2", "po-1"]);
});

test("level 2 uses the Master 2 PO set before and after the review", () => {
  const { CYCLE_VERSION, buildEvidence } = require("../helpers/masterWorkflow");
  const item = { master_workflow: {
    cycle_version: CYCLE_VERSION,
    stage: "master_1",
    revision: 2,
    consumed_pos: ["used"],
    reviews: [{ stage: "master_1", reviewed_at: "2026-10-03T08:00:00Z" }],
  } };
  const visit = (id, po, day, approved = true) => ({
    _id: id,
    po,
    inspector: "reviewer",
    is_approved: approved,
    inspection_date: day,
    createdAt: day + "T10:00:00Z",
    inspected_item_sizes: [{ L: 10 }],
  });
  const records = [
    visit("old", "old", "2026-10-02"),
    visit("used", "USED", "2026-10-04"),
    visit("unapproved", "unapproved", "2026-10-04", false),
    visit("first", "A", "2026-10-04"),
    visit("second", "B", "2026-10-05"),
    visit("third", "C", "2026-10-06"),
    visit("extra", "D", "2026-10-07"),
    visit("updated", " a ", "2026-10-08"),
  ];
  const expected = ["updated", "second", "third"];
  assert.deepEqual(ids(selectPostMasterOneInspections(item, records, records)), expected);
  assert.deepEqual(selectPostMasterOneInspections(item, records.slice(0, 5), records), []);
  assert.deepEqual(selectPostMasterOneInspections(item, records, records.slice(0, 5)), []);
  const evidence = buildEvidence(item, records).inspections;
  item.master_workflow.stage = "finalized";
  item.master_workflow.reviews.push({ stage: "master_2", evidence });
  records.at(-1).inspected_item_sizes[0].L = 99;
  const saved = selectPostMasterOneInspections(item, records, []);
  assert.deepEqual(ids(saved), expected);
  assert.equal(saved[0].inspected_item_sizes[0].L, 10);
  assert.deepEqual(selectPostMasterOneInspections({}, records, records), []);
});
