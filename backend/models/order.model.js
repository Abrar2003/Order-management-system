const mongoose = require("mongoose");

const Order_Schema = new mongoose.Schema(
  {
    order_id: { type: String, required: true },
    item: {
      item_code: { type: String, required: true },
      description: { type: String }
    },
    vendor: { type: String, required: true },
    ETD: { type: Date },
    order_date: { type: Date, default: Date.now() },
    status: { type: String, enum: ["Pending", "Under Inspection", "Finalized"], default: "Pending" },
    quantity: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("orders", Order_Schema);
