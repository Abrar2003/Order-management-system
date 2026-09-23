const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const { applyCommonProductDatabaseFields } = require("../helpers/productTypeTemplateCommonFields");

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  await connectDB();

  const templates = await ProductTypeTemplate.find({});
  for (const template of templates) {
    applyCommonProductDatabaseFields(template);
    await template.save();
  }
  console.log(`Updated ${templates.length} product type template(s).`);
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Product type template update failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close(false).catch(() => {}));
}

module.exports = { applyCommonProductDatabaseFields };
