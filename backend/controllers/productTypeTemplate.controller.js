const mongoose = require("mongoose");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const {
  PRODUCT_TYPE_TEMPLATE_INPUT_TYPES,
  PRODUCT_TYPE_TEMPLATE_STATUSES,
  PRODUCT_TYPE_TEMPLATE_VALUE_TYPES,
  normalizeTemplateKey,
  prepareTemplatePayload,
  sortTemplateGroups,
} = require("../helpers/productTypeTemplates");
const { normalizeRoleKey } = require("../helpers/permissions");
const { isManagerLikeRole } = require("../helpers/userRole");

const normalizeText = (value) => String(value ?? "").trim();

const isPrivilegedTemplateReader = (user = {}) =>
  isManagerLikeRole(normalizeRoleKey(user?.role));

const buildTemplateMeta = () => ({
  statuses: PRODUCT_TYPE_TEMPLATE_STATUSES,
  input_types: PRODUCT_TYPE_TEMPLATE_INPUT_TYPES,
  value_types: PRODUCT_TYPE_TEMPLATE_VALUE_TYPES,
});

const serializeTemplate = (doc = {}) => ({
  _id: doc?._id,
  key: normalizeTemplateKey(doc?.key),
  label: normalizeText(doc?.label),
  description: normalizeText(doc?.description),
  version: Number(doc?.version || 1),
  status: normalizeText(doc?.status || "draft").toLowerCase(),
  groups: sortTemplateGroups(doc?.groups || []),
  createdAt: doc?.createdAt || null,
  updatedAt: doc?.updatedAt || null,
});

const deactivateSiblingActiveTemplates = async ({
  key = "",
  excludeId = null,
} = {}) => {
  const normalizedKey = normalizeTemplateKey(key);
  if (!normalizedKey) return;

  await ProductTypeTemplate.updateMany(
    {
      key: normalizedKey,
      status: "active",
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    },
    {
      $set: { status: "inactive" },
    },
  );
};

const getReadableTemplateMatch = (req, extraMatch = {}) => {
  const match = { ...extraMatch };
  const requestedStatus = normalizeTemplateKey(req.query?.status || "");
  const privileged = isPrivilegedTemplateReader(req.user);

  if (
    requestedStatus &&
    PRODUCT_TYPE_TEMPLATE_STATUSES.includes(requestedStatus)
  ) {
    match.status = requestedStatus;
    return match;
  }

  if (!privileged) {
    match.status = "active";
  }

  return match;
};

const getProductTypeTemplates = async (req, res) => {
  try {
    const docs = await ProductTypeTemplate.find(getReadableTemplateMatch(req))
      .sort({ key: 1, version: -1, updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: docs.map((doc) => serializeTemplate(doc)),
      meta: buildTemplateMeta(),
    });
  } catch (error) {
    console.error("Get Product Type Templates Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch product type templates",
    });
  }
};

const getProductTypeTemplateByKey = async (req, res) => {
  try {
    const key = normalizeTemplateKey(req.params.key);
    if (!key) {
      return res.status(400).json({
        success: false,
        message: "Template key is required",
      });
    }

    const requestedVersion = Number.parseInt(
      String(req.query?.version ?? "").trim(),
      10,
    );
    const match = getReadableTemplateMatch(req, { key });
    if (Number.isFinite(requestedVersion) && requestedVersion > 0) {
      match.version = requestedVersion;
    }

    const doc = await ProductTypeTemplate.findOne(match)
      .sort({ version: -1, updatedAt: -1 })
      .lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Product type template not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeTemplate(doc),
      meta: buildTemplateMeta(),
    });
  } catch (error) {
    console.error("Get Product Type Template By Key Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch product type template",
    });
  }
};

const createProductTypeTemplate = async (req, res) => {
  try {
    const normalizedPayload = prepareTemplatePayload(req.body || {});
    const doc = new ProductTypeTemplate(normalizedPayload);
    await doc.validate();
    await doc.save();

    if (doc.status === "active") {
      await deactivateSiblingActiveTemplates({
        key: doc.key,
        excludeId: doc._id,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Product type template created successfully",
      data: serializeTemplate(doc.toObject()),
    });
  } catch (error) {
    console.error("Create Product Type Template Error:", error);
    const statusCode = error?.code === 11000 ? 409 : 400;
    return res.status(statusCode).json({
      success: false,
      message:
        error?.code === 11000
          ? "A template with the same key and version already exists"
          : error.message || "Failed to create product type template",
    });
  }
};

const updateProductTypeTemplate = async (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid template id",
      });
    }

    const existingDoc = await ProductTypeTemplate.findById(id).lean();
    if (!existingDoc) {
      return res.status(404).json({
        success: false,
        message: "Product type template not found",
      });
    }

    const normalizedPayload = prepareTemplatePayload({
      key: req.body?.key ?? existingDoc.key,
      label: req.body?.label ?? existingDoc.label,
      description: req.body?.description ?? existingDoc.description,
      version: req.body?.version ?? existingDoc.version,
      status: req.body?.status ?? existingDoc.status,
      groups: req.body?.groups ?? existingDoc.groups,
    });

    const updatedDoc = await ProductTypeTemplate.findByIdAndUpdate(
      id,
      { $set: normalizedPayload },
      { new: true, runValidators: true },
    );

    if (updatedDoc?.status === "active") {
      await deactivateSiblingActiveTemplates({
        key: updatedDoc.key,
        excludeId: updatedDoc._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product type template updated successfully",
      data: serializeTemplate(updatedDoc?.toObject()),
    });
  } catch (error) {
    console.error("Update Product Type Template Error:", error);
    const statusCode = error?.code === 11000 ? 409 : 400;
    return res.status(statusCode).json({
      success: false,
      message:
        error?.code === 11000
          ? "A template with the same key and version already exists"
          : error.message || "Failed to update product type template",
    });
  }
};

const updateProductTypeTemplateStatus = async (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid template id",
      });
    }

    const status = normalizeTemplateKey(req.body?.status || "");
    if (!PRODUCT_TYPE_TEMPLATE_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid template status",
      });
    }

    const updatedDoc = await ProductTypeTemplate.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true, runValidators: true },
    );

    if (!updatedDoc) {
      return res.status(404).json({
        success: false,
        message: "Product type template not found",
      });
    }

    if (status === "active") {
      await deactivateSiblingActiveTemplates({
        key: updatedDoc.key,
        excludeId: updatedDoc._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product type template status updated successfully",
      data: serializeTemplate(updatedDoc.toObject()),
    });
  } catch (error) {
    console.error("Update Product Type Template Status Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update product type template status",
    });
  }
};

const archiveProductTypeTemplate = async (req, res) => {
  try {
    const id = normalizeText(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid template id",
      });
    }

    const updatedDoc = await ProductTypeTemplate.findByIdAndUpdate(
      id,
      { $set: { status: "archived" } },
      { new: true, runValidators: true },
    );

    if (!updatedDoc) {
      return res.status(404).json({
        success: false,
        message: "Product type template not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product type template archived successfully",
      data: serializeTemplate(updatedDoc.toObject()),
    });
  } catch (error) {
    console.error("Archive Product Type Template Error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to archive product type template",
    });
  }
};

module.exports = {
  archiveProductTypeTemplate,
  createProductTypeTemplate,
  getProductTypeTemplateByKey,
  getProductTypeTemplates,
  updateProductTypeTemplate,
  updateProductTypeTemplateStatus,
};
