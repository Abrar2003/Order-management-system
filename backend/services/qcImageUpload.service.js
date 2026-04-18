const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QC = require("../models/qc.model");
const { safeDeleteFiles } = require("../helpers/fileCleanup");
const { optimizeImageFileForStorage } = require("./imageOptimization.service");
const {
  createStorageKey,
  uploadFile,
  deleteObject,
} = require("./wasabiStorage.service");
const {
  QC_IMAGE_MIME_TYPES,
  QC_IMAGE_EXTENSIONS,
  QC_IMAGE_PROCESSING_CHUNK_SIZE,
  QC_IMAGE_PROCESSING_CONCURRENCY,
} = require("../config/qcImageUpload.config");

const normalizeText = (value) => String(value ?? "").trim();

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

const normalizeQcImageHash = (value) => normalizeText(value).toLowerCase();

const flattenUploadedFiles = (files = null) => {
  if (Array.isArray(files)) {
    return files.filter(Boolean);
  }

  if (!files || typeof files !== "object") {
    return [];
  }

  return Object.values(files)
    .flatMap((entry) => (Array.isArray(entry) ? entry : []))
    .filter(Boolean);
};

const computeFileSha256 = async (filePath = "") =>
  new Promise((resolve, reject) => {
    const normalizedPath = normalizeText(filePath);
    if (!normalizedPath) {
      reject(new Error("File path is required to compute sha256"));
      return;
    }

    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(normalizedPath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const buildQcImageDuplicateEntry = ({
  originalName = "",
  hash = "",
  reason = "duplicate",
} = {}) => ({
  originalName: normalizeText(originalName) || "qc-image",
  hash: normalizeQcImageHash(hash),
  reason: normalizeText(reason) || "duplicate",
});

const buildQcImageFailureEntry = ({
  originalName = "",
  reason = "",
  stage = "",
} = {}) => ({
  originalName: normalizeText(originalName) || "unknown-file",
  reason: normalizeText(reason) || "Unknown error",
  ...(normalizeText(stage) ? { stage: normalizeText(stage) } : {}),
});

const buildStoredQcImageEntry = ({
  uploadResult = {},
  hash = "",
  comment = "",
  uploadedAt = new Date(),
  uploadedBy = null,
} = {}) => ({
  key: uploadResult?.key || "",
  hash: normalizeQcImageHash(hash),
  originalName: uploadResult?.originalName || "",
  contentType: uploadResult?.contentType || "",
  size: toNonNegativeNumber(uploadResult?.size, 0),
  comment: normalizeText(comment),
  uploadedAt,
  uploaded_by: uploadedBy || {},
});

const cleanupUploadedQcImageObject = async (key = "") => {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return false;
  }

  try {
    await deleteObject(normalizedKey);
    return true;
  } catch (error) {
    console.warn("[qc-image-upload] wasabi_cleanup_failed", {
      key: normalizedKey,
      reason: error?.message || String(error),
    });
    return false;
  }
};

const cleanupLocalQcImageFiles = async (paths = []) => {
  await safeDeleteFiles(
    (Array.isArray(paths) ? paths : [paths])
      .map((filePath) => normalizeText(filePath))
      .filter(Boolean),
  );
};

const getQcImageMemorySnapshot = () => {
  const usage = process.memoryUsage();
  return {
    rss: Number(usage?.rss || 0),
    heapUsed: Number(usage?.heapUsed || 0),
  };
};

const logQcImageUploadEvent = (event, payload = {}) => {
  console.info(`[qc-image-upload] ${event}`, {
    ...payload,
    memory: getQcImageMemorySnapshot(),
  });
};

const chunkItems = (items = [], chunkSize = 1) => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeChunkSize = Math.max(1, Number(chunkSize) || 1);
  const chunks = [];

  for (let index = 0; index < safeItems.length; index += safeChunkSize) {
    chunks.push(safeItems.slice(index, index + safeChunkSize));
  }

  return chunks;
};

const mapWithConcurrencyLimit = async (
  items = [],
  concurrencyLimit = 1,
  mapper = async (item) => item,
) => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeConcurrencyLimit = Math.max(1, Number(concurrencyLimit) || 1);
  const results = new Array(safeItems.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(safeConcurrencyLimit, safeItems.length) },
    () =>
      (async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= safeItems.length) {
            return;
          }

          results[currentIndex] = await mapper(
            safeItems[currentIndex],
            currentIndex,
          );
        }
      })(),
  );

  await Promise.all(workers);
  return results;
};

const validateQcImageFile = (file = null) => {
  const mimeType = normalizeText(file?.mimetype).toLowerCase();
  const extension = path.extname(String(file?.originalname || "")).toLowerCase();

  if (
    !QC_IMAGE_MIME_TYPES.has(mimeType) ||
    !QC_IMAGE_EXTENSIONS.has(extension)
  ) {
    throw new Error("Only JPG, JPEG, and PNG files are allowed");
  }

  if (!normalizeText(file?.path)) {
    throw new Error("QC image temp file is missing");
  }

  return {
    mimeType,
    extension,
  };
};

const prepareSingleQcImageUpload = async ({
  file = null,
  fallbackOriginalName = "qc-image.jpg",
} = {}) => {
  const { mimeType, extension } = validateQcImageFile(file);
  const sourcePath = normalizeText(file?.path);

  const optimizedImage = await optimizeImageFileForStorage({
    inputPath: sourcePath,
    contentType: mimeType || "application/octet-stream",
    originalName: file?.originalname || fallbackOriginalName,
    // A valid image may still be uploadable even if optimization fails, so
    // we fall back to the original temp file instead of failing the whole file.
    fallbackToOriginal: true,
  });

  return {
    filePath: optimizedImage.path,
    cleanupPaths: [
      sourcePath,
      ...(Array.isArray(optimizedImage?.cleanupPaths)
        ? optimizedImage.cleanupPaths
        : []),
    ],
    hash: await computeFileSha256(optimizedImage.path),
    originalName: optimizedImage.originalName || fallbackOriginalName,
    contentType:
      optimizedImage.contentType || mimeType || "application/octet-stream",
    extension:
      path.extname(String(optimizedImage?.originalName || "")).toLowerCase()
      || extension
      || ".jpg",
    size: toNonNegativeNumber(optimizedImage?.size, 0),
    optimized: Boolean(optimizedImage?.optimized),
    bytesSaved: toNonNegativeNumber(optimizedImage?.bytesSaved, 0),
    optimizationError: normalizeText(optimizedImage?.optimizationError || ""),
  };
};

const uploadPreparedQcImage = async ({
  preparedUpload = null,
  folder = "qc-images",
} = {}) => {
  if (!normalizeText(preparedUpload?.filePath)) {
    throw new Error("Prepared QC image upload is required");
  }

  return uploadFile({
    filePath: preparedUpload.filePath,
    key: createStorageKey({
      folder,
      originalName: preparedUpload.originalName,
      extension: preparedUpload.extension,
    }),
    originalName: preparedUpload.originalName,
    contentType: preparedUpload.contentType,
  });
};

const persistSingleQcImageEntry = async ({
  qcId = "",
  imageEntry = null,
  hash = "",
  uploadedBy = null,
} = {}) => {
  const normalizedHash = normalizeQcImageHash(hash);
  if (!qcId || !imageEntry || !normalizedHash) {
    throw new Error("QC image persistence requires qcId, imageEntry, and hash");
  }

  // This document-level conditional update is the final duplicate guard when
  // concurrent requests race to append the same image hash.
  return QC.updateOne(
    {
      _id: qcId,
      "qc_images.hash": { $ne: normalizedHash },
    },
    {
      $push: {
        qc_images: imageEntry,
      },
      $set: {
        updated_by: uploadedBy || {},
      },
    },
  );
};

const processSingleQcImageFile = async ({
  file = null,
  qc = null,
  singleImageComment = "",
  uploadedBy = null,
  uploadedAt = null,
  existingHashes = new Set(),
  requestHashes = new Set(),
} = {}) => {
  const fallbackOriginalName =
    file?.originalname ||
    `${normalizeText(qc?.order_meta?.order_id || qc?._id || "qc")}${
      path.extname(String(file?.originalname || "")).toLowerCase() || ".jpg"
    }`;
  let preparedUpload = null;
  let uploadResult = null;

  try {
    preparedUpload = await prepareSingleQcImageUpload({
      file,
      fallbackOriginalName,
    });

    const normalizedHash = normalizeQcImageHash(preparedUpload?.hash);
    if (!normalizedHash) {
      return {
        status: "failed",
        failure: buildQcImageFailureEntry({
          originalName: preparedUpload?.originalName || fallbackOriginalName,
          reason: "Unable to compute image hash",
          stage: "validation",
        }),
      };
    }

    if (requestHashes.has(normalizedHash)) {
      return {
        status: "duplicate",
        duplicate: buildQcImageDuplicateEntry({
          originalName: preparedUpload?.originalName || fallbackOriginalName,
          hash: normalizedHash,
          reason: "duplicate_in_request",
        }),
      };
    }

    if (existingHashes.has(normalizedHash)) {
      return {
        status: "duplicate",
        duplicate: buildQcImageDuplicateEntry({
          originalName: preparedUpload?.originalName || fallbackOriginalName,
          hash: normalizedHash,
          reason: "already_uploaded",
        }),
      };
    }

    requestHashes.add(normalizedHash);

    uploadResult = await uploadPreparedQcImage({
      preparedUpload,
      folder: "qc-images",
    });

    const imageEntry = buildStoredQcImageEntry({
      uploadResult,
      hash: normalizedHash,
      comment: singleImageComment,
      uploadedAt: uploadedAt || new Date(),
      uploadedBy,
    });

    const persistResult = await persistSingleQcImageEntry({
      qcId: String(qc?._id || ""),
      imageEntry,
      hash: normalizedHash,
      uploadedBy,
    });

    if (Number(persistResult?.modifiedCount || 0) <= 0) {
      await cleanupUploadedQcImageObject(uploadResult?.key);
      existingHashes.add(normalizedHash);
      return {
        status: "duplicate",
        duplicate: buildQcImageDuplicateEntry({
          originalName: preparedUpload?.originalName || fallbackOriginalName,
          hash: normalizedHash,
          reason: "already_uploaded",
        }),
      };
    }

    existingHashes.add(normalizedHash);
    return {
      status: "uploaded",
      uploadedImage: imageEntry,
      optimized: Boolean(preparedUpload?.optimized),
      bytesSaved: toNonNegativeNumber(preparedUpload?.bytesSaved, 0),
      optimizationError: normalizeText(preparedUpload?.optimizationError || ""),
    };
  } catch (error) {
    if (uploadResult?.key) {
      await cleanupUploadedQcImageObject(uploadResult.key);
    }

    return {
      status: "failed",
      failure: buildQcImageFailureEntry({
        originalName:
          normalizeText(preparedUpload?.originalName || file?.originalname)
          || fallbackOriginalName,
        reason: error?.message || String(error),
        stage:
          uploadResult?.key
            ? "persist"
            : preparedUpload
              ? "upload"
              : "optimization",
      }),
    };
  } finally {
    await cleanupLocalQcImageFiles(preparedUpload?.cleanupPaths || [file?.path]);
  }
};

const processQcImageBatch = async ({
  qc = null,
  files = [],
  uploadMode = "",
  singleImageComment = "",
  uploadedBy = null,
  requestStartedAt = Date.now(),
} = {}) => {
  const safeFiles = flattenUploadedFiles(files);
  const existingHashes = new Set(
    (Array.isArray(qc?.qc_images) ? qc.qc_images : [])
      .map((image) => normalizeQcImageHash(image?.hash))
      .filter(Boolean),
  );
  const requestHashes = new Set();
  const skippedDuplicates = [];
  const failures = [];
  let uploadedCount = 0;
  let optimizedCount = 0;
  let bytesSaved = 0;

  const chunkSize = Math.max(1, QC_IMAGE_PROCESSING_CHUNK_SIZE);
  const processingConcurrency = Math.max(1, QC_IMAGE_PROCESSING_CONCURRENCY);
  const fileChunks = chunkItems(safeFiles, chunkSize);

  logQcImageUploadEvent("start", {
    qcId: String(qc?._id || ""),
    uploadMode: normalizeText(uploadMode),
    requestedFileCount: safeFiles.length,
    chunkCount: fileChunks.length,
    chunkSize,
    processingConcurrency,
  });

  for (let chunkIndex = 0; chunkIndex < fileChunks.length; chunkIndex += 1) {
    const chunk = fileChunks[chunkIndex];
    const chunkResults = await mapWithConcurrencyLimit(
      chunk,
      processingConcurrency,
      async (file) =>
        processSingleQcImageFile({
          file,
          qc,
          singleImageComment,
          uploadedBy,
          uploadedAt: new Date(),
          existingHashes,
          requestHashes,
        }),
    );

    chunkResults.forEach((result) => {
      if (result?.status === "uploaded") {
        uploadedCount += 1;
        if (result?.optimized) {
          optimizedCount += 1;
        }
        bytesSaved += toNonNegativeNumber(result?.bytesSaved, 0);
        return;
      }

      if (result?.status === "duplicate" && result?.duplicate) {
        skippedDuplicates.push(result.duplicate);
        return;
      }

      if (result?.failure) {
        failures.push(result.failure);
      }
    });

    logQcImageUploadEvent("chunk_complete", {
      qcId: String(qc?._id || ""),
      uploadMode: normalizeText(uploadMode),
      chunkIndex: chunkIndex + 1,
      chunkCount: fileChunks.length,
      uploadedCount,
      duplicateCount: skippedDuplicates.length,
      failedCount: failures.length,
      optimizedCount,
      bytesSaved,
    });
  }

  const skippedDuplicateCount = skippedDuplicates.length;
  const failedCount = failures.length;
  const processedCount = uploadedCount + skippedDuplicateCount + failedCount;
  const durationMs = Date.now() - requestStartedAt;

  logQcImageUploadEvent("complete", {
    qcId: String(qc?._id || ""),
    uploadMode: normalizeText(uploadMode),
    requestedFileCount: safeFiles.length,
    chunkCount: fileChunks.length,
    uploadedCount,
    duplicateCount: skippedDuplicateCount,
    failedCount,
    optimizedCount,
    bytesSaved,
    durationMs,
  });

  return {
    uploadedCount,
    skippedDuplicateCount,
    skippedDuplicates,
    failedCount,
    failures,
    optimizedCount,
    bytesSaved,
    processedCount,
    totalRequestedCount: safeFiles.length,
  };
};

module.exports = {
  flattenUploadedFiles,
  normalizeQcImageHash,
  buildStoredQcImageEntry,
  prepareSingleQcImageUpload,
  uploadPreparedQcImage,
  cleanupUploadedQcImageObject,
  cleanupLocalQcImageFiles,
  processQcImageBatch,
};
