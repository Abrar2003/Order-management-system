const mongoose = require("mongoose");

const user_Schema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "manager", "QC", "Dev"], required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    name: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("users", user_Schema);