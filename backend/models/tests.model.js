const mongoose = require("mongoose");

const ImageSchema = new mongoose.Schema(
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

const TestSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["drop"],
      default: "drop",
      required: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    version: { type: String, required: true, trim: true },
    testing_guide: { type: ImageSchema, default: undefined },
    instructions: { type: String, default: undefined },
    is_active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: "tests" },
);

TestSchema.index(
  { type: 1 },
  { unique: true, partialFilterExpression: { is_active: true } },
);

module.exports = mongoose.model("tests", TestSchema);
