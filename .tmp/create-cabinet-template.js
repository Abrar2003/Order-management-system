const path = require("path");
const dns = require("dns");
const mongoose = require("../backend/node_modules/mongoose");
const XLSX = require("../backend/node_modules/xlsx");
const { loadEnvFiles } = require("../backend/config/loadEnv");
const connectDB = require("../backend/config/connectDB");
const ProductTypeTemplate = require("../backend/models/productTypeTemplate.model");
const {
  mapUploadedRowToProductSpecs,
  prepareTemplatePayload,
} = require("../backend/helpers/productTypeTemplates");

const workbookPath = "C:/Users/Owner/Downloads/Book1.xlsx";

const field = (key, label, sourceHeader, order, extra = {}) => ({
  key,
  label,
  order,
  source_headers: [sourceHeader],
  ...extra,
});

const number = (key, label, sourceHeader, order, extra = {}) =>
  field(key, label, sourceHeader, order, {
    input_type: "number",
    value_type: "number",
    ...extra,
  });

const boolean = (key, label, sourceHeader, order, extra = {}) =>
  field(key, label, sourceHeader, order, {
    input_type: "boolean",
    value_type: "boolean",
    ...extra,
  });

const itemSize = (key, label, order, size_remark, size_source_headers) => ({
  key,
  label,
  order,
  input_type: "item_size",
  value_type: "array",
  size_remark,
  size_source_headers,
});

const boxSize = (key, label, order, size_remark, size_source_headers) => ({
  key,
  label,
  order,
  input_type: "box_size",
  value_type: "array",
  size_remark,
  size_source_headers,
});

const buildCabinetTemplate = () =>
  prepareTemplatePayload({
    key: "cabinet",
    label: "Cabinet",
    description: "Template for cabinet product master information imported from cabinet infosheets.",
    version: 1,
    status: "active",
    groups: [
      {
        key: "basic_info",
        label: "Basic Info",
        order: 10,
        fields: [
          field("item_number", "Item Number", "Item number", 10, { searchable: true, filterable: true, show_in_table: true }),
          field("description", "Description", "Description", 20, { input_type: "textarea", value_type: "string", searchable: true, show_in_table: true }),
          field("cabinet_type", "Type Of Cabinet", "Type of Cabinet", 30, { searchable: true, filterable: true, show_in_table: true }),
          field("barcode_number", "Barcode Number", "BARCODE NO.", 40, { searchable: true }),
          boolean("dropship", "Dropship", "Dropship Yes or No", 50, { filterable: true }),
          number("coli", "Coli", "Coli", 60),
          boolean("assembled", "Assembled", "Assembled Yes/No", 70, { filterable: true }),
          number("cbm", "CBM", "CBM", 80, { unit: "cbm" }),
          number("price", "Price", "Price", 90),
        ],
      },
      {
        key: "sizes",
        label: "Sizes",
        order: 20,
        fields: [
          itemSize("article_size", "Article Size", 10, "article", {
            L: ["depth"], B: ["Width"], H: ["Height"], net_weight: ["kgs"], gross_weight: ["Gross Weight of article"],
          }),
          boxSize("packing_box_1", "Packing Box 1", 20, "box1", {
            L: ["Packing Length box 1"], B: ["Packing Width box 1"], H: ["Packing Height box 1"], gross_weight: ["Weight box 1"],
          }),
          boxSize("packing_box_2", "Packing Box 2", 30, "box2", {
            L: ["Packing Length box 2"], B: ["Packing Width box 2"], H: ["Packing Height box 2"], gross_weight: ["Weight box 2"],
          }),
          boxSize("packing_box_3", "Packing Box 3", 40, "box3", {
            L: ["Packing Length box 3"], B: ["Packing Width box 3"], H: ["Packing Height box 3"], gross_weight: ["Weight box 3"],
          }),
        ],
      },
      {
        key: "materials",
        label: "Materials",
        order: 30,
        fields: [
          field("material_1", "Material 1", "Material 1", 10),
          field("material_2", "Material 2", "Material 2", 20),
          field("material_3", "Material 3", 30),
          field("material_leg", "Material Leg", "Material Leg", 40),
          field("material_back", "Material Back", "Material Back", 50),
          field("material_cabinet", "Material Cabinet", "Material Cabinet", 60),
          field("material_door", "Material Door", "Material Door", 70),
          field("material_drawer", "Material Drawer", "Material Drawer", 80),
          field("glass_type", "Type Of Glass", "Type of Glass", 90),
          field("material_frame", "Material Frame", "Material Frame", 100),
          field("wood_pattern", "Pattern In The Wood", "Pattern in the wood", 110),
        ],
      },
      {
        key: "cabinet_details",
        label: "Cabinet Details",
        order: 40,
        fields: [
          field("open_or_closed", "Open Or Closed Cabinet", "Open or Closed Cabinet", 10, { filterable: true }),
          field("outer_shape", "Outer Shape", "Outer Shape", 20, { filterable: true }),
          field("treated", "Treated", "Treated ", 30),
          boolean("waterproof", "Waterproof", "Waterproof", 40, { filterable: true }),
          boolean("heat_proof", "Heat Proof", "Heat Proof", 50, { filterable: true }),
          boolean("acid_proof", "Acid Proof", "Acid proof", 60, { filterable: true }),
          field("usage_environment", "Indoor / Outdoor / Both", "Indoor/Outdoor/Both", 70, { input_type: "select", value_type: "string", options: ["Indoor", "Outdoor", "Both"], filterable: true }),
        ],
      },
      {
        key: "colors",
        label: "Colors",
        order: 50,
        fields: [
          field("color_1", "Color 1", "Color 1", 10, { filterable: true }),
          field("leg_color", "Color Leg", "Color Leg", 20, { filterable: true }),
          field("frame_color", "Color Frame", "Color Frame", 30, { filterable: true }),
          field("color_2", "Color 2", "Color 2", 40, { filterable: true }),
        ],
      },
      {
        key: "storage",
        label: "Storage",
        order: 60,
        fields: [
          number("drawer_count", "How Many Drawers", "How many Drawers", 10),
          number("drawer_weight_capacity", "Drawer Weight Capacity", "Drawer Weight Capacity", 20),
          number("shelf_count", "How Many Shelves", "How many Shelves", 30),
          boolean("adjustable_shelves", "Adjustable Shelves", "adjustable shelves", 40),
          number("shelf_load_capacity", "Load Capacity Per Shelf", "load capacity per shelve", 50),
          number("compartment_count", "Number Of Compartments", "Number of Compartments", 60),
          number("door_count", "How Many Doors", "How many doors", 70),
          field("door_type", "Type Of Door", "Type of Door", 80),
          boolean("includes_back_wall", "Includes Back Wall", "Includes Back Wall? Yes/No", 90),
          boolean("hole_for_cords", "Hole For Cords", "Hole for cords yes or no", 100),
        ],
      },
      {
        key: "hardware",
        label: "Hardware",
        order: 70,
        fields: [
          field("hinges", "Hinges", "Hinges", 10),
          field("handles_on_door", "Handles On Door", "handles on door", 20),
          field("handles_on_drawers", "Handles On Drawers", "handles on Drawers", 30),
          field("drawer_channels", "Drawer Channels", "Drawer Channels", 40),
          boolean("anti_tip_kit", "Anti Tip Kit", "Anti Tip kit", 50),
          field("mounting_material", "Mounting Material", "Mounting material", 60),
          boolean("protection_caps", "Protection Caps", "Protectioncaps ", 70),
          boolean("shelf_support", "Shelf Support", "Shelf support yes/no", 80),
          boolean("adjustable_feet", "Adjustable Feet", "Adjustable feet yes/no", 90),
        ],
      },
      {
        key: "documents",
        label: "Documents",
        order: 80,
        fields: [
          boolean("cad_drawing", "CAD Drawing", "CAD drawing", 10),
          boolean("assembly_instruction", "Assembly Instruction", "Assembly instruction", 20),
          boolean("maintenance_instruction", "Maintenance Instruction", "Maintanence instruction", 30),
        ],
      },
    ],
  });

const verifyWorkbookMapping = (template) => {
  const sheet = XLSX.readFile(workbookPath).Sheets.Sheet1;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  const headers = rows[3];
  const dataRows = rows.slice(4).filter((row) => String(row?.[0] || "").trim());
  const results = dataRows.map((values) =>
    mapUploadedRowToProductSpecs({ headers, values }, template),
  );

  if (results.length !== 50) throw new Error(`Expected 50 cabinet rows, found ${results.length}`);
  if (!results.every((result) => result.common_fields.code)) {
    throw new Error("Every cabinet row must map an item number");
  }
  const mappedArticleSizes = results.reduce(
    (total, result) => total + result.item_sizes.length,
    0,
  );
  if (mappedArticleSizes !== 49) {
    throw new Error(`Expected 49 mapped article sizes, found ${mappedArticleSizes}`);
  }

  return {
    records: results.length,
    fields: template.groups.reduce((total, group) => total + group.fields.length, 0),
    mappedArticleSizes,
    mappedBoxes: results.reduce((total, result) => total + result.box_sizes.length, 0),
  };
};

const main = async () => {
  const template = buildCabinetTemplate();
  await new ProductTypeTemplate(template).validate();
  const summary = verifyWorkbookMapping(template);

  if (process.argv.includes("--verify-only")) {
    console.log(JSON.stringify({ verified: true, ...summary }, null, 2));
    return;
  }

  loadEnvFiles({ cwd: path.resolve(__dirname, "../backend"), preserveExistingEnv: true });
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
  const mongoUri = process.argv.includes("--script-db")
    ? String(process.env.MONGO_URI_SCRIPT || "").trim()
    : "";
  if (process.argv.includes("--script-db") && !mongoUri) {
    throw new Error("MONGO_URI_SCRIPT is not configured");
  }
  await connectDB(mongoUri ? { mongoUri } : {});

  const existing = await ProductTypeTemplate.findOne({ key: template.key, version: template.version });
  if (existing) {
    throw new Error(`Cabinet v1 already exists with status ${existing.status}`);
  }

  const created = await ProductTypeTemplate.create(template);
  console.log(JSON.stringify({ created: true, id: String(created._id), key: created.key, version: created.version, status: created.status, ...summary }, null, 2));
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
