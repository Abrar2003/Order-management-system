const mongoose = require("mongoose");

const labelMigrationConflictSchema = new mongoose.Schema(
  {
    fingerprint: { type: String, required: true, trim: true },
    inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      default: null,
    },
    label_number: { type: Number, min: 0, default: null },
    conflict_type: { type: String, required: true, trim: true },
    severity: {
      type: String,
      enum: ["warning", "error"],
      required: true,
    },
    legacy_evidence: { type: mongoose.Schema.Types.Mixed, default: null },
    modern_evidence: { type: mongoose.Schema.Types.Mixed, default: null },
    source_document_ids: [mongoose.Schema.Types.ObjectId],
    status: {
      type: String,
      enum: ["open", "resolved", "ignored"],
      default: "open",
    },
    detected_at: { type: Date, default: Date.now },
    last_seen_at: { type: Date, default: Date.now },
    resolved_at: { type: Date, default: null },
    resolution_type: { type: String, default: '', trim: true },
    canonical_current_owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'inspectors',
      default: null,
    },
    resolved_by: { type: mongoose.Schema.Types.Mixed, default: null },
    resolution_reason: { type: String, default: '', trim: true },
    previous_evidence: { type: mongoose.Schema.Types.Mixed, default: null },
    resulting_canonical_state: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    resolution_history: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

labelMigrationConflictSchema.index({ fingerprint: 1 }, { unique: true });
labelMigrationConflictSchema.index({ inspector: 1, status: 1, conflict_type: 1 });
labelMigrationConflictSchema.index({ label_number: 1, status: 1 });

module.exports = mongoose.model(
  "label_migration_conflicts",
  labelMigrationConflictSchema,
);
