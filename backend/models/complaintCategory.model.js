const mongoose = require("mongoose");

const AUDIT_ACTOR_SCHEMA = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
  name: { type: String, default: "", trim: true },
};

const normalizeCategoryName = (value = "") =>
  String(value ?? "").trim().replace(/\s+/g, " ");

const ComplaintCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalized_name: { type: String, required: true, unique: true, index: true },
    created_by: AUDIT_ACTOR_SCHEMA,
    updated_by: AUDIT_ACTOR_SCHEMA,
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    collection: "complaint_categories",
  },
);

ComplaintCategorySchema.pre("validate", function normalizeBeforeValidate() {
  this.name = normalizeCategoryName(this.name);
  this.normalized_name = this.name.toLowerCase();
});

ComplaintCategorySchema.index({ name: 1 });

module.exports = {
  ComplaintCategory: mongoose.model("complaint_categories", ComplaintCategorySchema),
  normalizeCategoryName,
};
