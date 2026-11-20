const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const multer = require("multer");
const { DISCUSSION_FILE_TYPES, MAX_DISCUSSION_FILES, MAX_DISCUSSION_FILE_BYTES } = require("../helpers/itemDiscussions");

const directory = path.join(os.tmpdir(), "oms-item-discussions");
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try { fs.mkdirSync(directory, { recursive: true }); cb(null, directory); } catch (error) { cb(error); }
    },
  }),
  limits: { files: MAX_DISCUSSION_FILES, fileSize: MAX_DISCUSSION_FILE_BYTES, fields: 2, fieldSize: 24 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!DISCUSSION_FILE_TYPES[path.extname(file.originalname).toLowerCase()]) return cb(new Error("Unsupported discussion attachment format."));
    cb(null, true);
  },
}).array("files", MAX_DISCUSSION_FILES);

const cleanupDiscussionFiles = async (files = []) => {
  await Promise.all(files.map((file) => fsp.unlink(file.path).catch((error) => {
    if (error.code !== "ENOENT") console.error("Discussion temp file cleanup failed", error);
  })));
};
const discussionUpload = (req, res, next) => upload(req, res, async (error) => {
  if (!error) return next();
  await cleanupDiscussionFiles(req.files);
  return res.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Each attachment must be 50 MB or smaller." : error.message || "Invalid discussion attachments." });
});
module.exports = { discussionUpload, cleanupDiscussionFiles };
