const mongoose = require("mongoose");

const employeeTaskAssignmentSchema = new mongoose.Schema(
  {
    task_key: { type: String, required: true, unique: true, trim: true },
    assignee_ids: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "users" }],
      default: [],
    },
    updated_by: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
      name: { type: String, default: "", trim: true },
      updated_at: { type: Date, default: Date.now },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("EmployeeTaskAssignment", employeeTaskAssignmentSchema);
