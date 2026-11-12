const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const replicaSet = require("./helpers/labelReplicaSet");
const Order = require("../models/order.model");
const Vendor = require("../models/vendor.model");
const Brand = require("../models/brand.model");
const Upload = require("../models/orderReferenceUpload.model");
const wasabi = require("../services/wasabiStorage.service");
const documents = require("../services/orderReferenceDocuments.service");
const { createOrdersManually, editCompleteOrder, getOrderById } = require("../controllers/order.controller");

const request = async (handler, user, body, id) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; },
  };
  await handler({ user, body, params: { id } }, res);
  return res;
};

test("commits private reference batches to a PO and preserves history through order changes", { timeout: 90_000 }, async (t) => {
  const replica = await replicaSet();
  t.after(replica.close);

  const files = new Map();
  const copies = [];
  let failingSource;
  t.mock.method(wasabi, "isConfigured", () => true);
  t.mock.method(wasabi, "getPresignedUploadUrl", async (key) => key);
  t.mock.method(wasabi, "getObjectMetadata", async (key) => files.get(key) || { exists: false });
  t.mock.method(wasabi, "copyObject", async (source, target, etag) => {
    assert.equal(etag, files.get(source).etag);
    if (source === failingSource) throw new Error("test Wasabi copy failure");
    assert.match(target, /^order-reference-documents\/files\//);
    copies.push(target);
    files.set(target, files.get(source));
  });
  t.mock.method(wasabi, "getSignedObjectUrl", async (key, options) => ({ key, ...options }));
  t.mock.method(wasabi, "deleteObjectPrefix", async (prefix) => {
    for (const key of files.keys()) if (key.startsWith(prefix)) files.delete(key);
  });
  for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
    const before = process.env[name];
    delete process.env[name];
    t.after(() => { if (before !== undefined) process.env[name] = before; });
  }

  const owner = { _id: new Types.ObjectId(), name: "Uploader", role: "user", allowed_vendors: ["all"] };
  const manager = { ...owner, _id: new Types.ObjectId(), name: "Manager", role: "product manager" };
  const viewer = { ...owner, _id: new Types.ObjectId(), role: "viewer" };
  const giga = (await Brand.collection.insertOne({ name: "Giga" })).insertedId;
  const otherBrand = (await Brand.collection.insertOne({ name: "Other" })).insertedId;
  const vendor = await Vendor.create({ name: "Main vendor", brands: [{ brand_id: giga, brand_name: "Giga" }] });
  const otherVendor = await Vendor.create({
    name: "Other vendor",
    brands: [{ brand_id: otherBrand, brand_name: "Other" }, { brand_id: giga, brand_name: "Giga" }],
  });
  const po = { order_id: "PO-REFERENCE", brand: "Giga", vendor: vendor.name, order_date: "2026-10-01", ETD: "2026-11-01" };
  const items = [{ item_code: "REF-1", description: "Chair", quantity: 1 }, { item_code: "REF-2", description: "Table", quantity: 2 }];
  const save = (body) => request(createOrdersManually, owner, { po, items, ...body });
  const prepare = (names, orderRow, target = po) => documents.prepareUpload({
    user: owner, po: target, orderRow, files: names.map((name) => ({ name, size: 5 })),
  });
  const put = (upload, count = upload.files.length) => {
    for (const entry of upload.files.slice(0, count)) {
      files.set(entry.upload_url, { exists: true, contentType: entry.headers["Content-Type"], size: 5, etag: "etag" });
    }
  };

  assert.equal((await save()).statusCode, 400);
  assert.equal(await Order.countDocuments({ order_id: po.order_id }), 0);
  await assert.rejects(prepare(["bad.html"]), { statusCode: 400 });
  await assert.rejects(prepare(Array(11).fill("many.pdf")), { statusCode: 400 });
  await assert.rejects(documents.prepareUpload({
    user: owner, po, files: [{ name: "large.pdf", size: 50 * 1024 * 1024 + 1 }],
  }), { statusCode: 400 });

  const manual = await prepare(["one.pdf", "two.xlsx", "three.png"]);
  const uploadBody = { reference_document_upload_id: String(manual.upload_id) };
  put(manual, 2);
  assert.equal((await save(uploadBody)).data.code, "REFERENCE_UPLOAD_INCOMPLETE");
  assert.equal(copies.length, 0);
  assert.equal(await Order.countDocuments({ order_id: po.order_id }), 0);
  put(manual);
  const reminderId = new Types.ObjectId();
  await Order.create({
    ...po, order_id: "PREVIOUS-PO", item: { item_code: "REF-1" }, quantity: 1,
    reminders: [{ _id: reminderId, type: "admin", comment: "Check dimensions" }],
  });
  assert.equal((await save(uploadBody)).data.code, "PENDING_ADMIN_REMINDERS");
  assert.equal(copies.length, 0);
  const acknowledged = { ...uploadBody, acknowledged_admin_reminder_ids: [String(reminderId)] };

  const insertMany = Order.insertMany;
  const failInsert = t.mock.method(Order, "insertMany", async (...args) => {
    await insertMany.apply(Order, args);
    throw new Error("test failure after insertion");
  });
  assert.equal((await save(acknowledged)).statusCode, 500);
  failInsert.mock.restore();
  assert.equal(await Order.countDocuments({ order_id: po.order_id }), 0);
  assert.equal((await Upload.findById(manual.upload_id)).state, "ready");
  const created = await save(acknowledged);
  assert.equal(created.statusCode, 201, JSON.stringify(created.data));
  assert.equal(created.data.inserted_count, 2);
  assert.equal((await save(acknowledged)).statusCode, 200);
  assert.equal(copies.length, 3);

  const rows = await Order.find({ order_id: po.order_id }).sort({ "item.item_code": 1 }).lean();
  const [first, second] = rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => !("order_reference_documents" in row)));
  const response = await request(getOrderById, owner, null, po.order_id);
  assert.equal(response.statusCode, 200);
  assert.ok(response.data.every((row) => !("order_reference_documents" in row)));

  const group = await documents.groupKey(first);
  const later = await prepare(["later.docx"], second._id);
  put(later);
  await assert.rejects(documents.appendBatch(first._id, later.upload_id, owner), { statusCode: 409 });
  await documents.appendBatch(second._id, later.upload_id, owner);
  await documents.appendBatch(second._id, later.upload_id, owner);
  const batches = await documents.listBatches(group, owner);
  assert.deepEqual(batches.map((batch) => batch.files.length), [1, 3]);
  assert.deepEqual(batches.map((batch) => batch.uploader), ["Uploader", "Uploader"]);
  assert.ok(batches.every((batch) => batch.can_comment));
  assert.equal(copies.length, 4);

  const pdf = batches[1].files[0];
  const office = batches[0].files[0];
  assert.equal(pdf.can_preview, true);
  assert.equal(office.can_preview, false);
  assert.equal((await documents.fileLink(group, pdf._id, false)).download, false);
  assert.equal((await documents.fileLink(group, office._id, false)).download, true);
  assert.equal((await documents.addComment(group, pdf._id, " Looks good ", owner)).text, "Looks good");
  assert.equal((await documents.addComment(group, pdf._id, "Approved", manager)).author.name, "Manager");
  await assert.rejects(documents.addComment(group, pdf._id, "Cannot post", viewer), { statusCode: 403 });
  await assert.rejects(documents.addComment(group, pdf._id, " ", manager), { statusCode: 400 });

  const extra = await prepare(["manual-add.pdf"]);
  put(extra);
  const extended = await save({
    items: [{ item_code: "REF-3", description: "Desk", quantity: 1 }],
    reference_document_upload_id: String(extra.upload_id),
  });
  assert.equal(extended.statusCode, 201, JSON.stringify(extended.data));
  assert.equal((await documents.listBatches(group, manager)).length, 3);

  const duplicatePo = await Order.create({ ...po, vendor: otherVendor.name, item: { item_code: "REF-4" }, quantity: 1 });
  const duplicateGroup = await documents.groupKey(duplicatePo);
  assert.deepEqual(await documents.listBatches(duplicateGroup, manager), []);
  await assert.rejects(documents.fileLink(duplicateGroup, pdf._id, false), { statusCode: 404 });
  const scopedOwner = { ...owner, allowed_vendors: [vendor.name] };
  await assert.rejects(documents.activeOrder(duplicatePo._id, scopedOwner), { statusCode: 404 });
  await Order.updateOne({ _id: first._id }, { $set: { archived: true } });
  await assert.rejects(documents.activeOrder(first._id, owner), { statusCode: 404 });
  assert.equal((await documents.listBatches(group, manager))[2].files[0].comments.length, 2);

  const edited = await request(editCompleteOrder, scopedOwner, { order_id: "RENAMED-PO" }, String(second._id));
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.data));
  const moved = await documents.activeOrder(second._id, owner);
  const movedGroup = await documents.groupKey(moved);
  assert.deepEqual(await documents.listBatches(group, owner), []);
  assert.equal((await documents.listBatches(movedGroup, owner)).length, 3);
  assert.equal((await documents.activeOrder(duplicatePo._id, owner)).order_id, po.order_id);

  const reassigned = await request(editCompleteOrder, manager, {
    brand: "Other", vendor: otherVendor.name,
  }, String(second._id));
  assert.equal(reassigned.statusCode, 200, JSON.stringify(reassigned.data));
  await assert.rejects(documents.activeOrder(second._id, { ...owner, allowed_brands: [{ name: "Giga" }] }), { statusCode: 404 });
  const reassignedGroup = await documents.groupKey(await documents.activeOrder(second._id, manager));
  assert.equal((await documents.listBatches(reassignedGroup, manager)).length, 3);

  const abandoned = await prepare(["abandoned.pdf", "partly-finalized.pdf"]);
  put(abandoned);
  failingSource = abandoned.files[0].upload_url;
  await assert.rejects(documents.insertManualOrders([
    { ...po, item: { item_code: "REF-5" }, quantity: 1 },
  ], [abandoned.upload_id], owner), /test Wasabi copy failure/);
  assert.equal((await Upload.findById(abandoned.upload_id)).state, "open");
  assert.equal(await Order.countDocuments({ "item.item_code": "REF-5" }), 0);
  await Upload.updateMany({}, { $set: { expires_at: new Date(0) } });
  await documents.cleanupExpiredUploads();
  assert.equal(await Upload.countDocuments(), 0);
  assert.ok([...files.keys()].every((key) => key.includes("/files/")));
  assert.equal(files.size, 5);
});
