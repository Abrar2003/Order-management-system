const XLSX = require("xlsx");
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
const Item = require("../models/item.model"); // adjust path
require("dotenv").config();
const mongoose = require("mongoose");
const {
  cleanupLegacyItemSizeFields,
} = require("../helpers/itemLegacySizeCleanup");

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

function hasCompletePositiveLBH(obj) {
  return obj && obj.L > 0 && obj.B > 0 && obj.H > 0;
}

function calculateCbmFromLbh(obj) {
  if (!hasCompletePositiveLBH(obj)) return 0;
  return Number(((obj.L * obj.B * obj.H) / 1000000).toFixed(6));
}

function toFixedWeight(value) {
  return Number((Number(value) || 0).toFixed(3));
}

function buildSizeEntries({ singleEntry, topEntry, bottomEntry, dimensionKey, weightKey }) {
  const entries = [];

  if (topEntry || bottomEntry) {
    if (hasCompletePositiveLBH(topEntry?.[dimensionKey])) {
      entries.push({
        ...topEntry[dimensionKey],
        remark: "top",
        [weightKey]: toFixedWeight(topEntry?.[weightKey === "net_weight" ? "net" : "gross"]),
      });
    }
    if (hasCompletePositiveLBH(bottomEntry?.[dimensionKey])) {
      entries.push({
        ...bottomEntry[dimensionKey],
        remark: "base",
        [weightKey]: toFixedWeight(bottomEntry?.[weightKey === "net_weight" ? "net" : "gross"]),
      });
    }
  }

  if (entries.length === 0 && hasCompletePositiveLBH(singleEntry?.[dimensionKey])) {
    entries.push({
      ...singleEntry[dimensionKey],
      remark: "",
      [weightKey]: toFixedWeight(singleEntry?.[weightKey === "net_weight" ? "net" : "gross"]),
    });
  }

  if (entries.length === 1) {
    entries[0].remark = "";
  }

  return entries.slice(0, 4);
}

function parseFlag(value) {
  const raw = cleanString(value).toLowerCase();
    console.log(`Parsing flag from value: "${value}", cleaned: "${raw}"`);
  if (!raw) return "single";

  if (raw === "true" || raw === "top" || raw === "TOP") {
    return "top";
  }

  if (
    raw === "false" ||
    raw === "flase" ||
    raw === "bottom" ||
    raw === "FALSE"
  ) {
    return "bottom";
  }

  // If something unexpected comes, keep it for fallback handling
  return "unknown";
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
        product: parseLBH(row["product_size"]),
        box: parseLBH(row["box_size"]),
        net: extractNumber(row["net_weight"]),
        gross: extractNumber(row["gross_weight"]),
        flag: parseFlag(row["top_or_bottom"]),
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
    // console.log(`Processing code: ${code} with ${entries.length} entries`);
    for (const entry of entries) {
        // console.log(`  Entry flag: ${entry.flag}, product: ${JSON.stringify(entry.product)}, box: ${JSON.stringify(entry.box)}, net: ${entry.net}, gross: ${entry.gross}`);
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

    const itemSizeEntries = buildSizeEntries({
      singleEntry: mainEntry,
      topEntry,
      bottomEntry,
      dimensionKey: "product",
      weightKey: "net_weight",
    });
    const boxSizeEntries = buildSizeEntries({
      singleEntry: mainEntry,
      topEntry,
      bottomEntry,
      dimensionKey: "box",
      weightKey: "gross_weight",
    });
    const cbmSource = boxSizeEntries.length > 0 ? boxSizeEntries : itemSizeEntries;
    const totalPiCbm = Number(
      cbmSource.reduce((sum, entry) => sum + calculateCbmFromLbh(entry), 0).toFixed(6),
    );

    const itemDoc = await Item.findOne({ code });

    if (itemDoc) {
      matched++;
      itemDoc.set("brand_name", mainEntry?.brandName || "");
      itemDoc.set("pis_item_sizes", itemSizeEntries);
      itemDoc.set("pis_box_sizes", boxSizeEntries);
      itemDoc.set("pis_box_mode", "individual");
      itemDoc.set("cbm.top", cbmSource[0] ? String(calculateCbmFromLbh(cbmSource[0])) : "0");
      itemDoc.set("cbm.bottom", cbmSource[1] ? String(calculateCbmFromLbh(cbmSource[1])) : "0");
      itemDoc.set("cbm.total", String(totalPiCbm));
      itemDoc.set("cbm.calculated_pis_total", String(totalPiCbm));
      cleanupLegacyItemSizeFields(itemDoc, { groups: ["pis_item", "pis_box"] });
      if (itemDoc.isModified()) {
        await itemDoc.save();
        updated++;
      }
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
