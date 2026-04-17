const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const sharp = require("sharp");
const { ensureDirectory, safeDeleteFile } = require("../helpers/fileCleanup");

const SUPPORTED_SOURCE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_IMAGE_WIDTH = 2200;
const JPEG_QUALITY = 78;
const PNG_WEBP_QUALITY = 78;
const DEFAULT_TEMP_OUTPUT_DIR = path.join(
  process.env.OMS_TEMP_DIR || os.tmpdir(),
  "oms",
  "image-optimization",
);

const normalizeText = (value) => String(value || "").trim();

const normalizeMimeType = (value) => normalizeText(value).toLowerCase();

const ensureFileNameWithExtension = (originalName = "", extension = ".jpg") => {
  const trimmedName = normalizeText(originalName);
  const parsedPath = path.parse(trimmedName || "qc-image");
  const safeBaseName = normalizeText(parsedPath.name) || "qc-image";
  return `${safeBaseName}${extension}`;
};

const getFileSize = async (filePath) => {
  const stats = await fs.stat(filePath);
  return Number(stats?.size || 0);
};

const buildTempOutputPath = async (originalName = "", extension = ".jpg") => {
  await ensureDirectory(DEFAULT_TEMP_OUTPUT_DIR);
  const parsed = path.parse(normalizeText(originalName) || "qc-image");
  const safeBaseName =
    normalizeText(parsed.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "qc-image";

  return path.join(
    DEFAULT_TEMP_OUTPUT_DIR,
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeBaseName}${extension}`,
  );
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

const optimizeImageFileForStorage = async ({
  inputPath = "",
  contentType = "",
  originalName = "",
  fallbackToOriginal = true,
} = {}) => {
  const normalizedInputPath = normalizeText(inputPath);
  if (!normalizedInputPath) {
    throw new Error("Image optimization requires an input file path");
  }

  const normalizedContentType = normalizeMimeType(contentType);
  const normalizedOriginalName = normalizeText(originalName);
  const originalSize = await getFileSize(normalizedInputPath);

  const buildOriginalResult = (optimizationError = "") => ({
    path: normalizedInputPath,
    cleanupPaths: [],
    contentType: normalizedContentType || contentType || "application/octet-stream",
    originalName: normalizedOriginalName,
    size: originalSize,
    optimized: false,
    optimizedFormat: null,
    bytesSaved: 0,
    optimizationError: normalizeText(optimizationError),
  });

  if (!SUPPORTED_SOURCE_MIME_TYPES.has(normalizedContentType) || originalSize <= 0) {
    return buildOriginalResult();
  }

  let optimizedOutputPath = "";

  try {
    let image = sharp(normalizedInputPath, {
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

    let optimizedContentType;
    let optimizedOriginalName;
    let optimizedFormat;

    if (normalizedContentType === "image/jpeg") {
      optimizedOutputPath = await buildTempOutputPath(normalizedOriginalName, ".jpg");
      await image
        .jpeg({
          quality: JPEG_QUALITY,
          mozjpeg: true,
        })
        .toFile(optimizedOutputPath);
      optimizedContentType = "image/jpeg";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".jpg");
      optimizedFormat = "jpeg-q78";
    } else {
      optimizedOutputPath = await buildTempOutputPath(normalizedOriginalName, ".webp");
      await image
        .webp({
          quality: PNG_WEBP_QUALITY,
        })
        .toFile(optimizedOutputPath);
      optimizedContentType = "image/webp";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".webp");
      optimizedFormat = "webp-q78";
    }

    const optimizedSize = await getFileSize(optimizedOutputPath);
    if (optimizedSize <= 0 || optimizedSize >= originalSize) {
      await safeDeleteFile(optimizedOutputPath);
      return buildOriginalResult();
    }

    return {
      path: optimizedOutputPath,
      cleanupPaths: [optimizedOutputPath],
      contentType: optimizedContentType,
      originalName: optimizedOriginalName,
      size: optimizedSize,
      optimized: true,
      optimizedFormat,
      bytesSaved: originalSize - optimizedSize,
      optimizationError: "",
    };
  } catch (error) {
    if (optimizedOutputPath) {
      await safeDeleteFile(optimizedOutputPath);
    }

    if (fallbackToOriginal) {
      return buildOriginalResult(error?.message || String(error));
    }

    throw error;
  }
};

module.exports = {
  optimizeImageForStorage,
  optimizeImageFileForStorage,
};
