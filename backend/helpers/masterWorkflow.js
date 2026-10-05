const crypto = require("node:crypto");
const { parseDateOnly } = require("./dateOnly");
const { normalizeUserRoleKey } = require("./userRole");
const { normalizeSingleItemSizeRemarks, normalizeSingleBoxSizeRemarks } = require("./masterSizeRemarks");
const { formatSizeEntryToReference } = require("./sizeDimensionFormatter");
const { detectBoxPackagingMode, normalizeBoxEntryMetadata } = require("./boxMeasurement");
const { compareItemSizeDimensionVariance, compareBoxSizeDimensionVariance, compareWeightVariance } = require("./measurementMismatchRules");

const CYCLE_VERSION = "2026-10-03";
const CYCLE_STARTED_AT = "2026-10-02T18:30:00.000Z";
const STAGES = ["awaiting_master_1", "master_1", "master_2", "final_master", "finalized"];
const MASTER_FIELDS = ["master_item_sizes", "master_box_sizes", "master_box_mode", "master_country_of_origin", "master_barcode", "master_master_barcode", "master_inner_barcode"];
const PD_FIELDS = ["pd_item_sizes", "pd_box_sizes", "pd_box_mode"];
const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).toLowerCase();
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const time = (value) => new Date(value || 0).getTime() || 0;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (typeof value.toObject === "function") return canonical(value.toObject());
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value ?? null;
};
const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const failure = (message, status = 409) => Object.assign(new Error(message), { status });
const getWorkflow = (item = {}) => item.master_workflow?.cycle_version === CYCLE_VERSION
  ? clone(item.master_workflow)
  : { cycle_version: CYCLE_VERSION, started_at: CYCLE_STARTED_AT, stage: STAGES[0], revision: 0, reviews: [], consumed_pos: [] };
const masterSnapshot = (item = {}) => ({
  ...Object.fromEntries(MASTER_FIELDS.map((field) => [field, clone(item[field] ?? (field.endsWith("sizes") ? [] : ""))])),
  calculated_master_total: text(item.cbm?.calculated_master_total || "0"),
});
const pdSnapshot = (item = {}) => ({ ...Object.fromEntries(PD_FIELDS.map((field) => [field, clone(item[field] ?? (field.endsWith("sizes") ? [] : ""))])), measurement_revision: item.pd_measurement_revision || 0 });
const isSuperAdmin = (user) => normalizeUserRoleKey(user?.role) === "super_admin";

// Evidence is copied at review time: later QC edits never rewrite a completed review.
const inspectionSnapshot = (record) => ({
  inspection_id: text(record._id || record.inspection_id), qc_id: text(record.qc || record.qc_id),
  po: text(record.po || record.order_id), inspector: text(record.inspector?._id || record.inspector),
  inspection_date: record.inspection_date, created_at: record.createdAt || record.created_at,
  updated_at: record.updatedAt || record.updated_at, is_approved: record.is_approved === true,
  item_sizes: clone(record.inspected_item_sizes || record.item_sizes || []),
  box_sizes: clone(record.inspected_box_sizes || record.box_sizes || []),
  box_mode: record.inspected_box_mode || record.box_mode || "individual",
  master_barcode: text(record.master_barcode || record.barcode), inner_barcode: text(record.inner_barcode),
});
const compareVisits = (a, b) => time(parseDateOnly(a.inspection_date)) - time(parseDateOnly(b.inspection_date))
  || time(a.created_at) - time(b.created_at) || a.inspection_id.localeCompare(b.inspection_id);

const buildEvidence = (item, records = [], now = new Date()) => {
  const workflow = getWorkflow(item);
  const stageIndex = STAGES.indexOf(workflow.stage);
  const required = stageIndex === 0 ? 1 : stageIndex < 3 ? 3 : 0;
  const anchor = workflow.reviews?.at(-1)?.reviewed_at;
  const consumed = new Set((workflow.consumed_pos || []).map(key));
  const visits = records.map(inspectionSnapshot).filter((r) => {
    const date = parseDateOnly(r.inspection_date);
    if (!r.is_approved || !r.po || !r.inspection_id || !r.inspector || !date || date > parseDateOnly(now)) return false;
    if (consumed.has(key(r.po))) return false;
    if (stageIndex > 0 && (!anchor || time(r.created_at) <= time(anchor) || date < parseDateOnly(anchor))) return false;
    return true;
  }).sort(compareVisits);
  const pos = new Map();
  for (const visit of visits) {
    const poKey = key(visit.po);
    const current = pos.get(poKey);
    pos.set(poKey, { first: current?.first || visit, latest: visit });
  }
  const selected = stageIndex === 0
    ? visits.slice(-1)
    : [...pos.values()].sort((a, b) => compareVisits(a.first, b.first)).slice(0, required).map((r) => r.latest);
  return {
    required, count: pos.size, ready: required > 0 && selected.length === required,
    inspections: selected, token: fingerprint({ stage: workflow.stage, revision: workflow.revision, inspections: selected }),
  };
};

const sourceValues = (item, prefix) => ({
  item_sizes: item[`${prefix}_item_sizes`] || [], box_sizes: item[`${prefix}_box_sizes`] || [],
  box_mode: item[`${prefix}_box_mode`] || "",
});

const compareSizes = (master, other) => {
  const rows = [];
  const masterMode = detectBoxPackagingMode(master.box_mode, master.box_sizes);
  const otherMode = detectBoxPackagingMode(other.box_mode, other.box_sizes);
  rows.push({ key: "box_mode", group: "Packaging", part: "", field: "Mode", master: master.box_mode ? masterMode : null, other: other.box_mode ? otherMode : null, status: !master.box_mode || !other.box_mode ? "missing" : masterMode === otherMode ? "match" : "mismatch" });
  for (const group of ["item", "box"]) {
    const normalize = (entries, mode) => group === "item" ? normalizeSingleItemSizeRemarks(entries)
      : normalizeSingleBoxSizeRemarks(entries.map((entry) => ({ ...entry, ...normalizeBoxEntryMetadata(entry, mode) })));
    const masterEntries = normalize(master[`${group}_sizes`] || [], masterMode);
    const otherEntries = normalize(other[`${group}_sizes`] || [], otherMode);
    const entryKey = (entry, index, entries) => {
      const label = key(entry.remark || (group === "box" ? entry.box_type : "")) || `entry${index + 1}`;
      return entries.length === 1 && ["item", "box", "individual"].includes(label) ? "single" : label;
    };
    const indexEntries = (entries) => {
      const counts = new Map();
      return new Map(entries.map((entry, index) => {
        const label = entryKey(entry, index, entries);
        const occurrence = (counts.get(label) || 0) + 1;
        counts.set(label, occurrence);
        return [occurrence === 1 ? label : `${label}#${occurrence}`, entry];
      }));
    };
    const left = indexEntries(masterEntries);
    const right = indexEntries(otherEntries);
    const parts = [...new Set([...left.keys(), ...right.keys()])];
    if (!parts.length) rows.push({ key: `${group}:missing`, group, part: "", field: "Measurements", master: null, other: null, status: "missing" });
    for (const part of parts) {
      const a = left.get(part), rawOther = right.get(part);
      const b = a && rawOther ? formatSizeEntryToReference(rawOther, a) : rawOther;
      const fields = ["L", "B", "H", group === "item" ? "net_weight" : "gross_weight"];
      if (group === "box") {
        if (masterMode === "carton" || otherMode === "carton") {
          if (a?.box_type === "inner" || b?.box_type === "inner") fields.push("item_count_in_inner");
          if (a?.box_type === "master" || b?.box_type === "master") fields.push("box_count_in_master");
        } else if (masterMode === "individual_master" || otherMode === "individual_master") fields.push("box_count_in_master");
      }
      for (const field of fields) {
        const av = a?.[field], bv = b?.[field];
        const missing = !(Number(av) > 0) || !(Number(bv) > 0);
        const rule = field.endsWith("weight") ? compareWeightVariance
          : ["L", "B", "H"].includes(field) ? (group === "item" ? compareItemSizeDimensionVariance : compareBoxSizeDimensionVariance) : null;
        // Final Master is the reference for percentage tolerances.
        const mismatch = rule ? rule(bv, av).mismatch : Number(av) !== Number(bv);
        rows.push({ key: `${group}:${part}:${field}`, group, part: a?.remark || b?.remark || part, field, master: av ?? null, other: bv ?? null, status: missing ? "missing" : mismatch ? "mismatch" : "match" });
      }
    }
  }
  return rows;
};
const buildPdComparison = (item) => {
  const snapshots = { master: masterSnapshot(item), pd: pdSnapshot(item) };
  const rows = compareSizes(sourceValues(item, "master"), sourceValues(item, "pd"));
  const token = fingerprint(snapshots);
  const review = getWorkflow(item).pd_review;
  return { rows, token, snapshots, issue_count: rows.filter((row) => row.status !== "match").length, reviewed: review?.token === token, review: review || null };
};

const assertAction = (item, user, payload) => {
  if (!isSuperAdmin(user)) throw failure("Only Super Admin can review or update master data.", 403);
  const workflow = getWorkflow(item);
  if (workflow.stage === "finalized") throw failure("Final Master is permanently locked.");
  if (!Number.isInteger(payload.revision) || payload.revision !== workflow.revision) throw failure("This review is stale. Refresh the item and review the current data.");
  return workflow;
};
const actor = (user) => ({ user: text(user?._id || user?.id), name: text(user?.name || user?.email || user?.role) });

const transition = ({ item, user, payload, action, evidence, values, now = new Date() }) => {
  const workflow = assertAction(item, user, payload);
  const timestamp = new Date(now).toISOString();
  const nextItem = clone(item);
  if (action === "review") {
    if (!evidence?.ready || !["awaiting_master_1", "master_1", "master_2"].includes(workflow.stage)) throw failure("The required approved PO inspections are not yet available.");
    if (payload.evidence_token !== evidence.token) throw failure("Inspection evidence changed. Refresh and review it again.");
    if (!workflow.legacy_master) workflow.legacy_master = masterSnapshot(item);
    Object.assign(nextItem, values);
    nextItem.cbm = { ...nextItem.cbm, calculated_master_total: values.calculated_master_total };
    delete nextItem.calculated_master_total;
    workflow.stage = STAGES[STAGES.indexOf(workflow.stage) + 1];
    workflow.reviews = [...(workflow.reviews || []), { stage: workflow.stage, reviewed_at: timestamp, reviewed_by: actor(user), evidence: clone(evidence.inspections), master: masterSnapshot(nextItem) }];
    workflow.consumed_pos = [...new Set([...(workflow.consumed_pos || []), ...evidence.inspections.map((r) => key(r.po))])];
    workflow.pd_review = null;
  } else if (action === "correct") {
    if (workflow.stage !== "final_master") throw failure("Only an unlocked Final Master can be corrected.");
    Object.assign(nextItem, values);
    nextItem.cbm = { ...nextItem.cbm, calculated_master_total: values.calculated_master_total };
    delete nextItem.calculated_master_total;
    workflow.pd_review = null;
  } else if (action === "pd-review") {
    if (workflow.stage !== "final_master") throw failure("Create Final Master before signing off the PD comparison.");
    const comparison = buildPdComparison(item);
    if (payload.comparison_token !== comparison.token) throw failure("The comparison changed. Refresh and review it again.");
    const reasons = {};
    for (const row of comparison.rows.filter((r) => r.status !== "match")) {
      const reason = text(payload.reasons?.[row.key]);
      if (!reason || reason.length > 2000) throw failure(`Provide an acceptance reason (up to 2000 characters) for ${row.group} ${row.part} ${row.field}.`, 400);
      reasons[row.key] = reason;
    }
    workflow.pd_review = { token: comparison.token, snapshots: comparison.snapshots, reasons, reviewed_at: timestamp, reviewed_by: actor(user) };
  } else if (action === "finalize") {
    if (workflow.stage !== "final_master" || !buildPdComparison(item).reviewed) throw failure("Sign off the current Master vs PD comparison before finalizing.");
    if (payload.comparison_token !== buildPdComparison(item).token) throw failure("The comparison changed. Refresh before finalizing.");
    workflow.stage = "finalized";
    workflow.finalized_at = timestamp;
    workflow.finalized_by = actor(user);
    workflow.final_snapshot = masterSnapshot(item);
  } else throw failure("Unknown master workflow action.", 400);
  workflow.revision += 1;
  workflow.events = [...(workflow.events || []), { action, stage: workflow.stage, revision: workflow.revision, at: timestamp, actor: actor(user), master: masterSnapshot(nextItem), pd_review: action === "pd-review" ? clone(workflow.pd_review) : undefined }];
  return { ...nextItem, master_workflow: workflow };
};

module.exports = { CYCLE_VERSION, CYCLE_STARTED_AT, STAGES, MASTER_FIELDS, PD_FIELDS, key, text, clone, fingerprint, failure, getWorkflow, masterSnapshot, pdSnapshot, isSuperAdmin, buildEvidence, sourceValues, compareSizes, buildPdComparison, assertAction, transition };
