const mongoose = require("mongoose");
const Item = require("../models/item.model");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const PisUpdateLog = require("../models/pisUpdateLog.model");
const { applyDataAccessMatch } = require("./userDataAccess.service");
const { buildItemMatch, applyItemDataAccess, escapeRegex } = require("../helpers/itemQuery");
const { parseSizeEntriesPayload, ITEM_SIZE_REMARK_OPTIONS } = require("../helpers/sizeEntryPayload");
const { BOX_PACKAGING_MODES, BOX_SIZE_REMARK_OPTIONS, buildBoxMeasurementCbmSummary } = require("../helpers/boxMeasurement");
const { normalizeSingleMasterSizeRemarks } = require("../helpers/masterSizeRemarks");
const { normalizeVendorDisplayList } = require("../helpers/vendorRef");
const { buildItemUpdateAuditSnapshot, buildItemUpdateLogPayload } = require("../helpers/itemUpdateAudit");
const { appendItemUpdateHistory } = require("../helpers/itemUpdateHistory");
const {
  CYCLE_VERSION, MASTER_FIELDS, PD_FIELDS, key, text, clone, getWorkflow,
  masterSnapshot, buildEvidence, sourceValues, compareSizes, buildPdComparison, isSuperAdmin,
  assertAction, transition, failure,
} = require("../helpers/masterWorkflow");

const WORKFLOW_SELECT = ["code", "name", "description", "brand", "brand_name", "brands", "vendors", "country_of_origin", "image", "master_workflow", "pd_measurement_revision", "pis_item_sizes", "pis_box_sizes", "pis_box_mode", "pis_master_barcode", "pis_barcode", "pis_inner_barcode", "pis_update_comments", "cbm.calculated_master_total", "updatedAt", ...MASTER_FIELDS, ...PD_FIELDS].join(" ");
const VIEW_STAGES = {
  "pis-diffs": ["awaiting_master_1"], "final-pis-check": ["master_1"],
  "final-masters": ["master_2", "final_master", "finalized"], "master-vs-pd": ["final_master", "finalized"],
};
const stageMatch = (view) => view === "pis-diffs"
  ? { $or: [{ "master_workflow.cycle_version": { $ne: CYCLE_VERSION } }, { "master_workflow.stage": "awaiting_master_1" }] }
  : { "master_workflow.cycle_version": CYCLE_VERSION, "master_workflow.stage": { $in: VIEW_STAGES[view] || [] } };

const getApprovedRecords = async (items, user) => {
  if (!items.length) return new Map();
  const qcs = await QC.find(applyDataAccessMatch({ $or: items.map((item) => ({ "item.item_code": { $regex: `^\\s*${escapeRegex(item.code)}\\s*$`, $options: "i" } })) }, user, { brandFields: ["order_meta.brand"], vendorFields: ["order_meta.vendor"] }))
    .select("item.item_code order order_meta").populate("order", "order_id").lean();
  const qcMap = new Map(qcs.map((qc) => [String(qc._id), qc]));
  if (!qcs.length) return new Map();
  const records = await Inspection.find({ qc: { $in: qcs.map((qc) => qc._id) }, is_approved: true })
    .select("qc inspector inspection_date createdAt updatedAt is_approved inspected_item_sizes inspected_box_sizes inspected_box_mode master_barcode barcode inner_barcode").lean();
  const byItem = new Map();
  for (const record of records) {
    const qc = qcMap.get(String(record.qc));
    const itemKey = key(qc.item.item_code);
    const list = byItem.get(itemKey) || [];
    list.push({ ...record, po: qc.order?.order_id || qc.order_meta?.order_id });
    byItem.set(itemKey, list);
  }
  return byItem;
};

const buildRow = (item, records, user) => {
  const workflow = getWorkflow(item);
  const evidence = buildEvidence(item, records);
  const comparison = ["final_master", "finalized"].includes(workflow.stage) ? buildPdComparison(item) : null;
  const status = workflow.stage === "finalized" ? "finalized" : workflow.stage === "final_master" ? "created" : evidence.ready ? "ready" : "waiting";
  const canWrite = isSuperAdmin(user) && workflow.stage !== "finalized";
  return {
    ...item, id: String(item._id), master_workflow: workflow, evidence, status,
    brand_label: item.brand_name || item.brand || item.brands?.[0] || "",
    vendor_labels: normalizeVendorDisplayList(item.vendors), comparison,
    inspection_comparisons: evidence.inspections.map((inspection) => ({ inspection_id: inspection.inspection_id, rows: compareSizes(sourceValues(item, "master"), inspection) })),
    actions: { review: canWrite && evidence.ready, correct: canWrite && workflow.stage === "final_master", pd_review: canWrite && workflow.stage === "final_master", finalize: canWrite && workflow.stage === "final_master" && comparison?.reviewed === true },
  };
};

const getWorkflowRows = async ({ view, filters = {}, user = {} }) => {
  if (!VIEW_STAGES[view]) throw failure("Unknown workflow page.", 400);
  const items = await Item.find(applyItemDataAccess({ $and: [buildItemMatch(filters), stageMatch(view)] }, user)).select(WORKFLOW_SELECT).sort({ code: 1 }).lean();
  const records = await getApprovedRecords(items.filter((item) => !["final_master", "finalized"].includes(getWorkflow(item).stage)), user);
  return items.filter((item) => view !== "pis-diffs" || records.has(key(item.code)))
    .map((item) => buildRow(item, records.get(key(item.code)) || [], user))
    .filter((row) => !filters.status || filters.status === "all" || row.status === filters.status);
};

const parseMasterValues = (item, input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw failure("Master values are required.", 400);
  if (Object.keys(input).some((field) => !MASTER_FIELDS.includes(field))) throw failure("Only master fields can be submitted in a master review.", 400);
  const result = { ...masterSnapshot(item), ...input };
  if (!Object.values(BOX_PACKAGING_MODES).includes(result.master_box_mode)) throw failure("Invalid master packaging mode.", 400);
  try {
    result.master_item_sizes = parseSizeEntriesPayload(result.master_item_sizes, { fieldLabel: "master_item_sizes", remarkOptions: ITEM_SIZE_REMARK_OPTIONS, weightKey: "net_weight", allowIncomplete: true });
    result.master_box_sizes = parseSizeEntriesPayload(result.master_box_sizes, { fieldLabel: "master_box_sizes", remarkOptions: BOX_SIZE_REMARK_OPTIONS, weightKey: "gross_weight", mode: result.master_box_mode, allowIncomplete: true });
  } catch (error) { throw failure(error.message, 400); }
  if (result.master_box_mode === "carton" && result.master_box_sizes.length !== 2) throw failure("Inner + Master packaging requires two box rows.", 400);
  if (result.master_box_mode === "individual_master" && result.master_box_sizes.length !== 1) throw failure("Individual + Master packaging requires one master carton row.", 400);
  Object.assign(result, normalizeSingleMasterSizeRemarks(result));
  // Snapshot the same defaults and types that the model will persist.
  for (const field of ["master_item_sizes", "master_box_sizes"]) result[field] = clone(Item.schema.path(field).cast(result[field]));
  for (const field of MASTER_FIELDS.filter((field) => !field.endsWith("sizes"))) {
    if (typeof result[field] !== "string") throw failure(`${field} must be text.`, 400);
    result[field] = text(result[field]);
  }
  result.master_barcode = result.master_master_barcode;
  result.calculated_master_total = buildBoxMeasurementCbmSummary({ sizes: result.master_box_sizes, mode: result.master_box_mode }).total;
  return result;
};

// Match the revision AND all compared values to prevent a simultaneous PD edit
// or an older master writer from invalidating a sign-off during its commit.
const buildWriteFilter = (item) => ({
  _id: item._id,
  "master_workflow.revision": item.master_workflow?.revision ?? null,
  "master_workflow.stage": item.master_workflow?.stage ?? null,
  pd_measurement_revision: item.pd_measurement_revision ?? null,
  ...Object.fromEntries([...MASTER_FIELDS, ...PD_FIELDS].filter((field) => !field.endsWith("sizes")).map((field) => [field, item[field] ?? null])),
  // Literal arrays preserve legacy rows with absent numeric defaults; Mongoose
  // otherwise fills those defaults in an equality filter and the CAS never matches.
  $expr: { $and: [...MASTER_FIELDS, ...PD_FIELDS].filter((field) => field.endsWith("sizes")).map((field) => ({ $eq: [{ $ifNull: [`$${field}`, null] }, { $literal: clone(item[field] ?? null) }] })) },
  "cbm.calculated_master_total": item.cbm?.calculated_master_total ?? null,
});

const performAction = async ({ id, user, payload = {}, action }) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw failure("Invalid item id.", 400);
  if (!isSuperAdmin(user)) throw failure("Only Super Admin can review or update master data.", 403);
  const item = await Item.findOne(applyItemDataAccess({ _id: id }, user)).select(WORKFLOW_SELECT).lean();
  if (!item) throw failure("Item not found.", 404);
  assertAction(item, user, payload);
  const records = action === "review" ? await getApprovedRecords([item], user) : new Map();
  const evidence = buildEvidence(item, records.get(key(item.code)) || []);
  const values = ["review", "correct"].includes(action) ? parseMasterValues(item, payload.values) : null;
  const next = transition({ item, user, payload, action, evidence, values });
  const $set = { master_workflow: next.master_workflow };
  if (values) {
    for (const field of MASTER_FIELDS) $set[field] = values[field];
    $set["cbm.calculated_master_total"] = values.calculated_master_total;
  }
  const history = appendItemUpdateHistory(next, { before: item, after: next, reqUser: user, action: "master_update", source: "master_workflow", metadata: { action, stage: next.master_workflow.stage, revision: next.master_workflow.revision } });
  const updated = await Item.findOneAndUpdate(buildWriteFilter(item), {
    $set, ...(history ? { $push: { update_history: { $each: [history], $slice: -200 } } } : {}),
  }, { new: true, runValidators: true }).select(WORKFLOW_SELECT).lean();
  if (!updated) throw failure("The item changed while you were reviewing it. Refresh and try again.");
  try {
    await PisUpdateLog.create(buildItemUpdateLogPayload({ reqUser: user, beforeSnapshot: buildItemUpdateAuditSnapshot(item), afterSnapshot: buildItemUpdateAuditSnapshot(updated), operationType: "master_update", pageName: "Master Workflow", source: `master_workflow_${action}`, dataScopes: ["Master"], extraRemarks: [`${action}: ${updated.master_workflow.stage}`], metadata: { action, stage: updated.master_workflow.stage, revision: updated.master_workflow.revision, evidence: evidence.inspections.map((r) => ({ inspection_id: r.inspection_id, po: r.po })) } }));
  } catch (error) {
    // The authoritative review and actor are already part of the atomic item write.
    console.error("Master workflow audit display log failed:", error.message);
  }
  return buildRow(updated, [], user);
};

module.exports = { WORKFLOW_SELECT, VIEW_STAGES, stageMatch, getApprovedRecords, buildRow, getWorkflowRows, parseMasterValues, buildWriteFilter, performAction };
