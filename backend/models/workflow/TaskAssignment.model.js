const mongoose = require("mongoose");
const {
  WORKFLOW_TASK_ASSIGNMENT_STATUSES,
  normalizeText,
} = require("../../helpers/workflow");
const { AuditActorSchema } = require("./shared");

const TaskAssignmentSchema = new mongoose.Schema(
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
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "workflow_departments",
      default: null,
    },
    status: {
      type: String,
      enum: WORKFLOW_TASK_ASSIGNMENT_STATUSES,
      default: "active",
      trim: true,
    },
    assigned_at: { type: Date, default: Date.now },
    removed_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    assigned_by: { type: AuditActorSchema, default: () => ({}) },
    removed_by: { type: AuditActorSchema, default: () => ({}) },
    note: { type: String, default: "", trim: true },
  },
  {
    collection: "workflow_task_assignments",
    timestamps: true,
  },
);

TaskAssignmentSchema.index({ task: 1, assignee: 1, status: 1 });
TaskAssignmentSchema.index({ batch: 1, assignee: 1, status: 1 });
TaskAssignmentSchema.index({ assignee: 1, status: 1, assigned_at: -1 });

TaskAssignmentSchema.pre("validate", function normalizeAssignment() {
  this.note = normalizeText(this.note);
});

module.exports = mongoose.model("workflow_task_assignments", TaskAssignmentSchema);
