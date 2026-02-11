const mongoose = require("mongoose");

const qcSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      required: true,
      index: true,
    },
    order_meta : {
      vendor: {type: String, requried: true},
      brand: {type: String, required:true}
    },
    request_date: { 
      type: Date,
      required: true
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

    cbm: {
      top: { type: String, default: "0" },
      bottom: { type: String, default: "0" },
      total: { type: String, default: "0" },
    },

    barcode: {
      type: Number,
      required: true,
      default: 0
    },
    packed_size: {
      type: Boolean,
      required: true,
      default: false
    },
    finishing: {
      type: Boolean,
      required: true,
      default: false
    },
    branding: {
      type: Boolean,
      required: true,
      default: false
    },

    labels: {
      type: [],
      default: [], 
      required: true
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

// 1) Inspector dashboard + date sort/filter
qcSchema.index({ inspector: 1, request_date: -1 });

// 2) Vendor + date (common for ops views)
qcSchema.index({ "order_meta.vendor": 1, request_date: -1 });

// 3) Brand + date
qcSchema.index({ "order_meta.brand": 1, request_date: -1 });

// 4) Item code + date
qcSchema.index({ "item.item_code": 1, request_date: -1 });

// 5) If you often filter by vendor+brand together:
qcSchema.index({ "order_meta.vendor": 1, "order_meta.brand": 1, request_date: -1 });

// Optional (only if you do a LOT of date range queries without other filters)
qcSchema.index({ request_date: -1 });


module.exports = mongoose.model("qc", qcSchema);
