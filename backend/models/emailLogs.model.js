const mongoose = require("mongoose");

const emailLogsSchema = new mongoose.Schema({
  order_id: {
    type: String,
    required: true,
  },
  brand: {
    name: { type: String, required: true },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "brands",
      required: true,
    },
  },
  vendor: {
    name: { type: String, required: true },
  },
  log: { type: String, trim: true, default: "" },
  creation_date: { type: Date, default: Date.now },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
});

module.exports = mongoose.model("emailLogs", emailLogsSchema);
