const mongoose = require("mongoose");

const authSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      index: true,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    revoked_at: {
      type: Date,
      default: null,
      index: true,
    },
    rotated_at: {
      type: Date,
      default: null,
    },
    last_used_at: {
      type: Date,
      default: null,
    },
    user_agent: {
      type: String,
      default: "",
      trim: true,
    },
    ip: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true },
);

authSessionSchema.index({ user: 1, revoked_at: 1, expires_at: 1 });

module.exports = mongoose.model("auth_sessions", authSessionSchema);
