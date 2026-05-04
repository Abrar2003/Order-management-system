const mongoose = require("mongoose");
const {
  WORKFLOW_AUTO_CREATE_MODES,
  WORKFLOW_TASK_PRIORITIES,
  WORKFLOW_TASK_TYPE_CATEGORIES,
  normalizeKey,
  normalizeText,
} = require("../../helpers/workflow");
const { AuditActorSchema, UserReferenceSchema } = require("./shared");

const TaskTypeFileMatchRuleSchema = new mongoose.Schema(
  {
    extensions: { type: [String], default: [] },
    mime_types: { type: [String], default: [] },
    name_patterns: { type: [String], default: [] },
    folder_patterns: { type: [String], default: [] },
  },
  { _id: false },
);

const TaskTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    category: {
      type: String,
      enum: WORKFLOW_TASK_TYPE_CATEGORIES,
      default: "other",
      trim: true,
    },
    default_department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_departments",
      default: null,
    },
    default_assignees: { type: [UserReferenceSchema], default: [] },
    default_priority: {
      type: String,
      enum: WORKFLOW_TASK_PRIORITIES,
      default: "normal",
      trim: true,
    },
    auto_create_mode: {
      type: String,
      enum: WORKFLOW_AUTO_CREATE_MODES,
      default: "manual",
      trim: true,
    },
    file_match_rule: {
      type: TaskTypeFileMatchRuleSchema,
      default: () => ({}),
    },
    estimated_minutes: { type: Number, default: 0, min: 0 },
    requires_review: { type: Boolean, default: true },
    is_active: { type: Boolean, default: true },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  {
    collection: "workflow_task_types",
    timestamps: true,
  },
);

TaskTypeSchema.index({ key: 1 }, { unique: true });
TaskTypeSchema.index({ is_active: 1, name: 1 });
TaskTypeSchema.index({ category: 1, is_active: 1 });

TaskTypeSchema.pre("validate", function normalizeTaskType() {
  this.name = normalizeText(this.name);
  this.key = normalizeKey(this.key || this.name);
  this.description = normalizeText(this.description);

  const rule = this.file_match_rule || {};
  rule.extensions = Array.isArray(rule.extensions)
    ? [...new Set(rule.extensions.map((value) => normalizeText(value).replace(/^\./, "").toLowerCase()).filter(Boolean))]
    : [];
  rule.mime_types = Array.isArray(rule.mime_types)
    ? [...new Set(rule.mime_types.map((value) => normalizeText(value).toLowerCase()).filter(Boolean))]
    : [];
  rule.name_patterns = Array.isArray(rule.name_patterns)
    ? [...new Set(rule.name_patterns.map((value) => normalizeText(value)).filter(Boolean))]
    : [];
  rule.folder_patterns = Array.isArray(rule.folder_patterns)
    ? [...new Set(rule.folder_patterns.map((value) => normalizeText(value)).filter(Boolean))]
    : [];
  this.file_match_rule = rule;
});

module.exports = mongoose.model("workflow_task_types", TaskTypeSchema);
