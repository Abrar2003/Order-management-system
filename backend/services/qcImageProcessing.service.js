const path = require("path");
const mongoose = require("mongoose");
const sharp = require("sharp");

const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const {
  QC_IMAGE_MAX_INPUT_PIXELS,
  QC_IMAGE_PREVIEW_MAX_DIMENSION,
  QC_IMAGE_PREVIEW_WEBP_QUALITY,
  QC_IMAGE_THUMBNAIL_MAX_DIMENSION,
  QC_IMAGE_THUMBNAIL_WEBP_QUALITY,
} = require("../config/qcImageUpload.config");
const {
  getObjectBuffer,
  getObjectMetadata,
  getObjectUrl,
  deleteObject,
  uploadBuffer,
} = require("./wasabiStorage.service");
const {
  QC_THUMBNAIL_CACHE_CONTROL,
  buildQcThumbnailStorageKey,
} = require("./imageThumbnailService");
const {
  enqueueQcImageDerivativeProcessing,
} = require("../queues");

const VALID_IMAGE_FIELDS = Object.freeze([
  "qc_images",
  "hardware_inspection",
  "goods_not_ready_images",
]);
const OWNER_MODEL_QC = "qc";
const OWNER_MODEL_INSPECTION = "inspection";
const DIRECT_PROCESSING_STATUSES = new Set(["queued", "failed"]);
const MAX_PROCESSING_ATTEMPTS = 3;
const PREVIEW_CACHE_CONTROL = "private, max-age=31536000, immutable";
const PROCESSING_LOCK_MS = 30 * 60 * 1000;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const resolveOwnerModel = ({ ownerModel = OWNER_MODEL_QC, inspectionId = "" } = {}) =>
  normalizeKey(ownerModel) === OWNER_MODEL_INSPECTION ||
  mongoose.Types.ObjectId.isValid(normalizeText(inspectionId))
    ? OWNER_MODEL_INSPECTION
    : OWNER_MODEL_QC;
const toConciseError = (error) =>
  normalizeText(error?.message || String(error)).replace(/\s+/g, " ").slice(0, 500);

const toPositiveInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveImageField = (value = "qc_images") =>
  VALID_IMAGE_FIELDS.includes(normalizeText(value)) ? normalizeText(value) : "qc_images";

const getDownloadedBuffer = (payload) => {
  if (Buffer.isBuffer(payload)) return payload;
  if (Buffer.isBuffer(payload?.buffer)) return payload.buffer;
  if (payload?.buffer instanceof ArrayBuffer) return Buffer.from(payload.buffer);
  if (ArrayBuffer.isView(payload?.buffer)) {
    return Buffer.from(
      payload.buffer.buffer,
      payload.buffer.byteOffset,
      payload.buffer.byteLength,
    );
  }
  return null;
};

const buildSharpPipeline = (sourceBuffer) =>
  sharp(sourceBuffer, {
    failOn: "none",
    sequentialRead: true,
    limitInputPixels: QC_IMAGE_MAX_INPUT_PIXELS,
  }).rotate();

const getSharpImageRuntimeSupport = () => {
  const formats = sharp.format || {};
  const canRead = (format) =>
    Boolean(
      formats?.[format]?.input?.buffer ||
        formats?.[format]?.input?.file ||
        formats?.[format]?.input?.stream,
    );
  const canWrite = (format) =>
    Boolean(
      formats?.[format]?.output?.buffer ||
        formats?.[format]?.output?.file ||
        formats?.[format]?.output?.stream,
    );

  return {
    sharp: sharp.versions?.sharp || "",
    libvips: sharp.versions?.vips || "",
    heifInput: canRead("heif"),
    avifInput: canRead("avif"),
    webpOutput: canWrite("webp"),
  };
};

const createPreviewDerivative = async (sourceBuffer) => {
  const qualities = [
    QC_IMAGE_PREVIEW_WEBP_QUALITY,
    Math.max(1, QC_IMAGE_PREVIEW_WEBP_QUALITY - 4),
    Math.max(1, QC_IMAGE_PREVIEW_WEBP_QUALITY - 8),
    Math.max(1, QC_IMAGE_PREVIEW_WEBP_QUALITY - 12),
    Math.max(1, QC_IMAGE_PREVIEW_WEBP_QUALITY - 16),
  ];
  let selected = null;

  for (const quality of qualities) {
    const { data, info } = await buildSharpPipeline(sourceBuffer)
      .resize({
        width: QC_IMAGE_PREVIEW_MAX_DIMENSION,
        height: QC_IMAGE_PREVIEW_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    selected = { buffer: data, info, quality };
    if (Buffer.byteLength(data) <= 850 * 1024) break;
  }

  return {
    buffer: selected.buffer,
    contentType: "image/webp",
    width: Number(selected.info?.width || 0),
    height: Number(selected.info?.height || 0),
    size: Buffer.byteLength(selected.buffer),
    quality: selected.quality,
  };
};

const createThumbnailDerivative = async (sourceBuffer) => {
  const { data, info } = await buildSharpPipeline(sourceBuffer)
    .resize({
      width: QC_IMAGE_THUMBNAIL_MAX_DIMENSION,
      height: QC_IMAGE_THUMBNAIL_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: QC_IMAGE_THUMBNAIL_WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    contentType: "image/webp",
    width: Number(info?.width || 0),
    height: Number(info?.height || 0),
    size: Buffer.byteLength(data),
  };
};

const buildDerivativeBaseKey = ({
  sourceKey = "",
  qcId = "",
  inspectionId = "",
  imageField = "qc_images",
  imageId = "",
} = {}) => {
  const normalizedSourceKey = normalizeText(sourceKey).replace(/\\/g, "/");
  const sourceMarker = "/source/";
  if (normalizedSourceKey.includes(sourceMarker)) {
    return normalizedSourceKey.slice(0, normalizedSourceKey.indexOf(sourceMarker));
  }

  return [
    imageField === "hardware_inspection" ? "hardware-inspection" : "qc-images",
    normalizeKey(qcId) || "qc",
    ...(normalizeText(inspectionId)
      ? ["inspection", normalizeKey(inspectionId) || "inspection"]
      : []),
    normalizeKey(imageField) || "images",
    normalizeKey(imageId) || "image",
  ].join("/");
};

const buildPreviewKey = (args = {}) => `${buildDerivativeBaseKey(args)}/preview/v1.webp`;
const buildThumbnailKey = (args = {}) => `${buildDerivativeBaseKey(args)}/thumbnail/v1.webp`;

const verifyDerivativeObject = async ({ key = "", expectedContentType = "image/webp" } = {}) => {
  const metadata = await getObjectMetadata(key);
  if (!metadata.exists || metadata.size <= 0) {
    throw new Error(`Generated object verification failed for ${key}`);
  }
  if (expectedContentType && normalizeKey(metadata.contentType) !== expectedContentType) {
    throw new Error(`Generated object content type mismatch for ${key}`);
  }
  return metadata;
};

const getImageById = (qc = {}, field = "qc_images", imageId = "") =>
  (Array.isArray(qc?.[field]) ? qc[field] : []).find((image) =>
    normalizeText(image?._id) === normalizeText(imageId),
  ) || null;

const claimImageForProcessing = async ({
  qcId = "",
  inspectionId = "",
  ownerModel = OWNER_MODEL_QC,
  imageField = "qc_images",
  imageId = "",
} = {}) => {
  const field = resolveImageField(imageField);
  if (!mongoose.Types.ObjectId.isValid(qcId) || !mongoose.Types.ObjectId.isValid(imageId)) {
    return null;
  }

  const owner = resolveOwnerModel({ ownerModel, inspectionId });
  if (
    owner === OWNER_MODEL_INSPECTION &&
    normalizeText(inspectionId) &&
    !mongoose.Types.ObjectId.isValid(inspectionId)
  ) {
    return null;
  }

  const now = new Date();
  const imageObjectId = new mongoose.Types.ObjectId(imageId);
  const lockUntil = new Date(now.getTime() + PROCESSING_LOCK_MS);
  const ownerQuery =
    owner === OWNER_MODEL_INSPECTION
      ? {
          ...(mongoose.Types.ObjectId.isValid(normalizeText(inspectionId))
            ? { _id: inspectionId }
            : {}),
          qc: qcId,
        }
      : { _id: qcId };
  const Model = owner === OWNER_MODEL_INSPECTION ? Inspection : QC;
  const result = await Model.updateOne(
    {
      ...ownerQuery,
      [field]: {
        $elemMatch: {
          _id: imageObjectId,
          $or: [
            { "processing.status": { $in: [...DIRECT_PROCESSING_STATUSES] } },
            {
              $and: [
                { "processing.status": "processing" },
                { "processing.lock_until": { $lte: now } },
              ],
            },
            {
              $and: [
                { "storage.source_key": { $in: [null, ""] } },
                {
                  $or: [
                    { thumbnail_key: { $exists: false } },
                    { thumbnail_key: null },
                    { thumbnail_key: "" },
                    { "thumbnail.key": { $exists: false } },
                    { "thumbnail.key": null },
                    { "thumbnail.key": "" },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    {
      $set: {
        [`${field}.$[image].processing.status`]: "processing",
        [`${field}.$[image].processing.started_at`]: now,
        [`${field}.$[image].processing.lock_until`]: lockUntil,
        [`${field}.$[image].processing.error`]: "",
      },
      $inc: {
        [`${field}.$[image].processing.attempts`]: 1,
      },
    },
    {
      arrayFilters: [{ "image._id": imageObjectId }],
    },
  );

  if (Number(result?.modifiedCount || 0) <= 0) return null;

  const doc =
    owner === OWNER_MODEL_INSPECTION
      ? await Inspection.findOne(ownerQuery).select(`_id qc ${field}`).lean()
      : await QC.findById(qcId).select(`_id ${field}`).lean();
  const image = getImageById(doc, field, imageId);
  return image
    ? {
        qc: owner === OWNER_MODEL_INSPECTION ? { _id: qcId } : doc,
        inspection: owner === OWNER_MODEL_INSPECTION ? doc : null,
        image,
        imageField: field,
        ownerModel: owner,
      }
    : null;
};

const markImageProcessingFailed = async ({
  qcId = "",
  inspectionId = "",
  ownerModel = OWNER_MODEL_QC,
  imageField = "qc_images",
  imageId = "",
  error,
} = {}) => {
  if (!mongoose.Types.ObjectId.isValid(qcId) || !mongoose.Types.ObjectId.isValid(imageId)) {
    return null;
  }

  const owner = resolveOwnerModel({ ownerModel, inspectionId });
  const Model = owner === OWNER_MODEL_INSPECTION ? Inspection : QC;
  const query =
    owner === OWNER_MODEL_INSPECTION
      ? {
          ...(mongoose.Types.ObjectId.isValid(normalizeText(inspectionId))
            ? { _id: inspectionId }
            : {}),
          qc: qcId,
          [`${imageField}._id`]: new mongoose.Types.ObjectId(imageId),
        }
      : { _id: qcId, [`${imageField}._id`]: new mongoose.Types.ObjectId(imageId) };

  return Model.updateOne(
    query,
    {
      $set: {
        [`${imageField}.$[image].processing.status`]: "failed",
        [`${imageField}.$[image].processing.error`]: toConciseError(error),
        [`${imageField}.$[image].processing.lock_until`]: null,
      },
    },
    {
      arrayFilters: [{ "image._id": new mongoose.Types.ObjectId(imageId) }],
    },
  );
};

const processLegacyThumbnail = async ({
  qcId = "",
  inspectionId = "",
  ownerModel = OWNER_MODEL_QC,
  imageField = "qc_images",
  image = {},
  sourceBuffer,
} = {}) => {
  const sourceKey = normalizeText(image?.key || image?.public_id || "");
  const thumbnailKey =
    normalizeText(image?.thumbnail?.key || image?.thumbnail_key || "") ||
    buildQcThumbnailStorageKey(sourceKey);
  const thumbnail = await createThumbnailDerivative(sourceBuffer);

  await uploadBuffer({
    buffer: thumbnail.buffer,
    key: thumbnailKey,
    originalName: path.posix.basename(thumbnailKey),
    contentType: thumbnail.contentType,
    cacheControl: QC_THUMBNAIL_CACHE_CONTROL,
  });
  await verifyDerivativeObject({ key: thumbnailKey });

  const owner = resolveOwnerModel({ ownerModel, inspectionId });
  const Model = owner === OWNER_MODEL_INSPECTION ? Inspection : QC;
  const query =
    owner === OWNER_MODEL_INSPECTION
      ? {
          ...(mongoose.Types.ObjectId.isValid(normalizeText(inspectionId))
            ? { _id: inspectionId }
            : {}),
          qc: qcId,
          [`${imageField}._id`]: image._id,
        }
      : { _id: qcId, [`${imageField}._id`]: image._id };

  await Model.updateOne(
    query,
    {
      $set: {
        [`${imageField}.$[image].thumbnail_key`]: thumbnailKey,
        [`${imageField}.$[image].thumbnail_url`]: getObjectUrl(thumbnailKey),
        [`${imageField}.$[image].thumbnail_generated_at`]: new Date(),
        [`${imageField}.$[image].thumbnail_status`]: "completed",
        [`${imageField}.$[image].thumbnail_error`]: "",
        [`${imageField}.$[image].thumbnail.key`]: thumbnailKey,
        [`${imageField}.$[image].thumbnail.content_type`]: thumbnail.contentType,
        [`${imageField}.$[image].thumbnail.size_bytes`]: thumbnail.size,
        [`${imageField}.$[image].thumbnail.width`]: thumbnail.width,
        [`${imageField}.$[image].thumbnail.height`]: thumbnail.height,
        [`${imageField}.$[image].thumbnail.generated_at`]: new Date(),
        [`${imageField}.$[image].processing.status`]: "ready",
        [`${imageField}.$[image].processing.completed_at`]: new Date(),
        [`${imageField}.$[image].processing.lock_until`]: null,
        [`${imageField}.$[image].processing.error`]: "",
      },
    },
    {
      arrayFilters: [{ "image._id": image._id }],
    },
  );

  return {
    legacy: true,
    qcId,
    inspectionId,
    ownerModel: owner,
    imageField,
    imageId: String(image._id),
    thumbnailKey,
    thumbnailSize: thumbnail.size,
  };
};

const processDirectSourceImage = async ({
  qcId = "",
  inspectionId = "",
  ownerModel = OWNER_MODEL_QC,
  imageField = "qc_images",
  image = {},
  sourceBuffer,
} = {}) => {
  const sourceKey = normalizeText(image?.storage?.source_key || image?.key || "");
  const imageId = String(image?._id || "");
  const owner = resolveOwnerModel({ ownerModel, inspectionId });
  const previewKey = buildPreviewKey({
    sourceKey,
    qcId,
    inspectionId,
    imageField,
    imageId,
  });
  const thumbnailKey = buildThumbnailKey({
    sourceKey,
    qcId,
    inspectionId,
    imageField,
    imageId,
  });
  const [preview, thumbnail] = await Promise.all([
    createPreviewDerivative(sourceBuffer),
    createThumbnailDerivative(sourceBuffer),
  ]);

  await uploadBuffer({
    buffer: preview.buffer,
    key: previewKey,
    originalName: path.posix.basename(previewKey),
    contentType: preview.contentType,
    cacheControl: PREVIEW_CACHE_CONTROL,
  });
  await uploadBuffer({
    buffer: thumbnail.buffer,
    key: thumbnailKey,
    originalName: path.posix.basename(thumbnailKey),
    contentType: thumbnail.contentType,
    cacheControl: QC_THUMBNAIL_CACHE_CONTROL,
  });

  await verifyDerivativeObject({ key: previewKey });
  await verifyDerivativeObject({ key: thumbnailKey });

  const now = new Date();
  const Model = owner === OWNER_MODEL_INSPECTION ? Inspection : QC;
  const query =
    owner === OWNER_MODEL_INSPECTION
      ? {
          ...(mongoose.Types.ObjectId.isValid(normalizeText(inspectionId))
            ? { _id: inspectionId }
            : {}),
          qc: qcId,
          [`${imageField}._id`]: image._id,
        }
      : { _id: qcId, [`${imageField}._id`]: image._id };

  await Model.updateOne(
    query,
    {
      $set: {
        [`${imageField}.$[image].key`]: previewKey,
        [`${imageField}.$[image].contentType`]: preview.contentType,
        [`${imageField}.$[image].size`]: preview.size,
        [`${imageField}.$[image].preview.key`]: previewKey,
        [`${imageField}.$[image].preview.content_type`]: preview.contentType,
        [`${imageField}.$[image].preview.size_bytes`]: preview.size,
        [`${imageField}.$[image].preview.width`]: preview.width,
        [`${imageField}.$[image].preview.height`]: preview.height,
        [`${imageField}.$[image].preview.generated_at`]: now,
        [`${imageField}.$[image].thumbnail_key`]: thumbnailKey,
        [`${imageField}.$[image].thumbnail_url`]: getObjectUrl(thumbnailKey),
        [`${imageField}.$[image].thumbnail_generated_at`]: now,
        [`${imageField}.$[image].thumbnail_status`]: "completed",
        [`${imageField}.$[image].thumbnail_error`]: "",
        [`${imageField}.$[image].thumbnail.key`]: thumbnailKey,
        [`${imageField}.$[image].thumbnail.content_type`]: thumbnail.contentType,
        [`${imageField}.$[image].thumbnail.size_bytes`]: thumbnail.size,
        [`${imageField}.$[image].thumbnail.width`]: thumbnail.width,
        [`${imageField}.$[image].thumbnail.height`]: thumbnail.height,
        [`${imageField}.$[image].thumbnail.generated_at`]: now,
        [`${imageField}.$[image].processing.status`]: "ready",
        [`${imageField}.$[image].processing.completed_at`]: now,
        [`${imageField}.$[image].processing.lock_until`]: null,
        [`${imageField}.$[image].processing.error`]: "",
      },
    },
    {
      arrayFilters: [{ "image._id": image._id }],
    },
  );

  let sourceCleanupStatus = "completed";
  let sourceDeletedAt = new Date();
  try {
    await deleteObject(sourceKey);
  } catch (error) {
    sourceCleanupStatus = "pending";
    sourceDeletedAt = null;
    console.warn("[qc-image-processing] source cleanup failed", {
      qcId,
      imageField,
      imageId,
      sourceKey,
      message: error?.message || String(error),
    });
  }

  await Model.updateOne(
    query,
    {
      $set: {
        [`${imageField}.$[image].storage.source_cleanup_status`]: sourceCleanupStatus,
        [`${imageField}.$[image].storage.source_deleted_at`]: sourceDeletedAt,
      },
    },
    {
      arrayFilters: [{ "image._id": image._id }],
    },
  );

  return {
    legacy: false,
    qcId,
    inspectionId,
    ownerModel: owner,
    imageField,
    imageId,
    previewKey,
    thumbnailKey,
    previewSize: preview.size,
    thumbnailSize: thumbnail.size,
    sourceCleanupStatus,
  };
};

const processQcImageDerivatives = async ({
  qcId = "",
  inspectionId = "",
  ownerModel = OWNER_MODEL_QC,
  imageField = "qc_images",
  imageId = "",
} = {}) => {
  const claimed = await claimImageForProcessing({
    qcId,
    inspectionId,
    ownerModel,
    imageField,
    imageId,
  });
  if (!claimed) {
    return {
      skipped: true,
      reason: "not_claimed",
      qcId,
      inspectionId,
      ownerModel,
      imageField,
      imageId,
    };
  }

  const {
    image,
    imageField: field,
    ownerModel: claimedOwnerModel,
    inspection,
  } = claimed;
  const resolvedInspectionId = normalizeText(inspection?._id || inspectionId);
  const sourceKey = normalizeText(image?.storage?.source_key || image?.key || image?.public_id || "");
  if (!sourceKey) {
    await markImageProcessingFailed({
      qcId,
      inspectionId: resolvedInspectionId,
      ownerModel: claimedOwnerModel,
      imageField: field,
      imageId,
      error: new Error("Image source key is missing"),
    });
    return {
      skipped: true,
      reason: "missing_source_key",
      qcId,
      inspectionId: resolvedInspectionId,
      ownerModel: claimedOwnerModel,
      imageField: field,
      imageId,
    };
  }

  try {
    const sourceObject = await getObjectBuffer(sourceKey);
    const sourceBuffer = getDownloadedBuffer(sourceObject);
    if (!sourceBuffer || sourceBuffer.length === 0) {
      throw new Error("Downloaded source image is empty");
    }

    await buildSharpPipeline(sourceBuffer).metadata();

    if (normalizeText(image?.storage?.source_key)) {
      return await processDirectSourceImage({
        qcId,
        inspectionId: resolvedInspectionId,
        ownerModel: claimedOwnerModel,
        imageField: field,
        image,
        sourceBuffer,
      });
    }

    return await processLegacyThumbnail({
      qcId,
      inspectionId: resolvedInspectionId,
      ownerModel: claimedOwnerModel,
      imageField: field,
      image,
      sourceBuffer,
    });
  } catch (error) {
    await markImageProcessingFailed({
      qcId,
      inspectionId: resolvedInspectionId,
      ownerModel: claimedOwnerModel,
      imageField: field,
      imageId,
      error,
    });
    throw error;
  }
};

const shouldEnqueueImage = (image = {}) => {
  const status = normalizeKey(image?.processing?.status);
  const sourceKey = normalizeText(image?.storage?.source_key || "");
  const thumbnailKey = normalizeText(image?.thumbnail?.key || image?.thumbnail_key || "");
  const attempts = Math.max(0, Number(image?.processing?.attempts || 0));
  if (sourceKey) {
    return status === "queued" || (status === "failed" && attempts < MAX_PROCESSING_ATTEMPTS);
  }
  return normalizeText(image?.key || image?.public_id || "") && !thumbnailKey;
};

const scanAndEnqueuePendingQcImages = async ({
  limit = 500,
  legacyOnly = false,
} = {}) => {
  const safeLimit = Math.max(1, toPositiveInteger(limit, 500));
  const query = {
    $or: VALID_IMAGE_FIELDS.map((field) => ({
      [field]: {
        $elemMatch: legacyOnly
          ? {
              key: { $exists: true, $ne: "" },
              $or: [
                { thumbnail_key: { $exists: false } },
                { thumbnail_key: null },
                { thumbnail_key: "" },
                { "thumbnail.key": { $exists: false } },
                { "thumbnail.key": null },
                { "thumbnail.key": "" },
              ],
              "storage.source_key": { $in: [null, ""] },
            }
          : {
              $or: [
                {
                  "storage.source_key": { $exists: true, $ne: "" },
                  "processing.status": { $in: ["queued", "failed"] },
                },
                {
                  key: { $exists: true, $ne: "" },
                  "storage.source_key": { $in: [null, ""] },
                  $or: [
                    { thumbnail_key: { $exists: false } },
                    { thumbnail_key: null },
                    { thumbnail_key: "" },
                    { "thumbnail.key": { $exists: false } },
                    { "thumbnail.key": null },
                    { "thumbnail.key": "" },
                  ],
                },
              ],
            },
      },
    })),
  };
  const docs = await QC.find(query)
    .select(`_id ${VALID_IMAGE_FIELDS.join(" ")}`)
    .limit(safeLimit)
    .lean();
  const inspections = await Inspection.find(query)
    .select(`_id qc ${VALID_IMAGE_FIELDS.join(" ")}`)
    .limit(safeLimit)
    .lean();
  let enqueued = 0;

  for (const doc of docs) {
    for (const field of VALID_IMAGE_FIELDS) {
      const images = Array.isArray(doc?.[field]) ? doc[field] : [];
      for (const image of images) {
        if (legacyOnly && normalizeText(image?.storage?.source_key || "")) continue;
        if (!shouldEnqueueImage(image)) continue;
        await enqueueQcImageDerivativeProcessing({
          qcId: String(doc._id),
          imageField: field,
          imageId: String(image._id),
          ownerModel: OWNER_MODEL_QC,
        });
        enqueued += 1;
      }
    }
  }

  for (const inspection of inspections) {
    for (const field of VALID_IMAGE_FIELDS) {
      const images = Array.isArray(inspection?.[field]) ? inspection[field] : [];
      for (const image of images) {
        if (legacyOnly && normalizeText(image?.storage?.source_key || "")) continue;
        if (!shouldEnqueueImage(image)) continue;
        await enqueueQcImageDerivativeProcessing({
          qcId: String(inspection.qc || ""),
          inspectionId: String(inspection._id),
          imageField: field,
          imageId: String(image._id),
          ownerModel: OWNER_MODEL_INSPECTION,
        });
        enqueued += 1;
      }
    }
  }

  return {
    docs: docs.length,
    inspections: inspections.length,
    enqueued,
  };
};

const cleanupAbandonedUploadSessions = async ({ olderThan = new Date() } = {}) => {
  const docs = await QC.find({
    $or: VALID_IMAGE_FIELDS.map((field) => ({
      [field]: {
        $elemMatch: {
          "processing.status": "uploading",
          "upload.expires_at": { $lte: olderThan },
        },
      },
    })),
  })
    .select(`_id ${VALID_IMAGE_FIELDS.join(" ")}`)
    .limit(500)
    .lean();
  const inspections = await Inspection.find({
    $or: VALID_IMAGE_FIELDS.map((field) => ({
      [field]: {
        $elemMatch: {
          "processing.status": "uploading",
          "upload.expires_at": { $lte: olderThan },
        },
      },
    })),
  })
    .select(`_id qc ${VALID_IMAGE_FIELDS.join(" ")}`)
    .limit(500)
    .lean();
  let cleaned = 0;

  for (const doc of docs) {
    for (const field of VALID_IMAGE_FIELDS) {
      const expiredImages = (Array.isArray(doc?.[field]) ? doc[field] : []).filter((image) =>
        normalizeKey(image?.processing?.status) === "uploading" &&
        image?.upload?.expires_at &&
        new Date(image.upload.expires_at).getTime() <= olderThan.getTime(),
      );
      for (const image of expiredImages) {
        const sourceKey = normalizeText(image?.storage?.source_key || image?.key || "");
        if (sourceKey) {
          await deleteObject(sourceKey).catch(() => {});
        }
        await QC.updateOne(
          { _id: doc._id },
          {
            $pull: {
              [field]: { _id: image._id },
            },
          },
        );
        cleaned += 1;
      }
    }
  }

  for (const inspection of inspections) {
    for (const field of VALID_IMAGE_FIELDS) {
      const expiredImages = (Array.isArray(inspection?.[field]) ? inspection[field] : []).filter((image) =>
        normalizeKey(image?.processing?.status) === "uploading" &&
        image?.upload?.expires_at &&
        new Date(image.upload.expires_at).getTime() <= olderThan.getTime(),
      );
      for (const image of expiredImages) {
        const sourceKey = normalizeText(image?.storage?.source_key || image?.key || "");
        if (sourceKey) {
          await deleteObject(sourceKey).catch(() => {});
        }
        await Inspection.updateOne(
          { _id: inspection._id },
          {
            $pull: {
              [field]: { _id: image._id },
            },
          },
        );
        cleaned += 1;
      }
    }
  }

  return {
    docs: docs.length,
    inspections: inspections.length,
    cleaned,
  };
};

module.exports = {
  buildPreviewKey,
  buildThumbnailKey,
  cleanupAbandonedUploadSessions,
  createPreviewDerivative,
  createThumbnailDerivative,
  getSharpImageRuntimeSupport,
  processQcImageDerivatives,
  scanAndEnqueuePendingQcImages,
};
