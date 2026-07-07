const mongoose = require("mongoose");

const Inspection = require("../models/inspection.model");
const {
  isAdminLikeRole,
  isManagerLikeRole,
  normalizeUserRoleKey,
} = require("../helpers/userRole");

const INSPECTION_IMAGE_ARRAY_FIELDS = Object.freeze([
  "qc_images",
  "hardware_inspection",
  "goods_not_ready_images",
]);

const INSPECTION_IMAGE_FIELDS = Object.freeze([
  ...INSPECTION_IMAGE_ARRAY_FIELDS,
  "rejected_image",
]);

const normalizeText = (value) => String(value ?? "").trim();

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getUserObjectId = (user = {}) =>
  normalizeText(user?._id || user?.id || "");

const isElevatedImageUser = (user = {}) => {
  const roleKey = normalizeUserRoleKey(user?.role);
  return isAdminLikeRole(roleKey) || isManagerLikeRole(roleKey);
};

const normalizeInspectionImageField = (field = "qc_images") =>
  INSPECTION_IMAGE_FIELDS.includes(normalizeText(field))
    ? normalizeText(field)
    : "qc_images";

const getInspectionImageList = (inspection = {}, field = "qc_images") =>
  Array.isArray(inspection?.[field]) ? inspection[field] : [];

const sortInspectionRecordsLatestFirst = (left = {}, right = {}) => {
  const leftInspectionDate = normalizeText(left?.inspection_date);
  const rightInspectionDate = normalizeText(right?.inspection_date);
  if (leftInspectionDate !== rightInspectionDate) {
    return rightInspectionDate.localeCompare(leftInspectionDate);
  }

  return (
    new Date(right?.createdAt || 0).getTime() -
    new Date(left?.createdAt || 0).getTime()
  );
};

const resolveInspectionImageUploadTarget = async ({
  qc,
  user,
  inspectionId = "",
} = {}) => {
  if (!qc?._id) {
    throw createHttpError(400, "QC record is required before uploading images");
  }

  const qcId = qc._id;
  const elevatedUser = isElevatedImageUser(user);
  const normalizedInspectionId = normalizeText(inspectionId);

  if (elevatedUser && normalizedInspectionId) {
    if (!mongoose.Types.ObjectId.isValid(normalizedInspectionId)) {
      throw createHttpError(400, "Invalid inspection id");
    }

    const selectedInspection = await Inspection.findOne({
      _id: normalizedInspectionId,
      qc: qcId,
    });
    if (!selectedInspection) {
      throw createHttpError(404, "Selected inspection record was not found");
    }

    return selectedInspection;
  }

  const query = { qc: qcId };
  if (!elevatedUser) {
    const currentUserId = getUserObjectId(user);
    if (!currentUserId) {
      throw createHttpError(401, "Unauthorized");
    }
    query.inspector = currentUserId;
  }

  const latestInspection = await Inspection.findOne(query).sort({
    inspection_date: -1,
    createdAt: -1,
  });
  if (!latestInspection) {
    throw createHttpError(
      400,
      elevatedUser
        ? "Create an inspection record before uploading QC images"
        : "No assigned inspection record was found for this QC user",
    );
  }

  return latestInspection;
};

module.exports = {
  INSPECTION_IMAGE_ARRAY_FIELDS,
  INSPECTION_IMAGE_FIELDS,
  createHttpError,
  getInspectionImageList,
  isElevatedImageUser,
  normalizeInspectionImageField,
  resolveInspectionImageUploadTarget,
  sortInspectionRecordsLatestFirst,
};
