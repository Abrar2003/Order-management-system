const mongoose = require("mongoose");

const omsChatRateBucketSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    count: { type: Number, default: 0, min: 0 },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "oms_chat_rate_buckets",
    timestamps: false,
  },
);

omsChatRateBucketSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.OmsChatRateBucket
  || mongoose.model("OmsChatRateBucket", omsChatRateBucketSchema);
