const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Item = require("../models/item.model");
const Message = require("../models/itemDiscussionMessage.model");
const storage = require("../services/wasabiStorage.service");
const controller = require("../controllers/itemDiscussion.controller");
const discussionRelay = require("../services/itemDiscussionRelay.service");
const { DISCUSSION_TOPICS, validateDiscussionFile, validateDiscussionMessage } = require("../helpers/itemDiscussions");

const itemId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();
const req = (topic = "autocad") => ({ params: { id: String(itemId), topic }, query: {}, discussionItem: { _id: itemId }, user: { _id: userId, name: "QC Inspector", role: "QC" }, body: { text: "Please review this drawing.", client_message_id: crypto.randomUUID() }, files: [] });
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const chain = (data) => ({ sort() { return this; }, limit() { return this; }, select() { return this; }, lean: async () => data });
const tempFiles = async (t, contents = ["%PDF-1.7\nfixture"]) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oms-discussion-test-"));
  t.after(async () => {
    for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name));
    await fs.rmdir(directory);
  });
  return Promise.all(contents.map(async (content, i) => {
    const filePath = path.join(directory, `${i}.pdf`);
    await fs.writeFile(filePath, content);
    return { path: filePath, originalname: `${i}.pdf`, size: Buffer.byteLength(content), mimetype: "application/pdf" };
  }));
};
const stubStorage = (t) => {
  const uploaded = [], deleted = [];
  t.mock.method(storage, "createStorageKey", ({ folder, originalName }) => `${folder}/${originalName}`);
  t.mock.method(storage, "uploadFile", async (file) => { uploaded.push(file); });
  t.mock.method(storage, "deleteObject", async (key) => { deleted.push(key); });
  t.mock.method(storage, "getSignedObjectUrl", async (key) => `https://private.example/${key}?signed=1`);
  return { uploaded, deleted };
};

test("three fixed item topics accept text or supported attachments and reject invalid input", () => {
  assert.deepEqual(Object.keys(DISCUSSION_TOPICS), ["autocad", "shipping_marks", "finish"]);
  const body = req().body;
  assert.equal(validateDiscussionMessage({ ...body, text: "  Hello  " }).text, "Hello");
  assert.equal(validateDiscussionMessage({ ...body, text: "" }, [{ size: 2 }]).text, "");
  for (const extension of ["pdf", "jpg", "jpeg", "png", "webp", "mp4", "mov", "mkv", "xls", "xlsx"]) {
    assert.ok(validateDiscussionFile({ originalname: `file.${extension}`, size: 12 }).content_type);
  }
  for (const input of [{ ...body, text: " " }, { ...body, text: "x".repeat(5001) }, { ...body, text: { $ne: "" } }, { ...body, client_message_id: "invalid" }]) {
    assert.throws(() => validateDiscussionMessage(input), { statusCode: 400 });
  }
  for (const file of [{ originalname: "x.exe", size: 1 }, { originalname: "../a.pdf", size: 1 }, { originalname: "a.pdf", size: 0 }, { originalname: "a.pdf", size: 51 * 1024 * 1024 }]) {
    assert.throws(() => validateDiscussionFile(file), { statusCode: 400 });
  }
  assert.equal(validateDiscussionMessage(body, Array(20).fill({ size: 1 })).text, body.text);
  assert.throws(() => validateDiscussionMessage(body, Array(21).fill({ size: 1 })), { statusCode: 400 });
  assert.throws(() => validateDiscussionMessage(body, Array(3).fill({ size: 50 * 1024 * 1024 })), { statusCode: 400 });
  const indexes = Message.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.item && fields.topic && fields["author.user"] && fields.client_message_id && options.unique));
});

test("discussion reads and posts require a visible item and a fixed topic", async (t) => {
  let match;
  t.mock.method(Item, "findOne", (query) => { match = query; return chain(null); });
  const request = req(); request.user.qc_vendor_scope = [];
  const response = res();
  await controller.loadItem(request, response, () => assert.fail("inaccessible item continued"));
  assert.equal(response.statusCode, 404);
  assert.match(JSON.stringify(match), /"_id":null/);
  const invalid = res();
  await controller.loadItem(req("new-thread"), invalid, () => assert.fail("arbitrary thread continued"));
  assert.equal(invalid.statusCode, 400);
});

test("each item exposes the same three topic threads regardless of vendor context", async (t) => {
  t.mock.method(Message, "aggregate", async (pipeline) => {
    assert.deepEqual(pipeline[0].$match, { item: itemId });
    return [{ _id: "autocad", count: 3, latest: { text: "Updated drawing" } }];
  });
  for (const context of [{ vendor: "Alpha" }, { vendor: "Beta" }, { qc_id: "qc" }]) {
    const request = req(); request.query = context;
    const response = res(); await controller.listTopics(request, response);
    assert.equal(response.body.data.length, 3);
    assert.equal(response.body.data[0].message_count, 3);
    assert.equal(response.body.data[1].message_count, 0);
  }
});

test("posting works for item viewers and stores trusted authorship, not client-supplied identity", async (t) => {
  const events = [];
  t.mock.method(discussionRelay, "publishItemDiscussionEvent", async (event) => events.push(event));
  t.mock.method(Message, "findOne", () => chain(null));
  let saved;
  t.mock.method(Message, "create", async (payload) => { saved = payload; return new Message({ ...payload, created_at: new Date() }); });
  const request = req(); request.user.role = "viewer"; request.body.author = { name: "Forged author" };
  const response = res(); await controller.postMessage(request, response);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(saved.author, { user: userId, name: "QC Inspector" });
  assert.equal(saved.item, itemId); assert.equal(saved.topic, "autocad");
  assert.deepEqual(events, [{ type: "changed", itemId: String(itemId), topic: "autocad" }]);
});

test("attachment-only posts keep private metadata and clean temporary files", async (t) => {
  const state = stubStorage(t);
  t.mock.method(Message, "findOne", () => chain(null));
  t.mock.method(Message, "create", async (payload) => new Message({ ...payload, created_at: new Date() }));
  const request = req("shipping_marks"); request.body.text = ""; request.files = await tempFiles(t);
  const response = res(); await controller.postMessage(request, response);
  assert.equal(response.statusCode, 201);
  assert.equal(state.uploaded.length, 1); assert.equal(state.deleted.length, 0);
  assert.equal(response.body.data.attachments[0].name, "0.pdf");
  assert.equal(response.body.data.attachments[0].key, undefined);
  assert.match(response.body.data.attachments[0].url, /signed=1/);
  await assert.rejects(fs.access(request.files[0].path));
});

test("invalid file contents are rejected before upload", async (t) => {
  const state = stubStorage(t);
  t.mock.method(Message, "findOne", () => chain(null));
  const request = req(); request.files = await tempFiles(t, ["not a PDF"]);
  const response = res(); await controller.postMessage(request, response);
  assert.equal(response.statusCode, 400); assert.equal(state.uploaded.length, 0);
  await assert.rejects(fs.access(request.files[0].path));
});

test("upload or persistence failure rolls back storage and removes temporary files", async (t) => {
  t.mock.method(discussionRelay, "publishItemDiscussionEvent", () => assert.fail("uncommitted message was broadcast"));
  const state = stubStorage(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(Message, "findOne", () => chain(null));
  t.mock.method(Message, "create", async () => { throw new Error("Database unavailable"); });
  const request = req(); request.files = await tempFiles(t);
  const response = res(); await controller.postMessage(request, response);
  assert.equal(response.statusCode, 500); assert.equal(state.deleted.length, 1);
  await assert.rejects(fs.access(request.files[0].path));
});

test("retrying a confirmed message returns it without posting or uploading again", async (t) => {
  t.mock.method(discussionRelay, "publishItemDiscussionEvent", () => assert.fail("idempotent retry was broadcast again"));
  const state = stubStorage(t);
  const original = new Message({ ...req().body, item: itemId, topic: "autocad", author: { user: userId, name: "QC Inspector" }, created_at: new Date() }).toObject();
  t.mock.method(Message, "findOne", () => chain(original));
  t.mock.method(Message, "create", () => assert.fail("duplicate create"));
  const request = req(); request.files = await tempFiles(t);
  const response = res(); await controller.postMessage(request, response);
  assert.equal(String(response.body.data._id), String(original._id));
  assert.equal(state.uploaded.length, 0);
  await assert.rejects(fs.access(request.files[0].path));
});

test("response signing failure never deletes attachments belonging to a saved message", async (t) => {
  const state = stubStorage(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(storage, "getSignedObjectUrl", async () => { throw new Error("Signing unavailable"); });
  t.mock.method(Message, "findOne", () => chain(null));
  t.mock.method(Message, "create", async (payload) => new Message({ ...payload, created_at: new Date() }));
  const request = req(); request.files = await tempFiles(t);
  const response = res(); await controller.postMessage(request, response);
  assert.equal(response.statusCode, 500); assert.equal(state.deleted.length, 0);
});

test("root stays pinned while replies are paginated chronologically", async (t) => {
  const root = { _id: new mongoose.Types.ObjectId(), text: "Root", attachments: [] };
  const replies = Array.from({ length: 51 }, () => ({ _id: new mongoose.Types.ObjectId(), text: "Reply", attachments: [] })).reverse();
  t.mock.method(Message, "findOne", (match) => { assert.equal(match.topic, "autocad"); return chain(root); });
  t.mock.method(Message, "find", (match) => { assert.equal(match._id.$ne, root._id); return chain([...replies]); });
  const response = res(); await controller.listMessages(req(), response);
  assert.equal(response.body.data.root._id, root._id); assert.equal(response.body.data.replies.length, 50);
  assert.equal(response.body.data.before, String(response.body.data.replies[0]._id));
  const invalidReq = req(); invalidReq.query.before = { $gt: "" };
  const invalid = res(); await controller.listMessages(invalidReq, invalid);
  assert.equal(invalid.statusCode, 400);
});

test("attachment lookup checks item, topic, message, and file together", async (t) => {
  stubStorage(t);
  let match;
  t.mock.method(Message, "findOne", (query) => { match = query; return chain(null); });
  const request = req("finish"); request.params.messageId = String(new mongoose.Types.ObjectId()); request.params.fileId = String(new mongoose.Types.ObjectId());
  const response = res(); await controller.getAttachment(request, response);
  assert.equal(response.statusCode, 404); assert.equal(match.item, itemId); assert.equal(match.topic, "finish");
  assert.equal(match._id, request.params.messageId); assert.equal(match["attachments._id"], request.params.fileId);
});

test("concurrent retries clean the losing upload and return the one stored message", async (t) => {
  const state = stubStorage(t);
  const original = new Message({ ...req().body, item: itemId, topic: "autocad", author: { user: userId, name: "QC Inspector" }, created_at: new Date() }).toObject();
  let reads = 0;
  t.mock.method(Message, "findOne", () => chain(++reads === 1 ? null : original));
  t.mock.method(Message, "create", async () => { throw Object.assign(new Error("Duplicate"), { code: 11000 }); });
  const request = req(); request.files = await tempFiles(t);
  const response = res(); await controller.postMessage(request, response);
  assert.equal(String(response.body.data._id), String(original._id));
  assert.equal(state.uploaded.length, 1); assert.equal(state.deleted.length, 1);
});

test("failure partway through a batch rolls back every attempted file", async (t) => {
  const state = stubStorage(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(Message, "findOne", () => chain(null));
  let uploads = 0;
  t.mock.method(storage, "uploadFile", async () => { if (++uploads === 2) throw new Error("Storage unavailable"); });
  t.mock.method(Message, "create", () => assert.fail("incomplete message persisted"));
  const request = req(); request.files = await tempFiles(t, ["%PDF-1.7\nfirst", "%PDF-1.7\nsecond"]);
  const response = res(); await controller.postMessage(request, response);
  assert.equal(response.statusCode, 500); assert.equal(state.deleted.length, 2);
  for (const file of request.files) await assert.rejects(fs.access(file.path));
});

test("discussion routes reuse vendor authorization before receiving any uploads", () => {
  const router = require("../routers/items.routes");
  const scope = require("../middlewares/qcItemVendorScope.middleware");
  const { discussionUpload } = require("../middlewares/itemDiscussionUpload.middleware");
  const routes = router.stack.filter((layer) => layer.route?.path.includes("/discussions"));
  assert.equal(routes.length, 5);
  for (const { route } of routes) {
    const handlers = route.stack.map((entry) => entry.handle);
    assert.ok(handlers.includes(scope)); assert.ok(handlers.includes(controller.loadItem));
    if (route.methods.post) assert.ok(handlers.indexOf(controller.loadItem) < handlers.indexOf(discussionUpload));
  }
});

test("only admins and super admins can delete discussion messages", async (t) => {
  t.mock.method(Message, "findOneAndUpdate", () => assert.fail("unauthorized deletion reached storage"));
  for (const role of ["QC", "manager", "product manager", "inspection manager", "dev", "user", "viewer"]) {
    const request = req(); request.user.role = role; request.params.messageId = String(new mongoose.Types.ObjectId());
    const response = res(); await controller.deleteMessage(request, response);
    assert.equal(response.statusCode, 403, role);
  }
});

test("admins delete exactly one scoped message and its attachments while retaining a thread placeholder", async (t) => {
  const state = stubStorage(t);
  const messageId = String(new mongoose.Types.ObjectId());
  t.mock.method(Message, "findOneAndUpdate", (filter, update, options) => {
    assert.deepEqual(filter, { item: itemId, topic: "autocad", _id: messageId, deleted_at: null });
    assert.equal(update.$set.text, ""); assert.deepEqual(update.$set.attachments, []);
    assert.ok(update.$set.deleted_at instanceof Date);
    assert.deepEqual(update.$set.deleted_by, { user: userId, name: "QC Inspector" });
    assert.equal(update.$set.author, undefined); assert.equal(update.$set.client_message_id, undefined);
    assert.equal(options.new, false);
    return chain({ _id: messageId, attachments: [{ key: "drawing.pdf" }, { key: "photo.png" }] });
  });
  for (const role of ["admin", "super admin"]) {
    const request = req(); request.user.role = role; request.params.messageId = messageId;
    const response = res(); await controller.deleteMessage(request, response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.success, true);
  }
  assert.deepEqual(state.deleted, ["drawing.pdf", "photo.png", "drawing.pdf", "photo.png"]);
});

test("invalid, missing, and already deleted message IDs cannot delete other messages", async (t) => {
  t.mock.method(Message, "findOneAndUpdate", () => chain(null));
  const request = req(); request.user.role = "admin";
  request.params.messageId = "invalid";
  const invalid = res(); await controller.deleteMessage(request, invalid);
  assert.equal(invalid.statusCode, 400);
  request.params.messageId = String(new mongoose.Types.ObjectId());
  const missing = res(); await controller.deleteMessage(request, missing);
  assert.equal(missing.statusCode, 404);
});

test("deleting the first message keeps its replies and never signs deleted attachments", async (t) => {
  t.mock.method(storage, "getSignedObjectUrl", () => assert.fail("deleted attachment was signed"));
  const root = { _id: new mongoose.Types.ObjectId(), text: "Sensitive old text", deleted_at: new Date(), attachments: [{ key: "removed.pdf" }] };
  const reply = { _id: new mongoose.Types.ObjectId(), text: "Keep this reply", attachments: [] };
  t.mock.method(Message, "findOne", () => chain(root));
  t.mock.method(Message, "find", () => chain([reply]));
  const response = res(); await controller.listMessages(req(), response);
  assert.equal(response.body.data.root._id, root._id); assert.equal(response.body.data.root.text, "");
  assert.ok(response.body.data.root.deleted_at); assert.deepEqual(response.body.data.root.attachments, []);
  assert.equal(response.body.data.replies[0].text, "Keep this reply");
});

test("retries cannot restore a message deleted by an admin", async (t) => {
  const deleted = { _id: new mongoose.Types.ObjectId(), deleted_at: new Date(), text: "", attachments: [] };
  t.mock.method(Message, "findOne", () => chain(deleted));
  t.mock.method(Message, "create", () => assert.fail("deleted message restored"));
  const response = res(); await controller.postMessage(req(), response);
  assert.equal(response.body.data._id, deleted._id); assert.ok(response.body.data.deleted_at);
});

test("storage cleanup errors do not restore deleted messages", async (t) => {
  const events = [];
  t.mock.method(discussionRelay, "publishItemDiscussionEvent", async (event) => events.push(event));
  t.mock.method(console, "error", () => {});
  t.mock.method(Message, "findOneAndUpdate", () => chain({ attachments: [{ key: "old.pdf" }] }));
  t.mock.method(storage, "deleteObject", async () => { throw new Error("Storage unavailable"); });
  const request = req(); request.user.role = "admin"; request.params.messageId = String(new mongoose.Types.ObjectId());
  const response = res(); await controller.deleteMessage(request, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(events, [{ type: "changed", itemId: String(itemId), topic: "autocad" }]);
});
