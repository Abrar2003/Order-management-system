const crypto = require("crypto");
const mongoose = require("mongoose");

const omsChatConversationSchema = new mongoose.Schema(
  {
    conversation_id: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      immutable: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      immutable: true,
      index: true,
    },
    access_fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
    },
    history: {
      type: [{
        _id: false,
        role: {
          type: String,
          enum: ["user", "assistant"],
          required: true,
        },
        content: {
          type: String,
          maxlength: 8_000,
          required: true,
        },
      }],
      default: [],
      select: false,
    },
    revision: {
      type: Number,
      default: 0,
      select: false,
    },
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  {
    collection: "oms_chat_conversations",
    timestamps: true,
  },
);

omsChatConversationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
omsChatConversationSchema.index({ user: 1, updatedAt: -1 });

module.exports =
  mongoose.models.OmsChatConversation
  || mongoose.model("OmsChatConversation", omsChatConversationSchema);
