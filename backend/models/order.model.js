const mongoose = require("mongoose");

const Order_Schema = new mongoose.Schema(
  {
    order_id: { type: String, required: true },
    item_id: { type: mongoose.Schema.Types.ObjectId, ref: "items", required: true },
    ETD: { type: Date },
    order_date: { type: Date, default: Date.now() },
    status: { type: String, enum: ["Pending", "To be requested", "Requested", "QC Done"], default: "Pending" },
    quantity: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("orders", Order_Schema);
