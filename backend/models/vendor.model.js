const mongoose = require("mongoose");

const vendorSchema = new mongoose.schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  address: {
    type: String,
  },
});

module.exports = mongoose.model("vendors", vendorSchema);
