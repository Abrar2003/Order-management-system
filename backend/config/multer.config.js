const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");

const QC_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const QC_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const MAX_QC_IMAGE_UPLOAD_COUNT = 100;
const DEFAULT_QC_IMAGE_MAX_FILE_SIZE = 12 * 1024 * 1024;
const QC_IMAGE_MAX_FILE_SIZE = Math.max(
  1,
  Number(process.env.QC_IMAGE_MAX_FILE_SIZE || DEFAULT_QC_IMAGE_MAX_FILE_SIZE),
);
const QC_IMAGE_TEMP_DIR = path.join(
  process.env.OMS_TEMP_DIR || os.tmpdir(),
  "oms",
  "qc-image-uploads",
);

fs.mkdirSync(QC_IMAGE_TEMP_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

const qcImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, QC_IMAGE_TEMP_DIR);
  },
  filename: (_req, file, cb) => {
    const originalName = String(file?.originalname || "").trim();
    const extension = path.extname(originalName).toLowerCase();
    const safeExtension = QC_IMAGE_EXTENSIONS.has(extension) ? extension : ".img";
    const baseName = path
      .basename(originalName, extension)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "qc-image";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${baseName}${safeExtension}`);
  },
});

const qcImageFileFilter = (_req, file, cb) => {
  const mimeType = String(file?.mimetype || "").trim().toLowerCase();
  const extension = path.extname(String(file?.originalname || "")).toLowerCase();

  if (QC_IMAGE_MIME_TYPES.has(mimeType) && QC_IMAGE_EXTENSIONS.has(extension)) {
    cb(null, true);
    return;
  }

  cb(new Error("Only JPG, JPEG, and PNG files are allowed for QC images"));
};

const qcImageUpload = multer({
  storage: qcImageStorage,
  limits: {
    files: MAX_QC_IMAGE_UPLOAD_COUNT,
    fileSize: QC_IMAGE_MAX_FILE_SIZE,
  },
  fileFilter: qcImageFileFilter,
});

const handleQcImageUploadErrors = (err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `QC image exceeds the maximum allowed size of ${QC_IMAGE_MAX_FILE_SIZE} bytes`,
      });
    }

    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: `You can upload up to ${MAX_QC_IMAGE_UPLOAD_COUNT} QC images at once`,
      });
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: "Only JPG, JPEG, and PNG files are allowed for QC images",
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || "Invalid upload request",
    });
  }

  return res.status(400).json({
    success: false,
    message: err?.message || "Invalid upload request",
  });
};

module.exports = upload;
module.exports.qcImageUpload = qcImageUpload;
module.exports.handleQcImageUploadErrors = handleQcImageUploadErrors;
module.exports.QC_IMAGE_TEMP_DIR = QC_IMAGE_TEMP_DIR;
module.exports.MAX_QC_IMAGE_UPLOAD_COUNT = MAX_QC_IMAGE_UPLOAD_COUNT;
module.exports.QC_IMAGE_MAX_FILE_SIZE = QC_IMAGE_MAX_FILE_SIZE;
