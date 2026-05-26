const path = require("path");
const mongoose = require("mongoose");

const {
  Complaint,
  COMPLAINT_STATUS_VALUES,
} = require("../models/complaint.model");
const {
  createStorageKey,
  getObjectUrl,
  uploadBuffer,
} = require("../services/wasabiStorage.service");
const {
  isManagerLikeRole,
  isSuperAdminLikeRole,
  normalizeUserRoleKey,
} = require("../helpers/userRole");

const STATUS_SET = new Set(COMPLAINT_STATUS_VALUES);
const SEARCH_FIELDS = [
  "complaint_no",
  "item_code",
  "brand",
  "vendor",
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
const normalizeStatus = (value = "") => {
  const normalized = normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
  return STATUS_SET.has(normalized) ? normalized : "";
};
const normalizeBooleanFilter = (value, fallback = false) => {
  const normalized = normalizeText(value).toLowerCase();
  if (["true", "1", "yes", "archived"].includes(normalized)) return true;
  if (["false", "0", "no", "active"].includes(normalized)) return false;
  return fallback;
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
    message: "Complaint action is restricted to admin and manager users.",
  });
  return false;
};

const ensureAdminAccess = (req, res) => {
  if (isAdminOnlyRole(req.user)) return true;
  res.status(403).json({
    success: false,
    message: "Complaint archive actions are admin-only.",
  });
  return false;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const createComplaintNo = () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `CMP-${datePart}-${suffix}`;
};

const buildComplaintMatch = (query = {}) => {
  const match = {};
  const search = normalizeText(query.search);
  const brand = normalizeText(query.brand);
  const vendor = normalizeText(query.vendor);
  const itemCode = normalizeText(query.item_code || query.itemCode);
  const status = normalizeStatus(query.status);
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
  if (itemCode && itemCode.toLowerCase() !== "all") {
    match.item_code = { $regex: `^${escapeRegex(itemCode)}$`, $options: "i" };
  }
  if (status) {
    match.status = status;
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

const serializeComplaint = (complaint = {}) => ({
  _id: String(complaint._id || ""),
  complaint_no: normalizeText(complaint.complaint_no),
  brand: normalizeText(complaint.brand),
  vendor: normalizeText(complaint.vendor),
  item_code: normalizeText(complaint.item_code),
  po: normalizeText(complaint.po),
  status: normalizeStatus(complaint.status) || "open",
  first_comment: normalizeText(complaint.first_comment),
  comments: Array.isArray(complaint.comments) ? complaint.comments : [],
  files: Array.isArray(complaint.files) ? complaint.files : [],
  created_by: complaint.created_by || null,
  updated_by: complaint.updated_by || null,
  status_history: Array.isArray(complaint.status_history) ? complaint.status_history : [],
  update_history: Array.isArray(complaint.update_history) ? complaint.update_history : [],
  archived: complaint.archived === true,
  archived_at: complaint.archived_at || null,
  archived_by: complaint.archived_by || null,
  archived_reason: normalizeText(complaint.archived_reason),
  created_at: complaint.created_at || complaint.createdAt || null,
  updated_at: complaint.updated_at || complaint.updatedAt || null,
});

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
      data: rows.map(serializeComplaint),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("Get Complaints Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch complaints.",
    });
  }
};

exports.createComplaint = async (req, res) => {
  try {
    const brand = normalizeText(req.body?.brand);
    const vendor = normalizeText(req.body?.vendor);
    const itemCode = normalizeText(req.body?.item_code || req.body?.itemCode);
    const po = normalizeText(req.body?.po);
    const firstComment = normalizeText(req.body?.first_comment || req.body?.firstComment);

    if (!brand || !vendor || !itemCode || !firstComment) {
      return res.status(400).json({
        success: false,
        message: "Brand, vendor, item code, and first comment are required.",
      });
    }

    const actor = buildActor(req.user);
    const now = new Date();
    const uploadedFiles = await uploadComplaintFiles(req.files, actor);
    const basePayload = {
      brand,
      vendor,
      item_code: itemCode,
      po,
      status: "open",
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
      throw lastError || new Error("Failed to generate complaint number");
    }

    return res.status(201).json({
      success: true,
      message: "Complaint created successfully.",
      data: serializeComplaint(complaint.toObject()),
    });
  } catch (error) {
    console.error("Create Complaint Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create complaint.",
    });
  }
};

exports.getComplaintById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint id." });
    }
    const complaint = await Complaint.findById(req.params.id).lean();
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found." });
    }
    return res.status(200).json({
      success: true,
      data: serializeComplaint(complaint),
    });
  } catch (error) {
    console.error("Get Complaint Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch complaint.",
    });
  }
};

exports.updateComplaintStatus = async (req, res) => {
  try {
    if (!ensureManagerAccess(req, res)) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint id." });
    }
    const nextStatus = normalizeStatus(req.body?.status);
    const comment = normalizeText(req.body?.comment);
    if (!nextStatus) {
      return res.status(400).json({ success: false, message: "Invalid complaint status." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found." });
    }

    const actor = buildActor(req.user);
    const previousStatus = normalizeStatus(complaint.status) || "open";
    complaint.status = nextStatus;
    complaint.updated_by = actor;
    complaint.status_history.push({
      previous_status: previousStatus,
      next_status: nextStatus,
      changed_by: actor,
      changed_at: new Date(),
      comment,
    });
    if (comment) {
      complaint.comments.push({
        comment,
        created_by: actor,
        created_at: new Date(),
      });
    }
    complaint.update_history.push(createUpdateHistory("status_update", actor, {
      previous_status: previousStatus,
      next_status: nextStatus,
      comment,
    }));

    await complaint.save();
    return res.status(200).json({
      success: true,
      message: "Complaint status updated successfully.",
      data: serializeComplaint(complaint.toObject()),
    });
  } catch (error) {
    console.error("Update Complaint Status Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update complaint status.",
    });
  }
};

exports.addComplaintComment = async (req, res) => {
  try {
    if (!ensureManagerAccess(req, res)) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint id." });
    }
    const comment = normalizeText(req.body?.comment);
    if (!comment) {
      return res.status(400).json({ success: false, message: "Comment is required." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found." });
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
      data: serializeComplaint(complaint.toObject()),
    });
  } catch (error) {
    console.error("Add Complaint Comment Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to add complaint comment.",
    });
  }
};

exports.addComplaintFiles = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint id." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found." });
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
      message: "Complaint files uploaded successfully.",
      data: serializeComplaint(complaint.toObject()),
    });
  } catch (error) {
    console.error("Upload Complaint Files Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to upload complaint files.",
    });
  }
};

exports.archiveComplaint = async (req, res) => {
  try {
    if (!ensureAdminAccess(req, res)) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint id." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found." });
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
      message: "Complaint archived successfully.",
      data: serializeComplaint(complaint.toObject()),
    });
  } catch (error) {
    console.error("Archive Complaint Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to archive complaint.",
    });
  }
};

exports.unarchiveComplaint = async (req, res) => {
  try {
    if (!ensureAdminAccess(req, res)) return undefined;
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid complaint id." });
    }
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ success: false, message: "Complaint not found." });
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
      message: "Complaint restored successfully.",
      data: serializeComplaint(complaint.toObject()),
    });
  } catch (error) {
    console.error("Unarchive Complaint Error:", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to restore complaint.",
    });
  }
};
