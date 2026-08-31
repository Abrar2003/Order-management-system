const mongoose = require("mongoose");

const labelSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 0 },
    allocation_state: {
      type: String,
      enum: ['active', 'conflicted'],
      default: 'active',
    },
    owner_inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      default: null,
    },
    rejected_by_inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      default: null,
    },
    usage: {
      inspector: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "inspectors",
        default: null,
      },
      inspectors: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'inspectors',
      }],
      source_updated_at: { type: Date, default: null },
    },
    rejected_at: { type: Date, default: null },
    migration: {
      source: { type: String, default: "", trim: true },
      migrated_at: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

labelSchema.index({ number: 1 }, { unique: true });
labelSchema.index({ owner_inspector: 1, number: 1 });
labelSchema.index({ "usage.inspector": 1, number: 1 });
labelSchema.index({ "usage.inspectors": 1, number: 1 });
labelSchema.index({ rejected_by_inspector: 1, number: 1 });

module.exports = mongoose.model("labels", labelSchema);
