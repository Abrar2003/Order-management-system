const assert = require("node:assert/strict");
const test = require("node:test");
const { Types } = require("mongoose");
const replicaSet = require("./helpers/labelReplicaSet");
const { DROP_TEST_STAGES } = require("../helpers/dropTest");
const QC = require("../models/qc.model");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const Inspection = require("../models/inspection.model");
const Template = require("../models/tests.model");
const Upload = require("../models/dropTestVideoUpload.model");
const storage = require("../services/wasabiStorage.service");
const controller = require("../controllers/tests.controller");

test("direct evidence is resumed, attached once, and a pass covers the item on another PO", async (t) => {
  const db = await replicaSet();
  t.after(db.close);
  await Upload.createIndexes();
  const user = { _id: new Types.ObjectId(), name: "Inspector", role: "QC" };
  const vendor = { name: "Test Vendor", vendor_id: new Types.ObjectId(), country: "IN" };
  const item = { item_code: "DROP-1", description: "Test packaging" };
  await Item.collection.insertOne({ code: item.item_code, claim_percentage: 7 });
  const template = await Template.create({ type: "drop", name: "Drop Test", version: "1" });
  const addQc = async (order_id, inspector) => {
    const order = await Order.create({ order_id, item, brand: "Test brand", vendor, quantity: 10 });
    return QC.create({
      order: order._id, order_meta: { order_id, vendor, brand: order.brand },
      item, inspector, createdBy: inspector, request_date: "2026-11-16",
      last_inspected_date: "2026-11-16", quantities: { client_demand: 10, qc_passed: 10 },
      test_requirement_pending: order_id === "PO-1",
    });
  };
  const first = await addQc("PO-1", user._id);
  const otherUser = { ...user, _id: new Types.ObjectId() };
  const second = await addQc("PO-2", otherUser._id);
  const pending = await Inspection.create({
    qc: first._id, inspector: user._id, createdBy: user._id,
    inspection_date: first.request_date, requested_date: first.request_date,
    vendor_requested: 10, vendor_offered: 10, checked: 10, passed: 10, rejected: 0, pending_after: 0,
    test_requirement_pending: true,
  });

  let created = 0;
  let complete = false;
  const partSize = 5 * 1024 * 1024;
  const size = partSize + 7;
  const parts = [{ PartNumber: 1, Size: partSize, ETag: '"one"' }];
  t.mock.method(storage, "createMultipartUpload", async () => `storage-session-${++created}`);
  t.mock.method(storage, "getPresignedPartUrl", async (_key, _id, number, length) => {
    assert.equal(number, 2);
    assert.equal(length, 7);
    return "https://storage.example.test/part-2";
  });
  t.mock.method(storage, "listMultipartParts", async () => {
    if (complete) throw Object.assign(new Error("Already completed"), { name: "NoSuchUpload" });
    return [...parts];
  });
  t.mock.method(storage, "getObjectMetadata", async () => ({ exists: complete, size, contentType: "video/mp4" }));
  t.mock.method(storage, "completeMultipartUpload", async (_key, _id, manifest) => {
    assert.deepEqual(manifest, [{ PartNumber: 1, ETag: '"one"' }, { PartNumber: 2, ETag: '"two"' }]);
    complete = true;
  });

  const call = async (handler, qc, actor, body = {}, params = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user: actor, params: { qcId: qc.id, testId: template.id, ...params }, body }, res);
    return res;
  };
  const before = await call(controller.getQcTests, second, otherUser);
  assert.equal(before.body.data.requirement.required, true);
  const scope = { request_key: `date:${first.request_date}`, test_version: template.version };
  const meta = { ...scope, name: "drop.mp4", size, fingerprint: "a".repeat(64) };
  const tooBig = await call(controller.prepareDropTestVideo, first, user, { ...meta, size: 900_000_001 });
  assert.equal(tooBig.code, 400);
  const prepared = await call(controller.prepareDropTestVideo, first, user, meta);
  const uploadId = prepared.body.data.upload_id;
  const resumed = await call(controller.prepareDropTestVideo, first, user, meta);
  assert.deepEqual(resumed.body.data, { upload_id: uploadId, part_size: partSize, complete: false, uploaded_parts: [1] });
  assert.equal(created, 1);
  const maxSize = await call(controller.prepareDropTestVideo, first, user, { ...meta, size: 900_000_000, fingerprint: "b".repeat(64) });
  assert.equal(maxSize.code, 200);
  assert.ok(maxSize.body.data.upload_id);
  const forbidden = await call(controller.signDropTestVideoPart, second, otherUser, { test_version: "1" }, { uploadId, partNumber: "2" });
  assert.equal(forbidden.code, 404);
  const signed = await call(controller.signDropTestVideoPart, first, user, scope, { uploadId, partNumber: "2" });
  assert.equal(signed.body.data.upload_url, "https://storage.example.test/part-2");

  const body = {
    ...scope, run_id: new Types.ObjectId().toString(), result: "pass", gross_packed_weight_kg: 20,
    confirmed_stages: JSON.stringify(DROP_TEST_STAGES.map((stage) => stage.id)),
    video_upload_ids: JSON.stringify([uploadId]),
  };
  assert.equal((await call(controller.submitDropTestRun, first, user, body)).code, 409);
  parts.push({ PartNumber: 2, Size: 7, ETag: '"two"' });
  const saved = await call(controller.submitDropTestRun, first, user, body);
  assert.equal(saved.code, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.data.released, true);
  assert.equal((await Inspection.findById(pending._id)).status, "Inspection Done");
  assert.equal((await call(controller.submitDropTestRun, first, user, body)).code, 201);
  const qc = await QC.findById(first._id);
  assert.equal(qc.test_runs.length, 1);
  assert.equal(qc.test_runs[0].videos[0].size, size);
  assert.equal(qc.test_requirement_pending, false);
  const after = await call(controller.getQcTests, second, otherUser);
  assert.equal(after.body.data.requirement.result, "pass");
  assert.equal(after.body.data.requirement.required, false);
  assert.deepEqual(after.body.data.runs, []);
});
