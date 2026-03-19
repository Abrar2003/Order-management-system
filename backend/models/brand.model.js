const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    logo: {
      type: Buffer,
      default: null,
      required() {
        return !String(this.logo_url || "").trim();
      },
    },
    logo_url: {
      type: String,
      default: "",
      trim: true,
      required() {
        return !this.logo;
      },
    },
    logo_storage_key: { type: String, default: "", trim: true },
    logo_content_type: { type: String, default: "image/webp", trim: true },
    logo_size: { type: Number, default: 0, min: 0 },
    calendar: { type: String }
});

module.exports = mongoose.model("brands", brandSchema);
