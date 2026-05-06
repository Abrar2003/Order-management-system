const mongoose = require("mongoose");
const {
  WORKFLOW_TASK_PRIORITIES,
  WORKFLOW_TASK_STATUSES,
  normalizeKey,
  normalizeText,
} = require("../../helpers/workflow");
const {
  AuditActorSchema,
  SourceFileMetadataSchema,
  UserReferenceSchema,
} = require("./shared");

const TaskSchema = new mongoose.Schema(
  {
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_batches",
      default: null,
      index: true,
    },
    batch_no: { type: String, default: "", trim: true, uppercase: true },
    task_no: { type: String, required: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    task_type: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_task_types",
      required: true,
    },
    task_type_key: { type: String, required: true, trim: true, lowercase: true },
    task_type_name: { type: String, default: "", trim: true },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_departments",
      default: null,
    },
    brand: { type: String, default: "", trim: true },
    source_folder_name: { type: String, default: "", trim: true },
    source_folder_path: { type: String, default: "", trim: true },
    source_files: { type: [SourceFileMetadataSchema], default: [] },
    status: {
      type: String,
      enum: WORKFLOW_TASK_STATUSES,
      default: "pending",
      trim: true,
    },
    priority: {
      type: String,
      enum: WORKFLOW_TASK_PRIORITIES,
      default: "normal",
      trim: true,
    },
    assigned_to: { type: [UserReferenceSchema], default: [] },
    assigned_by: { type: AuditActorSchema, default: () => ({}) },
    assigned_at: { type: Date, default: null },
    due_date: { type: Date, default: null },
    started_at: { type: Date, default: null },
    submitted_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    review_required: { type: Boolean, default: true },
    reviewed_by: { type: AuditActorSchema, default: () => ({}) },
    reviewed_at: { type: Date, default: null },
    rework_count: { type: Number, default: 0, min: 0 },
    blocked_reason: { type: String, default: "", trim: true },
    tags: { type: [String], default: [] },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
    is_deleted: { type: Boolean, default: false },
  },
  {
    collection: "workflow_tasks",
    timestamps: true,
  },
);

TaskSchema.index({ task_no: 1 }, { unique: true });
TaskSchema.index({ batch: 1, status: 1, createdAt: -1 });
TaskSchema.index({ task_type_key: 1, status: 1, createdAt: -1 });
TaskSchema.index({ brand: 1, status: 1, createdAt: -1 });
TaskSchema.index({ department: 1, status: 1, createdAt: -1 });
TaskSchema.index({ "assigned_to.user": 1, status: 1, createdAt: -1 });
TaskSchema.index({ due_date: 1, status: 1 });
TaskSchema.index({ source_folder_name: 1, task_type_key: 1, createdAt: -1 });

TaskSchema.pre("validate", function normalizeTask() {
  this.title = normalizeText(this.title);
  this.description = normalizeText(this.description);
  this.task_type_key = normalizeKey(this.task_type_key || this.task_type_name);
  this.task_type_name = normalizeText(this.task_type_name);
  this.brand = normalizeText(this.brand);
  this.source_folder_name = normalizeText(this.source_folder_name);
  this.source_folder_path = normalizeText(this.source_folder_path);
  this.blocked_reason = normalizeText(this.blocked_reason);
  this.tags = Array.isArray(this.tags)
    ? [...new Set(this.tags.map((value) => normalizeText(value)).filter(Boolean))]
    : [];
});

module.exports = mongoose.model("workflow_tasks", TaskSchema);
