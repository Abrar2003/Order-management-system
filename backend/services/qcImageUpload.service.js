const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const { safeDeleteFiles } = require("../helpers/fileCleanup");
const { optimizeImageFileForStorage } = require("./imageOptimization.service");
const {
  createStorageKey,
  objectExists,
  uploadFile,
  deleteObject,
} = require("./wasabiStorage.service");
const {
  enqueueQcImageThumbnailGeneration,
} = require("../queues");
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

const normalizeQcImageIdempotencyKey = (value) =>
  normalizeText(value).toLowerCase();

const sanitizeStorageKeyPart = (value = "", fallback = "image") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || fallback;

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

const claimUploadSlot = (uploadSlotState = null) => {
  if (!uploadSlotState || !Number.isFinite(uploadSlotState.remaining)) {
    return true;
  }

  if (uploadSlotState.remaining <= 0) {
    return false;
  }

  uploadSlotState.remaining -= 1;
  return true;
};

const releaseUploadSlot = (uploadSlotState = null) => {
  if (!uploadSlotState || !Number.isFinite(uploadSlotState.remaining)) {
    return;
  }

  uploadSlotState.remaining += 1;
};

const buildStoredQcImageEntry = ({
  uploadResult = {},
  hash = "",
  idempotencyKey = "",
  comment = "",
  uploadedAt = new Date(),
  uploadedBy = null,
  thumbnail = {},
} = {}) => ({
  key: uploadResult?.key || "",
  hash: normalizeQcImageHash(hash),
  idempotency_key: normalizeQcImageIdempotencyKey(idempotencyKey),
  originalName: uploadResult?.originalName || "",
  contentType: uploadResult?.contentType || "",
  size: toNonNegativeNumber(uploadResult?.size, 0),
  thumbnail_key: normalizeText(thumbnail?.key || "") || null,
  thumbnail_url: normalizeText(thumbnail?.url || "") || null,
  thumbnail_generated_at: thumbnail?.generatedAt || null,
  thumbnail_status: normalizeText(thumbnail?.status || "pending"),
  thumbnail_error: normalizeText(thumbnail?.error || ""),
  thumbnail_attempts: toNonNegativeNumber(thumbnail?.attempts, 0),
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
  qcId = "",
  inspectionId = "",
  targetField = "qc_images",
  idempotencyKey = "",
} = {}) => {
  if (!normalizeText(preparedUpload?.filePath)) {
    throw new Error("Prepared QC image upload is required");
  }

  const normalizedIdempotencyKey = normalizeQcImageIdempotencyKey(idempotencyKey);
  const storageKey = normalizedIdempotencyKey
    ? [
      normalizeText(folder).replace(/^\/+|\/+$/g, "") || "qc-images",
      sanitizeStorageKeyPart(qcId, "qc"),
      ...(normalizeText(inspectionId)
        ? ["inspection", sanitizeStorageKeyPart(inspectionId, "inspection")]
        : []),
      sanitizeStorageKeyPart(targetField, "images"),
      `${sanitizeStorageKeyPart(normalizedIdempotencyKey, "image")}${preparedUpload.extension || ".jpg"}`,
    ].join("/")
    : createStorageKey({
      folder,
      originalName: preparedUpload.originalName,
      extension: preparedUpload.extension,
    });

  if (normalizedIdempotencyKey && await objectExists(storageKey)) {
    return {
      key: storageKey,
      originalName: preparedUpload.originalName,
      contentType: preparedUpload.contentType,
      size: toNonNegativeNumber(preparedUpload?.size, 0),
      reusedExistingObject: true,
    };
  }

  return uploadFile({
    filePath: preparedUpload.filePath,
    key: storageKey,
    originalName: preparedUpload.originalName,
    contentType: preparedUpload.contentType,
  });
};

const persistSingleQcImageEntry = async ({
  qcId = "",
  inspectionId = "",
  ownerModel = "qc",
  imageEntry = null,
  hash = "",
  idempotencyKey = "",
  uploadedBy = null,
  targetField = "qc_images",
} = {}) => {
  const normalizedHash = normalizeQcImageHash(hash);
  const normalizedIdempotencyKey = normalizeQcImageIdempotencyKey(idempotencyKey);
  const normalizedOwnerModel = normalizeText(ownerModel).toLowerCase();
  if (!qcId || !imageEntry || !normalizedHash) {
    throw new Error("QC image persistence requires qcId, imageEntry, and hash");
  }
  if (normalizedOwnerModel === "inspection" && !inspectionId) {
    throw new Error("Inspection image persistence requires inspectionId");
  }

  // This document-level conditional update is the final duplicate guard when
  // concurrent requests race to append the same image hash or idempotency key.
  const duplicateGuards = {
    [`${targetField}.hash`]: { $ne: normalizedHash },
  };
  if (normalizedIdempotencyKey) {
    duplicateGuards[`${targetField}.idempotency_key`] = {
      $ne: normalizedIdempotencyKey,
    };
  }

  const Model = normalizedOwnerModel === "inspection" ? Inspection : QC;
  const query =
    normalizedOwnerModel === "inspection"
      ? {
          _id: inspectionId,
          qc: qcId,
          ...duplicateGuards,
        }
      : {
          _id: qcId,
          ...duplicateGuards,
        };

  return Model.updateOne(
    query,
    {
      $push: {
        [targetField]: imageEntry,
      },
      $set: {
        updated_by: uploadedBy || {},
      },
    },
  );
};

const queueQcImageThumbnailGeneration = ({
  qcId = "",
  inspectionId = "",
  ownerModel = "qc",
  targetField = "qc_images",
  imageEntry = {},
} = {}) => {
  const sourceKey = normalizeText(imageEntry?.key || "");
  if (!qcId || !sourceKey) return;

  setImmediate(() => {
    enqueueQcImageThumbnailGeneration({
      qcId,
      inspectionId,
      ownerModel,
      imageField: targetField,
      sourceKey,
      idempotencyKey: imageEntry?.idempotency_key || "",
    }).catch((error) => {
      console.warn("[qc-image-upload] thumbnail_enqueue_failed", {
        qcId,
        inspectionId,
        ownerModel,
        targetField,
        sourceKey,
        reason: error?.message || String(error),
      });
    });
  });
};

const processSingleQcImageFile = async ({
  file = null,
  qc = null,
  inspectionId = "",
  ownerModel = "qc",
  idempotencyKey = "",
  singleImageComment = "",
  uploadedBy = null,
  uploadedAt = null,
  existingHashes = new Set(),
  existingIdempotencyKeys = new Set(),
  requestHashes = new Set(),
  requestIdempotencyKeys = new Set(),
  targetField = "qc_images",
  storageFolder = "qc-images",
  uploadSlotState = null,
  uploadLimitMessage = "",
} = {}) => {
  const normalizedIdempotencyKey = normalizeQcImageIdempotencyKey(idempotencyKey);
  const fallbackOriginalName =
    file?.originalname ||
    `${normalizeText(qc?.order_meta?.order_id || qc?._id || "qc")}${
      path.extname(String(file?.originalname || "")).toLowerCase() || ".jpg"
  }`;
  let preparedUpload = null;
  let uploadResult = null;
  let claimedUploadSlot = false;

  try {
    if (normalizedIdempotencyKey) {
      if (requestIdempotencyKeys.has(normalizedIdempotencyKey)) {
        return {
          status: "duplicate",
          duplicate: buildQcImageDuplicateEntry({
            originalName: file?.originalname || fallbackOriginalName,
            hash: "",
            reason: "duplicate_idempotency_key_in_request",
          }),
        };
      }

      if (existingIdempotencyKeys.has(normalizedIdempotencyKey)) {
        return {
          status: "duplicate",
          duplicate: buildQcImageDuplicateEntry({
            originalName: file?.originalname || fallbackOriginalName,
            hash: "",
            reason: "already_uploaded_idempotency_key",
          }),
        };
      }

      requestIdempotencyKeys.add(normalizedIdempotencyKey);
    }

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

    if (!claimUploadSlot(uploadSlotState)) {
      return {
        status: "failed",
        failure: buildQcImageFailureEntry({
          originalName: preparedUpload?.originalName || fallbackOriginalName,
          reason:
            normalizeText(uploadLimitMessage)
            || "QC image upload limit reached for this record",
          stage: "limit",
        }),
      };
    }
    claimedUploadSlot = true;

    uploadResult = await uploadPreparedQcImage({
      preparedUpload,
      folder: storageFolder,
      qcId: String(qc?._id || ""),
      inspectionId,
      targetField,
      idempotencyKey: normalizedIdempotencyKey,
    });

    const imageEntry = buildStoredQcImageEntry({
      uploadResult,
      hash: normalizedHash,
      idempotencyKey: normalizedIdempotencyKey,
      comment: singleImageComment,
      uploadedAt: uploadedAt || new Date(),
      uploadedBy,
      thumbnail: {
        status: "pending",
      },
    });

    const persistResult = await persistSingleQcImageEntry({
      qcId: String(qc?._id || ""),
      inspectionId,
      ownerModel,
      imageEntry,
      hash: normalizedHash,
      idempotencyKey: normalizedIdempotencyKey,
      uploadedBy,
      targetField,
    });

    if (Number(persistResult?.modifiedCount || 0) <= 0) {
      if (!uploadResult?.reusedExistingObject) {
        await cleanupUploadedQcImageObject(uploadResult?.key);
      }
      releaseUploadSlot(uploadSlotState);
      claimedUploadSlot = false;
      existingHashes.add(normalizedHash);
      if (normalizedIdempotencyKey) {
        existingIdempotencyKeys.add(normalizedIdempotencyKey);
      }
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
    if (normalizedIdempotencyKey) {
      existingIdempotencyKeys.add(normalizedIdempotencyKey);
    }
    queueQcImageThumbnailGeneration({
      qcId: String(qc?._id || ""),
      inspectionId,
      ownerModel,
      targetField,
      imageEntry,
    });
    return {
      status: "uploaded",
      uploadedImage: imageEntry,
      optimized: Boolean(preparedUpload?.optimized),
      bytesSaved: toNonNegativeNumber(preparedUpload?.bytesSaved, 0),
      optimizationError: normalizeText(preparedUpload?.optimizationError || ""),
    };
  } catch (error) {
    if (claimedUploadSlot) {
      releaseUploadSlot(uploadSlotState);
      claimedUploadSlot = false;
    }

    if (uploadResult?.key && !uploadResult?.reusedExistingObject) {
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
  inspectionId = "",
  ownerModel = "qc",
  files = [],
  idempotencyKeys = [],
  existingImages = null,
  uploadMode = "",
  singleImageComment = "",
  uploadedBy = null,
  targetField = "qc_images",
  storageFolder = "qc-images",
  maxSuccessfulUploads = null,
  uploadLimitMessage = "",
  requestStartedAt = Date.now(),
} = {}) => {
  const safeFiles = flattenUploadedFiles(files);
  const safeIdempotencyKeys = Array.isArray(idempotencyKeys)
    ? idempotencyKeys
    : [];
  const uploadItems = safeFiles.map((file, index) => ({
    file,
    idempotencyKey: normalizeQcImageIdempotencyKey(safeIdempotencyKeys[index]),
  }));
  const duplicateSourceImages = Array.isArray(existingImages)
    ? existingImages
    : (Array.isArray(qc?.[targetField]) ? qc[targetField] : []);
  const existingHashes = new Set(
    duplicateSourceImages
      .map((image) => normalizeQcImageHash(image?.hash))
      .filter(Boolean),
  );
  const existingIdempotencyKeys = new Set(
    duplicateSourceImages
      .map((image) => normalizeQcImageIdempotencyKey(image?.idempotency_key))
      .filter(Boolean),
  );
  const requestHashes = new Set();
  const requestIdempotencyKeys = new Set();
  const skippedDuplicates = [];
  const failures = [];
  let uploadedCount = 0;
  let optimizedCount = 0;
  let bytesSaved = 0;

  const chunkSize = Math.max(1, QC_IMAGE_PROCESSING_CHUNK_SIZE);
  const processingConcurrency = Number.isFinite(maxSuccessfulUploads)
    ? 1
    : Math.max(1, QC_IMAGE_PROCESSING_CONCURRENCY);
  const uploadSlotState = Number.isFinite(maxSuccessfulUploads)
    ? { remaining: Math.max(0, Number(maxSuccessfulUploads) || 0) }
    : null;
  const fileChunks = chunkItems(uploadItems, chunkSize);

  logQcImageUploadEvent("start", {
    qcId: String(qc?._id || ""),
    inspectionId,
    ownerModel,
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
      async (item) =>
        processSingleQcImageFile({
          file: item?.file,
          qc,
          inspectionId,
          ownerModel,
          idempotencyKey: item?.idempotencyKey,
          singleImageComment,
          uploadedBy,
          uploadedAt: new Date(),
          existingHashes,
          existingIdempotencyKeys,
          requestHashes,
          requestIdempotencyKeys,
          targetField,
          storageFolder,
          uploadSlotState,
          uploadLimitMessage,
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
      inspectionId,
      ownerModel,
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
