const mongoose = require("mongoose");
const path = require("path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Item = require("../models/item.model");

const TABLE_FIELD_GROUPS = Object.freeze({
  seating_capacity: { key: "table_details", label: "Table Details" },
  table_top_thickness: { key: "sizes", label: "Sizes" },
});

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  await connectDB();

  let modifiedCount = 0;
  for (const [fieldKey, group] of Object.entries(TABLE_FIELD_GROUPS)) {
    const result = await Item.updateMany(
      {
        $and: [
          {
            $or: [
              { "product_type.key": /^table$/i },
              { "product_type.label": /^table$/i },
            ],
          },
          { "product_specs.fields.key": fieldKey },
        ],
      },
      {
        $set: {
          "product_specs.fields.$[field].group_key": group.key,
          "product_specs.fields.$[field].group_label": group.label,
        },
      },
      { arrayFilters: [{ "field.key": fieldKey }] },
    );
    modifiedCount += result.modifiedCount;
  }

  console.log(`Updated product-spec groups for ${modifiedCount} table item(s).`);
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Table product-spec group update failed:", error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close(false).catch(() => {}));
}

module.exports = { TABLE_FIELD_GROUPS };
