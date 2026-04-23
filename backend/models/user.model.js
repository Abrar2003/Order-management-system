const mongoose = require("mongoose");
const { USER_ROLES, normalizeUserRole } = require("../helpers/userRole");

const user_Schema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: USER_ROLES,
        required: true,
        default: "user",
        set: (value) => normalizeUserRole(value, value),
    },
    email: { type: String, required: true, unique: true },
    phone: { type: String },
    name: { type: String, required: true },
    isQC: { type: Boolean, default: false },
    inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null }

}, { timestamps: true });

user_Schema.pre("validate", function normalizeRoleBeforeValidate() {
    this.role = normalizeUserRole(this.role, this.role);
});

module.exports = mongoose.model("users", user_Schema);
