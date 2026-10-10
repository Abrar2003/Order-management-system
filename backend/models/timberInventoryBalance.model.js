const mongoose = require("mongoose");

const manufacturerSnapshotSchema = new mongoose.Schema(
  {
    vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    name: { type: String, required: true, trim: true },
    country: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const timberInventoryBalanceSchema = new mongoose.Schema(
  {
    manufacturer_vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, unique: true },
    manufacturer_snapshot: { type: manufacturerSnapshotSchema, required: true },
    approved_received_units: { type: Number, default: 0, min: 0 },
    consumed_units: { type: Number, default: 0, min: 0 },
    net_adjustment_units: { type: Number, default: 0 },
    available_units: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 0, min: 0 },
    last_receipt_at: { type: Date, default: null },
    last_consumption_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "timber_inventory_balances" },
);

module.exports = mongoose.models.TimberInventoryBalance
  || mongoose.model("TimberInventoryBalance", timberInventoryBalanceSchema);
