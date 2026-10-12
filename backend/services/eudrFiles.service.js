const path = require("node:path");
const crypto = require("node:crypto");
const storage = require("./wasabiStorage.service");
const types = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".csv": "text/csv", ".txt": "text/plain",
};
const fileMime = (name) => types[path.extname(String(name)).toLowerCase()];
const assertForestImage = async (file) => {
  try {
    const metadata = await require("sharp")(file.buffer).metadata();
    if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format) || fileMime(file.originalname) !== `image/${metadata.format}`) throw new Error("Invalid image format");
  } catch {
    throw Object.assign(new Error("Forest image must be a valid PNG, JPEG or WebP image"), { statusCode: 400 });
  }
};
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const priorDocuments = (chain) => [
  ...chain.stages.flatMap((stage) => stage.documents || []),
  ...chain.history.flatMap((entry) => entry.event === "document_uploaded" ? [entry.detail?.replaced] : entry.event === "later_stages_superseded" ? (entry.detail?.stages || []).flatMap((stage) => stage.documents || []) : entry.event === "legacy_receiver_upgraded" ? entry.detail?.stage?.documents || [] : []),
].filter(Boolean);
const assertUniqueFile = async (chain, file) => {
  for (const document of priorDocuments(chain)) {
    if (String(document.name).trim().toLowerCase() === String(file.name).trim().toLowerCase()) throw Object.assign(new Error(`A file named ${file.name} was already uploaded in this chain.`), { statusCode: 409 });
    let hash = document.sha256;
    if (!hash && document.key && (document.size == null || Number(document.size) === Number(file.size))) hash = sha256((await storage.getObjectBuffer(document.key)).buffer);
    if (hash === file.sha256) throw Object.assign(new Error(`This file was already uploaded in this chain (${document.name}).`), { statusCode: 409 });
  }
};
module.exports = { fileMime, sha256, assertUniqueFile, assertForestImage };
