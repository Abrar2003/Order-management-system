const mongoose = require("mongoose");

const normalizeShipmentInvoiceNumber = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || "N/A";
};

const RevisedEtdHistorySchema = new mongoose.Schema(
  {
    revised_etd: { type: Date, required: true },
    updated_at: { type: Date, default: Date.now },
    updated_by: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
        default: null,
      },
      name: { type: String, default: "" },
    },
  },
  { _id: false },
);

const AuditActorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    name: { type: String, default: "" },
  },
  { _id: false },
);

const ShipmentEntrySchema = new mongoose.Schema(
  {
    container: { type: String, trim: true, required: true },
    invoice_number: {
      type: String,
      trim: true,
      required: true,
      default: "N/A",
    },
    stuffing_date: { type: Date },
    quantity: { type: Number },
    pending: { type: Number },
    remaining_remarks: { type: String },
    updated_at: { type: Date, default: Date.now },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { _id: true },
);

const Order_Schema = new mongoose.Schema(
  {
    order_id: { type: String, required: true },
    item: {
      item_code: { type: String, required: true },
      description: { type: String }
    },
    brand: { type: String, required: true },
    vendor: { type: String, required: true },
    ETD: { type: Date },
    revised_ETD: { type: Date },
    revised_etd_history: { type: [RevisedEtdHistorySchema], default: [] },
    order_date: { type: Date, default: Date.now() },
    status: {
      type: String,
      enum: [
        "Pending",
        "Under Inspection",
        "Inspection Done",
        "Partial Shipped",
        "Shipped",
        "Cancelled",
      ],
      default: "Pending",
    },
    quantity: { type: Number, required: true },
    shipment: { type: [ShipmentEntrySchema], default: [] },
    gcal: {
      calendarId: { type: String, default: null },
      eventId: { type: String, default: null },
      lastSyncedAt: { type: Date, default: null },
      lastSyncError: { type: String, default: null },
    },
    qc_record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "qc",
      default: null,
    },
    archived: { type: Boolean, default: false, index: true },
    archived_remark: { type: String, default: "" },
    archived_at: { type: Date, default: null },
    archived_by: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
        default: null,
      },
      name: { type: String, default: "" },
    },
    updated_by: { type: AuditActorSchema, default: () => ({}) },
  },
  { timestamps: true }
);

Order_Schema.pre("validate", function backfillLegacyShipmentInvoices() {
  if (!Array.isArray(this.shipment)) return;

  this.shipment.forEach((entry) => {
    if (!entry) return;
    entry.invoice_number = normalizeShipmentInvoiceNumber(entry.invoice_number);
  });
});

module.exports = mongoose.model("orders", Order_Schema);
