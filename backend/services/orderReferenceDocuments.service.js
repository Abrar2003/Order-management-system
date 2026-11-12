const path = require("node:path");
const mongoose = require("mongoose");
const Order = require("../models/order.model");
const Upload = require("../models/orderReferenceUpload.model");
const { findVendorByName, getVendorId, getVendorName, normalizeVendorName, resolveVendorFromInput } = require("../helpers/vendorRef");
const { isManagerLikeRole } = require("../helpers/userRole");
const { applyDataAccessMatch } = require("./userDataAccess.service");
const wasabi = require("./wasabiStorage.service");

const FIELD = "order_reference_documents";
const UPLOAD_SECONDS = 15 * 60;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const FILE_TYPES = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const error = (statusCode, message, code = "REFERENCE_DOCUMENTS") =>
  Object.assign(new Error(message), { statusCode, code });
const uploadExpired = () =>
  error(409, "The document upload expired. Start the upload again.", "REFERENCE_UPLOAD_EXPIRED");
const canPreview = (type) => type === "application/pdf" || type.startsWith("image/");
const text = (value) => typeof value === "string" ? value.trim() : "";

const actor = (user) => ({
  user: user._id,
  name: text(user.name || user.username || user.email),
});

const groupKey = async ({ order_id, brand, vendor }, legacyVendors = new Map()) => {
  const name = getVendorName(vendor);
  const nameKey = normalizeVendorName(name);
  let vendorId = getVendorId(vendor);
  if (!vendorId && nameKey) {
    if (!legacyVendors.has(nameKey)) legacyVendors.set(nameKey, findVendorByName(name));
    vendorId = getVendorId(await legacyVendors.get(nameKey));
  }
  return JSON.stringify([text(order_id), text(brand).toLowerCase(), vendorId.toLowerCase() || nameKey]);
};

const activeOrder = async (id, user, session = null) => {
  if (!mongoose.isObjectIdOrHexString(id)) throw error(400, "Invalid order row");
  const order = await Order.findOne(applyDataAccessMatch({
    _id: id,
    archived: { $ne: true },
    status: { $ne: "Cancelled" },
  }, user)).select("order_id brand vendor").session(session).lean();
  if (!order) throw error(404, "Order not found");
  return order;
};

const validateFiles = (files) => {
  if (!Array.isArray(files) || files.length < 1 || files.length > 10) {
    throw error(400, "Select 1–10 order reference documents.");
  }
  return files.map((file) => {
    const name = text(file?.name);
    const contentType = FILE_TYPES[path.extname(name).toLowerCase()];
    const size = file?.size;
    if (!contentType || name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(name)) {
      throw error(400, "Use a valid PDF, Word, Excel, CSV, JPG, PNG, or WebP filename.");
    }
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
      throw error(400, `${name} must be between 1 byte and 50 MiB.`);
    }
    return { name, size, content_type: contentType };
  });
};

const objectKey = (upload, file, folder) =>
  `order-reference-documents/${folder}/${upload._id}/${folder === "files" ? `${upload.copy_id}/` : ""}${file._id}`;

const prepareUpload = async ({ po, orderRow, files, user }) => {
  const validatedFiles = validateFiles(files);
  assertTransactionsAvailable();
  if (!wasabi.isConfigured()) throw error(503, "Document storage is unavailable.");
  const upload = await Upload.create({
    uploader: user._id,
    order_row: orderRow || null,
    group_key: await groupKey(po),
    files: validatedFiles,
    expires_at: new Date(Date.now() + UPLOAD_SECONDS * 1000),
  });
  const urls = await Promise.all(upload.files.map(async (file) => ({
    upload_url: await wasabi.getPresignedUploadUrl(objectKey(upload, file, "staged"), {
      contentType: file.content_type,
      contentLength: file.size,
      expiresIn: UPLOAD_SECONDS,
    }),
    headers: { "Content-Type": file.content_type },
  })));
  return { upload_id: upload._id, expires_at: upload.expires_at, files: urls };
};

const findUpload = async (id, user) => {
  if (!mongoose.isObjectIdOrHexString(id)) throw error(400, "Select an order reference document upload.");
  const upload = await Upload.findOne({ _id: id, uploader: user._id }).lean();
  if (!upload) throw uploadExpired();
  return upload;
};

const readyUpload = async (upload) => {
  if (upload.expires_at <= new Date()) throw uploadExpired();
  if (upload.state === "ready") return upload;
  if (upload.state === "committed") throw error(409, "This document upload has already been used.");
  const copyId = new mongoose.Types.ObjectId();
  const now = new Date();
  const claimed = await Upload.updateOne({
    _id: upload._id,
    expires_at: { $gt: now },
    $or: [
      { state: "open" },
      { state: "copying", copy_started_at: { $lt: new Date(now.getTime() - 120_000) } },
    ],
  }, {
    $set: { state: "copying", copy_id: copyId, copy_started_at: now },
    $push: { copy_attempts: copyId },
  });
  if (!claimed.modifiedCount) {
    throw error(409, "This document upload is being processed. Retry shortly.");
  }
  const attempt = { ...upload, copy_id: copyId };
  const claim = { _id: upload._id, state: "copying", copy_id: copyId };

  try {
    const staged = await Promise.all(upload.files.map(async (file) => {
      const source = objectKey(upload, file, "staged");
      const metadata = await wasabi.getObjectMetadata(source, {
        abortSignal: AbortSignal.timeout(30_000),
      });
      if (!metadata.exists || metadata.size !== file.size ||
          metadata.contentType !== file.content_type || !metadata.etag) {
        throw error(409, `${file.name} is missing or incomplete. Retry the upload.`, "REFERENCE_UPLOAD_INCOMPLETE");
      }
      return { file, source, etag: metadata.etag };
    }));
    // Wait for every copy before releasing the claim, including on partial failure.
    const copied = await Promise.allSettled(staged.map(({ file, source, etag }) =>
      wasabi.copyObject(source, objectKey(attempt, file, "files"), etag),
    ));
    const failure = copied.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    const result = await Upload.updateOne(claim, { $set: { state: "ready" } });
    if (!result.modifiedCount) throw error(409, "This document upload is being processed. Retry shortly.");
    return attempt;
  } catch (failure) {
    await Upload.updateOne(claim, { $set: { state: "open" } });
    throw failure;
  }
};

const consumeUpload = async (upload, user, session) => {
  const result = await Upload.updateOne({
    _id: upload._id, state: "ready", copy_id: upload.copy_id, expires_at: { $gt: new Date() },
  }, { $set: { state: "committed" } }, { session });
  if (!result.modifiedCount) throw error(409, "This document upload expired or has already been used.");
  return {
    _id: upload._id,
    group_key: upload.group_key,
    uploader: actor(user),
    uploaded_at: new Date(),
    files: upload.files.map((file) => ({ ...file, key: objectKey(upload, file, "files") })),
  };
};

const assertTransactionsAvailable = () => {
  if (mongoose.connection.$supportsTransactions === false) {
    throw error(503, "Order reference documents require MongoDB transaction support.");
  }
};

const inTransaction = (work) => {
  assertTransactionsAvailable();
  return mongoose.connection.transaction(work);
};

const insertManualOrders = async (orders, uploadIds, user) => {
  if (!uploadIds.length) throw error(400, "Order Reference Documents are required.");
  const uploads = await Promise.all(uploadIds.map((id) => findUpload(id, user)));
  const uploadsByGroup = new Map(uploads.filter((upload) => !upload.order_row)
    .map((upload) => [upload.group_key, upload]));
  const firstRowByGroup = new Map();
  const vendors = new Map();
  const rowsWithVendorRefs = [];
  for (const [index, order] of orders.entries()) {
    const vendorKey = getVendorId(order.vendor) || normalizeVendorName(getVendorName(order.vendor));
    if (!vendors.has(vendorKey)) vendors.set(vendorKey, await resolveVendorFromInput(order.vendor));
    const row = { ...order, vendor: vendors.get(vendorKey) };
    rowsWithVendorRefs.push(row);
    const key = await groupKey(row);
    if (!firstRowByGroup.has(key)) firstRowByGroup.set(key, index);
  }
  if ([...firstRowByGroup.keys()].some((key) => !uploadsByGroup.has(key))) {
    throw error(400, "Attach a document upload for each PO being saved.");
  }
  for (const key of firstRowByGroup.keys()) {
    uploadsByGroup.set(key, await readyUpload(uploadsByGroup.get(key)));
  }
  await inTransaction(async (session) => {
    const rows = [...rowsWithVendorRefs];
    for (const [key, index] of firstRowByGroup) {
      const batch = await consumeUpload(uploadsByGroup.get(key), user, session);
      rows[index] = { ...rows[index], [FIELD]: [batch] };
    }
    await Order.insertMany(rows, { session, ordered: true, limit: 1 });
  });
};

const appendBatch = async (id, uploadId, user) => {
  const upload = await findUpload(uploadId, user);
  const anchor = await activeOrder(id, user);
  if (String(upload.order_row) !== String(anchor._id) || upload.group_key !== await groupKey(anchor)) {
    throw error(409, "This document upload belongs to a different PO.");
  }
  if (upload.state === "committed") return;
  const ready = await readyUpload(upload);
  await inTransaction(async (session) => {
    const order = await activeOrder(id, user, session);
    if (upload.group_key !== await groupKey(order)) {
      throw error(409, "The PO changed during upload. Start the upload again.");
    }
    const batch = await consumeUpload(ready, user, session);
    const updated = await Order.updateOne({ _id: order._id }, { $push: { [FIELD]: batch } }, {
      session, runValidators: true, timestamps: false,
    });
    if (!updated.modifiedCount) throw error(409, "The PO changed during upload. Start the upload again.");
  });
};

const canComment = (batch, user) =>
  String(batch.uploader.user) === String(user._id) || isManagerLikeRole(user.role);

const listBatches = async (key, user) => {
  const rows = await Order.find({ [`${FIELD}.group_key`]: key }).select(`+${FIELD}`).lean();
  return rows.flatMap((row) => row[FIELD]).filter((batch) => batch.group_key === key)
    .sort((left, right) => right.uploaded_at - left.uploaded_at)
    .map((batch) => ({
      _id: batch._id,
      uploader: batch.uploader.name,
      uploaded_at: batch.uploaded_at,
      can_comment: canComment(batch, user),
      files: batch.files.map(({ _id, name, size, content_type, comments }) => ({
        _id, name, size, can_preview: canPreview(content_type), comments,
      })),
    }));
};

const findFile = async (key, id) => {
  if (!mongoose.isObjectIdOrHexString(id)) throw error(400, "Invalid document id");
  const fileId = new mongoose.Types.ObjectId(id);
  const row = await Order.findOne({
    [FIELD]: { $elemMatch: { group_key: key, "files._id": fileId } },
  }).select(`+${FIELD}`).lean();
  const batch = row?.[FIELD].find((entry) =>
    entry.group_key === key && entry.files.some((file) => file._id.equals(fileId)),
  );
  if (!batch) throw error(404, "Order reference document not found");
  return { row, batch, file: batch.files.find((entry) => entry._id.equals(fileId)) };
};

const fileLink = async (key, id, download) => {
  const { file } = await findFile(key, id);
  const asDownload = download || !canPreview(file.content_type);
  return wasabi.getSignedObjectUrl(file.key, {
    expiresIn: 120,
    download: asDownload,
    contentType: asDownload ? "application/octet-stream" : file.content_type,
    filename: file.name,
  });
};

const addComment = async (key, id, value, user) => {
  const comment = text(value);
  if (!comment || comment.length > 2000) throw error(400, "Enter a comment of 1–2,000 characters.");
  const { row, batch, file } = await findFile(key, id);
  if (!canComment(batch, user)) throw error(403, "You cannot comment on this document.");
  const entry = { _id: new mongoose.Types.ObjectId(), text: comment, author: actor(user), created_at: new Date() };
  const result = await Order.updateOne({
    _id: row._id, [FIELD]: { $elemMatch: { _id: batch._id, group_key: key, "files._id": file._id } },
  }, { $push: { [`${FIELD}.$[batch].files.$[file].comments`]: entry } }, {
    arrayFilters: [{ "batch._id": batch._id, "batch.group_key": key }, { "file._id": file._id }],
    runValidators: true,
    timestamps: false,
  });
  if (!result.modifiedCount) throw error(404, "Order reference document not found");
  return entry;
};

const moveBatches = (from, to, session) => Order.updateMany({
  [`${FIELD}.group_key`]: { $in: from },
}, { $set: { [`${FIELD}.$[batch].group_key`]: to } }, {
  arrayFilters: [{ "batch.group_key": { $in: from } }], session, timestamps: false,
});

const cleanupExpiredUploads = async () => {
  if (!wasabi.isConfigured()) return;
  // Allow in-flight PUTs and copies to finish before removing expired objects.
  const before = new Date(Date.now() - 60 * 60 * 1000);
  const uploads = await Upload.find({ expires_at: { $lt: before } })
    .sort({ expires_at: 1 }).limit(50).lean();
  for (const upload of uploads) {
    try {
      await wasabi.deleteObjectPrefix(`order-reference-documents/staged/${upload._id}/`);
      if (upload.state !== "committed") {
        await wasabi.deleteObjectPrefix(`order-reference-documents/files/${upload._id}/`);
      } else {
        for (const attempt of upload.copy_attempts || []) {
          if (String(attempt) !== String(upload.copy_id)) {
            await wasabi.deleteObjectPrefix(`order-reference-documents/files/${upload._id}/${attempt}/`);
          }
        }
      }
      await Upload.deleteOne({ _id: upload._id });
    } catch (failure) {
      console.warn("Order reference upload cleanup failed", String(upload._id), failure.message);
    }
  }
};

module.exports = {
  activeOrder, addComment, appendBatch, cleanupExpiredUploads, fileLink, groupKey,
  insertManualOrders, inTransaction, listBatches, moveBatches, prepareUpload,
};
