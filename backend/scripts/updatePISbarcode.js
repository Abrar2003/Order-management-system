const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const XLSX = require("xlsx");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env.production") });

const args = process.argv.slice(2);
const shouldApply = args.includes("--apply");

const fileArgIndex = args.indexOf("--file");
const filePath =
  fileArgIndex >= 0
    ? path.resolve(process.cwd(), args[fileArgIndex + 1])
    : path.resolve(__dirname, "../data/All EAN India.xlsx");

function cleanCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\.0$/, "").trim();
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function readBarcodeRows(xlsxPath) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`XLSX file not found: ${xlsxPath}`);
  }

  const workbook = XLSX.readFile(xlsxPath, {
    cellDates: false,
    cellNF: false,
    cellText: true,
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });

  const byCode = new Map();

  for (const row of rows) {
    const code = cleanCell(
      row.item_code || row.Item_Code || row.ITEM_CODE || row.code || row.Code,
    );

    const barcode = cleanCell(
      row.barcode ||
        row.Barcode ||
        row.BARCODE ||
        row.ean ||
        row.EAN ||
        row["Master EAN"],
    );

    if (!code || !barcode) continue;

    byCode.set(code, barcode);
  }

  return Array.from(byCode.entries()).map(([code, barcode]) => ({
    code,
    barcode,
  }));
}

async function main() {
  const mongoUri = String(process.env.MONGO_URI || "").trim();

  if (!mongoUri) {
    throw new Error("MONGO_URI is missing in env");
  }

  const rows = readBarcodeRows(filePath);

  if (!rows.length) {
    throw new Error("No valid item_code + barcode rows found in XLSX");
  }

  await mongoose.connect(mongoUri);

  const items = mongoose.connection.collection("items");

  const codes = rows.map((row) => row.code);

  const existingItems = await items
    .find(
      { code: { $in: codes } },
      { projection: { code: 1 } },
    )
    .toArray();

  const existingCodeSet = new Set(existingItems.map((item) => item.code));

  const matchedRows = rows.filter((row) => existingCodeSet.has(row.code));
  const unmatchedRows = rows.filter((row) => !existingCodeSet.has(row.code));

  console.log({
    xlsxRows: rows.length,
    matchedItems: matchedRows.length,
    unmatchedItems: unmatchedRows.length,
    mode: shouldApply ? "APPLY" : "DRY_RUN",
  });

  if (unmatchedRows.length) {
    const unmatchedPath = path.resolve(
      process.cwd(),
      "unmatched-pis-master-barcodes.json",
    );

    fs.writeFileSync(unmatchedPath, JSON.stringify(unmatchedRows, null, 2));
    console.log(`Unmatched rows saved to: ${unmatchedPath}`);
  }

  if (!shouldApply) {
    console.log("Dry run only. Re-run with --apply to update MongoDB.");
    console.log("Sample rows:", matchedRows.slice(0, 5));
    await mongoose.disconnect();
    return;
  }

  const ops = matchedRows.map((row) => ({
    updateOne: {
      filter: { code: row.code },
      update: {
        $set: {
          pis_master_barcode: row.barcode,
          pis_barcode: row.barcode,
          updatedAt: new Date(),
        },
      },
    },
  }));

  let matchedCount = 0;
  let modifiedCount = 0;

  for (const chunk of chunkArray(ops, 500)) {
    const result = await items.bulkWrite(chunk, { ordered: false });
    matchedCount += result.matchedCount || 0;
    modifiedCount += result.modifiedCount || 0;
  }

  console.log({
    updated: true,
    matchedCount,
    modifiedCount,
  });

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});