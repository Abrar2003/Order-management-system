const path = require("path");
const mongoose = require("mongoose");
const QC = require("../models/qc.model");
const {
  getObjectBuffer,
  getObjectUrl,
  objectExists,
  uploadBuffer,
} = require("./wasabiStorage.service");
const {
  QC_THUMBNAIL_CACHE_CONTROL,
  buildQcThumbnailStorageKey,
  generateQcImageThumbnail,
} = require("./imageThumbnailService");
const {
  invalidateQcCaches,
} = require("./cacheInvalidation.service");

const VALID_QC_IMAGE_FIELDS = new Set(["qc_images", "hardware_inspection", "goods_not_ready_images"]);

const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const toConciseError = (error) =>
  normalizeText(error?.message || String(error)).replace(/\s+/g, " ").slice(0, 300);

const getDownloadedBuffer = (payload) => {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (Buffer.isBuffer(payload?.buffer)) {
    return payload.buffer;
  }

  if (payload?.buffer instanceof ArrayBuffer) {
    return Buffer.from(payload.buffer);
  }

  if (ArrayBuffer.isView(payload?.buffer)) {
    return Buffer.from(
      payload.buffer.buffer,
      payload.buffer.byteOffset,
      payload.buffer.byteLength,
    );
  }

  return null;
};

const resolveImageField = (value = "qc_images") => {
  const normalized = normalizeText(value);
  return VALID_QC_IMAGE_FIELDS.has(normalized) ? normalized : "qc_images";
};

const findStoredImage = (qcDoc = {}, {
  imageField = "qc_images",
  imageId = "",
  sourceKey = "",
  idempotencyKey = "",
} = {}) => {
  const field = resolveImageField(imageField);
  const images = Array.isArray(qcDoc?.[field]) ? qcDoc[field] : [];
  const normalizedImageId = normalizeText(imageId);
  const normalizedSourceKey = normalizeText(sourceKey);
  const normalizedIdempotencyKey = normalizeKey(idempotencyKey);

  return images.find((image) => {
    const storedImageId = normalizeText(image?._id);
    const storedSourceKey = normalizeText(image?.key || image?.public_id || "");
    const storedIdempotencyKey = normalizeKey(image?.idempotency_key);

    return (
      (normalizedImageId && storedImageId === normalizedImageId) ||
      (normalizedSourceKey && storedSourceKey === normalizedSourceKey) ||
      (normalizedIdempotencyKey && storedIdempotencyKey === normalizedIdempotencyKey)
    );
  }) || null;
};

const buildImageArrayFilter = ({
  imageId = "",
  sourceKey = "",
  idempotencyKey = "",
} = {}) => {
  const normalizedImageId = normalizeText(imageId);
  if (mongoose.Types.ObjectId.isValid(normalizedImageId)) {
    const objectId = new mongoose.Types.ObjectId(normalizedImageId);
    return {
      queryMatch: { _id: objectId },
      arrayFilter: { "image._id": objectId },
    };
  }

  const normalizedIdempotencyKey = normalizeKey(idempotencyKey);
  if (normalizedIdempotencyKey) {
    return {
      queryMatch: { idempotency_key: normalizedIdempotencyKey },
      arrayFilter: { "image.idempotency_key": normalizedIdempotencyKey },
    };
  }

  const normalizedSourceKey = normalizeText(sourceKey);
  return {
    queryMatch: { key: normalizedSourceKey },
    arrayFilter: { "image.key": normalizedSourceKey },
  };
};

const updateThumbnailSuccess = async ({
  qcId = "",
  imageField = "qc_images",
  imageId = "",
  sourceKey = "",
  idempotencyKey = "",
  thumbnailKey = "",
} = {}) => {
  const field = resolveImageField(imageField);
  const { queryMatch, arrayFilter } = buildImageArrayFilter({
    imageId,
    sourceKey,
    idempotencyKey,
  });

  const result = await QC.updateOne(
    {
      _id: qcId,
      [`${field}`]: { $elemMatch: queryMatch },
    },
    {
      $set: {
        [`${field}.$[image].thumbnail_key`]: thumbnailKey,
        [`${field}.$[image].thumbnail_url`]: getObjectUrl(thumbnailKey),
        [`${field}.$[image].thumbnail_generated_at`]: new Date(),
        [`${field}.$[image].thumbnail_status`]: "completed",
        [`${field}.$[image].thumbnail_error`]: "",
      },
    },
    {
      arrayFilters: [arrayFilter],
    },
  );

  if (Number(result?.modifiedCount || 0) > 0) {
    await invalidateQcCaches().catch(() => undefined);
  }

  return result;
};

const updateThumbnailFailure = async ({
  qcId = "",
  imageField = "qc_images",
  imageId = "",
  sourceKey = "",
  idempotencyKey = "",
  error,
} = {}) => {
  const field = resolveImageField(imageField);
  const { queryMatch, arrayFilter } = buildImageArrayFilter({
    imageId,
    sourceKey,
    idempotencyKey,
  });

  const result = await QC.updateOne(
    {
      _id: qcId,
      [`${field}`]: { $elemMatch: queryMatch },
    },
    {
      $set: {
        [`${field}.$[image].thumbnail_status`]: "failed",
        [`${field}.$[image].thumbnail_error`]: toConciseError(error),
      },
      $inc: {
        [`${field}.$[image].thumbnail_attempts`]: 1,
      },
    },
    {
      arrayFilters: [arrayFilter],
    },
  );

  if (Number(result?.modifiedCount || 0) > 0) {
    await invalidateQcCaches().catch(() => undefined);
  }

  return result;
};

const generateThumbnailForStoredQcImage = async ({
  qcId = "",
  imageField = "qc_images",
  imageId = "",
  sourceKey = "",
  idempotencyKey = "",
} = {}) => {
  const normalizedQcId = normalizeText(qcId);
  if (!mongoose.Types.ObjectId.isValid(normalizedQcId)) {
    throw new Error("Valid QC id is required for thumbnail generation");
  }

  const field = resolveImageField(imageField);
  const qcDoc = await QC.findById(normalizedQcId)
    .select(`_id ${field}`)
    .lean();
  if (!qcDoc) {
    return { skipped: true, reason: "qc_not_found", qcId: normalizedQcId };
  }

  const image = findStoredImage(qcDoc, {
    imageField: field,
    imageId,
    sourceKey,
    idempotencyKey,
  });
  if (!image) {
    return { skipped: true, reason: "image_not_found", qcId: normalizedQcId, imageField: field };
  }

  const resolvedSourceKey = normalizeText(image?.key || sourceKey);
  if (!resolvedSourceKey) {
    throw new Error("QC image source key is missing");
  }

  const resolvedImageId = normalizeText(image?._id || imageId);
  const resolvedIdempotencyKey = normalizeKey(image?.idempotency_key || idempotencyKey);
  const thumbnailKey =
    normalizeText(image?.thumbnail_key) || buildQcThumbnailStorageKey(resolvedSourceKey);

  try {
    if (await objectExists(thumbnailKey)) {
      await updateThumbnailSuccess({
        qcId: normalizedQcId,
        imageField: field,
        imageId: resolvedImageId,
        sourceKey: resolvedSourceKey,
        idempotencyKey: resolvedIdempotencyKey,
        thumbnailKey,
      });
      return {
        completed: true,
        alreadyExisted: true,
        qcId: normalizedQcId,
        imageField: field,
        sourceKey: resolvedSourceKey,
        thumbnailKey,
      };
    }

    const sourceObject = await getObjectBuffer(resolvedSourceKey);
    const thumbnail = await generateQcImageThumbnail({
      sourceBuffer: getDownloadedBuffer(sourceObject),
    });

    await uploadBuffer({
      buffer: thumbnail.buffer,
      key: thumbnailKey,
      originalName: path.posix.basename(thumbnailKey),
      contentType: thumbnail.contentType,
      cacheControl: QC_THUMBNAIL_CACHE_CONTROL,
    });

    await updateThumbnailSuccess({
      qcId: normalizedQcId,
      imageField: field,
      imageId: resolvedImageId,
      sourceKey: resolvedSourceKey,
      idempotencyKey: resolvedIdempotencyKey,
      thumbnailKey,
    });

    return {
      completed: true,
      generated: true,
      qcId: normalizedQcId,
      imageField: field,
      sourceKey: resolvedSourceKey,
      thumbnailKey,
      thumbnailSize: thumbnail.size,
      thumbnailWidth: thumbnail.width,
      thumbnailHeight: thumbnail.height,
    };
  } catch (error) {
    await updateThumbnailFailure({
      qcId: normalizedQcId,
      imageField: field,
      imageId: resolvedImageId,
      sourceKey: resolvedSourceKey,
      idempotencyKey: resolvedIdempotencyKey,
      error,
    });
    throw error;
  }
};

module.exports = {
  generateThumbnailForStoredQcImage,
  updateThumbnailFailure,
  updateThumbnailSuccess,
};
