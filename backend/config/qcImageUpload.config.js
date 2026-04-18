const fs = require("fs");
const os = require("os");
const path = require("path");

const ABSOLUTE_MAX_QC_IMAGE_UPLOAD_COUNT = 100;
const DEFAULT_QC_IMAGE_UPLOAD_COUNT = 100;
const DEFAULT_QC_IMAGE_MAX_FILE_SIZE = 12 * 1024 * 1024;
const DEFAULT_QC_IMAGE_PROCESSING_CHUNK_SIZE = 5;
const DEFAULT_QC_IMAGE_PROCESSING_CONCURRENCY = 1;
const MAX_QC_IMAGE_PROCESSING_CONCURRENCY = 2;
const DEFAULT_QC_IMAGE_MAX_WIDTH = 2200;
const DEFAULT_QC_IMAGE_JPEG_QUALITY = 78;
const DEFAULT_QC_IMAGE_WEBP_QUALITY = 78;
const DEFAULT_QC_IMAGE_MAX_INPUT_PIXELS = 40 * 1024 * 1024;

const QC_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const QC_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const QC_IMAGE_UPLOAD_MODES = Object.freeze({
  SINGLE: "single",
  BULK: "bulk",
});

const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const clampInteger = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, toPositiveInteger(value, minimum)));

const MAX_QC_IMAGE_UPLOAD_COUNT = clampInteger(
  process.env.QC_IMAGE_MAX_UPLOAD_COUNT
    || process.env.MAX_QC_IMAGE_UPLOAD_COUNT
    || DEFAULT_QC_IMAGE_UPLOAD_COUNT,
  1,
  ABSOLUTE_MAX_QC_IMAGE_UPLOAD_COUNT,
);

const QC_IMAGE_MAX_FILE_SIZE = Math.max(
  1,
  toPositiveInteger(process.env.QC_IMAGE_MAX_FILE_SIZE, DEFAULT_QC_IMAGE_MAX_FILE_SIZE),
);

const QC_IMAGE_PROCESSING_CHUNK_SIZE = clampInteger(
  process.env.QC_IMAGE_PROCESSING_CHUNK_SIZE || DEFAULT_QC_IMAGE_PROCESSING_CHUNK_SIZE,
  1,
  MAX_QC_IMAGE_UPLOAD_COUNT,
);

const QC_IMAGE_PROCESSING_CONCURRENCY = clampInteger(
  process.env.QC_IMAGE_PROCESSING_CONCURRENCY
    || process.env.QC_IMAGE_OPTIMIZE_CONCURRENCY
    || process.env.QC_IMAGE_UPLOAD_CONCURRENCY
    || DEFAULT_QC_IMAGE_PROCESSING_CONCURRENCY,
  1,
  MAX_QC_IMAGE_PROCESSING_CONCURRENCY,
);

const QC_IMAGE_MAX_WIDTH = Math.max(
  1,
  toPositiveInteger(process.env.QC_IMAGE_MAX_WIDTH, DEFAULT_QC_IMAGE_MAX_WIDTH),
);

const QC_IMAGE_JPEG_QUALITY = clampInteger(
  process.env.QC_IMAGE_JPEG_QUALITY || DEFAULT_QC_IMAGE_JPEG_QUALITY,
  1,
  100,
);

const QC_IMAGE_WEBP_QUALITY = clampInteger(
  process.env.QC_IMAGE_WEBP_QUALITY || DEFAULT_QC_IMAGE_WEBP_QUALITY,
  1,
  100,
);

const QC_IMAGE_MAX_INPUT_PIXELS = Math.max(
  1,
  toPositiveInteger(
    process.env.QC_IMAGE_MAX_INPUT_PIXELS,
    DEFAULT_QC_IMAGE_MAX_INPUT_PIXELS,
  ),
);

const OMS_TEMP_ROOT_DIR = path.join(process.env.OMS_TEMP_DIR || os.tmpdir(), "oms");
const QC_IMAGE_TEMP_DIR = path.join(OMS_TEMP_ROOT_DIR, "qc-image-uploads");
const QC_IMAGE_OPTIMIZATION_TEMP_DIR = path.join(OMS_TEMP_ROOT_DIR, "image-optimization");

const ensureQcImageTempDirectories = () => {
  fs.mkdirSync(QC_IMAGE_TEMP_DIR, { recursive: true });
  fs.mkdirSync(QC_IMAGE_OPTIMIZATION_TEMP_DIR, { recursive: true });
};

module.exports = {
  ABSOLUTE_MAX_QC_IMAGE_UPLOAD_COUNT,
  QC_IMAGE_MIME_TYPES,
  QC_IMAGE_EXTENSIONS,
  QC_IMAGE_UPLOAD_MODES,
  MAX_QC_IMAGE_UPLOAD_COUNT,
  QC_IMAGE_MAX_FILE_SIZE,
  QC_IMAGE_PROCESSING_CHUNK_SIZE,
  QC_IMAGE_PROCESSING_CONCURRENCY,
  QC_IMAGE_MAX_WIDTH,
  QC_IMAGE_JPEG_QUALITY,
  QC_IMAGE_WEBP_QUALITY,
  QC_IMAGE_MAX_INPUT_PIXELS,
  OMS_TEMP_ROOT_DIR,
  QC_IMAGE_TEMP_DIR,
  QC_IMAGE_OPTIMIZATION_TEMP_DIR,
  ensureQcImageTempDirectories,
};
