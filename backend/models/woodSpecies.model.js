const mongoose = require("mongoose");
const name = { type: String, required: true, trim: true, maxlength: 160,
  set: value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value };
const schema = new mongoose.Schema({
  name, scientific_name: name, active: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
schema.index({ scientific_name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
module.exports = mongoose.model("WoodSpecies", schema, "wood_species");
