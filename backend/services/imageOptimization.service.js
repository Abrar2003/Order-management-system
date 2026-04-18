const path = require("path");
const fs = require("fs/promises");
const sharp = require("sharp");
const { ensureDirectory, safeDeleteFile } = require("../helpers/fileCleanup");
const {
  QC_IMAGE_MIME_TYPES,
  QC_IMAGE_MAX_WIDTH,
  QC_IMAGE_JPEG_QUALITY,
  QC_IMAGE_WEBP_QUALITY,
  QC_IMAGE_MAX_INPUT_PIXELS,
  QC_IMAGE_OPTIMIZATION_TEMP_DIR,
} = require("../config/qcImageUpload.config");

const SUPPORTED_SOURCE_MIME_TYPES = QC_IMAGE_MIME_TYPES;

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
  await ensureDirectory(QC_IMAGE_OPTIMIZATION_TEMP_DIR);
  const parsed = path.parse(normalizeText(originalName) || "qc-image");
  const safeBaseName =
    normalizeText(parsed.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "qc-image";

  return path.join(
    QC_IMAGE_OPTIMIZATION_TEMP_DIR,
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeBaseName}${extension}`,
  );
};

const buildSharpPipeline = (input) =>
  sharp(input, {
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: QC_IMAGE_MAX_INPUT_PIXELS,
  }).rotate();

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
    let image = buildSharpPipeline(buffer);

    const metadata = await image.metadata();
    const width = Number(metadata?.width || 0);
    if (Number.isFinite(width) && width > QC_IMAGE_MAX_WIDTH) {
      image = image.resize({
        width: QC_IMAGE_MAX_WIDTH,
        withoutEnlargement: true,
        fit: "inside",
      });
    }

    let optimizedBuffer;
    let optimizedContentType;
    let optimizedOriginalName;
    let optimizedFormat;

    if (normalizedContentType === "image/jpeg") {
      optimizedBuffer = await image
        .jpeg({
          quality: QC_IMAGE_JPEG_QUALITY,
          mozjpeg: true,
        })
        .toBuffer();
      optimizedContentType = "image/jpeg";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".jpg");
      optimizedFormat = `jpeg-q${QC_IMAGE_JPEG_QUALITY}`;
    } else {
      optimizedBuffer = await image
        .webp({
          quality: QC_IMAGE_WEBP_QUALITY,
        })
        .toBuffer();
      optimizedContentType = "image/webp";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".webp");
      optimizedFormat = `webp-q${QC_IMAGE_WEBP_QUALITY}`;
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
    let image = buildSharpPipeline(normalizedInputPath);

    const metadata = await image.metadata();
    const width = Number(metadata?.width || 0);
    if (Number.isFinite(width) && width > QC_IMAGE_MAX_WIDTH) {
      image = image.resize({
        width: QC_IMAGE_MAX_WIDTH,
        withoutEnlargement: true,
        fit: "inside",
      });
    }

    let optimizedContentType;
    let optimizedOriginalName;
    let optimizedFormat;

    if (normalizedContentType === "image/jpeg") {
      optimizedOutputPath = await buildTempOutputPath(normalizedOriginalName, ".jpg");
      await image
        .jpeg({
          quality: QC_IMAGE_JPEG_QUALITY,
          mozjpeg: true,
        })
        .toFile(optimizedOutputPath);
      optimizedContentType = "image/jpeg";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".jpg");
      optimizedFormat = `jpeg-q${QC_IMAGE_JPEG_QUALITY}`;
    } else {
      optimizedOutputPath = await buildTempOutputPath(normalizedOriginalName, ".webp");
      await image
        .webp({
          quality: QC_IMAGE_WEBP_QUALITY,
        })
        .toFile(optimizedOutputPath);
      optimizedContentType = "image/webp";
      optimizedOriginalName = ensureFileNameWithExtension(normalizedOriginalName, ".webp");
      optimizedFormat = `webp-q${QC_IMAGE_WEBP_QUALITY}`;
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
