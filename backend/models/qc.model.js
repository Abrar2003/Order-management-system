const mongoose = require("mongoose");

const qcSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      required: true,
      index: true,
    },

    item: {
        item_code: {type: String, required: true},
        description: {type: String, required: true}
    },

    inspector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users", // role = "QC"
      required: true,
    },

    quantities: {
      client_demand: {
        type: Number,
        required: true,
      },
      vendor_provision: {
        type: Number,
        required: true,
        default: 0,
      },
      qc_checked: {
        type: Number,
        default: 0,
      },
      qc_passed: {
        type: Number,
        default: 0,
      },
      qc_rejected: {
        type: Number,
        default: 0,
      },
      pending: {
        type: Number,
        default: 0,
      },
    },

    remarks: {
      type: String,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users", // admin / manager
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("qc", qcSchema);
