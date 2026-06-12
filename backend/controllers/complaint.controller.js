const path = require("path");
const mongoose = require("mongoose");

const { Complaint } = require("../models/complaint.model");
const Item = require("../models/item.model");
const {
  ComplaintCategory,
  normalizeCategoryName,
} = require("../models/complaintCategory.model");
const {
  createStorageKey,
  deleteObject,
  getObjectUrl,
  getSignedObjectUrl,
  uploadBuffer,
} = require("../services/wasabiStorage.service");
const {
  isManagerLikeRole,
  isSuperAdminLikeRole,
  normalizeUserRoleKey,
} = require("../helpers/userRole");

const QC_COMPLAINT_ROLE_KEYS = new Set([
  "admin",
  "super_admin",
  "manager",
  "product_manager",
  "inspection_manager",
  "qc",
]);

const SEARCH_FIELDS = [
  "complaint_no",
  "item_code",
  "brand",
  "vendor",
  "category",
  "po",
  "first_comment",
];

const normalizeText = (value = "") => String(value ?? "").trim();
const escapeRegex = (value = "") =>
  normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const normalizeBooleanFilter = (value, fallback = false) => {
  const normalized = normalizeText(value).toLowerCase();
  if (["true", "1", "yes", "archived"].includes(normalized)) return true;
  if (["false", "0", "no", "active"].includes(normalized)) return false;
  return fallback;
};
const normalizeBooleanValue = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return ["true", "1", "yes", "on"].includes(normalized);
};
const parseJsonArrayField = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  const normalized = normalizeText(value);
  if (!normalized) return fallback;
  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};
const parseDateBoundary = (value, endOfDay = false) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    parsed.setUTCHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  return parsed;
};

const buildActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name: normalizeText(user?.name) ||
    normalizeText(user?.email) ||
    normalizeText(user?.username) ||
    normalizeText(user?.role) ||
    "Unknown",
});

const isAdminOnlyRole = (user = {}) => {
  const roleKey = normalizeUserRoleKey(user?.role);
  return roleKey === "admin" || isSuperAdminLikeRole(roleKey);
};

const ensureManagerAccess = (req, res) => {
  if (isManagerLikeRole(req.user?.role)) return true;
  res.status(403).json({
    success: false,
    message: "Complain action is restricted to admin and manager users.",
  });
  return false;
};

const ensureAdminAccess = (req, res, message = "Complain archive actions are admin-only.") => {
  if (isAdminOnlyRole(req.user)) return true;
  res.status(403).json({
    success: false,
    message,
  });
  return false;
};

const ensureQcComplaintAccess = (req, res) => {
  const roleKey = normalizeUserRoleKey(req.user?.role);
  if (QC_COMPLAINT_ROLE_KEYS.has(roleKey)) return true;
  res.status(403).json({
    success: false,
    message: "Complain viewing is restricted to QC, admin, and manager users.",
  });
  return false;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const getObjectIdString = (value) => String(value?._id || value || "").trim();
const normalizeItemCodeKey = (value) => normalizeText(value).toLowerCase();
const getUserIdString = (value) => String(value?._id || value?.id || value || "").trim();

const findExistingItemByCode = async (itemCode = "") => {
  const normalizedItemCode = normalizeText(itemCode);
  if (!normalizedItemCode) return null;

  return Item.findOne({
    code: { $regex: `^${escapeRegex(normalizedItemCode)}$`, $options: "i" },
  })
    .select("_id code brand brand_name brands vendors")
    .lean();
};

const createComplaintNo = () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `CMP-${datePart}-${suffix}`;
};

const serializeCategory = (category = {}) => ({
  _id: String(category._id || ""),
  name: normalizeCategoryName(category.name),
  created_by: category.created_by || null,
  updated_by: category.updated_by || null,
  created_at: category.created_at || category.createdAt || null,
  updated_at: category.updated_at || category.updatedAt || null,
});

const ensureComplaintCategory = async (name, actor) => {
  const normalizedName = normalizeCategoryName(name);
  if (!normalizedName) return null;

  const normalizedKey = normalizedName.toLowerCase();
  const existing = await ComplaintCategory.findOne({ normalized_name: normalizedKey });
  if (existing) return existing;

  try {
    return await ComplaintCategory.create({
      name: normalizedName,
      normalized_name: normalizedKey,
      created_by: actor,
      updated_by: actor,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return ComplaintCategory.findOne({ normalized_name: normalizedKey });
    }
    throw error;
  }
};

const buildComplaintMatch = (query = {}) => {
  const match = {};
  const search = normalizeText(query.search);
  const brand = normalizeText(query.brand);
  const vendor = normalizeText(query.vendor);
  const category = normalizeCategoryName(query.category);
  const itemCode = normalizeText(query.item_code || query.itemCode);
  const createdBy = normalizeText(query.created_by || query.createdBy);
  const dateFrom = parseDateBoundary(query.date_from || query.dateFrom);
  const dateTo = parseDateBoundary(query.date_to || query.dateTo, true);

  match.archived = normalizeBooleanFilter(query.archived, false);

  if (search) {
    const escaped = escapeRegex(search);
    match.$or = SEARCH_FIELDS.map((field) => ({
      [field]: { $regex: escaped, $options: "i" },
    }));
  }

  if (brand && brand.toLowerCase() !== "all") {
    match.brand = { $regex: `^${escapeRegex(brand)}$`, $options: "i" };
  }
  if (vendor && vendor.toLowerCase() !== "all") {
    match.vendor = { $regex: `^${escapeRegex(vendor)}$`, $options: "i" };
  }
  if (category && category.toLowerCase() !== "all") {
    match.category = { $regex: `^${escapeRegex(category)}$`, $options: "i" };
  }
  if (itemCode && itemCode.toLowerCase() !== "all") {
    match.item_code = { $regex: `^${escapeRegex(itemCode)}$`, $options: "i" };
  }
  if (createdBy && mongoose.Types.ObjectId.isValid(createdBy)) {
    match["created_by.user"] = new mongoose.Types.ObjectId(createdBy);
  }
  if (dateFrom || dateTo) {
    match.created_at = {};
    if (dateFrom) match.created_at.$gte = dateFrom;
    if (dateTo) match.created_at.$lte = dateTo;
  }

  return match;
};

const serializeComplaintFile = async (file = {}) => {
  const key = normalizeText(file.key);
  const originalName = normalizeText(file.original_name || file.file_name);
  let url = normalizeText(file.url);

  if (key) {
    try {
      url = await getSignedObjectUrl(key, {
        expiresIn: 24 * 60 * 60,
        filename: originalName,
      });
    } catch (error) {
      console.error("Complain file signed URL generation failed:", {
        key,
        error: error?.message || String(error),
      });
    }
  }

  return {
    _id: String(file._id || ""),
    original_name: originalName,
    file_name: normalizeText(file.file_name),
    mime_type: normalizeText(file.mime_type),
    size: Number(file.size || 0),
    key,
    url,
    uploaded_by: file.uploaded_by || null,
    uploaded_at: file.uploaded_at || null,
  };
};

const getComplaintReadMetadata = (complaint = {}, user = null) => {
  const userId = getUserIdString(user);
  const receipts = Array.isArray(complaint.read_receipts) ? complaint.read_receipts : [];
  const receipt = receipts.find((entry) => getUserIdString(entry?.user) === userId);
  const readAt = receipt?.read_at || null;
  const readTime = readAt ? new Date(readAt).getTime() : 0;

  const unreadCount = userId
    ? (Array.isArray(complaint.comments) ? complaint.comments : []).filter((entry) => {
        const commentTime = entry?.created_at ? new Date(entry.created_at).getTime() : 0;
        const commentUserId = getUserIdString(entry?.created_by?.user);
        return commentTime > readTime && commentUserId !== userId;
      }).length
    : 0;

  return {
    read_at: readAt,
    unread_count: unreadCount,
    has_unread: unreadCount > 0,
  };
};

const serializeComplaint = async (complaint = {}, { user = null } = {}) => {
  const readMetadata = getComplaintReadMetadata(complaint, user);

  return {
    _id: String(complaint._id || ""),
    complaint_no: normalizeText(complaint.complaint_no),
    brand: normalizeText(complaint.brand),
    vendor: normalizeText(complaint.vendor),
    item_code: normalizeText(complaint.item_code),
    po: normalizeText(complaint.po),
    category: normalizeCategoryName(complaint.category),
    first_comment: normalizeText(complaint.first_comment),
    comments: Array.isArray(complaint.comments) ? complaint.comments : [],
    files: await Promise.all((Array.isArray(complaint.files) ? complaint.files : []).map(serializeComplaintFile)),
    created_by: complaint.created_by || null,
    updated_by: complaint.updated_by || null,
    update_history: Array.isArray(complaint.update_history) ? complaint.update_history : [],
    read_at: readMetadata.read_at,
    unread_count: readMetadata.unread_count,
    has_unread: readMetadata.has_unread,
    archived: complaint.archived === true,
    archived_at: complaint.archived_at || null,
    archived_by: complaint.archived_by || null,
    archived_reason: normalizeText(complaint.archived_reason),
    created_at: complaint.created_at || complaint.createdAt || null,
    updated_at: complaint.updated_at || complaint.updatedAt || null,
  };
};

const findItemScopedComplaint = async ({ complaintId, itemCode }) => {
  if (!isValidObjectId(complaintId)) return null;
  const normalizedItemCode = normalizeItemCodeKey(itemCode);
  if (!normalizedItemCode) return null;

  const complaint = await Complaint.findOne({
    _id: complaintId,
    archived: false,
    item_code: { $regex: `^${escapeRegex(itemCode)}$`, $options: "i" },
  });

  if (!complaint) return null;
  if (normalizeItemCodeKey(complaint.item_code) !== normalizedItemCode) return null;
  return complaint;
};

const markComplaintReadForUser = (complaint, user) => {
  const actor = buildActor(user);
  const userId = getUserIdString(actor.user);
  if (!userId) return;

  const readAt = new Date();
  const receipts = Array.isArray(complaint.read_receipts) ? complaint.read_receipts : [];
  const existing = receipts.find((entry) => getUserIdString(entry?.user) === userId);

  if (existing) {
    existing.name = actor.name;
    existing.read_at = readAt;
  } else {
    complaint.read_receipts.push({
      user: actor.user,
      name: actor.name,
      read_at: readAt,
    });
  }
};

const uploadComplaintFiles = async (files = [], actor) => {
  const safeFiles = Array.isArray(files) ? files : [];
  const uploadedAt = new Date();
  const uploadedFiles = [];

  for (const file of safeFiles) {
    const originalName = normalizeText(file?.originalname);
    const extension = path.extname(originalName).toLowerCase();
    const key = createStorageKey({
      folder: "complaints",
      originalName,
      extension,
    });
    const uploadResult = await uploadBuffer({
      buffer: file.buffer,
      key,
      originalName,
      contentType: file.mimetype || "application/octet-stream",
    });
    uploadedFiles.push({
      original_name: originalName,
      file_name: path.basename(uploadResult.key),
      mime_type: file.mimetype || "application/octet-stream",
      size: Number(file.size || uploadResult.size || 0),
      key: uploadResult.key,
      url: getObjectUrl(uploadResult.key),
      uploaded_by: actor,
      uploaded_at: uploadedAt,
    });
  }

  return uploadedFiles;
};

const createUpdateHistory = (action, actor, details = {}) => ({
  action,
  actor,
  timestamp: new Date(),
  details,
});

exports.getComplaints = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;
    const match = buildComplaintMatch(req.query || {});

    const [rows, total] = await Promise.all([
      Complaint.find(match)
        .sort({ created_at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Complaint.countDocuments(match),
    ]);

    return res.status(200).json({
      success: true,
      data: await Promise.all(rows.map((row) => serializeComplaint(row, { user: req.user }))),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("Get Complains Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch complains.",
    });
  }
};

exports.getComplaintCategories = async (_req, res) => {
  try {
    const categories = await ComplaintCategory.find({})
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: categories.map(serializeCategory),
    });
  } catch (error) {
    console.error("Get Complain Categories Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch complain categories.",
    });
  }
};

exports.createComplaintCategory = async (req, res) => {
  try {
    const name = normalizeCategoryName(req.body?.name || req.body?.category);
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
      });
    }

    const actor = buildActor(req.user);
    const category = await ensureComplaintCategory(name, actor);

    return res.status(201).json({
      success: true,
      message: "Complain category saved successfully.",
      data: serializeCategory(category.toObject ? category.toObject() : category),
    });
  } catch (error) {
    console.error("Create Complain Category Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to save complain category.",
    });
  }
};

exports.getItemRelatedComplaints = async (req, res) => {
  try {
    if (!ensureQcComplaintAccess(req, res)) return undefined;

    const itemCode = normalizeText(req.query?.item_code || req.query?.itemCode);
    if (!itemCode) {
      return res.status(400).json({
        success: false,
        message: "Item code is required.",
      });
    }

    const complaints = await Complaint.find({
      archived: false,
      item_code: { $regex: `^${escapeRegex(itemCode)}$`, $options: "i" },
    })
      .sort({ updated_at: -1, created_at: -1, _id: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: await Promise.all(
        complaints.map((complaint) => serializeComplaint(complaint, { user: req.user })),
      ),
    });
  } catch (error) {
    console.error("Get Item Related Complains Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch item complains.",
    });
  }
};

exports.createComplaint = async (req, res) => {
  try {
    const brand = normalizeText(req.body?.brand);
    const vendor = normalizeText(req.body?.vendor);
    const itemCode = normalizeText(req.body?.item_code || req.body?.itemCode);
    const po = normalizeText(req.body?.po);
    const category = normalizeCategoryName(req.body?.category);
    const firstComment = normalizeText(req.body?.first_comment || req.body?.firstComment);

    if (!brand || !vendor || !itemCode || !firstComment) {
      return res.status(400).json({
        success: false,
        message: "Brand, vendor, item code, and first comment are required.",
      });
    }

    const existingItem = await findExistingItemByCode(itemCode);
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: `Item code ${itemCode} does not exist. Please select an existing item before creating a complain.`,
      });
    }

    const actor = buildActor(req.user);
    const now = new Date();
    const uploadedFiles = await uploadComplaintFiles(req.files, actor);
    if (category) {
      await ensureComplaintCategory(category, actor);
    }
    const basePayload = {
      brand,
      vendor,
      item_code: normalizeText(existingItem.code || itemCode),
      po,
      category,
      first_comment: firstComment,
      comments: [
        {
          comment: firstComment,
          created_by: actor,
          created_at: now,
        },
      ],
      files: uploadedFiles,
      created_by: actor,
      updated_by: actor,
      update_history: [
        createUpdateHistory("create", actor, {
          file_count: uploadedFiles.length,
          item_id: String(existingItem._id || ""),
        }),
      ],
    };

    let complaint = null;
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        complaint = await Complaint.create({
          ...basePayload,
          complaint_no: createComplaintNo(),
        });
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== 11000) throw error;
      }
    }

    if (!complaint) {
      throw lastError || new Error("Failed to generate complain number");
    }

    return res.status(201).json({
      success: true,
      message: "Complain created successfully.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Create Complain Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create complain.",
    });
  }
};

exports.getComplaintById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complain id." });
    }
    const complaint = await Complaint.findById(req.params.id).lean();
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found." });
    }
    return res.status(200).json({
      success: true,
      data: await serializeComplaint(complaint, { user: req.user }),
    });
  } catch (error) {
    console.error("Get Complain Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch complain.",
    });
  }
};

exports.updateComplaint = async (req, res) => {
  try {
    if (!ensureAdminAccess(req, res, "Only admins can fully edit complains.")) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complain id." });
    }

    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found." });
    }

    const brand = normalizeText(req.body?.brand);
    const vendor = normalizeText(req.body?.vendor);
    const itemCode = normalizeText(req.body?.item_code || req.body?.itemCode);
    const po = normalizeText(req.body?.po);
    const category = normalizeCategoryName(req.body?.category);
    const firstComment = normalizeText(req.body?.first_comment || req.body?.firstComment);
    const hasCommentsPayload = Object.prototype.hasOwnProperty.call(req.body || {}, "comments_json");
    const incomingComments = hasCommentsPayload
      ? parseJsonArrayField(req.body?.comments_json, [])
      : [];

    if (!brand || !vendor || !itemCode || !firstComment) {
      return res.status(400).json({
        success: false,
        message: "Brand, vendor, item code, and first comment are required.",
      });
    }

    const finalComments = hasCommentsPayload
      ? incomingComments
        .map((entry) => ({
          _id: normalizeText(entry?._id),
          comment: normalizeText(entry?.comment),
        }))
        .filter((entry) => entry.comment)
      : [];
    if (hasCommentsPayload && finalComments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one complain comment is required.",
      });
    }
    if (hasCommentsPayload && finalComments[0].comment !== firstComment) {
      return res.status(400).json({
        success: false,
        message: "First comment must match the first complain comment.",
      });
    }

    const existingItem = await findExistingItemByCode(itemCode);
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: `Item code ${itemCode} does not exist. Please select an existing item before updating the complain.`,
      });
    }

    const actor = buildActor(req.user);
    const previous = {
      brand: complaint.brand,
      vendor: complaint.vendor,
      item_code: complaint.item_code,
      po: complaint.po,
      category: complaint.category,
      first_comment: complaint.first_comment,
    };
    const previousCommentIds = new Set(
      (Array.isArray(complaint.comments) ? complaint.comments : [])
        .map((comment) => getObjectIdString(comment))
        .filter(Boolean),
    );
    const uploadedFiles = await uploadComplaintFiles(req.files, actor);
    if (category) {
      await ensureComplaintCategory(category, actor);
    }

    complaint.brand = brand;
    complaint.vendor = vendor;
    complaint.item_code = normalizeText(existingItem.code || itemCode);
    complaint.po = po;
    complaint.category = category;
    complaint.first_comment = firstComment;
    if (!Array.isArray(complaint.comments)) {
      complaint.comments = [];
    }

    const existingCommentsById = new Map(
      complaint.comments
        .map((comment) => [getObjectIdString(comment), comment])
        .filter(([id]) => id),
    );
    if (hasCommentsPayload) {
      const nextComments = finalComments.map((entry) => {
        const existingComment = entry._id ? existingCommentsById.get(entry._id) : null;
        if (existingComment) {
          existingComment.comment = entry.comment;
          return existingComment;
        }
        return {
          comment: entry.comment,
          created_by: actor,
          created_at: new Date(),
        };
      });
      complaint.comments = nextComments;
    } else {
      if (complaint.comments.length === 0) {
        complaint.comments.push({
          comment: firstComment,
          created_by: actor,
          created_at: complaint.created_at || new Date(),
        });
      } else {
        complaint.comments[0].comment = firstComment;
      }
    }

    const replaceFiles = normalizeBooleanValue(req.body?.replace_files || req.body?.replaceFiles);
    const requestedRemoveFileIds = new Set(
      parseJsonArrayField(req.body?.remove_file_ids || req.body?.removeFileIds, [])
        .map((value) => normalizeText(value))
        .filter(Boolean),
    );
    const existingFiles = Array.isArray(complaint.files) ? complaint.files : [];
    const removedFiles = existingFiles.filter((file) =>
      replaceFiles || requestedRemoveFileIds.has(getObjectIdString(file)),
    );
    complaint.files = existingFiles.filter((file) =>
      !replaceFiles && !requestedRemoveFileIds.has(getObjectIdString(file)),
    );
    if (uploadedFiles.length > 0) {
      complaint.files.push(...uploadedFiles);
    }
    complaint.updated_by = actor;
    const nextCommentIds = new Set(
      (Array.isArray(complaint.comments) ? complaint.comments : [])
        .map((comment) => getObjectIdString(comment))
        .filter(Boolean),
    );
    let updatedCommentCount = 0;
    let addedCommentCount = 0;
    for (const comment of complaint.comments || []) {
      const id = getObjectIdString(comment);
      if (id && previousCommentIds.has(id)) {
        updatedCommentCount += 1;
      } else {
        addedCommentCount += 1;
      }
    }
    let deletedCommentCount = 0;
    for (const id of previousCommentIds) {
      if (!nextCommentIds.has(id)) deletedCommentCount += 1;
    }
    complaint.update_history.push(createUpdateHistory("admin_full_edit", actor, {
      previous,
      next: {
        brand: complaint.brand,
        vendor: complaint.vendor,
        item_code: complaint.item_code,
        po: complaint.po,
        category: complaint.category,
        first_comment: complaint.first_comment,
      },
      comments: {
        added: hasCommentsPayload ? addedCommentCount : 0,
        updated: hasCommentsPayload ? updatedCommentCount : 1,
        deleted: hasCommentsPayload ? deletedCommentCount : 0,
        total: Array.isArray(complaint.comments) ? complaint.comments.length : 0,
      },
      files: {
        replace_all: replaceFiles,
        uploaded_count: uploadedFiles.length,
        uploaded: uploadedFiles.map((file) => file.original_name),
        removed_count: removedFiles.length,
        removed: removedFiles.map((file) => ({
          id: getObjectIdString(file),
          name: file.original_name || file.file_name || "",
          key: file.key || "",
        })),
      },
    }));

    await complaint.save();
    for (const file of removedFiles) {
      if (!file?.key) continue;
      deleteObject(file.key).catch((deleteError) => {
        console.error("Complain file delete failed:", {
          complaint_id: getObjectIdString(complaint),
          key: file.key,
          error: deleteError?.message || deleteError,
        });
      });
    }
    return res.status(200).json({
      success: true,
      message: "Complain updated successfully.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Update Complain Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update complain.",
    });
  }
};

exports.addQcComplaintComment = async (req, res) => {
  try {
    if (!ensureQcComplaintAccess(req, res)) return undefined;

    const itemCode = normalizeText(req.body?.item_code || req.body?.itemCode || req.query?.item_code || req.query?.itemCode);
    const comment = normalizeText(req.body?.comment);

    if (!itemCode) {
      return res.status(400).json({ success: false, message: "Item code is required." });
    }
    if (!comment) {
      return res.status(400).json({ success: false, message: "Comment is required." });
    }

    const complaint = await findItemScopedComplaint({
      complaintId: req.params.id,
      itemCode,
    });
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found for this item." });
    }

    const actor = buildActor(req.user);
    complaint.comments.push({
      comment,
      created_by: actor,
      created_at: new Date(),
    });
    complaint.updated_by = actor;
    markComplaintReadForUser(complaint, req.user);
    complaint.update_history.push(createUpdateHistory("qc_comment_add", actor, {
      comment,
      item_code: itemCode,
    }));
    await complaint.save();

    return res.status(200).json({
      success: true,
      message: "Comment added successfully.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Add QC Complain Comment Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to add complain comment.",
    });
  }
};

exports.markComplaintRead = async (req, res) => {
  try {
    if (!ensureQcComplaintAccess(req, res)) return undefined;

    const itemCode = normalizeText(req.body?.item_code || req.body?.itemCode || req.query?.item_code || req.query?.itemCode);
    if (!itemCode) {
      return res.status(400).json({ success: false, message: "Item code is required." });
    }

    const complaint = await findItemScopedComplaint({
      complaintId: req.params.id,
      itemCode,
    });
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found for this item." });
    }

    markComplaintReadForUser(complaint, req.user);
    await complaint.save({ timestamps: false });

    return res.status(200).json({
      success: true,
      message: "Complain marked as read.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Mark Complain Read Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to mark complain as read.",
    });
  }
};

exports.addComplaintComment = async (req, res) => {
  try {
    if (!ensureManagerAccess(req, res)) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complain id." });
    }
    const comment = normalizeText(req.body?.comment);
    if (!comment) {
      return res.status(400).json({ success: false, message: "Comment is required." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found." });
    }
    const actor = buildActor(req.user);
    complaint.comments.push({
      comment,
      created_by: actor,
      created_at: new Date(),
    });
    complaint.updated_by = actor;
    complaint.update_history.push(createUpdateHistory("comment_add", actor, { comment }));
    await complaint.save();
    return res.status(200).json({
      success: true,
      message: "Comment added successfully.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Add Complain Comment Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to add complain comment.",
    });
  }
};

exports.addComplaintFiles = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complain id." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found." });
    }
    const actor = buildActor(req.user);
    const uploadedFiles = await uploadComplaintFiles(req.files, actor);
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one file." });
    }
    complaint.files.push(...uploadedFiles);
    complaint.updated_by = actor;
    complaint.update_history.push(createUpdateHistory("files_upload", actor, {
      file_count: uploadedFiles.length,
      files: uploadedFiles.map((file) => file.original_name),
    }));
    await complaint.save();
    return res.status(200).json({
      success: true,
      message: "Complain files uploaded successfully.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Upload Complain Files Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to upload complain files.",
    });
  }
};

exports.archiveComplaint = async (req, res) => {
  try {
    if (!ensureAdminAccess(req, res)) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complain id." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found." });
    }
    const actor = buildActor(req.user);
    const reason = normalizeText(req.body?.archived_reason || req.body?.reason);
    complaint.archived = true;
    complaint.archived_at = new Date();
    complaint.archived_by = actor;
    complaint.archived_reason = reason;
    complaint.updated_by = actor;
    complaint.update_history.push(createUpdateHistory("archive", actor, { reason }));
    await complaint.save();
    return res.status(200).json({
      success: true,
      message: "Complain archived successfully.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Archive Complain Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to archive complain.",
    });
  }
};

exports.unarchiveComplaint = async (req, res) => {
  try {
    if (!ensureAdminAccess(req, res)) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complain id." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complain not found." });
    }
    const actor = buildActor(req.user);
    complaint.archived = false;
    complaint.archived_at = null;
    complaint.archived_by = { user: null, name: "" };
    complaint.updated_by = actor;
    complaint.update_history.push(createUpdateHistory("unarchive", actor, {
      previous_reason: complaint.archived_reason,
    }));
    complaint.archived_reason = "";
    await complaint.save();
    return res.status(200).json({
      success: true,
      message: "Complain restored successfully.",
      data: await serializeComplaint(complaint.toObject(), { user: req.user }),
    });
  } catch (error) {
    console.error("Unarchive Complain Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to restore complain.",
    });
  }
};
