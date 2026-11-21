const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const { PIMS_FIELDS } = require("../helpers/pimsTemplateFields");

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  await connectDB();
  const templates = await ProductTypeTemplate.find({ key: "table", status: "active" }).select("_id").lean();
  if (!templates.length) throw new Error("No active Table template found");
  for (const template of templates) {
    await ProductTypeTemplate.updateOne(
      { _id: template._id, "groups.key": { $ne: "pims" } },
      { $push: { groups: { key: "pims", label: "PIMS", order: 100, is_active: true, fields: [] } } },
      { runValidators: true },
    );
    for (const field of PIMS_FIELDS) {
      await ProductTypeTemplate.updateOne(
        { _id: template._id, "groups.fields.key": { $ne: field.key }, "groups.key": "pims" },
        { $push: { "groups.$.fields": field } },
        { runValidators: true },
      );
    }
  }
  console.log(`PIMS fields added to ${templates.length} active Table template(s); existing fields preserved.`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error("PIMS field setup failed:", error.message);
    process.exitCode = 1;
  }).finally(() => mongoose.connection.close(false).catch(() => {}));
}

module.exports = { main };
