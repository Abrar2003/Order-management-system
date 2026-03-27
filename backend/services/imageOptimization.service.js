const path = require("path");
const sharp = require("sharp");

const SUPPORTED_SOURCE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_IMAGE_WIDTH = 2200;
const JPEG_QUALITY = 78;
const PNG_WEBP_QUALITY = 78;

const normalizeText = (value) => String(value || "").trim();

const normalizeMimeType = (value) => normalizeText(value).toLowerCase();

const ensureFileNameWithExtension = (originalName = "", extension = ".jpg") => {
  const trimmedName = normalizeText(originalName);
  const parsedPath = path.parse(trimmedName || "qc-image");
  const safeBaseName = normalizeText(parsedPath.name) || "qc-image";
  return `${safeBaseName}${extension}`;
};

const optimizeImageForStorage = async ({
  buffer,
  contentType = "",
  originalName = "",
} = {}) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Image optimization requires a Buffer");
  }

  const normalizedContentType = normalizeMimeType(contentType);
  const normalizedOriginalName = normalizeText(originalName);
  const originalSize = Buffer.byteLength(buffer);

  if (!SUPPORTED_SOURCE_MIME_TYPES.has(normalizedContentType) || originalSize <= 0) {
    return {
      buffer,
      contentType: normalizedContentType || contentType || "application/octet-stream",
      originalName: normalizedOriginalName,
      size: originalSize,
      optimized: false,
      optimizedFormat: null,
      bytesSaved: 0,
    };
  }

  try {
    let image = sharp(buffer, {
      failOn: "none",
      sequentialRead: true,
    }).rotate();

    const metadata = await image.metadata();
    const width = Number(metadata?.width || 0);
    if (Number.isFinite(width) && width > MAX_IMAGE_WIDTH) {
      image = image.resize({
        width: MAX_IMAGE_WIDTH,
        withoutEnlargement: true,
      });
    }

    let optimizedBuffer;
    let optimizedContentType;
    let optimizedOriginalName;
    let optimizedFormat;

    if (normalizedContentType === "image/jpeg") {
      optimizedBuffer = await image
        .jpeg({
          quality: JPEG_QUALITY,
          mozjpeg: true,
        })
        .toBuffer();
      optimizedContentType = "image/jpeg";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".jpg");
      optimizedFormat = "jpeg-q78";
    } else {
      optimizedBuffer = await image
        .webp({
          quality: PNG_WEBP_QUALITY,
        })
        .toBuffer();
      optimizedContentType = "image/webp";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".webp");
      optimizedFormat = "webp-q78";
    }

    const optimizedSize = Buffer.byteLength(optimizedBuffer);
    if (optimizedSize <= 0 || optimizedSize >= originalSize) {
      return {
        buffer,
        contentType: normalizedContentType,
        originalName: normalizedOriginalName,
        size: originalSize,
        optimized: false,
        optimizedFormat: null,
        bytesSaved: 0,
      };
    }

    return {
      buffer: optimizedBuffer,
      contentType: optimizedContentType,
      originalName: optimizedOriginalName,
      size: optimizedSize,
      optimized: true,
      optimizedFormat,
      bytesSaved: originalSize - optimizedSize,
    };
  } catch (error) {
    return {
      buffer,
      contentType: normalizedContentType || contentType || "application/octet-stream",
      originalName: normalizedOriginalName,
      size: originalSize,
      optimized: false,
      optimizedFormat: null,
      bytesSaved: 0,
      optimizationError: error?.message || String(error),
    };
  }
};

module.exports = {
  optimizeImageForStorage,
};
