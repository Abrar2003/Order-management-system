const mongoose = require("mongoose");
const { USER_ROLES, normalizeUserRole } = require("../helpers/userRole");
const { NotificationPreferenceSchema } = require("./notification.model");

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
    inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    allowed_brands: [{ type: mongoose.Schema.Types.ObjectId, ref: "brands" }],
    allowed_vendors: [{ type: String, default: "all", trim: true }],
    last_notification_popup_seen_at: { type: Date, default: null },
    notification_preferences: {
        type: NotificationPreferenceSchema,
        default: () => ({}),
    },

}, { timestamps: true });

user_Schema.pre("validate", function normalizeRoleBeforeValidate() {
    this.role = normalizeUserRole(this.role, this.role);
});

module.exports = mongoose.model("users", user_Schema);
