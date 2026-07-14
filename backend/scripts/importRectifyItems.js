const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dns = require("dns");
const mongoose = require("mongoose");
const connectDB = require("../config/connectDB");
const Vendor = require("../models/vendor.model");
const Brand = require("../models/brand.model");
const Item = require("../models/item.model");
const { extractTableRowsFromPdfBuffer } = require("../services/pdfRectifyParser.service");
const { processRectifyRows } = require("../helpers/rectifyImporterHelper");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function escapeRegex(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const pdfPathArg = args.find((arg) => !arg.startsWith("-"));

  if (!pdfPathArg) {
    console.error("Usage: npm run import:rectify-items -- <pdf-path> [--apply]");
    process.exit(1);
  }

  const absolutePdfPath = path.resolve(pdfPathArg);
  if (!fs.existsSync(absolutePdfPath)) {
    console.error(`Error: File not found at path ${absolutePdfPath}`);
    process.exit(1);
  }

  console.log(`Loading PDF from ${absolutePdfPath}...`);
  const pdfBuffer = fs.readFileSync(absolutePdfPath);

  // Connect to DB
  console.log("Connecting to database...");
  await connectDB({
    mongoUri: process.env.MONGO_URI_SCRIPT || process.env.MONGO_URI,
  });

  // Load Active Vendors
  console.log("Loading active vendors...");
  const activeVendors = await Vendor.find({
    $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
    is_active: true,
  }).sort({ name: 1 });

  if (activeVendors.length === 0) {
    console.error("Error: No active vendors found in the database.");
    await mongoose.disconnect();
    process.exit(1);
  }

  // Load Brands
  console.log("Loading brands...");
  const existingBrands = await Brand.find({}).sort({ name: 1 });
  if (existingBrands.length === 0) {
    console.error("Error: No brands found in the database.");
    await mongoose.disconnect();
    process.exit(1);
  }

  // Select Vendor
  console.log("\n--- Active Vendors ---");
  activeVendors.forEach((v, index) => {
    console.log(`${index + 1}. ${v.name} (${v.country || "No Country"})`);
  });

  let selectedVendor = null;
  while (!selectedVendor) {
    const answer = await askQuestion(`Select a vendor (1-${activeVendors.length}): `);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= activeVendors.length) {
      selectedVendor = activeVendors[num - 1];
    } else {
      console.log("Invalid selection. Please try again.");
    }
  }

  // Select Brand
  console.log("\n--- Existing Brands ---");
  existingBrands.forEach((b, index) => {
    console.log(`${index + 1}. ${b.name}`);
  });

  let selectedBrand = null;
  while (!selectedBrand) {
    const answer = await askQuestion(`Select a brand (1-${existingBrands.length}): `);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= existingBrands.length) {
      selectedBrand = existingBrands[num - 1];
    } else {
      console.log("Invalid selection. Please try again.");
    }
  }

  console.log(`\nSelected Vendor: ${selectedVendor.name} (${selectedVendor.country || "India"})`);
  console.log(`Selected Brand: ${selectedBrand.name}`);

  // Parse PDF
  console.log("Parsing PDF rows...");
  const rows = extractTableRowsFromPdfBuffer(pdfBuffer);
  console.log(`Parsed ${rows.length} raw rows from PDF.`);

  // Load existing items to check duplicates
  const rawCodes = rows.map((r) => r.ourItemCode || r.yourItemCode || "").filter(Boolean);
  const uniqueRawCodes = [...new Set(rawCodes)];

  const existingItems = await Item.find({
    code: { $in: uniqueRawCodes.map((code) => new RegExp(`^\\s*${escapeRegex(code)}\\s*$`, "i")) },
  });

  const existingCodesSet = new Set(existingItems.map((item) => item.code.toUpperCase()));

  // Process rows
  console.log("Processing and deduplicating rows...");
  const { invalid, conflicting, duplicates, existing, toCreate } = processRectifyRows({
    rows,
    existingCodesSet,
    vendor: selectedVendor,
    brand: selectedBrand,
  });

  const mode = apply ? "APPLY" : "DRY RUN";
  console.log(`\n=================== IMPORT SUMMARY (${mode}) ===================`);
  console.log(`Total PDF rows parsed:    ${rows.length}`);
  console.log(`Invalid rows (skipped):   ${invalid.length}`);
  console.log(`Conflicting duplicate codes (skipped): ${conflicting.length}`);
  console.log(`Other duplicate rows (skipped):        ${duplicates.length}`);
  console.log(`Existing codes in DB (skipped):       ${existing.length}`);
  console.log(`New items to create:      ${toCreate.length}`);
  console.log("===============================================================");

  if (invalid.length > 0) {
    console.log("\n--- Invalid Rows ---");
    invalid.slice(0, 10).forEach((entry, idx) => {
      console.log(`  ${idx + 1}. Code: "${entry.row.ourItemCode || entry.row.yourItemCode || ""}" | Desc: "${entry.row.description || ""}" | Reason: ${entry.reason}`);
    });
    if (invalid.length > 10) console.log(`  ... and ${invalid.length - 10} more`);
  }

  if (conflicting.length > 0) {
    console.log("\n--- Conflicting Duplicates ---");
    conflicting.slice(0, 10).forEach((entry, idx) => {
      console.log(`  ${idx + 1}. Code: "${entry.code}" | Description 1: "${entry.description1}" | Description 2: "${entry.description2}"`);
    });
    if (conflicting.length > 10) console.log(`  ... and ${conflicting.length - 10} more`);
  }

  if (existing.length > 0) {
    console.log("\n--- Existing Codes in DB (Skipped) ---");
    console.log("  " + existing.map((e) => e.code).slice(0, 15).join(", ") + (existing.length > 15 ? ` ... (+${existing.length - 15} more)` : ""));
  }

  const createdItems = [];
  const failedItems = [];

  if (apply) {
    console.log("\nCreating new items in database...");
    for (const itemData of toCreate) {
      try {
        const doc = new Item(itemData);
        await doc.save();
        createdItems.push(doc.code);
      } catch (err) {
        failedItems.push({ code: itemData.code, error: err.message });
      }
    }

    console.log(`\nSuccessfully created ${createdItems.length} new items.`);
    if (failedItems.length > 0) {
      console.error(`Failed to save ${failedItems.length} items:`);
      failedItems.forEach((f) => {
        console.error(`  Item "${f.code}": ${f.error}`);
      });
    }
  } else {
    console.log("\nDry-run mode active. No database changes were saved.");
    console.log("To apply these changes, run with the --apply flag:");
    console.log(`npm run import:rectify-items -- "${pdfPathArg}" --apply`);
  }

  await mongoose.disconnect();
  console.log("\nDisconnected from database. Done!");
}

run().catch((err) => {
  console.error("Importer failed with error:", err);
  process.exit(1);
});
