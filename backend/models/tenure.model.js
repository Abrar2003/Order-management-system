const mongoose = require("mongoose");

const normalizeText = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

const tenureSchema = new mongoose.Schema(
  {
    brand: { type: String, required: true, trim: true },
    from_date: { type: Date, required: true },
    to_date: { type: Date, required: true },
  },
  { timestamps: true, collection: "tenures" },
);

tenureSchema.pre("validate", function normalizeTenure() {
  this.brand = normalizeText(this.brand);
  if (!this.brand) this.invalidate("brand", "Brand is required");
  if (this.from_date && this.to_date && this.to_date < this.from_date) {
    this.invalidate("to_date", "Tenure to date cannot be before from date");
  }
});

tenureSchema.index({ brand: 1, from_date: 1, to_date: 1 }, { unique: true });

module.exports = mongoose.model("tenures", tenureSchema);
