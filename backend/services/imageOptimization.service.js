const path = require("path");
const sharp = require("sharp");

const SUPPORTED_SOURCE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

const normalizeText = (value) => String(value || "").trim();

const normalizeMimeType = (value) => normalizeText(value).toLowerCase();

const ensureWebpFileName = (originalName = "") => {
  const trimmedName = normalizeText(originalName);
  if (!trimmedName) return "qc-image.webp";

  const parsedPath = path.parse(trimmedName);
  const safeBaseName = normalizeText(parsedPath.name) || "qc-image";
  return `${safeBaseName}.webp`;
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
  const originalSize = Buffer.byteLength(buffer);

  if (!SUPPORTED_SOURCE_MIME_TYPES.has(normalizedContentType) || originalSize <= 0) {
    return {
      buffer,
      contentType: normalizedContentType || contentType || "application/octet-stream",
      originalName: normalizeText(originalName),
      size: originalSize,
      optimized: false,
      optimizedFormat: null,
      bytesSaved: 0,
    };
  }

  try {
    const optimizedBuffer = await sharp(buffer)
      .rotate()
      .webp({
        lossless: true,
        effort: 6,
      })
      .toBuffer();

    const optimizedSize = Buffer.byteLength(optimizedBuffer);
    if (optimizedSize <= 0 || optimizedSize >= originalSize) {
      return {
        buffer,
        contentType: normalizedContentType,
        originalName: normalizeText(originalName),
        size: originalSize,
        optimized: false,
        optimizedFormat: null,
        bytesSaved: 0,
      };
    }

    return {
      buffer: optimizedBuffer,
      contentType: "image/webp",
      originalName: ensureWebpFileName(originalName),
      size: optimizedSize,
      optimized: true,
      optimizedFormat: "webp-lossless",
      bytesSaved: originalSize - optimizedSize,
    };
  } catch (error) {
    return {
      buffer,
      contentType: normalizedContentType || contentType || "application/octet-stream",
      originalName: normalizeText(originalName),
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
