const mongoose = require("mongoose");
const {
  WORKFLOW_TASK_STATUSES,
  normalizeText,
} = require("../../helpers/workflow");
const { AuditActorSchema } = require("./shared");

const TaskStatusHistorySchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_tasks",
      required: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_batches",
      default: null,
    },
    from_status: {
      type: String,
      enum: [...WORKFLOW_TASK_STATUSES, ""],
      default: "",
      trim: true,
    },
    to_status: {
      type: String,
      enum: WORKFLOW_TASK_STATUSES,
      required: true,
      trim: true,
    },
    changed_by: { type: AuditActorSchema, default: () => ({}) },
    changed_at: { type: Date, default: Date.now },
    note: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  {
    collection: "workflow_task_status_history",
    timestamps: true,
  },
);

TaskStatusHistorySchema.index({ task: 1, changed_at: -1 });
TaskStatusHistorySchema.index({ batch: 1, changed_at: -1 });

TaskStatusHistorySchema.pre("validate", function normalizeHistory() {
  this.note = normalizeText(this.note);
});

module.exports = mongoose.model(
  "workflow_task_status_history",
  TaskStatusHistorySchema,
);
