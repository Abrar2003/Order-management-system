const XLSX = require("xlsx");
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
const Item = require("../models/item.model"); // adjust path
require("dotenv").config();
const mongoose = require("mongoose");

function cleanString(value) {
  return value == null ? "" : String(value).trim();
}

function cleanCode(value) {
  if (value == null) return "";
  return String(value).trim();
}

function extractNumber(value) {
  if (value == null || value === "") return 0;
  const cleaned = String(value)
    .replace(/kg/gi, "")
    .replace(/cm/gi, "")
    .replace(/,/g, "")
    .trim();

  const match = cleaned.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseLBH(value) {
  if (value == null || value === "") {
    return { L: 0, B: 0, H: 0 };
  }

  const cleaned = String(value)
    .toLowerCase()
    .replace(/cm/gi, "")
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/\*/g, "x")
    .trim();

  const parts = cleaned
    .split("x")
    .map((v) => extractNumber(v))
    .filter((n) => !Number.isNaN(n));

  if (parts.length < 3) {
    return { L: 0, B: 0, H: 0 };
  }

  return {
    L: parts[0] || 0,
    B: parts[1] || 0,
    H: parts[2] || 0,
  };
}

function isValidLBH(obj) {
  return obj && (obj.L > 0 || obj.B > 0 || obj.H > 0);
}

function parseFlag(value) {
  const raw = cleanString(value).toLowerCase();

  if (!raw) return "single";

  if (raw === "true" || raw === "top") {
    return "top";
  }

  if (
    raw === "false" ||
    raw === "flase" ||
    raw === "bottom"
  ) {
    return "bottom";
  }

  // If something unexpected comes, keep it for fallback handling
  return "unknown";
}

function parseCbm(value) {
  const num = extractNumber(value);
  return Number(num.toFixed(3));
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const workbook = XLSX.readFile("C:\\Users\\abrar\\Downloads\\QC item all (2).xlsx");
  const grouped = new Map();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    for (const row of rows) {
      const code = cleanCode(row["item_code"]);
      if (!code) continue;

      const entry = {
        code,
        brandName: cleanString(row["brand"]),
        piCbm: parseCbm(row["pi_cbm"]),
        product: parseLBH(row["product_size"]),
        box: parseLBH(row["box_size"]),
        net: extractNumber(row["net_weight"]),
        gross: extractNumber(row["gross_weight"]),
        flag: parseFlag(row["true/false"]),
        remarks: cleanString(row["remarks"]),
      };

      if (!grouped.has(code)) {
        grouped.set(code, []);
      }

      grouped.get(code).push(entry);
    }
  }

  let matched = 0;
  let updated = 0;
  let notFound = 0;

  for (const [code, entries] of grouped.entries()) {
    let topEntry = null;
    let bottomEntry = null;
    let singleEntry = null;
    const unknownEntries = [];

    for (const entry of entries) {
      if (entry.flag === "top" && !topEntry) {
        topEntry = entry;
      } else if (entry.flag === "bottom" && !bottomEntry) {
        bottomEntry = entry;
      } else if (entry.flag === "single" && !singleEntry) {
        singleEntry = entry;
      } else {
        unknownEntries.push(entry);
      }
    }

    // Fallbacks:
    // if top/bottom not explicitly found, use row order
    if (!topEntry && unknownEntries.length > 0) {
      topEntry = unknownEntries.shift();
    }
    if (!bottomEntry && unknownEntries.length > 0) {
      bottomEntry = unknownEntries.shift();
    }

    // If only a single row exists, keep it as the main/default row
    if (!singleEntry && !topEntry && entries.length === 1) {
      singleEntry = entries[0];
    }

    const mainEntry = singleEntry || topEntry || bottomEntry || entries[0];

    const topProduct = topEntry?.product || { L: 0, B: 0, H: 0 };
    const bottomProduct = bottomEntry?.product || { L: 0, B: 0, H: 0 };
    const mainProduct = isValidLBH(mainEntry?.product)
      ? mainEntry.product
      : { L: 0, B: 0, H: 0 };

    const topBox = topEntry?.box || { L: 0, B: 0, H: 0 };
    const bottomBox = bottomEntry?.box || { L: 0, B: 0, H: 0 };
    const mainBox = isValidLBH(mainEntry?.box)
      ? mainEntry.box
      : { L: 0, B: 0, H: 0 };

    const topNet = topEntry?.net || 0;
    const bottomNet = bottomEntry?.net || 0;
    const topGross = topEntry?.gross || 0;
    const bottomGross = bottomEntry?.gross || 0;

    const mainNet = mainEntry?.net || 0;
    const mainGross = mainEntry?.gross || 0;

    const hasTopOrBottom = !!topEntry || !!bottomEntry;

    const totalNet = hasTopOrBottom
      ? Number((topNet + bottomNet).toFixed(3))
      : Number(mainNet.toFixed(3));

    const totalGross = hasTopOrBottom
      ? Number((topGross + bottomGross).toFixed(3))
      : Number(mainGross.toFixed(3));

    const totalPiCbm = Number(
      entries.reduce((sum, e) => sum + (e.piCbm || 0), 0).toFixed(3)
    );

    const update = {
      $set: {
        brand_name: mainEntry?.brandName || "",

        // single/default PIS item size
        "pis_item_LBH.L": mainProduct.L,
        "pis_item_LBH.B": mainProduct.B,
        "pis_item_LBH.H": mainProduct.H,

        // top item size
        "pis_item_top_LBH.L": topProduct.L,
        "pis_item_top_LBH.B": topProduct.B,
        "pis_item_top_LBH.H": topProduct.H,

        // bottom item size
        "pis_item_bottom_LBH.L": bottomProduct.L,
        "pis_item_bottom_LBH.B": bottomProduct.B,
        "pis_item_bottom_LBH.H": bottomProduct.H,

        // single/default box size
        "pis_box_LBH.L": mainBox.L,
        "pis_box_LBH.B": mainBox.B,
        "pis_box_LBH.H": mainBox.H,

        // top box size
        "pis_box_top_LBH.L": topBox.L,
        "pis_box_top_LBH.B": topBox.B,
        "pis_box_top_LBH.H": topBox.H,

        // bottom box size
        "pis_box_bottom_LBH.L": bottomBox.L,
        "pis_box_bottom_LBH.B": bottomBox.B,
        "pis_box_bottom_LBH.H": bottomBox.H,

        // weights
        "pis_weight.top_net": Number(topNet.toFixed(3)),
        "pis_weight.top_gross": Number(topGross.toFixed(3)),
        "pis_weight.bottom_net": Number(bottomNet.toFixed(3)),
        "pis_weight.bottom_gross": Number(bottomGross.toFixed(3)),
        "pis_weight.total_net": totalNet,
        "pis_weight.total_gross": totalGross,

        // cbm
        "cbm.calculated_pis_total": String(totalPiCbm),
      },
    };

    const result = await Item.updateOne({ code }, update);

    if (result.matchedCount > 0) {
      matched++;
      if (result.modifiedCount > 0) updated++;
    } else {
      notFound++;
      console.log(`Item not found for code: ${code}`);
    }
  }

  console.log({
    totalCodesInSheet: grouped.size,
    matched,
    updated,
    notFound,
  });

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});