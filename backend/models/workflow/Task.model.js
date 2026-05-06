const mongoose = require("mongoose");
const {
  WORKFLOW_TASK_PRIORITIES,
  WORKFLOW_TASK_STATUSES,
  normalizeKey,
  normalizeWorkflowTaskStatus,
  normalizeText,
} = require("../../helpers/workflow");
const {
  AuditActorSchema,
  SourceFileMetadataSchema,
  UserReferenceSchema,
} = require("./shared");

const TaskReworkedCommentSchema = new mongoose.Schema(
  {
    comment: { type: String, default: "", trim: true },
    created_at: { type: Date, default: Date.now },
    created_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { _id: false },
);

const TaskReworkedSchema = new mongoose.Schema(
  {
    count: { type: Number, default: 0, min: 0 },
    comments: { type: [TaskReworkedCommentSchema], default: [] },
  },
  { _id: false },
);

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
      default: "assigned",
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
    approved_by: { type: AuditActorSchema, default: () => ({}) },
    approved_at: { type: Date, default: null },
    uploaded_by: { type: AuditActorSchema, default: () => ({}) },
    uploaded_at: { type: Date, default: null },
    review_required: { type: Boolean, default: true },
    reviewed_by: { type: AuditActorSchema, default: () => ({}) },
    reviewed_at: { type: Date, default: null },
    reworked: { type: TaskReworkedSchema, default: () => ({}) },
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
  this.status = normalizeWorkflowTaskStatus(this.status, { fallback: "assigned" }) || "assigned";
  if (["approved", "uploaded"].includes(this.status)) {
    if (!this.approved_at && this.reviewed_at) {
      this.approved_at = this.reviewed_at;
    }
    if (!this.approved_by?.user && this.reviewed_by?.user) {
      this.approved_by = this.reviewed_by;
    }
  }
  if (!this.reworked || typeof this.reworked !== "object") {
    this.reworked = { count: 0, comments: [] };
  }
  this.reworked.comments = Array.isArray(this.reworked.comments)
    ? this.reworked.comments.map((entry) => ({
        comment: normalizeText(entry?.comment),
        created_at: entry?.created_at || new Date(),
        created_by: entry?.created_by || {},
      }))
    : [];
  this.reworked.count = Math.max(
    0,
    Number(this.reworked.count || 0),
    Number(this.rework_count || 0),
  );
  this.rework_count = this.reworked.count;
  this.tags = Array.isArray(this.tags)
    ? [...new Set(this.tags.map((value) => normalizeText(value)).filter(Boolean))]
    : [];
});

module.exports = mongoose.model("workflow_tasks", TaskSchema);
