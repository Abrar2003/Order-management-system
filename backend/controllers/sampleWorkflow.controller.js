const mongoose = require("mongoose");
const SampleWorkflow = require("../models/sampleWorkflow.model");
const User = require("../models/user.model");
const { TaskType, Department } = require("../models/workflow");
const { createWorkflowTask } = require("../services/workflow/workflowStatusService");
const { BOX_PACKAGING_MODES, BOX_ENTRY_TYPES } = require("../helpers/boxMeasurement");
const { normalizeUserRoleKey } = require("../helpers/userRole");
const { calculateTotalPoCbm } = require("../services/orderCbm.service");
const { applyDataAccessMatch } = require("../services/userDataAccess.service");

const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze(["item", "top", "base", "item1", "item2", "item3", "item4"]);
const BOX_SIZE_REMARK_OPTIONS = Object.freeze(["top", "base", "box", "box1", "box2", "box3"]);
const SAMPLE_MUTATION_ROLES = new Set([
  "admin",
  "super_admin",
  "inspection_manager",
  "product_manager",
]);

const escapeRegex = (value = "") =>
  String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonNegativeNumber = (value, fieldLabel) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} must be a non-negative number`);
  }
  return parsed;
};

const isPositiveNumericInput = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0;
};

const normalizeFilterValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (["all", "null", "undefined"].includes(lowered)) return null;
  return normalized;
};

const parseDate = (value, label = "date") => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed;
};

const parseDateBoundary = (value, endOfDay = false) => {
  const parsed = parseDate(value, "date");
  if (!parsed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value))) {
    parsed.setUTCHours(
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
  }
  return parsed;
};

const parseJsonBodyField = (value, label, fallback = []) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
};

const normalizeDistinctValues = (values = []) =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));

const buildAuditActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name: normalizeText(user?.name || user?.email || user?.role || ""),
});

const canMutateSamples = (user = {}) =>
  SAMPLE_MUTATION_ROLES.has(normalizeUserRoleKey(user?.role));

const ensureSampleMutationAccess = (req, res) => {
  if (canMutateSamples(req.user)) return true;
  res.status(403).json({
    success: false,
    message: "Sample Workflow updates are restricted to admin, super admin, inspection manager, and product manager users.",
  });
  return false;
};

const isBadRequestError = (error) => {
  const normalized = normalizeLower(error?.message);
  return ["required", "must be", "invalid", "already exists", "not found", "unsupported"].some((part) =>
    normalized.includes(part),
  );
};

const validateRemarkOption = (remark = "", options = [], fieldLabel = "Remark") => {
  if (!remark) return;
  if (!options.includes(remark)) {
    throw new Error(`${fieldLabel} must be one of: ${options.join(", ")}`);
  }
};

const normalizeVendorList = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))];
  }
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(",").map((entry) => normalizeText(entry)).filter(Boolean))];
};

const isBlankItemSizeEntry = (entry = {}) =>
  !isPositiveNumericInput(entry?.L) &&
  !isPositiveNumericInput(entry?.B) &&
  !isPositiveNumericInput(entry?.H) &&
  !isPositiveNumericInput(entry?.net_weight) &&
  !isPositiveNumericInput(entry?.gross_weight) &&
  !isPositiveNumericInput(entry?.weight) &&
  !normalizeText(entry?.remark);

const isBlankBoxSizeEntry = (entry = {}, boxMode = BOX_PACKAGING_MODES.INDIVIDUAL) =>
  !isPositiveNumericInput(entry?.L) &&
  !isPositiveNumericInput(entry?.B) &&
  !isPositiveNumericInput(entry?.H) &&
  !isPositiveNumericInput(entry?.net_weight) &&
  !isPositiveNumericInput(entry?.gross_weight) &&
  !isPositiveNumericInput(entry?.weight) &&
  (
    boxMode === BOX_PACKAGING_MODES.CARTON ||
    boxMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
      ? true
      : !normalizeText(entry?.remark)
  ) &&
  !isPositiveNumericInput(entry?.item_count_in_inner) &&
  !isPositiveNumericInput(entry?.box_count_in_master);

const normalizeItemSizeEntries = (entries = []) => {
  if (!Array.isArray(entries)) throw new Error("item_sizes must be an array");
  const normalizedEntries = entries.filter((entry) => !isBlankItemSizeEntry(entry));
  if (normalizedEntries.length > SIZE_ENTRY_LIMIT) {
    throw new Error(`item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`);
  }
  const seenRemarks = new Set();
  return normalizedEntries.map((entry, index) => {
    const label = `item_sizes[${index + 1}]`;
    const L = toNonNegativeNumber(entry?.L ?? 0, `${label}.L`);
    const B = toNonNegativeNumber(entry?.B ?? 0, `${label}.B`);
    const H = toNonNegativeNumber(entry?.H ?? 0, `${label}.H`);
    const netWeight = toNonNegativeNumber(entry?.net_weight ?? entry?.weight ?? 0, `${label}.net_weight`);
    const grossWeight = toNonNegativeNumber(entry?.gross_weight ?? 0, `${label}.gross_weight`);
    const remark = normalizeLower(entry?.remark) || (normalizedEntries.length === 1 ? "item" : "");
    if ((L > 0 || B > 0 || H > 0) && (!L || !B || !H)) {
      throw new Error(`${label} must include positive L, B, and H values`);
    }
    if (normalizedEntries.length > 1 && !remark) {
      throw new Error(`${label}.remark is required`);
    }
    validateRemarkOption(remark, ITEM_SIZE_REMARK_OPTIONS, `${label}.remark`);
    if (remark && seenRemarks.has(remark)) throw new Error("item_sizes remarks must be unique");
    if (remark) seenRemarks.add(remark);
    return { L, B, H, remark, net_weight: netWeight, gross_weight: grossWeight };
  });
};

const normalizeBoxSizeEntries = (entries = [], boxMode = BOX_PACKAGING_MODES.INDIVIDUAL) => {
  if (!Array.isArray(entries)) throw new Error("box_sizes must be an array");
  const normalizedEntries = entries.filter((entry) => !isBlankBoxSizeEntry(entry, boxMode));
  const entryLimit =
    boxMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : boxMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
        ? 1
        : SIZE_ENTRY_LIMIT;
  if (normalizedEntries.length > entryLimit) {
    throw new Error(`box_sizes cannot exceed ${entryLimit} entries`);
  }
  const seenRemarks = new Set();
  return normalizedEntries.map((entry, index) => {
    const label = `box_sizes[${index + 1}]`;
    const L = toNonNegativeNumber(entry?.L ?? 0, `${label}.L`);
    const B = toNonNegativeNumber(entry?.B ?? 0, `${label}.B`);
    const H = toNonNegativeNumber(entry?.H ?? 0, `${label}.H`);
    const netWeight = toNonNegativeNumber(entry?.net_weight ?? 0, `${label}.net_weight`);
    const grossWeight = toNonNegativeNumber(entry?.gross_weight ?? entry?.weight ?? 0, `${label}.gross_weight`);
    if ((L > 0 || B > 0 || H > 0) && (!L || !B || !H)) {
      throw new Error(`${label} must include positive L, B, and H values`);
    }

    if (boxMode === BOX_PACKAGING_MODES.CARTON) {
      const isInner = index === 0;
      return {
        L,
        B,
        H,
        remark: isInner ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
        net_weight: netWeight,
        gross_weight: grossWeight,
        box_type: isInner ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
        item_count_in_inner: isInner
          ? toNonNegativeNumber(entry?.item_count_in_inner ?? 0, `${label}.item_count_in_inner`)
          : 0,
        box_count_in_master: isInner
          ? 0
          : toNonNegativeNumber(entry?.box_count_in_master ?? 0, `${label}.box_count_in_master`),
      };
    }

    if (boxMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER) {
      const piecesInMaster = toNonNegativeNumber(
        entry?.box_count_in_master ?? 0,
        `${label}.box_count_in_master`,
      );
      if (piecesInMaster <= 0) {
        throw new Error(`${label}.box_count_in_master must be greater than 0`);
      }
      return {
        L,
        B,
        H,
        remark: BOX_ENTRY_TYPES.MASTER,
        net_weight: netWeight,
        gross_weight: grossWeight,
        box_type: BOX_ENTRY_TYPES.MASTER,
        item_count_in_inner: 0,
        box_count_in_master: piecesInMaster,
      };
    }

    const remark = normalizeLower(entry?.remark) || (normalizedEntries.length === 1 ? "box" : "");
    if (normalizedEntries.length > 1 && !remark) {
      throw new Error(`${label}.remark is required`);
    }
    validateRemarkOption(remark, BOX_SIZE_REMARK_OPTIONS, `${label}.remark`);
    if (remark && seenRemarks.has(remark)) throw new Error("box_sizes remarks must be unique");
    if (remark) seenRemarks.add(remark);
    return {
      L,
      B,
      H,
      remark,
      net_weight: netWeight,
      gross_weight: grossWeight,
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      item_count_in_inner: 0,
      box_count_in_master: 0,
    };
  });
};

const serializeSampleWorkflow = (sample = {}) => {
  const plain = typeof sample.toObject === "function" ? sample.toObject() : sample;
  return {
    ...plain,
    _id: String(plain?._id || ""),
    vendors: normalizeDistinctValues(plain?.vendor),
    vendor_summary: {
      vendors: normalizeDistinctValues(plain?.vendor),
    },
  };
};

const buildSampleWorkflowMatch = (query = {}) => {
  const match = {};
  const search = normalizeFilterValue(query.search);
  const brand = normalizeFilterValue(query.brand);
  const vendor = normalizeFilterValue(query.vendor);
  const dateFrom = parseDateBoundary(query.date_from || query.dateFrom);
  const dateTo = parseDateBoundary(query.date_to || query.dateTo, true);

  if (brand) match.brand = { $regex: `^${escapeRegex(brand)}$`, $options: "i" };
  if (vendor) {
    match.vendor = { $elemMatch: { $regex: escapeRegex(vendor), $options: "i" } };
  }
  if (dateFrom || dateTo) {
    match.updatedAt = {};
    if (dateFrom) match.updatedAt.$gte = dateFrom;
    if (dateTo) match.updatedAt.$lte = dateTo;
  }
  if (search) {
    const escaped = escapeRegex(search);
    const searchOr = [
      { code: { $regex: escaped, $options: "i" } },
      { name: { $regex: escaped, $options: "i" } },
      { description: { $regex: escaped, $options: "i" } },
      { brand: { $regex: escaped, $options: "i" } },
      { vendor: { $elemMatch: { $regex: escaped, $options: "i" } } },
    ];
    if (match.$or) {
      match.$and = [{ $or: match.$or }, { $or: searchOr }];
      delete match.$or;
    } else {
      match.$or = searchOr;
    }
  }
  return match;
};

const calculateDueDate = (creationDate = new Date()) => {
  const due = new Date(creationDate);
  due.setDate(due.getDate() + 2);
  let hasSunday = false;
  for (let i = 0; i <= 2; i++) {
    const checkDate = new Date(creationDate);
    checkDate.setDate(checkDate.getDate() + i);
    if (checkDate.getDay() === 0) { // 0 is Sunday
      hasSunday = true;
      break;
    }
  }
  if (hasSunday) {
    due.setDate(due.getDate() + 1);
  }
  return due;
};

exports.getSampleWorkflows = async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(200, parsePositiveInt(req.query.limit, 20));
    const skip = (page - 1) * limit;
    const baseMatch = buildSampleWorkflowMatch(req.query);
    const accessOptions = { vendorFields: ["vendor"] };
    const match = applyDataAccessMatch(baseMatch, req.user, accessOptions);
    const [workflows, totalRecords, brandsRaw, vendorsRaw] = await Promise.all([
      SampleWorkflow.find(match).sort({ updatedAt: -1, code: 1 }).skip(skip).limit(limit).lean(),
      SampleWorkflow.countDocuments(match),
      SampleWorkflow.distinct("brand", applyDataAccessMatch(buildSampleWorkflowMatch({ ...req.query, brand: "" }), req.user, accessOptions)),
      SampleWorkflow.distinct("vendor", applyDataAccessMatch(buildSampleWorkflowMatch({ ...req.query, vendor: "" }), req.user, accessOptions)),
    ]);

    return res.status(200).json({
      success: true,
      data: workflows.map(serializeSampleWorkflow),
      pagination: {
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
        totalRecords,
      },
      filters: {
        brands: normalizeDistinctValues(brandsRaw),
        vendors: normalizeDistinctValues(vendorsRaw),
      },
    });
  } catch (error) {
    console.error("Get Sample Workflows Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sample workflows",
      error: error.message,
    });
  }
};

exports.createSampleWorkflow = async (req, res) => {
  try {
    if (!ensureSampleMutationAccess(req, res)) return;
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const actorAudit = buildAuditActor(req.user);
    const code = normalizeText(payload.code).toUpperCase();
    if (!code) return res.status(400).json({ success: false, message: "code is required" });
    if (!normalizeText(payload.name) && !normalizeText(payload.description)) {
      return res.status(400).json({ success: false, message: "name or description is required" });
    }
    if (!normalizeText(payload.brand)) {
      return res.status(400).json({ success: false, message: "brand is required" });
    }

    const existingWorkflow = await SampleWorkflow.findOne({
      code: { $regex: `^${escapeRegex(code)}$`, $options: "i" },
    }).select("_id code");
    if (existingWorkflow) {
      return res.status(400).json({
        success: false,
        message: `Sample Workflow code ${existingWorkflow.code || code} already exists`,
      });
    }

    const boxMode = Object.values(BOX_PACKAGING_MODES).includes(payload.box_mode)
      ? payload.box_mode
      : BOX_PACKAGING_MODES.INDIVIDUAL;
    const sampleWorkflow = new SampleWorkflow({
      code,
      name: normalizeText(payload.name),
      description: normalizeText(payload.description),
      brand: normalizeText(payload.brand),
      vendor: normalizeVendorList(payload.vendor),
      item_sizes: normalizeItemSizeEntries(parseJsonBodyField(payload.item_sizes, "item_sizes")),
      box_sizes: normalizeBoxSizeEntries(parseJsonBodyField(payload.box_sizes, "box_sizes"), boxMode),
      box_mode: boxMode,
      cbm: Math.max(0, toSafeNumber(payload.cbm, 0)),
      updated_by: actorAudit,
    });

    await sampleWorkflow.save();

    // Trigger Chain of Commands - Create workflow task for Anzar assigned by Gaurav
    let task = null;
    try {
      const gaurav = await User.findOne({ username: { $regex: /^Gaurav$/i } });
      const anzar = await User.findOne({ username: { $regex: /^Anzar$/i } });

      if (!gaurav) {
        console.warn("Auto task creation failed: User 'Gaurav' not found");
      } else if (!anzar) {
        console.warn("Auto task creation failed: User 'Anzar' not found");
      } else {
        const taskType = await TaskType.findOne({ key: "cad_files" });
        const department = await Department.findOne({ key: "autocad" });

        if (!taskType) {
          console.warn("Auto task creation failed: Task type 'cad_files' not found");
        } else if (!department) {
          console.warn("Auto task creation failed: Department 'autocad' not found");
        } else {
          const due = calculateDueDate(new Date());
          const year = due.getFullYear();
          const month = String(due.getMonth() + 1).padStart(2, "0");
          const day = String(due.getDate()).padStart(2, "0");
          const dueDateString = `${year}-${month}-${day}`;

          const taskPayload = {
            title: code, // Take sample code as title
            task_type_key: "cad_files",
            assignee_ids: [anzar._id.toString()],
            upload_required: false,
            department: department._id.toString(),
            due_date: dueDateString,
            brand: sampleWorkflow.brand || "Sample Brand",
            description: sampleWorkflow.description || `Auto task for Sample Workflow ${code}`,
            priority: "normal",
            creation_note: `Automatically triggered from creation of Sample Workflow: ${code}`,
          };

          const actorObj = {
            _id: gaurav._id,
            name: gaurav.name,
            email: gaurav.email,
            role: gaurav.role,
          };

          task = await createWorkflowTask({
            payload: taskPayload,
            actor: actorObj,
            realtimeSource: req,
          });
        }
      }
    } catch (taskError) {
      console.error("Failed to automatically trigger workflow task creation:", taskError);
      // We do not roll back sampleWorkflow.save() as the sample workflow itself is created successfully.
    }

    return res.status(201).json({
      success: true,
      message: "Sample Workflow created successfully",
      data: serializeSampleWorkflow(sampleWorkflow),
      triggered_task: task ? { _id: task._id, task_no: task.task_no } : null,
    });
  } catch (error) {
    return res.status(isBadRequestError(error) ? 400 : 500).json({
      success: false,
      message: error?.message || "Failed to create sample workflow",
      error: error.message,
    });
  }
};
