const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    logo: {
      type: Buffer,
      default: null,
      required() {
        return !String(this.logo_url || "").trim()
          && !String(this.logo_storage_key || "").trim()
          && !String(this.logo_file?.key || "").trim();
      },
    },
    logo_file: {
      key: { type: String, default: "", trim: true },
      originalName: { type: String, default: "", trim: true },
      contentType: { type: String, default: "image/webp", trim: true },
      size: { type: Number, default: 0, min: 0 },
    },
    logo_url: {
      type: String,
      default: "",
      trim: true,
       
    },
    logo_storage_key: { type: String, default: "", trim: true },
    logo_content_type: { type: String, default: "image/webp", trim: true },
    logo_size: { type: Number, default: 0, min: 0 },
    calendar: { type: String }
});

module.exports = mongoose.model("brands", brandSchema);
