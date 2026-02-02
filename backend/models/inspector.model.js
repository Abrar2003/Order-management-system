const mongoose = require("mongoose");

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
    labels_allotted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
  },
  { timestamps: true },
);
module.exports = mongoose.model("inspectors", inspectorSchema);
