const mongoose = require("mongoose");
const { ROLE_KEYS, normalizeRoleKey } = require("../helpers/permissions");

const actorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    name: { type: String, default: "" },
  },
  { _id: false },
);

const permissionAuditSchema = new mongoose.Schema(
  {
    action: { type: String, default: "update" },
    previous_permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    next_permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    actor: { type: actorSchema, default: () => ({}) },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const rolePermissionSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ROLE_KEYS,
      required: true,
      unique: true,
      set: (value) => normalizeRoleKey(value),
    },
    permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    updated_by: { type: actorSchema, default: () => ({}) },
    updated_at: { type: Date, default: Date.now },
    history: { type: [permissionAuditSchema], default: [] },
  },
  { timestamps: true },
);

rolePermissionSchema.index({ role: 1 }, { unique: true });

rolePermissionSchema.pre("validate", function normalizeRole(next) {
  this.role = normalizeRoleKey(this.role);
  next();
});

module.exports = mongoose.model("RolePermission", rolePermissionSchema);
