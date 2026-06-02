const path = require("path");
const multer = require("multer");
const {
  QC_IMAGE_MIME_TYPES,
  QC_IMAGE_EXTENSIONS,
  MAX_QC_IMAGE_UPLOAD_COUNT,
  QC_IMAGE_MAX_FILE_SIZE,
  QC_IMAGE_TEMP_DIR,
  ensureQcImageTempDirectories,
} = require("./qcImageUpload.config");

const DEFAULT_GENERIC_UPLOAD_MAX_FILE_SIZE = 50 * 1024 * 1024;
const GENERIC_UPLOAD_MAX_FILE_SIZE = Math.max(
  1,
  Number.parseInt(
    String(process.env.GENERIC_UPLOAD_MAX_FILE_SIZE || DEFAULT_GENERIC_UPLOAD_MAX_FILE_SIZE),
    10,
  ) || DEFAULT_GENERIC_UPLOAD_MAX_FILE_SIZE,
);

const GENERIC_UPLOAD_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/excel",
  "application/x-excel",
  "application/x-msexcel",
  "application/xls",
  "application/x-xls",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const GENERIC_UPLOAD_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
  ".pptm",
]);

const COMPLAINT_UPLOAD_MAX_FILE_SIZE = Math.max(
  1,
  Number.parseInt(
    String(process.env.COMPLAINT_UPLOAD_MAX_FILE_SIZE || DEFAULT_GENERIC_UPLOAD_MAX_FILE_SIZE),
    10,
  ) || DEFAULT_GENERIC_UPLOAD_MAX_FILE_SIZE,
);
const COMPLAINT_UPLOAD_MAX_FILE_COUNT = Math.max(
  1,
  Number.parseInt(String(process.env.COMPLAINT_UPLOAD_MAX_FILE_COUNT || 10), 10) || 10,
);
const SAMPLE_UPLOAD_MAX_FILE_SIZE = Math.max(
  1,
  Number.parseInt(
    String(process.env.SAMPLE_UPLOAD_MAX_FILE_SIZE || DEFAULT_GENERIC_UPLOAD_MAX_FILE_SIZE),
    10,
  ) || DEFAULT_GENERIC_UPLOAD_MAX_FILE_SIZE,
);
const SAMPLE_UPLOAD_MAX_FILE_COUNT = Math.max(
  1,
  Number.parseInt(String(process.env.SAMPLE_UPLOAD_MAX_FILE_COUNT || 20), 10) || 20,
);
const COMPLAINT_UPLOAD_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/excel",
  "application/x-excel",
  "application/x-msexcel",
  "application/xls",
  "application/x-xls",
  "text/csv",
  "application/csv",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/x-matroska",
  "video/quicktime",
]);
const COMPLAINT_UPLOAD_EXTENSIONS = new Set([
  ".pdf",
  ".xls",
  ".xlsx",
  ".csv",
  ".png",
  ".jpeg",
  ".jpg",
  ".webp",
  ".mp4",
  ".mkv",
  ".mov",
  ".doc",
  ".docx",
  ".txt",
]);

const SAMPLE_UPLOAD_MIME_TYPES = new Set([
  ...COMPLAINT_UPLOAD_MIME_TYPES,
  "application/acad",
  "application/dwg",
  "application/x-dwg",
  "image/vnd.dwg",
]);
const SAMPLE_UPLOAD_EXTENSIONS = new Set([
  ...COMPLAINT_UPLOAD_EXTENSIONS,
  ".dwg",
  ".dxf",
]);

// Legacy non-QC uploads still use the generic middleware; QC image routes must
// use the dedicated disk-backed middleware exported below.
const genericFileFilter = (_req, file, cb) => {
  const mimeType = String(file?.mimetype || "").trim().toLowerCase();
  const extension = path.extname(String(file?.originalname || "")).toLowerCase();

  if (GENERIC_UPLOAD_MIME_TYPES.has(mimeType) && GENERIC_UPLOAD_EXTENSIONS.has(extension)) {
    cb(null, true);
    return;
  }

  cb(new Error("Unsupported file type"), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: GENERIC_UPLOAD_MAX_FILE_SIZE,
  },
  fileFilter: genericFileFilter,
});

const complaintFileFilter = (_req, file, cb) => {
  const mimeType = String(file?.mimetype || "").trim().toLowerCase();
  const extension = path.extname(String(file?.originalname || "")).toLowerCase();

  if (COMPLAINT_UPLOAD_MIME_TYPES.has(mimeType) && COMPLAINT_UPLOAD_EXTENSIONS.has(extension)) {
    cb(null, true);
    return;
  }

  cb(new Error("Unsupported complaint file type"), false);
};

const complaintUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: COMPLAINT_UPLOAD_MAX_FILE_COUNT,
    fileSize: COMPLAINT_UPLOAD_MAX_FILE_SIZE,
  },
  fileFilter: complaintFileFilter,
});

const sampleFileFilter = (_req, file, cb) => {
  const mimeType = String(file?.mimetype || "").trim().toLowerCase();
  const extension = path.extname(String(file?.originalname || "")).toLowerCase();

  if (SAMPLE_UPLOAD_MIME_TYPES.has(mimeType) && SAMPLE_UPLOAD_EXTENSIONS.has(extension)) {
    cb(null, true);
    return;
  }

  cb(new Error("Unsupported sample file type"), false);
};

const sampleUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: SAMPLE_UPLOAD_MAX_FILE_COUNT,
    fileSize: SAMPLE_UPLOAD_MAX_FILE_SIZE,
  },
  fileFilter: sampleFileFilter,
});
ensureQcImageTempDirectories();

const qcImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureQcImageTempDirectories();
      cb(null, QC_IMAGE_TEMP_DIR);
    } catch (error) {
      cb(error);
    }
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

const applyMulterMiddleware = (middleware) => (req, res, next) =>
  middleware(req, res, (err) => handleQcImageUploadErrors(err, req, res, next));

const applyGenericMulterMiddleware = (middleware) => (req, res, next) =>
  middleware(req, res, (err) => handleGenericUploadErrors(err, req, res, next));

const applyComplaintMulterMiddleware = (middleware) => (req, res, next) =>
  middleware(req, res, (err) => handleComplaintUploadErrors(err, req, res, next));

const applySampleMulterMiddleware = (middleware) => (req, res, next) =>
  middleware(req, res, (err) => handleSampleUploadErrors(err, req, res, next));

const handleGenericUploadErrors = (err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `Uploaded file exceeds the maximum allowed size of ${GENERIC_UPLOAD_MAX_FILE_SIZE} bytes`,
      });
    }

    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: "Upload accepts a single file for this field",
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
        message: `You can upload up to ${MAX_QC_IMAGE_UPLOAD_COUNT} QC images in one request`,
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

const handleComplaintUploadErrors = (err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `Complaint file exceeds the maximum allowed size of ${COMPLAINT_UPLOAD_MAX_FILE_SIZE} bytes`,
      });
    }

    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: `You can upload up to ${COMPLAINT_UPLOAD_MAX_FILE_COUNT} complaint files`,
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || "Invalid complaint upload request",
    });
  }

  return res.status(400).json({
    success: false,
    message: err?.message || "Invalid complaint upload request",
  });
};

const handleSampleUploadErrors = (err, _req, res, next) => {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `Sample file exceeds the maximum allowed size of ${SAMPLE_UPLOAD_MAX_FILE_SIZE} bytes`,
      });
    }

    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: `You can upload up to ${SAMPLE_UPLOAD_MAX_FILE_COUNT} sample files`,
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || "Invalid sample upload request",
    });
  }

  return res.status(400).json({
    success: false,
    message: err?.message || "Invalid sample upload request",
  });
};

module.exports = upload;
module.exports.safeSingle = (fieldName) =>
  applyGenericMulterMiddleware(upload.single(fieldName));
module.exports.qcImageUpload = qcImageUpload;
module.exports.qcImageAnyUpload = applyMulterMiddleware(qcImageUpload.any());
module.exports.qcImageSingleUpload = (fieldName = "image") =>
  applyMulterMiddleware(qcImageUpload.single(fieldName));
module.exports.handleGenericUploadErrors = handleGenericUploadErrors;
module.exports.handleQcImageUploadErrors = handleQcImageUploadErrors;
module.exports.handleComplaintUploadErrors = handleComplaintUploadErrors;
module.exports.handleSampleUploadErrors = handleSampleUploadErrors;
module.exports.complaintFilesUpload = (fieldName = "files") =>
  applyComplaintMulterMiddleware(complaintUpload.array(fieldName, COMPLAINT_UPLOAD_MAX_FILE_COUNT));
module.exports.sampleFilesUpload = (fieldName = "files") =>
  applySampleMulterMiddleware(sampleUpload.array(fieldName, SAMPLE_UPLOAD_MAX_FILE_COUNT));
module.exports.QC_IMAGE_TEMP_DIR = QC_IMAGE_TEMP_DIR;
module.exports.MAX_QC_IMAGE_UPLOAD_COUNT = MAX_QC_IMAGE_UPLOAD_COUNT;
module.exports.QC_IMAGE_MAX_FILE_SIZE = QC_IMAGE_MAX_FILE_SIZE;
module.exports.GENERIC_UPLOAD_MAX_FILE_SIZE = GENERIC_UPLOAD_MAX_FILE_SIZE;
module.exports.COMPLAINT_UPLOAD_MAX_FILE_SIZE = COMPLAINT_UPLOAD_MAX_FILE_SIZE;
module.exports.COMPLAINT_UPLOAD_MAX_FILE_COUNT = COMPLAINT_UPLOAD_MAX_FILE_COUNT;
module.exports.SAMPLE_UPLOAD_MAX_FILE_SIZE = SAMPLE_UPLOAD_MAX_FILE_SIZE;
module.exports.SAMPLE_UPLOAD_MAX_FILE_COUNT = SAMPLE_UPLOAD_MAX_FILE_COUNT;
