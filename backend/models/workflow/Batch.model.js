const mongoose = require("mongoose");
const {
  WORKFLOW_ASSIGNMENT_MODES,
  WORKFLOW_BATCH_STATUSES,
  buildBatchCounts,
  normalizeKey,
  normalizeNameKey,
  normalizeSourceFolderKey,
  normalizeSourceFolderName,
  normalizeText,
} = require("../../helpers/workflow");
const { AuditActorSchema, UserReferenceSchema } = require("./shared");

const BatchTaskTypeSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, default: "", trim: true, lowercase: true },
    name: { type: String, default: "", trim: true },
    category: { type: String, default: "", trim: true, lowercase: true },
    auto_create_mode: { type: String, default: "", trim: true, lowercase: true },
    requires_review: { type: Boolean, default: true },
  },
  { _id: false },
);

const BatchCountsSchema = new mongoose.Schema(
  {
    total_files: { type: Number, default: 0, min: 0 },
    image_files: { type: Number, default: 0, min: 0 },
    cad_files: { type: Number, default: 0, min: 0 },
    pdf_files: { type: Number, default: 0, min: 0 },
    excel_files: { type: Number, default: 0, min: 0 },
    three_d_files: { type: Number, default: 0, min: 0 },
    other_files: { type: Number, default: 0, min: 0 },
    total_tasks: { type: Number, default: 0, min: 0 },
    pending_tasks: { type: Number, default: 0, min: 0 },
    assigned_tasks: { type: Number, default: 0, min: 0 },
    in_progress_tasks: { type: Number, default: 0, min: 0 },
    complete_tasks: { type: Number, default: 0, min: 0 },
    submitted_tasks: { type: Number, default: 0, min: 0 },
    approved_tasks: { type: Number, default: 0, min: 0 },
    review_tasks: { type: Number, default: 0, min: 0 },
    uploaded_tasks: { type: Number, default: 0, min: 0 },
    completed_tasks: { type: Number, default: 0, min: 0 },
    reworked_tasks: { type: Number, default: 0, min: 0 },
    rework_tasks: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const BatchSchema = new mongoose.Schema(
  {
    batch_no: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    name_key: { type: String, required: true, trim: true, lowercase: true },
    start_code: { type: String, default: "", trim: true },
    source_folder_name: { type: String, required: true, trim: true },
    source_folder_key: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: "", trim: true },
    brand: { type: String, default: "", trim: true },
    selected_task_type: {
      type: BatchTaskTypeSnapshotSchema,
      default: () => ({}),
    },
    task_type: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_task_types",
      required: true,
    },
    task_type_key: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: WORKFLOW_BATCH_STATUSES,
      default: "draft",
      trim: true,
    },
    assignment_mode: {
      type: String,
      enum: WORKFLOW_ASSIGNMENT_MODES,
      default: "manual",
      trim: true,
    },
    assignees: { type: [UserReferenceSchema], default: [] },
    due_date: { type: Date, default: null },
    counts: {
      type: BatchCountsSchema,
      default: () => buildBatchCounts(),
    },
    uploaded_by: { type: AuditActorSchema, default: () => ({}) },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    is_deleted: { type: Boolean, default: false },
  },
  {
    collection: "workflow_batches",
    timestamps: true,
  },
);

BatchSchema.index({ batch_no: 1 }, { unique: true });
BatchSchema.index({ source_folder_key: 1 });
BatchSchema.index({ task_type_key: 1 });
BatchSchema.index({ status: 1, createdAt: -1 });
BatchSchema.index({ brand: 1, status: 1, createdAt: -1 });
BatchSchema.index({ due_date: 1, status: 1 });
BatchSchema.index({ "created_by.user": 1, createdAt: -1 });
BatchSchema.index(
  { source_folder_key: 1, task_type_key: 1 },
  {
    name: "workflow_batch_active_folder_task_type_unique_idx",
    unique: true,
    partialFilterExpression: {
      is_deleted: false,
      status: { $in: ["draft", "tasks_created", "in_progress", "completed"] },
    },
  },
);

BatchSchema.pre("validate", function normalizeBatch() {
  this.name = normalizeText(this.name);
  this.name_key = normalizeNameKey(this.name_key || this.name);
  this.start_code = normalizeText(this.start_code);
  this.source_folder_name = normalizeSourceFolderName(this.source_folder_name);
  this.source_folder_key = normalizeSourceFolderKey(
    this.source_folder_key || this.source_folder_name,
  );
  this.description = normalizeText(this.description);
  this.brand = normalizeText(this.brand);
  this.task_type_key = normalizeKey(this.task_type_key || this.selected_task_type?.key);

  if (!this.counts || typeof this.counts !== "object") {
    this.counts = buildBatchCounts();
  }
});

module.exports = mongoose.model("workflow_batches", BatchSchema);
