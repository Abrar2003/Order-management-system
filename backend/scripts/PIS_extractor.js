const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const INPUT_FILE = path.resolve(__dirname, "./data/96568_Kopie van Productsheet tables- SURAJ INT-109.xlsx");// backend\scripts\data\96568_Kopie van Productsheet tables- SURAJ INT-109.xlsx
const OUTPUT_FILE = path.resolve(__dirname, "./data/96568_Kopie van Productsheet tables- SURAJ INT-109.json");

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\r/g, "").trim();
  return text === "" ? null : text;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function toBooleanFromYesNo(yesValue, noValue) {
  const yes = normalizeText(yesValue);
  const no = normalizeText(noValue);

  if (yes && /^yes$/i.test(yes)) return true;
  if (no && /^no$/i.test(no)) return false;
  return null;
}

function cell(sheet, row, col) {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return sheet[addr] ? sheet[addr].v : null;
}

function getRowValues(sheet, row, maxCols = 42) {
  const values = [];
  for (let c = 1; c <= maxCols; c += 1) {
    values.push(cell(sheet, row, c));
  }
  return values;
}

function extractPricingHeaders(sheet) {
  const headers = [];
  for (let c = 1; c <= 42; c += 1) {
    const value = normalizeText(cell(sheet, 18, c));
    if (value) headers.push(value);
  }
  return headers;
}

function extractMaterials(sheet) {
  const materials = [];
  for (let row = 22; row <= 27; row += 1) {
    const materialType = normalizeText(cell(sheet, row, 1));
    if (!materialType) continue;

    materials.push({
      material_type: materialType,
      material_name: normalizeText(cell(sheet, row, 3)),
      composition_percent: toNumber(cell(sheet, row, 8)),
      color: normalizeText(cell(sheet, row, 12)),
      finishing: normalizeText(cell(sheet, row, 18)), // if present in future files
    });
  }
  return materials;
}

function extractDimensions(sheet) {
  const makeDimensionRow = (rowLabel, row) => ({
    label: rowLabel,
    length: toNumber(cell(sheet, row, 4)),
    width: toNumber(cell(sheet, row, 6)),
    depth: toNumber(cell(sheet, row, 8)),
    height: toNumber(cell(sheet, row, 10)),
    thickness: toNumber(cell(sheet, row, 12)),
    weight: toNumber(cell(sheet, row, 14)),
    kd: normalizeText(cell(sheet, row, 16)),
    quantity_in_box: toNumber(cell(sheet, row, 18)),
  });

  return {
    item: makeDimensionRow("Item", 31),
    table_top: makeDimensionRow("Table top", 32),
    legs: makeDimensionRow("Legs", 33),
    box_sizes: [
      {
        part: "top",
        length: toNumber(cell(sheet, 36, 4)),
        width: toNumber(cell(sheet, 36, 6)),
        depth: toNumber(cell(sheet, 36, 8)),
        height: toNumber(cell(sheet, 36, 10)),
        thickness: toNumber(cell(sheet, 36, 12)),
        weight: toNumber(cell(sheet, 36, 14)),
        quantity_in_box: toNumber(cell(sheet, 36, 18)),
      },
      {
        part: "legs",
        length: toNumber(cell(sheet, 37, 4)),
        width: toNumber(cell(sheet, 37, 6)),
        depth: toNumber(cell(sheet, 37, 8)),
        height: toNumber(cell(sheet, 37, 10)),
        thickness: toNumber(cell(sheet, 37, 12)),
        weight: toNumber(cell(sheet, 37, 14)),
        quantity_in_box: toNumber(cell(sheet, 37, 18)),
      },
    ],
  };
}

function extractHardware(sheet) {
  return {
    table_top: normalizeText(cell(sheet, 41, 4)),
    legs: normalizeText(cell(sheet, 41, 6)),
    extendable: normalizeText(cell(sheet, 41, 8)),
    butterfly: normalizeText(cell(sheet, 41, 10)),
    bold_and_washers: normalizeText(cell(sheet, 41, 4)),
    sleeding_guide: normalizeText(cell(sheet, 42, 4)),
    handles: normalizeText(cell(sheet, 43, 4)),
    stoppers: normalizeText(cell(sheet, 44, 4)),
    locks: normalizeText(cell(sheet, 45, 4)),
    wheels: normalizeText(cell(sheet, 46, 4)),
    protection_caps: normalizeText(cell(sheet, 47, 4)),
    kd: normalizeText(cell(sheet, 48, 4)),
    allen_key: normalizeText(cell(sheet, 49, 4)),
  };
}

function extractFeatures(sheet) {
  const featureRows = {
    instruction_manual: 53,
    waterproof: 54,
    liquid_proof: 55,
    heat_resistant: 56,
    suitable_for_indoor: 57,
    suitable_for_outdoor: 58,
    suitable_for_bathroom: 59,
    mounting_material: 60,
    maintenance_instruction: 61,
  };

  const result = {};
  for (const [key, row] of Object.entries(featureRows)) {
    result[key] = toBooleanFromYesNo(cell(sheet, row, 4), cell(sheet, row, 5));
  }
  return result;
}

function extractBranding(sheet) {
  const brandName = normalizeText(cell(sheet, 65, 1));
  const barcodeSticker = normalizeText(cell(sheet, 65, 4));
  const transparentSticker = normalizeText(cell(sheet, 65, 6));
  const hangtag = normalizeText(cell(sheet, 65, 8));

  return {
    brand_name: brandName,
    barcode_sticker: barcodeSticker ? /^x$/i.test(barcodeSticker) : false,
    transparent_sticker: transparentSticker ? /^x$/i.test(transparentSticker) : false,
    hangtag: hangtag ? /^x$/i.test(hangtag) : false,
  };
}

function extractTradePackaging(sheet) {
  return {
    barcode_master_box: normalizeText(cell(sheet, 9, 9)),
    barcode_pcs: normalizeText(cell(sheet, 10, 9)),
    hs_code: toNumber(cell(sheet, 11, 9)),
    import_duties: toNumber(cell(sheet, 12, 9)),
    moq_first_order: toNumber(cell(sheet, 13, 9)),
    moq_reorder: toNumber(cell(sheet, 14, 9)),
    maximum_carrying_capacity: normalizeText(cell(sheet, 16, 9)),
    master_box_cbm: toNumber(cell(sheet, 9, 16)),
    pcs_in_box: toNumber(cell(sheet, 10, 16)),
    cbm_per_unit: toNumber(cell(sheet, 11, 16)),
    packing_weight: {
      paper_carton_total_kg: toNumber(cell(sheet, 13, 16)),
      plastics_styrofoam_total_kg: toNumber(cell(sheet, 15, 16)),
      paper_carton_per_piece_kg: toNumber(cell(sheet, 13, 18)),
      plastics_styrofoam_per_piece_kg: toNumber(cell(sheet, 15, 18)),
    },
  };
}

function extractProductInfo(sheet) {
  return {
    brand: normalizeText(cell(sheet, 1, 1)),
    supplier: normalizeText(cell(sheet, 1, 10)),
    supplier_ref: normalizeText(cell(sheet, 2, 10)),
    product_type: normalizeText(cell(sheet, 3, 10)),
    article_number: toNumber(cell(sheet, 4, 10)),
    article_name: normalizeText(cell(sheet, 5, 10)),
    collection: normalizeText(cell(sheet, 6, 10)),
    sales_unit: toNumber(cell(sheet, 7, 10)),
  };
}

function extractWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  return {
    source_file: path.basename(filePath),
    sheet_name: sheetName,
    product_info: extractProductInfo(sheet),
    trade_packaging: extractTradePackaging(sheet),
    pricing_headers_present: extractPricingHeaders(sheet),
    materials: extractMaterials(sheet),
    dimensions_cm: extractDimensions(sheet),
    hardware: extractHardware(sheet),
    features: extractFeatures(sheet),
    branding: extractBranding(sheet),
  };
}

try {
  const result = extractWorkbook(INPUT_FILE);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), "utf8");

  console.log("JSON extracted successfully.");
  console.log(`Input : ${INPUT_FILE}`);
  console.log(`Output: ${OUTPUT_FILE}`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Failed to extract workbook:", error);
  process.exit(1);
}