const path = require("path");
const Upload = require("../models/dropTestVideoUpload.model");
const storage = require("./wasabiStorage.service");

const PART_SIZE = 5 * 1024 * 1024;
const MAX_VIDEO_SIZE = 900_000_000;
const RESUME_MS = 7 * 86400_000;
const VIDEO_TYPES = new Map([[".mp4", "video/mp4"], [".mov", "video/quicktime"], [".mkv", "video/x-matroska"]]);

const uploadError = (message, status = 400) => Object.assign(new Error(message), { status });

const readVideoMetadata = (body = {}) => {
  const original_name = typeof body.name === "string" ? body.name.trim() : "";
  const content_type = VIDEO_TYPES.get(path.extname(original_name).toLowerCase());
  if (!content_type || original_name.length > 255 || /[\\/\x00-\x1f]/.test(original_name)) {
    throw uploadError("Select an MP4, MOV, or MKV video.");
  }
  if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_VIDEO_SIZE) {
    throw uploadError(`Each video must be between 1 byte and ${MAX_VIDEO_SIZE / 1_000_000} MB.`);
  }
  if (typeof body.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.fingerprint)) {
    throw uploadError("Video fingerprint is invalid.");
  }
  return { original_name, content_type, size: body.size, fingerprint: body.fingerprint };
};

const partLength = (size, number) => {
  if (!Number.isInteger(number) || number < 1 || number > Math.ceil(size / PART_SIZE)) return 0;
  return Math.min(PART_SIZE, size - (number - 1) * PART_SIZE);
};

const readParts = async (upload) => {
  try {
    const parts = await storage.listMultipartParts(upload.key, upload.wasabi_upload_id);
    return { complete: false, parts: parts.filter(({ PartNumber, Size, ETag }) =>
      ETag && Size > 0 && Size === partLength(upload.size, PartNumber)) };
  } catch (error) {
    if (error.name !== "NoSuchUpload") throw error;
    const object = await storage.getObjectMetadata(upload.key, { abortSignal: AbortSignal.timeout(30_000) });
    if (!object.exists) return null;
    if (object.size !== upload.size || object.contentType !== upload.content_type) {
      throw uploadError("The stored video does not match the selected file.", 409);
    }
    return { complete: true, parts: [] };
  }
};

const createUpload = async (match, metadata) => {
  const key = storage.createStorageKey({ folder: "qc-tests/videos", originalName: metadata.original_name });
  const wasabi_upload_id = await storage.createMultipartUpload(key, metadata.content_type);
  try {
    return await Upload.create({ ...match, ...metadata, key, wasabi_upload_id, expires_at: new Date(Date.now() + RESUME_MS) });
  } catch (error) {
    // On an ambiguous database error leave the storage session resumable.
    if (error.code !== 11000) throw error;
    await storage.abortMultipartUpload(key, wasabi_upload_id).catch(() => {});
    return Upload.findOne(match);
  }
};

const prepareVideoUpload = async (scope, body) => {
  const metadata = readVideoMetadata(body);
  const match = { ...scope, fingerprint: metadata.fingerprint };
  let upload = await Upload.findOne(match);
  if (upload && upload.expires_at > new Date()) {
    if (upload.size !== metadata.size || upload.content_type !== metadata.content_type) {
      throw uploadError("The resumed upload does not match the selected video.", 409);
    }
    const status = await readParts(upload);
    if (status) return {
      upload_id: upload.id,
      part_size: PART_SIZE,
      complete: status.complete,
      uploaded_parts: status.parts.map((part) => part.PartNumber),
    };
  }
  if (upload) await Upload.deleteOne({ _id: upload._id });
  upload = await createUpload(match, metadata);
  if (!upload) throw uploadError("Retry to prepare the video upload.", 409);
  return { upload_id: upload.id, part_size: PART_SIZE, complete: false, uploaded_parts: [] };
};

const findUpload = async (scope, id) => {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) throw uploadError("Invalid video upload ID.");
  const upload = await Upload.findOne({ ...scope, _id: id, expires_at: { $gt: new Date() } });
  if (!upload) throw uploadError("Video upload expired or is unavailable. Retry the upload.", 404);
  return upload;
};

const signVideoPart = async (scope, id, partNumber) => {
  const upload = await findUpload(scope, id);
  const size = partLength(upload.size, partNumber);
  if (!size) throw uploadError("Invalid video part number.");
  return storage.getPresignedPartUrl(upload.key, upload.wasabi_upload_id, partNumber, size);
};

const completeVideoUpload = async (scope, id, actor) => {
  const upload = await findUpload(scope, id);
  const status = await readParts(upload);
  if (!status) throw uploadError("Video upload expired. Retry the upload.", 409);
  if (!status.complete) {
    const parts = status.parts.sort((a, b) => a.PartNumber - b.PartNumber);
    if (parts.length !== Math.ceil(upload.size / PART_SIZE) || parts.some((part, index) => part.PartNumber !== index + 1)) {
      throw uploadError("Video upload is incomplete. Retry to upload the missing parts.", 409);
    }
    try {
      await storage.completeMultipartUpload(upload.key, upload.wasabi_upload_id,
        parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })));
    } catch (error) {
      if (error.name !== "NoSuchUpload" || !(await readParts(upload))?.complete) throw error;
    }
  }
  return {
    key: upload.key,
    original_name: upload.original_name,
    content_type: upload.content_type,
    size: upload.size,
    uploaded_by: actor,
  };
};

module.exports = { prepareVideoUpload, signVideoPart, completeVideoUpload };
