const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const ProductTypeTemplate = require("../models/productTypeTemplate.model");
const { prepareTemplatePayload } = require("../helpers/productTypeTemplates");

const buildField = ({
  key,
  label,
  order,
  input_type = "text",
  value_type,
  description = "",
  unit = "",
  required = false,
  searchable = false,
  filterable = false,
  show_in_table = false,
  options = [],
  default_value = null,
  validation = {},
  source_headers = [],
  size_source_headers = {},
  size_remark = "",
  box_type = "individual",
  is_active = true,
} = {}) => ({
  key,
  label,
  description,
  input_type,
  value_type,
  unit,
  required,
  searchable,
  filterable,
  show_in_table,
  order,
  options,
  default_value,
  validation,
  source_headers,
  size_source_headers,
  size_remark,
  box_type,
  is_active,
});

const buildBooleanField = (config = {}) =>
  buildField({
    ...config,
    input_type: "boolean",
    value_type: "boolean",
    validation: {
      true_values: ["YES", "Yes", "yes", "TRUE", "True", "true", "1"],
      false_values: ["NO", "No", "no", "FALSE", "False", "false", "0", "-"],
      ...(config.validation || {}),
    },
  });

const buildNumberField = (config = {}) =>
  buildField({
    ...config,
    input_type: "number",
    value_type: "number",
  });

const buildSelectField = (config = {}) =>
  buildField({
    ...config,
    input_type: "select",
    value_type: "string",
  });

const buildItemSizeField = (config = {}) =>
  buildField({
    ...config,
    input_type: "item_size",
    value_type: "array",
  });

const buildBoxSizeField = (config = {}) =>
  buildField({
    ...config,
    input_type: "box_size",
    value_type: "array",
  });

const buildTableTemplate = () =>
  prepareTemplatePayload({
    key: "table",
    label: "Table",
    description:
      "Template for table-like product master information imported from row-based infosheets.",
    version: 1,
    status: "active",
    groups: [
      {
        key: "basic_info",
        label: "Basic Info",
        order: 10,
        fields: [
          buildField({
            key: "item_number",
            label: "Item Number",
            order: 10,
            searchable: true,
            filterable: true,
            show_in_table: true,
            source_headers: ["Item number"],
          }),
          buildField({
            key: "description",
            label: "Description",
            order: 20,
            input_type: "textarea",
            value_type: "string",
            searchable: true,
            show_in_table: true,
            source_headers: ["Description"],
          }),
          buildField({
            key: "table_type",
            label: "Table Type",
            order: 30,
            searchable: true,
            filterable: true,
            show_in_table: true,
            source_headers: ["Table type "],
          }),
          buildField({
            key: "barcode_number",
            label: "Barcode Number",
            order: 40,
            searchable: true,
            source_headers: ["BARCODE NO."],
          }),
          buildBooleanField({
            key: "dropship",
            label: "Dropship",
            order: 50,
            filterable: true,
            source_headers: ["Dropship Yes or No"],
          }),
          buildNumberField({
            key: "coli",
            label: "Coli",
            order: 60,
            source_headers: ["Coli"],
          }),
          buildBooleanField({
            key: "assembly_needed",
            label: "Assembly Needed",
            order: 70,
            filterable: true,
            source_headers: ["Assembly Needed Yes/No"],
          }),
          buildNumberField({
            key: "cbm",
            label: "CBM",
            order: 80,
            unit: "cbm",
            source_headers: ["CBM"],
          }),
          buildNumberField({
            key: "price",
            label: "Price",
            order: 90,
            source_headers: ["Price"],
          }),
        ],
      },
      {
        key: "sizes",
        label: "Sizes",
        order: 20,
        fields: [
          buildItemSizeField({
            key: "article_size",
            label: "Article Size",
            order: 10,
            description:
              "Maps article dimensions and weights into product_specs.item_sizes.",
            size_remark: "article",
            size_source_headers: {
              L: ["depth"],
              B: ["Width"],
              H: ["Height"],
              net_weight: ["kgs"],
              gross_weight: ["Gross Weight of article"],
            },
          }),
          buildBoxSizeField({
            key: "packing_box_1",
            label: "Packing Box 1",
            order: 20,
            size_remark: "box1",
            size_source_headers: {
              L: ["Packing Length box 1"],
              B: ["Packing Width box 1"],
              H: ["Packing Height box 1"],
              gross_weight: ["Weight box 1"],
            },
          }),
          buildBoxSizeField({
            key: "packing_box_2",
            label: "Packing Box 2",
            order: 30,
            size_remark: "box2",
            size_source_headers: {
              L: ["Packing Length box 2"],
              B: ["Packing Width box 2"],
              H: ["Packing Height box 2"],
              gross_weight: ["Weight box 2"],
            },
          }),
          buildBoxSizeField({
            key: "packing_box_3",
            label: "Packing Box 3",
            order: 40,
            size_remark: "box3",
            size_source_headers: {
              L: ["Packing Length box 3"],
              B: ["Packing Width box 3"],
              H: ["Packing Height box 3"],
              gross_weight: ["Weight box 3"],
            },
          }),
          buildItemSizeField({
            key: "table_top_size",
            label: "Table Top Size",
            order: 50,
            size_remark: "table_top",
            size_source_headers: {
              H: ["h"],
              L: ["L"],
              B: ["w"],
            },
          }),
          buildField({
            key: "seating_capacity",
            label: "Seating Capacity",
            order: 60,
            source_headers: ["Number of People who can sit"],
          }),
          buildNumberField({
            key: "leg_clearance_from_floor",
            label: "Leg Clearance From Floor",
            order: 70,
            source_headers: ["Leg Cleance distance from Floor"],
          }),
          buildItemSizeField({
            key: "leg_distance_size",
            label: "Distance Between Table Legs",
            order: 80,
            size_remark: "leg_distance",
            size_source_headers: {
              L: ["L"],
              B: ["W"],
              H: ["H"],
            },
          }),
        ],
      },
      {
        key: "materials",
        label: "Materials",
        order: 30,
        fields: [
          buildField({
            key: "material_1",
            label: "Material 1",
            order: 10,
            source_headers: ["Material 1"],
          }),
          buildField({
            key: "material_2",
            label: "Material 2",
            order: 20,
            source_headers: ["Material 2"],
          }),
          buildField({
            key: "material_top",
            label: "Material Top",
            order: 30,
            source_headers: ["Material Top"],
          }),
          buildField({
            key: "material_leg",
            label: "Material Leg",
            order: 40,
            source_headers: ["Material Leg"],
          }),
          buildField({
            key: "material_frame",
            label: "Material Frame",
            order: 50,
            source_headers: ["Material Frame"],
          }),
          buildField({
            key: "wood_pattern",
            label: "Pattern In The Wood",
            order: 60,
            source_headers: ["Pattern in the wood"],
          }),
        ],
      },
      {
        key: "table_details",
        label: "Table Details",
        order: 40,
        fields: [
          buildSelectField({
            key: "top_construction",
            label: "Top Solid Or Flip",
            order: 10,
            options: ["SOLID", "FLIP"],
            source_headers: ["Is the Top Solid or Flip"],
          }),
          buildField({
            key: "outer_shape",
            label: "Outer Shape",
            order: 20,
            source_headers: ["Outer Shape"],
          }),
          buildBooleanField({
            key: "top_has_backing",
            label: "Table Top Has Backing",
            order: 30,
            source_headers: ["Does the table top have backing  (YES/NO)"],
          }),
          buildField({
            key: "backing_material",
            label: "Backing Material",
            order: 40,
            source_headers: ["Backing under table top Materia"],
          }),
          buildNumberField({
            key: "number_of_legs",
            label: "Number Of Legs",
            order: 50,
            source_headers: ["Number of Legs"],
          }),
          buildField({
            key: "leg_shape",
            label: "Shape Of Leg",
            order: 60,
            source_headers: ["Shape of Leg"],
          }),
          buildField({
            key: "support_shape_between_legs",
            label: "Shape Of Support Between Legs",
            order: 70,
            source_headers: ["Shape of support between legs"],
          }),
          buildField({
            key: "kd_or_fixed",
            label: "KD Or Fixed",
            order: 80,
            source_headers: ["KD or Fixed"],
          }),
        ],
      },
      {
        key: "tests_usage",
        label: "Tests & Usage",
        order: 50,
        fields: [
          buildField({
            key: "treated",
            label: "Treated",
            order: 10,
            source_headers: ["Treated "],
          }),
          buildBooleanField({
            key: "waterproof",
            label: "Waterproof",
            order: 20,
            filterable: true,
            source_headers: ["Waterproof"],
          }),
          buildBooleanField({
            key: "heat_proof",
            label: "Heat Proof",
            order: 30,
            filterable: true,
            source_headers: ["Heat Proof"],
          }),
          buildBooleanField({
            key: "coffee_test",
            label: "Coffee Test",
            order: 40,
            filterable: true,
            source_headers: ["Coffee Test"],
          }),
          buildBooleanField({
            key: "fat_test",
            label: "Fat Test",
            order: 50,
            filterable: true,
            source_headers: ["fat Test"],
          }),
          buildBooleanField({
            key: "acid_proof",
            label: "Acid Proof",
            order: 60,
            filterable: true,
            source_headers: ["Acid proof"],
          }),
          buildSelectField({
            key: "usage_environment",
            label: "Indoor / Outdoor / Both",
            order: 70,
            filterable: true,
            options: ["Indoor", "Outdoor", "Both"],
            source_headers: ["Indoor/Outdoor/Both"],
          }),
        ],
      },
      {
        key: "colors",
        label: "Colors",
        order: 60,
        fields: [
          buildField({
            key: "top_color",
            label: "Top Color",
            order: 10,
            filterable: true,
            source_headers: ["Top Color"],
          }),
          buildField({
            key: "legs_color",
            label: "Legs Color",
            order: 20,
            filterable: true,
            source_headers: ["Legs Color"],
          }),
          buildField({
            key: "frame_color",
            label: "Frame Color",
            order: 30,
            filterable: true,
            source_headers: ["Frame Color"],
          }),
        ],
      },
      {
        key: "storage",
        label: "Storage",
        order: 70,
        fields: [
          buildNumberField({
            key: "drawer_count",
            label: "How Many Drawers",
            order: 10,
            source_headers: ["How many Drawers"],
          }),
          buildNumberField({
            key: "drawer_weight_capacity",
            label: "Drawer Weight Capacity",
            order: 20,
            source_headers: ["Drawer Weight Capacity"],
          }),
          buildNumberField({
            key: "shelf_count",
            label: "How Many Shelves",
            order: 30,
            source_headers: ["How many Shelves"],
          }),
          buildNumberField({
            key: "shelf_load_capacity",
            label: "Load Capacity Per Shelf",
            order: 40,
            source_headers: ["load capacity per shelve"],
          }),
          buildNumberField({
            key: "compartment_count",
            label: "Number Of Compartments",
            order: 50,
            source_headers: ["Number of Compartments"],
          }),
          buildField({
            key: "handles_on_drawers",
            label: "Handles On Drawers",
            order: 60,
            source_headers: ["handles on Drawers"],
          }),
          buildField({
            key: "drawer_channels",
            label: "Drawer Channels",
            order: 70,
            source_headers: ["Drawer Channels"],
          }),
          buildBooleanField({
            key: "extendable",
            label: "Extendable",
            order: 80,
            source_headers: ["Extendable"],
          }),
        ],
      },
      {
        key: "hardware",
        label: "Hardware",
        order: 80,
        fields: [
          buildField({
            key: "type_of_bolts_used",
            label: "Type Of Bolts Used",
            order: 10,
            source_headers: ["Type of Bolts Used"],
          }),
          buildField({
            key: "mounting_material",
            label: "Mounting Material",
            order: 20,
            source_headers: ["Mounting material"],
          }),
          buildBooleanField({
            key: "protection_caps",
            label: "Protection Caps",
            order: 30,
            source_headers: ["Protectioncaps "],
          }),
          buildBooleanField({
            key: "adjustable_feet",
            label: "Adjustable Feet",
            order: 40,
            source_headers: ["Adjustable feet yes/no"],
          }),
        ],
      },
      {
        key: "documents",
        label: "Documents",
        order: 90,
        fields: [
          buildBooleanField({
            key: "cad_drawing",
            label: "CAD Drawing",
            order: 10,
            source_headers: ["CAD drawing"],
          }),
          buildBooleanField({
            key: "assembly_instruction",
            label: "Assembly Instruction",
            order: 20,
            source_headers: ["Assembly instruction"],
          }),
          buildBooleanField({
            key: "maintenance_instruction",
            label: "Maintenance Instruction",
            order: 30,
            source_headers: ["Maintanence instruction"],
          }),
        ],
      },
    ],
  });

const seedTemplate = async (payload = {}) => {
  const existing = await ProductTypeTemplate.findOne({
    key: payload.key,
    version: payload.version,
  });

  if (existing) {
    existing.set(payload);
    await existing.save();
    if (existing.status === "active") {
      await ProductTypeTemplate.updateMany(
        {
          key: existing.key,
          status: "active",
          _id: { $ne: existing._id },
        },
        { $set: { status: "inactive" } },
      );
    }
    return { action: "updated", doc: existing };
  }

  const created = await ProductTypeTemplate.create(payload);
  if (created.status === "active") {
    await ProductTypeTemplate.updateMany(
      {
        key: created.key,
        status: "active",
        _id: { $ne: created._id },
      },
      { $set: { status: "inactive" } },
    );
  }
  return { action: "created", doc: created };
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
    preserveExistingEnv: true,
  });
  
  await connectDB();

  const templates = [buildTableTemplate()];
  for (const template of templates) {
    const result = await seedTemplate(template);
    console.log(
      `[${result.action}] ${result.doc.key} v${result.doc.version} (${result.doc.status})`,
    );
  }
};

main()
  .catch((error) => {
    console.error("Seed product type templates failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
