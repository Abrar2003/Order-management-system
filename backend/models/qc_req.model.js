const mongoose = require("mongoose");

const QC_Request_Schema = new mongoose.Schema({
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: "orders", required: true },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
    qc_status: { type: String, enum: ["Pending", "In Progress", "Completed"], default: "Pending" },
    quantity_checked: { type: Number },
    quantity_offered: { type: Number },
    quantity: { type: Number, required: true },
    remarks: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("qc_requests", QC_Request_Schema);