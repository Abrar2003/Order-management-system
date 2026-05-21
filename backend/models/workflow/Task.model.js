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
    rework_type: {
      type: String,
      enum: ["before_approval", "after_approval", ""],
      default: "",
      trim: true,
    },
    from_status: { type: String, default: "", trim: true },
    created_at: { type: Date, default: Date.now },
    created_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { _id: false },
);

const TaskReworkedSchema = new mongoose.Schema(
  {
    count: { type: Number, default: 0, min: 0 },
    before_approval_count: { type: Number, default: 0, min: 0 },
    after_approval_count: { type: Number, default: 0, min: 0 },
    comments: { type: [TaskReworkedCommentSchema], default: [] },
  },
  { _id: false },
);

const TaskReworkDueDateSchema = new mongoose.Schema(
  {
    date: { type: Date, default: null },
    comment: { type: String, default: "", trim: true },
    source: {
      type: String,
      enum: ["rework", "due_date"],
      default: "rework",
      trim: true,
    },
    created_at: { type: Date, default: Date.now },
    created_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { _id: false },
);

const TaskUploadStatusSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "uploaded"],
      default: "pending",
      trim: true,
    },
    uploaded_by: { type: AuditActorSchema, default: () => ({}) },
    uploaded_at: { type: Date, default: null },
  },
  { _id: false },
);

const TaskHoldSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["none", "pending", "hold"],
      default: "none",
      trim: true,
    },
    previous_status: { type: String, default: "", trim: true },
    requested_comment: { type: String, default: "", trim: true },
    requested_by: { type: AuditActorSchema, default: () => ({}) },
    requested_at: { type: Date, default: null },
    approved_comment: { type: String, default: "", trim: true },
    approved_by: { type: AuditActorSchema, default: () => ({}) },
    approved_at: { type: Date, default: null },
    resumed_comment: { type: String, default: "", trim: true },
    resumed_by: { type: AuditActorSchema, default: () => ({}) },
    resumed_at: { type: Date, default: null },
    rejected_comment: { type: String, default: "", trim: true },
    rejected_by: { type: AuditActorSchema, default: () => ({}) },
    rejected_at: { type: Date, default: null },
    total_paused_ms: { type: Number, default: 0, min: 0 },
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
    upload_required: { type: Boolean, default: true },
    upload_assignees: { type: [UserReferenceSchema], default: [] },
    upload_statuses: { type: [TaskUploadStatusSchema], default: [] },
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
    rework_due_dates: { type: [TaskReworkDueDateSchema], default: [] },
    rework_count: { type: Number, default: 0, min: 0 },
    hold: { type: TaskHoldSchema, default: () => ({}) },
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
TaskSchema.index({ "upload_assignees.user": 1, status: 1, createdAt: -1 });
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
  this.upload_required = this.upload_required !== false;
  this.upload_assignees = this.upload_required && Array.isArray(this.upload_assignees)
    ? this.upload_assignees
    : [];
  this.upload_statuses = this.upload_required && Array.isArray(this.upload_statuses)
    ? this.upload_statuses
    : [];
  if (["started", "complete", "approved", "uploaded"].includes(this.status) && !this.started_at) {
    this.started_at = new Date();
  }
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
  if (!this.hold || typeof this.hold !== "object") {
    this.hold = { status: "none" };
  }
  this.hold.status = ["pending", "hold"].includes(normalizeKey(this.hold.status))
    ? normalizeKey(this.hold.status)
    : "none";
  this.hold.previous_status = normalizeWorkflowTaskStatus(this.hold.previous_status, {
    fallback: "",
  });
  this.hold.requested_comment = normalizeText(this.hold.requested_comment);
  this.hold.approved_comment = normalizeText(this.hold.approved_comment);
  this.hold.resumed_comment = normalizeText(this.hold.resumed_comment);
  this.hold.total_paused_ms = Math.max(0, Number(this.hold.total_paused_ms || 0));
  this.reworked.comments = Array.isArray(this.reworked.comments)
    ? this.reworked.comments.map((entry) => ({
        comment: normalizeText(entry?.comment),
        rework_type: normalizeKey(entry?.rework_type),
        from_status: normalizeText(entry?.from_status).toLowerCase(),
        created_at: entry?.created_at || new Date(),
        created_by: entry?.created_by || {},
      }))
    : [];
  this.reworked.count = Math.max(
    0,
    Number(this.reworked.count || 0),
    Number(this.rework_count || 0),
  );
  this.reworked.before_approval_count = Math.max(
    0,
    Number(this.reworked.before_approval_count || 0),
  );
  this.reworked.after_approval_count = Math.max(
    0,
    Number(this.reworked.after_approval_count || 0),
  );
  this.rework_count = this.reworked.count;
  this.rework_due_dates = Array.isArray(this.rework_due_dates)
    ? this.rework_due_dates
        .map((entry) => ({
          date: entry?.date || entry?.due_date || null,
          comment: normalizeText(entry?.comment),
          source: normalizeKey(entry?.source) === "due_date" ? "due_date" : "rework",
          created_at: entry?.created_at || new Date(),
          created_by: entry?.created_by || {},
        }))
        .filter((entry) => Boolean(entry.date))
    : [];
  this.tags = Array.isArray(this.tags)
    ? [...new Set(this.tags.map((value) => normalizeText(value)).filter(Boolean))]
    : [];
});

module.exports = mongoose.model("workflow_tasks", TaskSchema);
