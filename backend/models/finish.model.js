const mongoose = require("mongoose");

const finishImageSchema = new mongoose.Schema(
  {
    key: { type: String, default: "", trim: true },
    originalName: { type: String, default: "", trim: true },
    contentType: { type: String, default: "", trim: true },
    size: { type: Number, default: 0, min: 0 },
    link: { type: String, default: "", trim: true },
    public_id: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const finishSchema = new mongoose.Schema(
  {
    color: { type: String, required: true, trim: true },
    color_code: { type: String, required: true, trim: true, uppercase: true },
    image: { type: finishImageSchema, default: () => ({}) },
    vendor: { type: String, required: true, trim: true },
    vendor_code: { type: String, required: true, trim: true, uppercase: true },
    item_codes: {
      type: [{ type: String, required: true, trim: true }],
      default: [],
    },
    unique_code: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("finish", finishSchema);
