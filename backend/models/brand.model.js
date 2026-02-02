const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    logo: { type: Buffer, required: true }
});

module.exports = mongoose.model("brands", brandSchema);