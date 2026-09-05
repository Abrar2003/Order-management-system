const mongoose = require("mongoose");

const NOTIFICATION_PRIORITIES = ["critical", "high", "normal", "low", "silent"];
const NOTIFICATION_CATEGORIES = ["comment", "system"];

const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true, index: true },
    type: { type: String, required: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, default: "", trim: true },
    priority: {
      type: String,
      enum: NOTIFICATION_PRIORITIES,
      default: "normal",
      trim: true,
      lowercase: true,
    },
    category: {
      type: String,
      enum: NOTIFICATION_CATEGORIES,
      default: "system",
      trim: true,
      lowercase: true,
    },
    read: { type: Boolean, default: false },
    read_at: { type: Date, default: null },
    archived: { type: Boolean, default: false },
    archived_at: { type: Date, default: null },
    entity_type: { type: String, default: "", trim: true, lowercase: true },
    entity_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    deep_link: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, default: null },
  },
  {
    collection: "notifications",
    timestamps: false,
  },
);

NotificationSchema.index({ user: 1, read: 1, created_at: -1 });
NotificationSchema.index({ user: 1, created_at: -1 });
NotificationSchema.index({ user: 1, category: 1, created_at: -1 });
NotificationSchema.index({ user: 1, priority: 1, created_at: -1 });
NotificationSchema.index({ entity_type: 1, entity_id: 1 });
NotificationSchema.index(
  {
    user: 1,
    type: 1,
    entity_type: 1,
    entity_id: 1,
    "metadata.dedupe_key": 1,
  },
  {
    name: "notification_dedupe_idx",
    partialFilterExpression: { archived: false },
  },
);

module.exports = {
  Notification: mongoose.model("notifications", NotificationSchema),
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
};
