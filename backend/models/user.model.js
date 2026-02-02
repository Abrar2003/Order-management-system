const mongoose = require("mongoose");

const user_Schema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "manager", "QC", "Dev", "user"], required: true, default: "user" },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    name: { type: String, required: true },
    isQC: { type: Boolean, default: false },
    inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null }

}, { timestamps: true });

module.exports = mongoose.model("users", user_Schema);