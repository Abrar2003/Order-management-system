const mongoose = require("mongoose");
const { normalizeKey, normalizeText } = require("../../helpers/workflow");
const { AuditActorSchema } = require("./shared");

const DepartmentMemberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    role: { type: String, default: "member", trim: true },
    added_at: { type: Date, default: Date.now },
    added_by: { type: AuditActorSchema, default: () => ({}) },
    is_active: { type: Boolean, default: true },
  },
  { _id: true },
);

const DepartmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: "", trim: true },
    members: { type: [DepartmentMemberSchema], default: [] },
    is_active: { type: Boolean, default: true },
    created_by: { type: AuditActorSchema, default: () => ({}) },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  {
    collection: "workflow_departments",
    timestamps: true,
  },
);

DepartmentSchema.index({ key: 1 }, { unique: true });
DepartmentSchema.index({ is_active: 1, name: 1 });
DepartmentSchema.index({ "members.user": 1, is_active: 1 });

DepartmentSchema.pre("validate", function normalizeDepartment() {
  this.name = normalizeText(this.name);
  this.key = normalizeKey(this.key || this.name);
  this.description = normalizeText(this.description);

  if (!Array.isArray(this.members)) return;
  this.members.forEach((member) => {
    if (!member) return;
    member.role = normalizeText(member.role || "member");
  });
});

module.exports = mongoose.model("workflow_departments", DepartmentSchema);
