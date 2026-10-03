const assert = require("node:assert/strict");
const test = require("node:test");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const {
  ACTIVE_ORDER_MATCH,
  countItemTaskMetrics,
  countItemTasks,
  ensureObjectIdList,
  getTaskMetrics,
  isFileApprovalEligible,
  isFileApprovalPending,
} = require("../services/employeeReport.service");

const stored = (key) => ({ key });

test("employee task predicates count only applicable missing uploads", () => {
  const counts = countItemTasks([
    { code: "MISSING" },
    {
      code: "COMPLETE",
      kd: true,
      mounting_file_needed: true,
      cad_file: stored("cad"),
      assembly_file: stored("assembly"),
      mounting_file: stored("mounting"),
      shipping_marks: { files: [stored("shipping")] },
      packeging_ppt: stored("ppt"),
      pd_checked: "created",
    },
    { code: "KD", kd: true, pd_checked: "not created" },
    { code: "MOUNT", mounting_file_needed: true },
  ]);

  assert.equal(counts.cad_upload, 3);
  assert.equal(counts.assembly_upload, 1);
  assert.equal(counts.mounting_upload, 1);
  assert.equal(counts.shipping_marks_upload, 3);
  assert.equal(counts.packaging_ppt_upload, 3);
  assert.equal(counts.product_database_creation, 3);

  const metrics = countItemTaskMetrics([{ code: "ONE" }, { code: "TWO", kd: true }]);
  assert.deepEqual(metrics.cad_upload, { total: 2, pending: 2 });
  assert.deepEqual(metrics.assembly_upload, { total: 1, pending: 1 });
});

test("QC approvals require an applicable Indian file and follow the stored file key", () => {
  const item = {
    country_of_origin: "India",
    kd: true,
    mounting_file_needed: true,
    cad_file: stored("cad-v1"),
    assembly_file: stored("assembly-v1"),
    mounting_file: stored("mounting-v1"),
    file_approvals: {
      cad_file: { file_key: "cad-v1" },
      assembly_file: { file_key: "old-assembly" },
    },
  };

  assert.equal(isFileApprovalEligible(item, "cad_file"), true);
  assert.equal(isFileApprovalPending(item, "cad_file"), false);
  assert.equal(isFileApprovalPending(item, "assembly_file"), true);
  assert.equal(isFileApprovalPending(item, "mounting_file"), true);
  assert.equal(isFileApprovalEligible({ ...item, country_of_origin: "Vietnam" }, "cad_file"), false);
  assert.equal(isFileApprovalEligible({ ...item, kd: false }, "assembly_file"), false);
  assert.equal(isFileApprovalEligible({ ...item, mounting_file_needed: false }, "mounting_file"), false);
});

test("shipping mark updates count only active QC records with uploaded item shipping marks", async (t) => {
  let items = [
    { code: "UPLOADED", shipping_marks: { files: [stored("front"), stored("side")] } },
    { code: "LEGACY-1", shipping_marks: { shipping_marks_1: { public_id: "legacy-1" } } },
    { code: "LEGACY-2", shipping_marks: { shipping_marks_2: { link: "legacy-2.pdf" } } },
    { code: "MISSING" },
    { code: "EMPTY", shipping_marks: { files: [{}, { key: "  " }] } },
    { code: "EAN-ONLY", shipping_marks: { ean: stored("ean") } },
  ];
  const orders = [
    { _id: "active", status: "Pending" },
    { _id: "archived", archived: true, status: "Pending" },
    { _id: "cancelled", status: "Cancelled" },
  ];
  const qcs = [
    { _id: "pending", order: "active", item: { item_code: "UPLOADED" }, shipping_mark_updated: false },
    { _id: "done", order: "active", item: { item_code: "UPLOADED" }, shipping_mark_updated: true },
    { _id: "legacy-pending", order: "active", item: { item_code: "LEGACY-1" } },
    { _id: "legacy-done", order: "active", item: { item_code: "LEGACY-2" }, shipping_mark_updated: true },
    { _id: "missing", order: "active", item: { item_code: "MISSING" } },
    { _id: "empty", order: "active", item: { item_code: "EMPTY" }, shipping_mark_updated: true },
    { _id: "ean", order: "active", item: { item_code: "EAN-ONLY" } },
    { _id: "unknown-item", order: "active", item: { item_code: "UNKNOWN" } },
    { _id: "archived", order: "archived", item: { item_code: "UPLOADED" } },
    { _id: "cancelled", order: "cancelled", item: { item_code: "UPLOADED" } },
  ];
  t.mock.method(Item, "find", () => ({
    select(fields) { assert.ok(fields.split(" ").includes("code")); return this; },
    lean: async () => items,
  }));
  t.mock.method(Order, "distinct", async (field, filter) => {
    assert.equal(field, "_id");
    assert.deepEqual(filter, ACTIVE_ORDER_MATCH);
    return orders.filter((order) => order.archived !== filter.archived.$ne && order.status !== filter.status.$ne)
      .map((order) => order._id);
  });
  t.mock.method(QC, "find", (filter) => ({
    select() { return this; },
    lean: async () => qcs.filter((qc) => filter.order.$in.includes(qc.order)),
  }));
  t.mock.method(Inspection, "countDocuments", async (filter) => {
    assert.deepEqual(filter.qc.$in, qcs.filter((qc) => qc.order === "active").map((qc) => qc._id));
    assert.equal(filter.status, "Inspection Done");
    return filter.is_approved ? 3 : 5;
  });

  const metrics = await getTaskMetrics();
  assert.deepEqual(metrics.shipping_marks_updated, { total: 4, pending: 2 });
  assert.deepEqual(metrics.shipping_marks_upload, { total: 6, pending: 3 });
  assert.deepEqual(metrics.inspection_approval, { total: 5, pending: 3 });

  items = items.map(({ code }) => ({ code }));
  const noUploads = await getTaskMetrics();
  assert.deepEqual(noUploads.shipping_marks_updated, { total: 0, pending: 0 });
  assert.deepEqual(noUploads.inspection_approval, { total: 5, pending: 3 });

  orders.length = 0;
  const noOrders = await getTaskMetrics();
  assert.deepEqual(noOrders.shipping_marks_updated, { total: 0, pending: 0 });
  assert.deepEqual(noOrders.inspection_approval, { total: 0, pending: 0 });
});

test("task catalog helpers normalize assignments and exclude inactive orders", () => {
  const firstId = "507f1f77bcf86cd799439011";
  const secondId = "507f191e810c19729de860ea";
  assert.deepEqual(ensureObjectIdList([firstId, firstId, secondId]), [firstId, secondId]);
  assert.throws(() => ensureObjectIdList(["not-an-id"]), /Invalid employee selected/);
  assert.deepEqual(ACTIVE_ORDER_MATCH, {
    archived: { $ne: true },
    status: { $ne: "Cancelled" },
  });
});
