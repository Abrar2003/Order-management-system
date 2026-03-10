const mongoose = require("mongoose");

const normalizeRole = (value) => {
    const normalizedRole = String(value || "").trim();
    if (!normalizedRole) return normalizedRole;

    const canonicalRoles = {
        admin: "admin",
        manager: "manager",
        qc: "QC",
        dev: "dev",
        user: "user",
    };

    const byLowerCase = canonicalRoles[normalizedRole.toLowerCase()];
    return byLowerCase || normalizedRole;
};

const user_Schema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ["admin", "manager", "QC", "dev", "user"],
        required: true,
        default: "user",
        set: normalizeRole,
    },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    name: { type: String, required: true },
    isQC: { type: Boolean, default: false },
    inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null }

}, { timestamps: true });

user_Schema.pre("validate", function normalizeUserRole() {
    this.role = normalizeRole(this.role);
});

module.exports = mongoose.model("users", user_Schema);
