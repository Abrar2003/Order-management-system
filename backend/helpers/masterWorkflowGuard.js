const { MASTER_FIELDS, PD_FIELDS, fingerprint, failure } = require("./masterWorkflow");

const PROTECTED_PATHS = [...MASTER_FIELDS, "master_workflow", "cbm.calculated_master_total"];
const touchesProtectedPath = (path) => PROTECTED_PATHS.some((field) => path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`));
const updateTouchesMaster = (update = {}) => {
  if (Array.isArray(update)) return update.some((stage) => Object.entries(stage).some(([operator, value]) => {
    if (["$set", "$addFields"].includes(operator)) return Object.keys(value).some(touchesProtectedPath);
    if (operator === "$unset") return (Array.isArray(value) ? value : [value]).some(touchesProtectedPath);
    if (operator === "$project" && Object.values(value).every((entry) => entry === 0 || entry === false)) return Object.keys(value).some(touchesProtectedPath);
    return true; // Replacements or inclusion projections can discard protected fields.
  }));
  return Object.entries(update).some(([operator, value]) => operator.startsWith("$")
    ? Object.entries(value || {}).some(([path, target]) => touchesProtectedPath(path) || (operator === "$rename" && touchesProtectedPath(String(target))))
    : touchesProtectedPath(operator));
};
const unlockedFilter = (filter = {}) => ({ $and: [filter, { "master_workflow.stage": { $ne: "finalized" } }] });
const protectedValues = (doc) => Object.fromEntries(PROTECTED_PATHS.map((field) => [field, doc.get(field)]));
const pdValues = (doc) => Object.fromEntries(PD_FIELDS.map((field) => [field, doc.get(field)]));
const touchesPd = (path) => PD_FIELDS.some((field) => path === field || path.startsWith(`${field}.`));
const updateTouchesPd = (update = {}) => Array.isArray(update)
  ? update.some(updateTouchesPd)
  : Object.entries(update).some(([operator, value]) => operator.startsWith("$")
    ? Object.entries(value || {}).some(([path, target]) => touchesPd(path) || (operator === "$rename" && touchesPd(String(target)))) : touchesPd(operator));

const incrementPdRevision = (update) => {
  if (Array.isArray(update)) update.push({ $set: { pd_measurement_revision: { $add: [{ $ifNull: ["$pd_measurement_revision", 0] }, 1] } } });
  else update.$inc = { ...update.$inc, pd_measurement_revision: 1 };
};

const masterWorkflowGuard = (schema) => {
  schema.post("init", function rememberMasterState(doc) {
    doc.$locals.masterWorkflowOriginal = fingerprint(protectedValues(doc));
    doc.$locals.masterWasFinalized = doc.master_workflow?.stage === "finalized";
    doc.$locals.pdOriginal = fingerprint(pdValues(doc));
  });
  schema.pre("save", function trackPdMeasurementChanges() {
    if (!this.isNew && this.modifiedPaths().some(touchesPd) && this.$locals.pdOriginal !== fingerprint(pdValues(this))) this.$inc("pd_measurement_revision", 1);
  });
  schema.pre("save", function guardMasterSave() {
    if (this.isNew || !this.directModifiedPaths().some(touchesProtectedPath)) return;
    if (this.$locals.masterWorkflowOriginal === fingerprint(protectedValues(this)) && PROTECTED_PATHS.every((field) => this.isSelected(field))) return;
    if (this.$locals.masterWasFinalized) throw failure("Final Master is permanently locked.");
    // This predicate also protects a stale document loaded before finalization.
    this.$where = { ...this.$where, "master_workflow.stage": { $ne: "finalized" } };
  });
  schema.post("save", function rememberSavedMaster(doc) {
    doc.$locals.masterWorkflowOriginal = fingerprint(protectedValues(doc));
    doc.$locals.masterWasFinalized = doc.master_workflow?.stage === "finalized";
    doc.$locals.pdOriginal = fingerprint(pdValues(doc));
  });
  for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"]) {
    schema.pre(operation, function guardMasterQuery() {
      if (updateTouchesPd(this.getUpdate()) && !operation.toLowerCase().includes("replace")) incrementPdRevision(this.getUpdate());
      if (operation.includes("Replace") || operation === "replaceOne" || updateTouchesMaster(this.getUpdate())) {
        this.setQuery(unlockedFilter(this.getFilter()));
      }
    });
  }
  schema.pre("bulkWrite", function guardMasterBulk(operations) {
    for (const operation of operations) {
      for (const kind of ["updateOne", "updateMany", "replaceOne"]) {
        const entry = operation[kind];
        if (entry && kind !== "replaceOne" && updateTouchesPd(entry.update)) incrementPdRevision(entry.update);
        if (entry && (kind === "replaceOne" || updateTouchesMaster(entry.update))) entry.filter = unlockedFilter(entry.filter);
      }
    }
  });
};

module.exports = { masterWorkflowGuard, touchesProtectedPath, updateTouchesMaster, unlockedFilter };
