const mongoose = require("mongoose");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");

const INDIA_COUNTRY_MATCH = /^india$/i;
const APPROVAL_FILE_TYPES = Object.freeze(["cad_file", "assembly_file", "mounting_file"]);
const CONFIGURABLE_TASK_KEYS = Object.freeze([
  "cad_upload",
  "assembly_upload",
  "mounting_upload",
  "shipping_marks_upload",
  "shipping_marks_updated",
  "inspection_approval",
  "product_database_creation",
  "packaging_ppt_upload",
]);
const QC_APPROVAL_TASKS = Object.freeze([
  { key: "cad_approval", label: "AutoCAD Approval", file_type: "cad_file" },
  { key: "assembly_approval", label: "Assembly Approval", file_type: "assembly_file" },
  { key: "mounting_approval", label: "Mounting File Approval", file_type: "mounting_file" },
]);
const TASK_CATALOG = Object.freeze([
  { key: "cad_upload", label: "AutoCAD Upload", configurable: true },
  { key: "assembly_upload", label: "Assembly Upload", configurable: true },
  { key: "mounting_upload", label: "Mounting Upload", configurable: true },
  { key: "shipping_marks_upload", label: "Shipping Marks Upload", configurable: true },
  { key: "shipping_marks_updated", label: "Shipping Marks Updated", configurable: true },
  { key: "inspection_approval", label: "Inspection Approval", configurable: true },
  { key: "product_database_creation", label: "Product Database Creation", configurable: true },
  { key: "packaging_ppt_upload", label: "Packaging PPT Upload", configurable: true },
  ...QC_APPROVAL_TASKS.map((task) => ({ ...task, configurable: false, qc_shared: true })),
]);

const ACTIVE_ORDER_MATCH = Object.freeze({ archived: { $ne: true }, status: { $ne: "Cancelled" } });
const text = (value) => String(value ?? "").trim();
const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasStoredFile = (file = {}) => Boolean(text(file?.key || file?.public_id || file?.link || file?.url));
const getStoredFileKey = (file = {}) => text(file?.key || file?.public_id || file?.link || file?.url);
const isIndianItem = (item = {}) => INDIA_COUNTRY_MATCH.test(text(item?.country_of_origin));

const isFileApprovalEligible = (item = {}, fileType = "") => {
  if (!APPROVAL_FILE_TYPES.includes(fileType) || !isIndianItem(item)) return false;
  if (fileType === "assembly_file" && item?.kd !== true) return false;
  if (fileType === "mounting_file" && item?.mounting_file_needed !== true) return false;
  return hasStoredFile(item?.[fileType]);
};

const isFileApprovalPending = (item = {}, fileType = "") => {
  if (!isFileApprovalEligible(item, fileType)) return false;
  const currentKey = getStoredFileKey(item?.[fileType]);
  const approvedKey = text(item?.file_approvals?.[fileType]?.file_key);
  return !approvedKey || approvedKey !== currentKey;
};

const hasPrimaryShippingMark = (item = {}) =>
  [
    ...(Array.isArray(item?.shipping_marks?.files) ? item.shipping_marks.files : []),
    item?.shipping_marks?.shipping_marks_1,
    item?.shipping_marks?.shipping_marks_2,
  ].some((file) => hasStoredFile(file));

const isProductDatabaseNotCreated = (item = {}) => {
  const status = text(item?.pd_checked).toLowerCase();
  return !status || ["not set", "not_set", "not created", "not_created"].includes(status);
};

const createTaskMetrics = () => Object.fromEntries(
  TASK_CATALOG.map((task) => [task.key, { total: 0, pending: 0 }]),
);

const addTaskMetric = (target, key, metric = {}) => {
  target[key].total += Number(metric.total || 0);
  target[key].pending += Number(metric.pending || 0);
};

const getCountryLabel = (item = {}) => text(item.country_of_origin) || "Unspecified";

const countItemTaskMetrics = (items = []) => {
  const metrics = createTaskMetrics();
  for (const item of items) {
    metrics.cad_upload.total += 1;
    metrics.shipping_marks_upload.total += 1;
    metrics.packaging_ppt_upload.total += 1;
    metrics.product_database_creation.total += 1;
    if (!hasStoredFile(item?.cad_file)) metrics.cad_upload.pending += 1;
    if (!hasPrimaryShippingMark(item)) metrics.shipping_marks_upload.pending += 1;
    if (!hasStoredFile(item?.packeging_ppt)) metrics.packaging_ppt_upload.pending += 1;
    if (isProductDatabaseNotCreated(item)) metrics.product_database_creation.pending += 1;
    if (item?.kd === true) {
      metrics.assembly_upload.total += 1;
      if (!hasStoredFile(item?.assembly_file)) metrics.assembly_upload.pending += 1;
    }
    if (item?.mounting_file_needed === true) {
      metrics.mounting_upload.total += 1;
      if (!hasStoredFile(item?.mounting_file)) metrics.mounting_upload.pending += 1;
    }
    for (const task of QC_APPROVAL_TASKS) {
      if (!isFileApprovalEligible(item, task.file_type)) continue;
      metrics[task.key].total += 1;
      if (isFileApprovalPending(item, task.file_type)) metrics[task.key].pending += 1;
    }
  }
  return metrics;
};

const countItemTasks = (items = []) => Object.fromEntries(
  Object.entries(countItemTaskMetrics(items)).map(([key, metric]) => [key, metric.pending]),
);

const getTaskMetrics = async () => {
  const [items, activeOrderIds] = await Promise.all([
    Item.find({})
      .select("code country_of_origin kd mounting_file_needed cad_file assembly_file mounting_file packeging_ppt shipping_marks pd_checked file_approvals")
      .lean(),
    Order.distinct("_id", ACTIVE_ORDER_MATCH),
  ]);
  const metrics = countItemTaskMetrics(items);
  if (activeOrderIds.length === 0) return metrics;

  const activeQcs = await QC.find({ order: { $in: activeOrderIds } })
    .select("item.item_code shipping_mark_updated")
    .lean();
  const activeQcIds = activeQcs.map((qc) => qc._id);
  const shippingMarkItemCodes = new Set(items.filter(hasPrimaryShippingMark).map((item) => item.code));
  const shippingMarkQcs = activeQcs.filter((qc) => shippingMarkItemCodes.has(qc.item?.item_code));
  metrics.shipping_marks_updated.total = shippingMarkQcs.length;
  metrics.shipping_marks_updated.pending = shippingMarkQcs.filter((qc) => qc.shipping_mark_updated !== true).length;
  if (activeQcIds.length) {
    const inspectionMatch = { qc: { $in: activeQcIds }, status: "Inspection Done" };
    const [total, pending] = await Promise.all([
      Inspection.countDocuments(inspectionMatch),
      Inspection.countDocuments({
        qc: { $in: activeQcIds },
        status: "Inspection Done",
        is_approved: { $ne: true },
      }),
    ]);
    metrics.inspection_approval.total = total;
    metrics.inspection_approval.pending = pending;
  }
  return metrics;
};

const getTaskMetricsByCountry = async () => {
  const [items, activeOrderIds] = await Promise.all([
    Item.find({})
      .select("code country_of_origin kd mounting_file_needed cad_file assembly_file mounting_file packeging_ppt shipping_marks pd_checked file_approvals")
      .lean(),
    Order.distinct("_id", ACTIVE_ORDER_MATCH),
  ]);
  const metricsByCountry = new Map();
  const getMetrics = (country) => {
    if (!metricsByCountry.has(country)) metricsByCountry.set(country, createTaskMetrics());
    return metricsByCountry.get(country);
  };

  for (const item of items) {
    const countryMetrics = getMetrics(getCountryLabel(item));
    const itemMetrics = countItemTaskMetrics([item]);
    for (const [key, metric] of Object.entries(itemMetrics)) addTaskMetric(countryMetrics, key, metric);
  }
  if (!activeOrderIds.length) return Object.fromEntries(metricsByCountry);

  const activeQcs = await QC.find({ order: { $in: activeOrderIds } })
    .select("_id item.item_code shipping_mark_updated")
    .lean();
  const itemCountryByCode = new Map(items.map((item) => [item.code, getCountryLabel(item)]));
  const shippingMarkItemCodes = new Set(items.filter(hasPrimaryShippingMark).map((item) => item.code));
  const qcCountryById = new Map();
  for (const qc of activeQcs) {
    const country = itemCountryByCode.get(qc.item?.item_code) || "Unspecified";
    qcCountryById.set(String(qc._id), country);
    if (!shippingMarkItemCodes.has(qc.item?.item_code)) continue;
    const metric = getMetrics(country).shipping_marks_updated;
    metric.total += 1;
    if (qc.shipping_mark_updated !== true) metric.pending += 1;
  }
  if (!activeQcs.length) return Object.fromEntries(metricsByCountry);

  const inspections = await Inspection.find({
    qc: { $in: activeQcs.map((qc) => qc._id) },
    status: "Inspection Done",
  }).select("qc is_approved").lean();
  for (const inspection of inspections) {
    const metric = getMetrics(qcCountryById.get(String(inspection.qc)) || "Unspecified").inspection_approval;
    metric.total += 1;
    if (inspection.is_approved !== true) metric.pending += 1;
  }
  return Object.fromEntries(metricsByCountry);
};

const getTaskCounts = async () => Object.fromEntries(
  Object.entries(await getTaskMetrics()).map(([key, metric]) => [key, metric.pending]),
);

const getPendingFileApprovalItems = async ({ fileType, search = "", page = 1, limit = 20 } = {}) => {
  if (!APPROVAL_FILE_TYPES.includes(fileType)) {
    const error = new Error("Invalid approval file type");
    error.statusCode = 400;
    throw error;
  }
  const fileMatch = fileType === "cad_file"
    ? {}
    : fileType === "assembly_file"
      ? { kd: true }
      : { mounting_file_needed: true };
  const normalizedSearch = text(search);
  const searchMatch = normalizedSearch
    ? { $or: ["code", "name", "description"].map((field) => ({ [field]: { $regex: escapeRegex(normalizedSearch), $options: "i" } })) }
    : {};
  const items = await Item.find({ country_of_origin: INDIA_COUNTRY_MATCH, ...fileMatch, ...searchMatch })
    .select(`code name description brand brand_name country_of_origin cbm kd mounting_file_needed ${fileType} file_approvals`)
    .sort({ code: 1 })
    .lean();
  const pending = items.filter((item) => isFileApprovalPending(item, fileType));
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safePage = Math.max(1, Number(page) || 1);
  const start = (safePage - 1) * safeLimit;
  return {
    data: pending.slice(start, start + safeLimit),
    pagination: {
      page: safePage,
      limit: safeLimit,
      totalRecords: pending.length,
      totalPages: Math.max(1, Math.ceil(pending.length / safeLimit)),
    },
  };
};

const ensureObjectIdList = (values = []) => {
  const ids = Array.isArray(values) ? values : [];
  const normalized = [...new Set(ids.map((value) => text(value)).filter(Boolean))];
  if (normalized.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    const error = new Error("Invalid employee selected");
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

module.exports = {
  APPROVAL_FILE_TYPES,
  ACTIVE_ORDER_MATCH,
  CONFIGURABLE_TASK_KEYS,
  QC_APPROVAL_TASKS,
  TASK_CATALOG,
  countItemTaskMetrics,
  countItemTasks,
  ensureObjectIdList,
  getPendingFileApprovalItems,
  getStoredFileKey,
  getTaskCounts,
  getTaskMetricsByCountry,
  getTaskMetrics,
  hasPrimaryShippingMark,
  hasStoredFile,
  isFileApprovalEligible,
  isFileApprovalPending,
  isProductDatabaseNotCreated,
};
