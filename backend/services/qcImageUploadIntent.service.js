const mongoose = require("mongoose");

const QcImageUploadIntent = require("../models/qcImageUploadIntent.model");
const Inspection = require("../models/inspection.model");
const { buildAuditActor } = require("../helpers/permissions");
const {
  QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS,
} = require("../config/qcImageUpload.config");
const { deleteObject } = require("./wasabiStorage.service");
const { createHttpError } = require("./qcInspectionImageOwnership.service");
const { findAccessibleQc } = require("./qcImageDirectUpload.service");

const OPERATION_CONFIG = Object.freeze({
  rejection: { imageType: "rejected_images", maxImages: 10 },
  goods_not_ready: { imageType: "goods_not_ready_images", maxImages: 10 },
  reject_all: { imageType: "rejected_images", maxImages: 1 },
});

const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const getUserId = (user = {}) => normalizeText(user?._id || user?.id || "");

const canManageIntent = (intent = {}, user = {}) => {
  const userId = getUserId(user);
  return Boolean(userId && userId === normalizeText(intent?.created_by?.user));
};

const resolveOperationConfig = (operation = "") => {
  const config = OPERATION_CONFIG[normalizeKey(operation)];
  if (!config) throw createHttpError(400, "Invalid QC image upload operation");
  return config;
};

const createImageUploadIntent = async ({
  user,
  qcId = "",
  operation = "",
  imageType = "",
  inspectionId = "",
  requestHistoryId = "",
  comment = "",
} = {}) => {
  const config = resolveOperationConfig(operation);
  if (normalizeText(imageType) && normalizeText(imageType) !== config.imageType) {
    throw createHttpError(400, "Image type does not match the upload operation");
  }

  const qc = await findAccessibleQc(qcId, user);
  const normalizedInspectionId = normalizeText(inspectionId);
  if (normalizedInspectionId && !mongoose.Types.ObjectId.isValid(normalizedInspectionId)) {
    throw createHttpError(400, "Invalid inspection id");
  }
  const normalizedRequestHistoryId = normalizeText(requestHistoryId);
  if (!mongoose.Types.ObjectId.isValid(normalizedRequestHistoryId)) {
    throw createHttpError(400, "Invalid QC request id");
  }
  if (
    normalizedRequestHistoryId &&
    !(Array.isArray(qc.request_history) ? qc.request_history : []).some(
      (entry) => String(entry?._id || "") === normalizedRequestHistoryId,
    )
  ) {
    throw createHttpError(400, "QC request does not belong to this QC record");
  }
  if (normalizedInspectionId) {
    const inspection = await Inspection.findOne({
      _id: normalizedInspectionId,
      qc: qc._id,
    })
      .select("request_history_id")
      .lean();
    if (!inspection) {
      throw createHttpError(400, "Inspection record does not belong to this QC record");
    }
    if (String(inspection.request_history_id || "") !== normalizedRequestHistoryId) {
      throw createHttpError(400, "Inspection record does not belong to this QC request");
    }
  }

  const intent = await QcImageUploadIntent.create({
    qc: qc._id,
    inspection: normalizedInspectionId || null,
    request_history_id: normalizedRequestHistoryId || null,
    operation: normalizeKey(operation),
    image_type: config.imageType,
    comment: normalizeText(comment),
    expires_at: new Date(Date.now() + QC_IMAGE_DIRECT_UPLOAD_URL_TTL_SECONDS * 1000),
    created_by: buildAuditActor(user),
  });

  return {
    intent_id: String(intent._id),
    qc_id: String(qc._id),
    image_type: intent.image_type,
    operation: intent.operation,
    max_images: config.maxImages,
    expires_at: intent.expires_at,
  };
};

const getOpenIntent = async ({
  intentId = "",
  user,
  qcId = "",
  operation = "",
  imageType = "",
  inspectionId = "",
  requestHistoryId = "",
  requireUnboundInspection = false,
  requireImages = true,
} = {}) => {
  if (!mongoose.Types.ObjectId.isValid(normalizeText(intentId))) {
    throw createHttpError(400, "Invalid QC image upload intent");
  }
  const intent = await QcImageUploadIntent.findById(intentId);
  if (!intent) throw createHttpError(404, "QC image upload intent was not found");
  if (!canManageIntent(intent, user)) {
    throw createHttpError(403, "QC image upload intent belongs to another user");
  }
  if (normalizeText(qcId) && String(intent.qc) !== normalizeText(qcId)) {
    throw createHttpError(400, "QC image upload intent does not belong to this QC record");
  }
  if (intent.state !== "open") {
    throw createHttpError(409, "QC image upload intent is no longer active");
  }
  if (!intent.expires_at || intent.expires_at.getTime() <= Date.now()) {
    intent.state = "expired";
    await intent.save();
    throw createHttpError(409, "QC image upload intent has expired");
  }
  if (normalizeText(operation) && intent.operation !== normalizeKey(operation)) {
    throw createHttpError(400, "QC image upload intent operation does not match");
  }
  if (normalizeText(imageType) && intent.image_type !== normalizeText(imageType)) {
    throw createHttpError(400, "QC image upload intent image type does not match");
  }
  if (normalizeText(inspectionId) && String(intent.inspection || "") !== normalizeText(inspectionId)) {
    throw createHttpError(400, "QC image upload intent inspection does not match");
  }
  if (requireUnboundInspection && intent.inspection) {
    throw createHttpError(400, "QC image upload intent is bound to an inspection record");
  }
  if (
    normalizeText(requestHistoryId) &&
    String(intent.request_history_id || "") !== normalizeText(requestHistoryId)
  ) {
    throw createHttpError(409, "QC request changed while images were uploading");
  }

  const images = Array.isArray(intent.images) ? intent.images : [];
  if (requireImages && images.length === 0) {
    throw createHttpError(400, "Upload at least one image before submitting");
  }
  if (images.some((image) => normalizeKey(image?.processing?.status) !== "queued")) {
    throw createHttpError(409, "Wait for every image upload to finish before submitting");
  }
  return intent;
};

const addIntentImagesToInspection = ({ intent, inspection, replace = false } = {}) => {
  const config = resolveOperationConfig(intent?.operation);
  const images = Array.isArray(intent?.images) ? intent.images.map((image) => ({ ...image })) : [];
  if (images.length > config.maxImages) {
    throw createHttpError(400, `You can upload up to ${config.maxImages} images for this action`);
  }
  const field = intent.image_type;
  const existing = replace ? [] : Array.isArray(inspection?.[field]) ? inspection[field] : [];
  if (existing.length + images.length > config.maxImages) {
    throw createHttpError(400, `Image limit reached for this inspection record (max ${config.maxImages})`);
  }
  inspection[field] = [...existing, ...images];
  return images;
};

const commitImageUploadIntent = async ({ intent } = {}) => {
  if (!intent || intent.state !== "open") return;
  intent.state = "committed";
  intent.committed_at = new Date();
  await intent.save();
};

const cancelImageUploadIntent = async ({ intentId = "", user } = {}) => {
  const intent = await getOpenIntent({ intentId, user, requireImages: false });
  await Promise.allSettled(
    (Array.isArray(intent.images) ? intent.images : [])
      .map((image) => normalizeText(image?.storage?.source_key || image?.key))
      .filter(Boolean)
      .map((key) => deleteObject(key)),
  );
  intent.state = "cancelled";
  await intent.save();
  return { intent_id: String(intent._id), cancelled: true };
};

const cleanupExpiredImageUploadIntents = async ({ olderThan = new Date() } = {}) => {
  const intents = await QcImageUploadIntent.find({
    state: "open",
    expires_at: { $lte: olderThan },
  }).limit(500);
  let cleaned = 0;
  for (const intent of intents) {
    await Promise.allSettled(
      (Array.isArray(intent.images) ? intent.images : [])
        .map((image) => normalizeText(image?.storage?.source_key || image?.key))
        .filter(Boolean)
        .map((key) => deleteObject(key)),
    );
    intent.state = "expired";
    await intent.save();
    cleaned += 1;
  }
  return { intents: intents.length, cleaned };
};

module.exports = {
  OPERATION_CONFIG,
  addIntentImagesToInspection,
  canManageIntent,
  cancelImageUploadIntent,
  cleanupExpiredImageUploadIntents,
  commitImageUploadIntent,
  createImageUploadIntent,
  getOpenIntent,
  resolveOperationConfig,
};
