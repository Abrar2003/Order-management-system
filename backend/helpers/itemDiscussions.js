const path = require("node:path");

const DISCUSSION_TOPICS = Object.freeze({ autocad: "AutoCAD", shipping_marks: "Shipping Marks", finish: "Finish" });
const MAX_DISCUSSION_FILES = 20;
const MAX_DISCUSSION_FILE_BYTES = 50 * 1024 * 1024;
const MAX_DISCUSSION_TEXT = 5000;
const DISCUSSION_FILE_TYPES = Object.freeze({
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
const discussionError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const validateDiscussionFile = (file) => {
  const name = String(file?.originalname || "");
  const extension = path.extname(name).toLowerCase();
  const content_type = DISCUSSION_FILE_TYPES[extension];
  if (!content_type || name.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(name)) {
    throw discussionError(400, "Attach PDF, JPG, PNG, WebP, MP4, MOV, MKV, XLS, or XLSX files.");
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_DISCUSSION_FILE_BYTES) {
    throw discussionError(400, "Each discussion attachment must be between 1 byte and 50 MB.");
  }
  return { name, content_type, size: file.size };
};
const validateDiscussionMessage = ({ text, client_message_id }, files = []) => {
  if (text !== undefined && typeof text !== "string") throw discussionError(400, "Invalid message text.");
  const cleaned = (text || "").trim();
  if (cleaned.length > MAX_DISCUSSION_TEXT) throw discussionError(400, "Messages must be 5,000 characters or fewer.");
  if (!Array.isArray(files) || files.length > MAX_DISCUSSION_FILES) throw discussionError(400, "Attach up to 20 files per message.");
  if (files.reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024) throw discussionError(400, "Keep attachments under 100 MB total per message.");
  if (!cleaned && !files.length) throw discussionError(400, "Write a message or attach a file.");
  if (typeof client_message_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_message_id)) {
    throw discussionError(400, "A valid message identifier is required.");
  }
  return { text: cleaned, client_message_id };
};

module.exports = { DISCUSSION_TOPICS, DISCUSSION_FILE_TYPES, MAX_DISCUSSION_FILES, MAX_DISCUSSION_FILE_BYTES, MAX_DISCUSSION_TEXT, discussionError, validateDiscussionFile, validateDiscussionMessage };
