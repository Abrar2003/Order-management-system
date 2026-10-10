const mongoose = require("mongoose");

const actorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    name: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const timberInventoryLedgerSchema = new mongoose.Schema(
  {
    manufacturer_vendor_id: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    transaction_type: {
      type: String,
      enum: ["RECEIPT_CREDIT", "CONTAINER_DEBIT", "CONTAINER_REVERSAL", "RECEIPT_CORRECTION", "OPENING_BALANCE_CREDIT", "AUTHORIZED_ADJUSTMENT"],
      required: true,
    },
    quantity_units: { type: Number, required: true, min: 1 },
    signed_delta_units: { type: Number, required: true },
    balance_after_units: { type: Number, required: true, min: 0 },
    source_type: { type: String, required: true, trim: true },
    source_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    source_event_key: { type: String, required: true, unique: true, trim: true },
    timber_purchase_id: { type: mongoose.Schema.Types.ObjectId, ref: "TimberPurchase", default: null, index: true },
    timber_receipt_id: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    container_consumption_id: { type: mongoose.Schema.Types.ObjectId, ref: "TimberContainerConsumption", default: null, index: true },
    remarks: { type: String, default: "", trim: true, maxlength: 4000 },
    created_by: { type: actorSchema, default: () => ({}) },
    reversal_of_transaction_id: { type: mongoose.Schema.Types.ObjectId, ref: "TimberInventoryLedger", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false }, collection: "timber_inventory_ledger" },
);

timberInventoryLedgerSchema.index({ manufacturer_vendor_id: 1, created_at: -1 });
timberInventoryLedgerSchema.index({ timber_purchase_id: 1, timber_receipt_id: 1 });

timberInventoryLedgerSchema.pre("save", function preventLedgerChanges() {
  if (!this.isNew) throw new Error("Inventory ledger entries are immutable");
});

["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"].forEach((operation) => {
  timberInventoryLedgerSchema.pre(operation, function preventLedgerMutation() {
    throw new Error("Inventory ledger entries are immutable");
  });
});

module.exports = mongoose.models.TimberInventoryLedger
  || mongoose.model("TimberInventoryLedger", timberInventoryLedgerSchema);
