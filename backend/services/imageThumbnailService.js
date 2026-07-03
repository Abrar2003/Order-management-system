const path = require("path");
const sharp = require("sharp");
const {
  QC_IMAGE_MAX_INPUT_PIXELS,
} = require("../config/qcImageUpload.config");

const QC_THUMBNAIL_MAX_DIMENSION = 480;
const QC_THUMBNAIL_WEBP_QUALITY = 72;
const QC_THUMBNAIL_CONTENT_TYPE = "image/webp";
const QC_THUMBNAIL_CACHE_CONTROL = "public, max-age=31536000, immutable";

const normalizeText = (value) => String(value ?? "").trim();

const normalizeStoragePath = (key = "") =>
  normalizeText(key).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

const buildQcThumbnailStorageKey = (sourceKey = "") => {
  const normalizedKey = normalizeStoragePath(sourceKey);
  if (!normalizedKey) {
    throw new Error("Source image key is required to build thumbnail key");
  }

  const directory = path.posix.dirname(normalizedKey);
  const extension = path.posix.extname(normalizedKey);
  const baseName = path.posix.basename(normalizedKey, extension) || "image";
  const thumbnailFileName = `${baseName}.webp`;

  if (!directory || directory === ".") {
    return `thumbnails/${thumbnailFileName}`;
  }

  return `${directory}/thumbnails/${thumbnailFileName}`;
};

const generateQcImageThumbnail = async ({
  sourceBuffer,
  maxDimension = QC_THUMBNAIL_MAX_DIMENSION,
  quality = QC_THUMBNAIL_WEBP_QUALITY,
} = {}) => {
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0) {
    throw new Error("Thumbnail generation requires a source image buffer");
  }

  const safeMaxDimension = Math.max(1, Number(maxDimension) || QC_THUMBNAIL_MAX_DIMENSION);
  const safeQuality = Math.min(100, Math.max(1, Number(quality) || QC_THUMBNAIL_WEBP_QUALITY));

  const { data, info } = await sharp(sourceBuffer, {
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: QC_IMAGE_MAX_INPUT_PIXELS,
  })
    .rotate()
    .resize({
      width: safeMaxDimension,
      height: safeMaxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: safeQuality,
    })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    contentType: QC_THUMBNAIL_CONTENT_TYPE,
    width: Number(info?.width || 0),
    height: Number(info?.height || 0),
    size: Buffer.byteLength(data),
  };
};

module.exports = {
  QC_THUMBNAIL_CACHE_CONTROL,
  QC_THUMBNAIL_CONTENT_TYPE,
  QC_THUMBNAIL_MAX_DIMENSION,
  QC_THUMBNAIL_WEBP_QUALITY,
  buildQcThumbnailStorageKey,
  generateQcImageThumbnail,
};
