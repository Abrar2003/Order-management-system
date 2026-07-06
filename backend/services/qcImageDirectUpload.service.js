const crypto = require("crypto");
const path = require("path");
const mongoose = require("mongoose");

const QC = require("../models/qc.model");
const { buildAuditActor } = require("../helpers/permissions");
const {
  isAdminLikeRole,
  isManagerLikeRole,
  normalizeUserRoleKey,
} = require("../helpers/userRole");
const { applyDataAccessMatch } = require("./userDataAccess.service");
const {
  QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS,
  QC_IMAGE_EXTENSIONS,
  QC_IMAGE_MAX_FILE_SIZE,
  QC_IMAGE_MIME_TYPES,
  QC_IMAGE_UPLOAD_LIMIT_PER_INSPECTION_RECORD,
  HARDWARE_INSPECTION_IMAGE_LIMIT,
} = require("../config/qcImageUpload.config");
const {
  deleteObject,
  getObjectMetadata,
  getPresignedUploadUrl,
  isConfigured: isWasabiConfigured,
} = require("./wasabiStorage.service");

const ACTIVE_ORDER_MATCH = {
  archived: { $ne: true },
  status: { $ne: "Cancelled" },
};
const VALID_IMAGE_FIELDS = new Set(["qc_images", "hardware_inspection"]);

const EXTENSION_TO_MIME = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
});

const MIME_TO_EXTENSION = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/avif": ".avif",
});

const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toPositiveInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sanitizeStorageKeyPart = (value = "", fallback = "value") =>
  normalizeKey(value)
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || fallback;

const normalizeImageField = (value = "qc_images") => {
  const normalized = normalizeText(value);
  return VALID_IMAGE_FIELDS.has(normalized) ? normalized : "qc_images";
};

const getQcInspectionRecordCount = (qc = {}) =>
  Array.isArray(qc?.inspection_record) ? qc.inspection_record.length : 0;

const getQcImageUploadTotalLimit = (qc = {}) =>
  getQcInspectionRecordCount(qc) * QC_IMAGE_UPLOAD_LIMIT_PER_INSPECTION_RECORD;

const getQcImageCurrentCount = (qc = {}) =>
  Array.isArray(qc?.qc_images) ? qc.qc_images.length : 0;

const getRemainingQcImageUploadSlots = (qc = {}) =>
  Math.max(0, getQcImageUploadTotalLimit(qc) - getQcImageCurrentCount(qc));

const buildQcImageUploadLimitMessage = (qc = {}) => {
  const inspectionRecordCount = getQcInspectionRecordCount(qc);
  const totalLimit = getQcImageUploadTotalLimit(qc);
  const currentCount = getQcImageCurrentCount(qc);

  if (inspectionRecordCount <= 0) {
    return "QC image uploads are available only after at least one inspection record exists.";
  }

  return `QC image limit reached. ${currentCount} of ${totalLimit} images already uploaded (${inspectionRecordCount} inspection record${inspectionRecordCount === 1 ? "" : "s"} x ${QC_IMAGE_UPLOAD_LIMIT_PER_INSPECTION_RECORD}).`;
};

const resolveSupportedImageType = ({ contentType = "", fileName = "" } = {}) => {
  const normalizedContentType = normalizeKey(contentType);
  const extension = path.extname(normalizeKey(fileName));
  const mimeFromExtension = EXTENSION_TO_MIME[extension] || "";
  const resolvedContentType =
    QC_IMAGE_MIME_TYPES.has(normalizedContentType)
      ? normalizedContentType
      : mimeFromExtension;
  const resolvedExtension =
    QC_IMAGE_EXTENSIONS.has(extension)
      ? extension
      : MIME_TO_EXTENSION[resolvedContentType] || "";

  if (!resolvedContentType || !resolvedExtension) {
    throw createHttpError(
      400,
      `Only ${Array.from(QC_IMAGE_EXTENSIONS).join(", ")} QC image files are supported`,
    );
  }

  return {
    contentType: resolvedContentType,
    extension: resolvedExtension,
  };
};

const assertWasabiConfigured = () => {
  if (!isWasabiConfigured()) {
    throw createHttpError(500, "Wasabi storage is not configured");
  }
};

const findAccessibleQc = async (qcId, user) => {
  if (!mongoose.Types.ObjectId.isValid(qcId)) {
    throw createHttpError(400, "Invalid QC id");
  }

  const qc = await QC.findById(qcId)
    .populate("inspector")
    .populate({
      path: "order",
      match: applyDataAccessMatch(ACTIVE_ORDER_MATCH, user),
      select: "status quantity shipment order_id brand vendor",
    });

  if (!qc || !qc.order) {
    throw createHttpError(404, "QC record not found");
  }

  return qc;
};

const userCanUseUploadSession = (image = {}, user = {}) => {
  const roleKey = normalizeUserRoleKey(user?.role);
  if (isAdminLikeRole(roleKey) || isManagerLikeRole(roleKey)) return true;

  const currentUserId = normalizeText(user?._id || user?.id);
  const uploadedBy = normalizeText(
    image?.upload?.uploaded_by?.user ||
      image?.uploaded_by?.user ||
      "",
  );

  return Boolean(currentUserId && uploadedBy && currentUserId === uploadedBy);
};

const buildSourceStorageKey = ({
  qcId = "",
  imageField = "qc_images",
  imageId = "",
  uploadId = "",
  extension = ".jpg",
} = {}) => {
  const folder = imageField === "hardware_inspection" ? "hardware-inspection" : "qc-images";
  return [
    folder,
    sanitizeStorageKeyPart(qcId, "qc"),
    sanitizeStorageKeyPart(imageField, "images"),
    sanitizeStorageKeyPart(imageId, "image"),
    "source",
    `${sanitizeStorageKeyPart(uploadId, "upload")}${extension}`,
  ].join("/");
};

const buildUploadSessionResponse = async ({
  qc,
  image,
  imageField,
  contentType,
  expiresAt,
  completed = false,
} = {}) => {
  const sourceKey = normalizeText(image?.storage?.source_key || image?.key);
  const uploadId = normalizeText(image?.upload?.upload_id);
  const safeExpiresAt =
    expiresAt ||
    image?.upload?.expires_at ||
    new Date(Date.now() + QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS * 1000);
  const uploadUrl = completed
    ? ""
    : await getPresignedUploadUrl(sourceKey, {
        contentType: contentType || image?.storage?.source_content_type || image?.contentType,
        expiresIn: QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS,
      });

  return {
    qc_id: String(qc?._id || ""),
    image_id: String(image?._id || ""),
    image_type: imageField,
    upload_id: uploadId,
    upload_url: uploadUrl,
    method: "PUT",
    source_key: sourceKey,
    content_type: contentType || image?.storage?.source_content_type || image?.contentType || "",
    expires_at: safeExpiresAt,
    already_completed: completed,
    headers: {
      "Content-Type": contentType || image?.storage?.source_content_type || image?.contentType || "",
    },
  };
};

const findImageByIdempotencyKey = (qc = {}, imageField = "qc_images", idempotencyKey = "") => {
  const normalizedKey = normalizeKey(idempotencyKey);
  if (!normalizedKey) return null;
  return (Array.isArray(qc?.[imageField]) ? qc[imageField] : []).find((image) =>
    normalizeKey(image?.upload?.idempotency_key || image?.idempotency_key) === normalizedKey,
  ) || null;
};

const createUploadSession = async ({
  user,
  qcId = "",
  imageType = "qc_images",
  fileName = "",
  contentType = "",
  sizeBytes = 0,
  idempotencyKey = "",
  uploadMode = "bulk",
  comment = "",
} = {}) => {
  assertWasabiConfigured();

  const qc = await findAccessibleQc(qcId, user);
  const imageField = normalizeImageField(imageType);
  const { contentType: resolvedContentType, extension } = resolveSupportedImageType({
    contentType,
    fileName,
  });
  const normalizedSize = toPositiveInteger(sizeBytes, 0);
  if (normalizedSize <= 0) {
    throw createHttpError(400, "Image size is required");
  }
  if (normalizedSize > QC_IMAGE_MAX_FILE_SIZE) {
    throw createHttpError(400, `Image is too large. Max size is ${QC_IMAGE_MAX_FILE_SIZE} bytes`);
  }

  const normalizedIdempotencyKey =
    normalizeKey(idempotencyKey) || crypto.randomUUID();
  const existingImage = findImageByIdempotencyKey(qc, imageField, normalizedIdempotencyKey);
  if (existingImage) {
    if (!userCanUseUploadSession(existingImage, user)) {
      throw createHttpError(403, "Upload session belongs to another user");
    }

    const processingStatus = normalizeKey(existingImage?.processing?.status);
    return buildUploadSessionResponse({
      qc,
      image: existingImage,
      imageField,
      contentType: resolvedContentType,
      completed: processingStatus === "ready" || processingStatus === "queued",
    });
  }

  const currentCount =
    imageField === "hardware_inspection"
      ? (Array.isArray(qc.hardware_inspection) ? qc.hardware_inspection.length : 0)
      : getQcImageCurrentCount(qc);
  const totalLimit =
    imageField === "hardware_inspection"
      ? HARDWARE_INSPECTION_IMAGE_LIMIT
      : getQcImageUploadTotalLimit(qc);
  const remainingSlots =
    imageField === "hardware_inspection"
      ? Math.max(0, totalLimit - currentCount)
      : getRemainingQcImageUploadSlots(qc);
  if (remainingSlots <= 0) {
    throw createHttpError(
      400,
      imageField === "hardware_inspection"
        ? `Hardware inspection image limit reached (max ${HARDWARE_INSPECTION_IMAGE_LIMIT} images).`
        : buildQcImageUploadLimitMessage(qc),
    );
  }

  const imageId = new mongoose.Types.ObjectId();
  const uploadId = crypto.randomUUID();
  const sourceKey = buildSourceStorageKey({
    qcId: String(qc._id),
    imageField,
    imageId: String(imageId),
    uploadId,
    extension,
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS * 1000);
  const uploadedBy = buildAuditActor(user);
  const safeOriginalName = normalizeText(fileName) || `qc-image${extension}`;
  const imageEntry = {
    _id: imageId,
    key: sourceKey,
    originalName: safeOriginalName,
    contentType: resolvedContentType,
    size: normalizedSize,
    hash: "",
    idempotency_key: normalizedIdempotencyKey,
    thumbnail_key: null,
    thumbnail_url: null,
    thumbnail_generated_at: null,
    thumbnail_status: "pending",
    thumbnail_error: "",
    thumbnail_attempts: 0,
    storage: {
      source_key: sourceKey,
      source_content_type: resolvedContentType,
      source_size_bytes: normalizedSize,
      source_etag: "",
      source_uploaded_at: null,
      source_deleted_at: null,
      source_cleanup_status: "pending",
    },
    preview: {
      key: "",
      content_type: "",
      size_bytes: 0,
      width: 0,
      height: 0,
      generated_at: null,
    },
    thumbnail: {
      key: "",
      content_type: "",
      size_bytes: 0,
      width: 0,
      height: 0,
      generated_at: null,
    },
    processing: {
      status: "uploading",
      attempts: 0,
      error: "",
      started_at: null,
      completed_at: null,
      lock_until: null,
    },
    upload: {
      upload_id: uploadId,
      idempotency_key: normalizedIdempotencyKey,
      uploaded_by: uploadedBy,
      expires_at: expiresAt,
    },
    comment: normalizeText(uploadMode).toLowerCase() === "single" ? normalizeText(comment) : "",
    uploadedAt: now,
    uploaded_by: uploadedBy,
  };

  await QC.updateOne(
    { _id: qc._id },
    {
      $push: { [imageField]: imageEntry },
      $set: { updated_by: uploadedBy },
    },
  );

  return buildUploadSessionResponse({
    qc,
    image: imageEntry,
    imageField,
    contentType: resolvedContentType,
    expiresAt,
  });
};

const findQcByUploadId = async (uploadId = "", user = null) => {
  const normalizedUploadId = normalizeText(uploadId);
  if (!normalizedUploadId) {
    throw createHttpError(400, "Upload id is required");
  }

  const qc = await QC.findOne({
    $or: [
      { "qc_images.upload.upload_id": normalizedUploadId },
      { "hardware_inspection.upload.upload_id": normalizedUploadId },
    ],
  })
    .populate("inspector")
    .populate({
      path: "order",
      match: applyDataAccessMatch(ACTIVE_ORDER_MATCH, user),
      select: "status quantity shipment order_id brand vendor",
    });

  if (!qc || !qc.order) {
    throw createHttpError(404, "Upload session not found");
  }

  const imageField = ["qc_images", "hardware_inspection"].find((field) =>
    (Array.isArray(qc?.[field]) ? qc[field] : []).some((image) =>
      normalizeText(image?.upload?.upload_id) === normalizedUploadId,
    ),
  );
  const image = (Array.isArray(qc?.[imageField]) ? qc[imageField] : []).find((entry) =>
    normalizeText(entry?.upload?.upload_id) === normalizedUploadId,
  );

  if (!image || !imageField) {
    throw createHttpError(404, "Upload session not found");
  }
  if (!userCanUseUploadSession(image, user)) {
    throw createHttpError(403, "Upload session belongs to another user");
  }

  return { qc, imageField, image };
};

const completeUploadSession = async ({ user, uploadId = "" } = {}) => {
  assertWasabiConfigured();
  const { qc, imageField, image } = await findQcByUploadId(uploadId, user);
  const processingStatus = normalizeKey(image?.processing?.status);
  const sourceKey = normalizeText(image?.storage?.source_key || image?.key);

  if (!sourceKey) {
    throw createHttpError(400, "Upload session is missing a source key");
  }

  if (processingStatus === "queued" || processingStatus === "processing" || processingStatus === "ready") {
    return {
      qc_id: String(qc._id),
      image_id: String(image._id),
      image_type: imageField,
      upload_id: uploadId,
      processing_status: processingStatus,
      already_completed: true,
    };
  }

  const metadata = await getObjectMetadata(sourceKey);
  if (!metadata.exists) {
    throw createHttpError(404, "Uploaded source object was not found in Wasabi");
  }
  if (metadata.size <= 0) {
    throw createHttpError(400, "Uploaded source object is empty");
  }
  if (metadata.size > QC_IMAGE_MAX_FILE_SIZE) {
    throw createHttpError(400, `Uploaded source object exceeds ${QC_IMAGE_MAX_FILE_SIZE} bytes`);
  }

  const now = new Date();
  const result = await QC.updateOne(
    {
      _id: qc._id,
      [`${imageField}.upload.upload_id`]: uploadId,
    },
    {
      $set: {
        [`${imageField}.$[image].key`]: sourceKey,
        [`${imageField}.$[image].contentType`]:
          metadata.contentType || image?.storage?.source_content_type || image?.contentType || "",
        [`${imageField}.$[image].size`]: metadata.size,
        [`${imageField}.$[image].storage.source_key`]: sourceKey,
        [`${imageField}.$[image].storage.source_content_type`]:
          metadata.contentType || image?.storage?.source_content_type || image?.contentType || "",
        [`${imageField}.$[image].storage.source_size_bytes`]: metadata.size,
        [`${imageField}.$[image].storage.source_etag`]: metadata.etag || "",
        [`${imageField}.$[image].storage.source_uploaded_at`]: metadata.lastModified || now,
        [`${imageField}.$[image].storage.source_cleanup_status`]: "pending",
        [`${imageField}.$[image].processing.status`]: "queued",
        [`${imageField}.$[image].processing.error`]: "",
        [`${imageField}.$[image].processing.lock_until`]: null,
        [`${imageField}.$[image].upload.expires_at`]: null,
        updated_by: buildAuditActor(user),
      },
    },
    {
      arrayFilters: [{ "image.upload.upload_id": uploadId }],
    },
  );

  if (Number(result?.matchedCount || 0) <= 0) {
    throw createHttpError(404, "Upload session not found");
  }

  return {
    qc_id: String(qc._id),
    image_id: String(image._id),
    image_type: imageField,
    upload_id: uploadId,
    source_key: sourceKey,
    source_size_bytes: metadata.size,
    source_etag: metadata.etag || "",
    processing_status: "queued",
    already_completed: false,
  };
};

const refreshUploadSession = async ({ user, uploadId = "" } = {}) => {
  assertWasabiConfigured();
  const { qc, imageField, image } = await findQcByUploadId(uploadId, user);
  const processingStatus = normalizeKey(image?.processing?.status);
  if (processingStatus !== "uploading") {
    throw createHttpError(409, "Only incomplete upload sessions can be refreshed");
  }

  const sourceKey = normalizeText(image?.storage?.source_key || image?.key);
  const contentType = normalizeText(image?.storage?.source_content_type || image?.contentType);
  const expiresAt = new Date(Date.now() + QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS * 1000);

  await QC.updateOne(
    {
      _id: qc._id,
      [`${imageField}.upload.upload_id`]: uploadId,
    },
    {
      $set: {
        [`${imageField}.$[image].upload.expires_at`]: expiresAt,
      },
    },
    {
      arrayFilters: [{ "image.upload.upload_id": uploadId }],
    },
  );

  return buildUploadSessionResponse({
    qc,
    image,
    imageField,
    contentType,
    expiresAt,
  });
};

const abortUploadSession = async ({ user, uploadId = "" } = {}) => {
  const { qc, imageField, image } = await findQcByUploadId(uploadId, user);
  const processingStatus = normalizeKey(image?.processing?.status);
  if (processingStatus !== "uploading") {
    throw createHttpError(409, "Only incomplete upload sessions can be cancelled");
  }

  const sourceKey = normalizeText(image?.storage?.source_key || image?.key);
  if (sourceKey) {
    await deleteObject(sourceKey).catch((error) => {
      console.warn("[qc-direct-upload] abort source cleanup failed", {
        uploadId,
        sourceKey,
        message: error?.message || String(error),
      });
    });
  }

  await QC.updateOne(
    { _id: qc._id },
    {
      $pull: {
        [imageField]: { "upload.upload_id": uploadId },
      },
      $set: {
        updated_by: buildAuditActor(user),
      },
    },
  );

  return {
    qc_id: String(qc._id),
    image_type: imageField,
    upload_id: uploadId,
    cancelled: true,
  };
};

module.exports = {
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  refreshUploadSession,
  resolveSupportedImageType,
};
