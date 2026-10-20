const mongoose = require("mongoose");

// A shared write serializes allocations across chains, including the first two concurrent creates.
const schema = new mongoose.Schema({
  _id: String,
  revision: { type: Number, default: 0 },
  caution_acceptances:[{code:String,fingerprint:String,reason:String,actor:{type:mongoose.Schema.Types.ObjectId,ref:"users"},at:Date}],
});

module.exports = mongoose.models.EudrAllocation || mongoose.model("EudrAllocation", schema, "eudr_allocations");
