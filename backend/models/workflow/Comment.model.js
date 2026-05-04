const mongoose = require("mongoose");
const {
  WORKFLOW_TASK_COMMENT_TYPES,
  normalizeText,
} = require("../../helpers/workflow");
const { AuditActorSchema } = require("./shared");

const CommentSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_tasks",
      required: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_batches",
      required: true,
    },
    comment: { type: String, required: true, trim: true },
    comment_type: {
      type: String,
      enum: WORKFLOW_TASK_COMMENT_TYPES,
      default: "general",
      trim: true,
    },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
    is_deleted: { type: Boolean, default: false },
    deleted_at: { type: Date, default: null },
    deleted_by: { type: AuditActorSchema, default: () => ({}) },
  },
  {
    collection: "workflow_comments",
    timestamps: true,
  },
);

CommentSchema.index({ task: 1, createdAt: -1, is_deleted: 1 });
CommentSchema.index({ batch: 1, createdAt: -1, is_deleted: 1 });

CommentSchema.pre("validate", function normalizeComment() {
  this.comment = normalizeText(this.comment);
});

module.exports = mongoose.model("workflow_comments", CommentSchema);
