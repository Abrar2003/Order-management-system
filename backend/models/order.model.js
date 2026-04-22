const mongoose = require("mongoose");

const ACTIVE_ORDER_STATUSES = [
  "Pending",
  "Under Inspection",
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const SHIPMENT_QUERY_STATUSES = [
  "Inspection Done",
  "Partial Shipped",
  "Shipped",
];

const normalizeShipmentInvoiceNumber = (value, fallback = "") => {
  const normalized = String(value ?? "").trim();
  return normalized || String(fallback ?? "").trim();
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
      required: false,
      default: "",
    },
    stuffing_date: { type: Date },
    quantity: { type: Number },
    pending: { type: Number },
    cases: [{ type: Number, required: true }],
    remaining_remarks: { type: String },
    stuffed_by: {
      // Keep legacy shipment rows saveable even if they were created before
      // stuffed_by was introduced. New shipment writes are still validated
      // at the controller layer before they reach the model.
      name: { type: String, default: "", trim: true },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    checked: {
      checked_by: { type: mongoose.Schema.Types.ObjectId, default: null },
      checked: { type: Boolean, required: true, default: false },
    },
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
      enum: [...ACTIVE_ORDER_STATUSES, "Cancelled"],
      default: "Pending",
    },
    total_po_cbm: { type: Number, default: 0, min: 0 },
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
    archived: { type: Boolean, default: false },
    archived_remark: { type: String, default: "" },
    archived_at: { type: Date, default: null },
    archived_previous_status: {
      type: String,
      enum: ACTIVE_ORDER_STATUSES,
      default: null,
    },
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

// Exact PO + brand + vendor lookups drive calendar sync and order-link resolution.
Order_Schema.index(
  { order_id: 1, brand: 1, vendor: 1 },
  { name: "orders_order_brand_vendor_idx" },
);

// PO + item lookups are used heavily for duplicate detection and previous-order replacement.
Order_Schema.index(
  { order_id: 1, "item.item_code": 1 },
  { name: "orders_order_item_code_idx" },
);

// Vendor/status screens page newest orders first, so keep the filter and recency sort together.
Order_Schema.index(
  { vendor: 1, status: 1, order_date: -1, order_id: 1 },
  { name: "orders_vendor_status_order_date_idx" },
);

// Item drilldowns read many rows by item code and then sort by the latest order/update activity.
Order_Schema.index(
  { "item.item_code": 1, order_date: -1, updatedAt: -1, order_id: 1 },
  { name: "orders_item_code_activity_idx" },
);

// Shipment searches focus on shippable statuses and container lookups, so keep this index partial.
Order_Schema.index(
  {
    "shipment.container": 1,
    vendor: 1,
    order_date: -1,
    updatedAt: -1,
    order_id: 1,
  },
  {
    name: "orders_shipment_container_vendor_idx",
    partialFilterExpression: {
      status: { $in: SHIPMENT_QUERY_STATUSES },
    },
  },
);

// Archived-order pages sort by archive time; this replaces the old single-field archived index.
Order_Schema.index(
  { archived: 1, archived_at: -1, updatedAt: -1, order_id: -1 },
  {
    name: "orders_archived_list_idx",
    partialFilterExpression: { archived: true },
  },
);

Order_Schema.pre("validate", function backfillLegacyShipmentInvoices() {
  if (!Array.isArray(this.shipment)) return;

  this.shipment.forEach((entry) => {
    if (!entry) return;
    entry.invoice_number = normalizeShipmentInvoiceNumber(
      entry.invoice_number,
      "",
    );

    if (!entry.stuffed_by || typeof entry.stuffed_by !== "object") {
      entry.stuffed_by = {};
    }

    if (!String(entry.stuffed_by.name || "").trim()) {
      entry.stuffed_by.name = String(entry.updated_by?.name || "").trim();
    }

    if (!entry.stuffed_by.id && entry.updated_by?.user) {
      entry.stuffed_by.id = entry.updated_by.user;
    }
  });
});

module.exports = mongoose.model("orders", Order_Schema);
