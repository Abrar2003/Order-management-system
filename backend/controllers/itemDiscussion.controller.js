const fs = require("node:fs/promises");
const mongoose = require("mongoose");
const Item = require("../models/item.model");
const Message = require("../models/itemDiscussionMessage.model");
const storage = require("../services/wasabiStorage.service");
const { applyItemDataAccess } = require("../helpers/itemQuery");
const { buildAuditActor } = require("../helpers/permissions");
const { normalizeUserRoleKey } = require("../helpers/userRole");
const { DISCUSSION_TOPICS, discussionError, validateDiscussionFile, validateDiscussionMessage } = require("../helpers/itemDiscussions");
const { cleanupDiscussionFiles } = require("../middlewares/itemDiscussionUpload.middleware");
const discussionRelay = require("../services/itemDiscussionRelay.service");

const sendError = (res, error) => {
  if (!error.statusCode) console.error("Item discussion error:", error);
  return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Could not load or save the item discussion. Please try again." });
};
const messageMatch = (req) => ({ item: req.discussionItem._id, topic: req.params.topic });
const serializeMessage = async (message) => ({
  _id: message._id, text: message.deleted_at ? "" : message.text, author: message.author, created_at: message.created_at,
  deleted_at: message.deleted_at || null,
  attachments: await Promise.all((message.deleted_at ? [] : message.attachments || []).map(async (file) => ({
    _id: file._id, name: file.name, size: file.size, content_type: file.content_type,
    url: await storage.getSignedObjectUrl(file.key, { expiresIn: 900, filename: file.name, contentType: file.content_type }),
  }))),
});

exports.loadItem = async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw discussionError(400, "Invalid item id.");
    if (req.params.topic && !Object.hasOwn(DISCUSSION_TOPICS, req.params.topic)) throw discussionError(400, "Invalid discussion topic.");
    const item = await Item.findOne(applyItemDataAccess({ _id: req.params.id }, req.user)).select("_id code").lean();
    if (!item) throw discussionError(404, "Item not found.");
    req.discussionItem = item;
    return next();
  } catch (error) { return sendError(res, error); }
};

exports.listTopics = async (req, res) => {
  try {
    const summaries = await Message.aggregate([
      { $match: { item: req.discussionItem._id } }, { $sort: { _id: 1 } },
      { $group: { _id: "$topic", count: { $sum: 1 }, latest: { $last: { text: "$text", author: "$author", created_at: "$created_at", deleted_at: "$deleted_at" } } } },
    ]);
    return res.json({ data: Object.entries(DISCUSSION_TOPICS).map(([key, label]) => {
      const summary = summaries.find((entry) => entry._id === key);
      return { key, label, message_count: summary?.count || 0, latest: summary?.latest || null };
    }) });
  } catch (error) { return sendError(res, error); }
};

exports.listMessages = async (req, res) => {
  try {
    const before = req.query.before;
    if (before !== undefined && !mongoose.isObjectIdOrHexString(before)) throw discussionError(400, "Invalid discussion cursor.");
    const match = messageMatch(req);
    const root = await Message.findOne(match).sort({ _id: 1 }).lean();
    if (!root) return res.json({ data: { root: null, replies: [], before: null } });
    const replies = await Message.find({ ...match, _id: { $ne: root._id, ...(before ? { $lt: new mongoose.Types.ObjectId(before) } : {}) } })
      .sort({ _id: -1 }).limit(51).lean();
    const hasMore = replies.length > 50;
    if (hasMore) replies.pop();
    replies.reverse();
    return res.json({ data: {
      root: await serializeMessage(root), replies: await Promise.all(replies.map(serializeMessage)),
      before: hasMore ? String(replies[0]._id) : null,
    } });
  } catch (error) { return sendError(res, error); }
};

const verifyFileContent = async (file, contentType) => {
  const handle = await fs.open(file.path, "r");
  try {
    const bytes = Buffer.alloc(12);
    await handle.read(bytes, 0, 12, 0);
    const hex = bytes.toString("hex");
    const valid = {
      "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
      "image/jpeg": hex.startsWith("ffd8ff"), "image/png": hex.startsWith("89504e470d0a1a0a"),
      "image/webp": bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP",
      "video/mp4": bytes.subarray(4, 8).toString() === "ftyp", "video/quicktime": ["ftyp", "moov", "mdat", "wide"].includes(bytes.subarray(4, 8).toString()),
      "video/x-matroska": hex.startsWith("1a45dfa3"),
      "application/vnd.ms-excel": hex.startsWith("d0cf11e0a1b11ae1"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": hex.startsWith("504b0304"),
    }[contentType];
    if (!valid) throw discussionError(400, `${file.originalname} does not match its file format.`);
  } finally { await handle.close(); }
};

exports.postMessage = async (req, res) => {
  const uploadedKeys = [];
  let saved = false;
  try {
    const content = validateDiscussionMessage(req.body || {}, req.files);
    const author = buildAuditActor(req.user);
    const identity = { ...messageMatch(req), "author.user": author.user, client_message_id: content.client_message_id };
    const existing = await Message.findOne(identity).lean();
    if (existing) return res.json({ data: await serializeMessage(existing) });
    const files = (req.files || []).map((file) => validateDiscussionFile(file));
    for (let i = 0; i < files.length; i++) await verifyFileContent(req.files[i], files[i].content_type);
    const attachments = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = storage.createStorageKey({ folder: `item-discussions/${req.discussionItem._id}/${req.params.topic}`, originalName: file.name });
      uploadedKeys.push(key);
      await storage.uploadFile({ filePath: req.files[i].path, key, originalName: file.name, contentType: file.content_type });
      attachments.push({ ...file, key });
    }
    let message;
    try { message = await Message.create({ ...messageMatch(req), ...content, author, attachments }); }
    catch (error) {
      if (error.code !== 11000) throw error;
      const duplicate = await Message.findOne(identity).lean();
      if (!duplicate) throw error;
      return res.json({ data: await serializeMessage(duplicate) });
    }
    saved = true;
    void discussionRelay.publishItemDiscussionEvent({ type: "changed", itemId: String(req.discussionItem._id), topic: req.params.topic });
    return res.status(201).json({ data: await serializeMessage(message.toObject()) });
  } catch (error) { return sendError(res, error); }
  finally {
    if (!saved) await Promise.all(uploadedKeys.map((key) => storage.deleteObject(key).catch((error) => console.error("Discussion upload cleanup failed", error))));
    await cleanupDiscussionFiles(req.files);
  }
};

exports.getAttachment = async (req, res) => {
  try {
    if (![req.params.messageId, req.params.fileId].every(mongoose.isObjectIdOrHexString)) throw discussionError(400, "Invalid discussion attachment.");
    const message = await Message.findOne({ ...messageMatch(req), _id: req.params.messageId, deleted_at: null, "attachments._id": req.params.fileId }).lean();
    const file = message?.attachments.find((entry) => String(entry._id) === req.params.fileId);
    if (!file) throw discussionError(404, "Attachment not found.");
    return res.json({ data: { url: await storage.getSignedObjectUrl(file.key, {
      expiresIn: 900, download: req.query.download === "true", filename: file.name, contentType: file.content_type,
    }) } });
  } catch (error) { return sendError(res, error); }
};

exports.deleteMessage = async (req, res) => {
  try {
    if (!["admin", "super_admin"].includes(normalizeUserRoleKey(req.user?.role))) throw discussionError(403, "Only admins can delete discussion messages.");
    if (!mongoose.isObjectIdOrHexString(req.params.messageId)) throw discussionError(400, "Invalid discussion message.");
    // Keep the thread position and retry identifier so replies stay attached and retries cannot restore deleted content.
    const message = await Message.findOneAndUpdate({ ...messageMatch(req), _id: req.params.messageId, deleted_at: null }, {
      $set: { text: "", attachments: [], deleted_at: new Date(), deleted_by: buildAuditActor(req.user) },
    }, { new: false }).lean();
    if (!message) throw discussionError(404, "Message not found or already deleted.");
    void discussionRelay.publishItemDiscussionEvent({ type: "changed", itemId: String(req.discussionItem._id), topic: req.params.topic });
    await Promise.all((message.attachments || []).map((file) => storage.deleteObject(file.key).catch((error) => console.error("Deleted discussion attachment cleanup failed", error))));
    return res.json({ success: true });
  } catch (error) { return sendError(res, error); }
};
