const mongoose = require("mongoose");

const LabelHistoryActorSchema = new mongoose.Schema(
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

const LabelAllocationHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "allocate",
        "transfer_in",
        "transfer_out",
        "reject",
        "replace",
        "remove",
      ],
      required: true,
    },
    labels: [{ type: Number, min: 0 }],
    previous_labels: [{ type: Number, min: 0 }],
    next_labels: [{ type: Number, min: 0 }],
    from_inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      default: null,
    },
    to_inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspectors",
      default: null,
    },
    actor: { type: LabelHistoryActorSchema, default: () => ({}) },
    recorded_at: { type: Date, default: Date.now },
    remarks: { type: String, default: "" },
  },
  { _id: true },
);

const LabelUsedHistorySchema = new mongoose.Schema(
  {
    labels: [{ type: Number, min: 0 }],
    inspection_record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "inspections",
      required: true,
      index: true,
    },
    qc: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "qc",
      default: null,
      index: true,
    },
    request_history_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    qc_meta: {
      order_id: { type: String, default: "" },
      brand: { type: String, default: "" },
      vendor: { type: String, default: "" },
      item_code: { type: String, default: "" },
      description: { type: String, default: "" },
    },
    inspection_date: { type: String, default: "" },
    used_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const inspectorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    assignedOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: "orders" }],
    alloted_labels: { type: Array, default: [] },
    used_labels: { type: Array, default: [] },
    rejected_labels: { type: Array, default: [] },
    label_allocation_history: {
      type: [LabelAllocationHistorySchema],
      default: [],
    },
    label_used_history: {
      type: [LabelUsedHistorySchema],
      default: [],
    },
    labels_allotted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
  },
  { timestamps: true },
);
module.exports = mongoose.model("inspectors", inspectorSchema);
