const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const AdmZip = require("adm-zip");
const dns = require("dns");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const Item = require("../models/item.model");
const {
  isConfigured: isWasabiConfigured,
  createStorageKey,
  getObjectUrl,
  uploadBuffer,
  deleteObject,
} = require("../services/wasabiStorage.service");
const {
  cleanupLegacyItemSizeFields,
} = require("../helpers/itemLegacySizeCleanup");
const { renderPdf } = require("../services/pdfRenderer");

const ITEM_SIZE_ENTRY_LIMIT = 5;
const BOX_SIZE_ENTRY_LIMIT = 4;
const ITEM_REMARKS = ["item", "item1", "item2", "item3", "item4"];
const BOX_REMARKS = ["box1", "box2", "box3", "box4"];

const normalizeText = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\r/g, "").trim();
};

const normalizeCode = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /^\d+\.0+$/.test(normalized) ? normalized.replace(/\.0+$/, "") : normalized;
};

const normalizeKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

const roundNumber = (value, precision = 3) =>
  Number.isFinite(value) ? Number(value.toFixed(precision)) : 0;

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = normalizeText(value).replace(/,/g, "");
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const cell = (sheet, row, col) => {
  const address = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return sheet?.[address] ? sheet[address].v : null;
};

const getMaxRow = (sheet) => {
  const reference = sheet?.["!ref"];
  return reference ? XLSX.utils.decode_range(reference).e.r + 1 : 1;
};

const findRowByLabel = (sheet, matcher, { col = 1, startRow = 1, endRow = getMaxRow(sheet) } = {}) => {
  for (let row = startRow; row <= endRow; row += 1) {
    if (matcher.test(normalizeText(cell(sheet, row, col)))) return row;
  }
  return null;
};

const getDimensionUnit = (sheet) => {
  const row = findRowByLabel(sheet, /^dimension in\b/i, {
    col: 1,
    startRow: 1,
    endRow: 60,
  });
  return /mm/i.test(normalizeText(cell(sheet, row || 30, 1))) ? "mm" : "cm";
};

const convertDimension = (value, unit) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return unit === "mm" ? roundNumber(parsed / 10, 3) : roundNumber(parsed, 3);
};

const extractLbh = (sheet, row, unit) => {
  const values = [4, 6, 8, 10]
    .map((col) => convertDimension(cell(sheet, row, col), unit))
    .filter((value) => value > 0);

  if (values.length < 3) return null;
  return { L: values[0], B: values[1], H: values[2] };
};

const inferTwoPartRemark = (label = "") => {
  const normalized = normalizeKey(label);
  if (!normalized) return "";
  if (normalized.includes("table top") || normalized.includes("box sizes top") || /\btop\b/.test(normalized)) {
    return "top";
  }
  if (normalized.includes("legs") || normalized.includes("base") || normalized.includes("bottom")) {
    return "base";
  }
  if (normalized.includes("pedestal")) {
    return "pedestal";
  }
  if (normalized.includes("stretcher")) {
    return "stretcher";
  }
  return "";
};

const assignRemarks = (entries = [], indexedRemarks = [], limit = BOX_SIZE_ENTRY_LIMIT) => {
  const trimmed = (Array.isArray(entries) ? entries : []).slice(0, limit);
  if (trimmed.length <= 1) {
    return trimmed.map((entry) => ({ ...entry, remark: "" }));
  }

  const inferred = trimmed.map((entry) => inferTwoPartRemark(entry.label));
  if (trimmed.length === 2) {
    if (inferred.includes("top") && inferred.includes("base")) {
      return trimmed.map((entry, index) => ({ ...entry, remark: inferred[index] }));
    }
  }

  return trimmed.map((entry, index) => ({
    ...entry,
    remark: inferred[index] || indexedRemarks[index] || indexedRemarks[indexedRemarks.length - 1] || "",
  }));
};

const calculateCbmFromLbh = (dimensions = {}) => {
  const length = Number(dimensions?.L || 0);
  const breadth = Number(dimensions?.B || 0);
  const height = Number(dimensions?.H || 0);
  if (!Number.isFinite(length) || !Number.isFinite(breadth) || !Number.isFinite(height)) return "0";
  if (length <= 0 || breadth <= 0 || height <= 0) return "0";
  const fixed = ((length * breadth * height) / 1000000).toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const formatCbmTotal = (total) => {
  if (!Number.isFinite(total) || total <= 0) return "0";
  const fixed = total.toFixed(6);
  return fixed.replace(/\.?0+$/, "") || "0";
};

const buildLegacyFields = (
  entries = [],
  weightKey = "",
  limit = ITEM_SIZE_ENTRY_LIMIT,
) => {
  const normalized = (Array.isArray(entries) ? entries : []).slice(0, limit);
  const totalWeight = roundNumber(
    normalized.reduce((sum, entry) => sum + Number(entry?.[weightKey] || 0), 0),
    3,
  );

  if (normalized.length <= 1) {
    const onlyEntry = normalized[0] || null;
    return {
      single: onlyEntry ? { L: onlyEntry.L, B: onlyEntry.B, H: onlyEntry.H } : { L: 0, B: 0, H: 0 },
      top: { L: 0, B: 0, H: 0 },
      bottom: { L: 0, B: 0, H: 0 },
      topWeight: 0,
      bottomWeight: 0,
      totalWeight,
    };
  }

  return {
    single: { L: 0, B: 0, H: 0 },
    top: { L: normalized[0].L, B: normalized[0].B, H: normalized[0].H },
    bottom: normalized[1]
      ? { L: normalized[1].L, B: normalized[1].B, H: normalized[1].H }
      : { L: 0, B: 0, H: 0 },
    topWeight: roundNumber(Number(normalized[0]?.[weightKey] || 0), 3),
    bottomWeight: roundNumber(Number(normalized[1]?.[weightKey] || 0), 3),
    totalWeight,
  };
};

const normalizeOptionalText = (value) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const extractPricingHeaders = (sheet) => {
  const headers = [];
  for (let col = 1; col <= 42; col += 1) {
    const value = normalizeOptionalText(cell(sheet, 18, col));
    if (value) headers.push(value);
  }
  return headers;
};

const extractMaterials = (sheet) => {
  const materials = [];
  for (let row = 22; row <= 27; row += 1) {
    const materialType = normalizeOptionalText(cell(sheet, row, 1));
    if (!materialType) continue;

    materials.push({
      material_type: materialType,
      material_name: normalizeOptionalText(cell(sheet, row, 3)),
      composition_percent: toNumber(cell(sheet, row, 8)),
      color: normalizeOptionalText(cell(sheet, row, 12)),
      finishing: normalizeOptionalText(cell(sheet, row, 18)),
    });
  }
  return materials;
};

const extractHardware = (sheet) => ({
  table_top: normalizeOptionalText(cell(sheet, 41, 4)),
  legs: normalizeOptionalText(cell(sheet, 41, 6)),
  extendable: normalizeOptionalText(cell(sheet, 41, 8)),
  butterfly: normalizeOptionalText(cell(sheet, 41, 10)),
  bold_and_washers: normalizeOptionalText(cell(sheet, 42, 4)),
  sleeding_guide: normalizeOptionalText(cell(sheet, 43, 4)),
  handles: normalizeOptionalText(cell(sheet, 44, 4)),
  stoppers: normalizeOptionalText(cell(sheet, 45, 4)),
  locks: normalizeOptionalText(cell(sheet, 46, 4)),
  wheels: normalizeOptionalText(cell(sheet, 47, 4)),
  protection_caps: normalizeOptionalText(cell(sheet, 48, 4)),
  kd: normalizeOptionalText(cell(sheet, 49, 4)),
  allen_key: normalizeOptionalText(cell(sheet, 50, 4)),
});

const toBooleanFromYesNo = (yesValue, noValue) => {
  const yes = normalizeOptionalText(yesValue);
  const no = normalizeOptionalText(noValue);

  if (yes && /^yes$/i.test(yes)) return true;
  if (no && /^no$/i.test(no)) return false;
  return null;
};

const extractFeatures = (sheet) => {
  const featureRows = {
    instruction_manual: 54,
    waterproof: 55,
    liquid_proof: 56,
    heat_resistant: 57,
    suitable_for_indoor: 58,
    suitable_for_outdoor: 59,
    suitable_for_bathroom: 60,
    mounting_material: 61,
    maintenance_instruction: 62,
  };

  return Object.entries(featureRows).reduce((accumulator, [key, row]) => {
    accumulator[key] = toBooleanFromYesNo(cell(sheet, row, 4), cell(sheet, row, 5));
    return accumulator;
  }, {});
};

const extractBranding = (sheet) => {
  let valueRow = 66;
  const brandingRow = findRowByLabel(sheet, /^branding$/i, {
    col: 1,
    startRow: 63,
    endRow: 67,
  });

  if (brandingRow) {
    valueRow = brandingRow + 1;
  }

  return {
    brand_name: normalizeOptionalText(cell(sheet, valueRow, 1)),
    barcode_sticker: /^x$/i.test(normalizeOptionalText(cell(sheet, valueRow, 4)) || ""),
    transparent_sticker: /^x$/i.test(normalizeOptionalText(cell(sheet, valueRow, 6)) || ""),
    hangtag: /^x$/i.test(normalizeOptionalText(cell(sheet, valueRow, 8)) || ""),
  };
};

const extractTradePackaging = (sheet) => ({
  barcode_master_box: normalizeOptionalText(cell(sheet, 9, 9)),
  barcode_pcs: normalizeOptionalText(cell(sheet, 10, 9)),
  hs_code: toNumber(cell(sheet, 11, 9)),
  import_duties: normalizeOptionalText(cell(sheet, 12, 9)),
  moq_first_order: toNumber(cell(sheet, 13, 9)),
  moq_reorder: toNumber(cell(sheet, 14, 9)),
  maximum_carrying_capacity: normalizeOptionalText(cell(sheet, 16, 9)),
  master_box_cbm: toNumber(cell(sheet, 9, 16)),
  pcs_in_box: toNumber(cell(sheet, 10, 16)),
  cbm_per_unit: toNumber(cell(sheet, 11, 16)),
  packing_weight: {
    paper_carton_total_kg: toNumber(cell(sheet, 13, 16)),
    plastics_styrofoam_total_kg: toNumber(cell(sheet, 15, 16)),
    paper_carton_per_piece_kg: toNumber(cell(sheet, 13, 18)),
    plastics_styrofoam_per_piece_kg: toNumber(cell(sheet, 15, 18)),
  },
});

const extractProductInfo = (sheet) => ({
  brand: normalizeOptionalText(cell(sheet, 1, 1)),
  supplier: normalizeOptionalText(cell(sheet, 1, 10)),
  supplier_ref: normalizeOptionalText(cell(sheet, 2, 10)),
  product_type: normalizeOptionalText(cell(sheet, 3, 10)),
  article_number: normalizeCode(cell(sheet, 4, 10)),
  article_name: normalizeOptionalText(cell(sheet, 5, 10)),
  collection: normalizeOptionalText(cell(sheet, 6, 10)),
  sales_unit: normalizeOptionalText(cell(sheet, 7, 10)),
});

const columnNumberToLabel = (index) => {
  let current = Number(index) + 1;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label || "A";
};

const inferImageContentType = (entryName = "") => {
  const normalized = String(entryName || "").toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
};

const resolveZipPath = (basePath, targetPath) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(basePath), targetPath));

const extractSheetImages = (filePath) => {
  try {
    const zip = new AdmZip(filePath);
    const sheetPath = "xl/worksheets/sheet1.xml";
    const sheetRelPath = "xl/worksheets/_rels/sheet1.xml.rels";
    const sheetRelEntry = zip.getEntry(sheetRelPath);
    if (!sheetRelEntry) return [];

    const sheetRelXml = zip.readAsText(sheetRelEntry);
    const drawingMatch = sheetRelXml.match(/Target="([^"]*drawings\/[^"]+\.xml)"/i);
    if (!drawingMatch) return [];

    const drawingPath = resolveZipPath(sheetPath, drawingMatch[1]);
    const drawingRelPath = resolveZipPath(drawingPath, `_rels/${path.posix.basename(drawingPath)}.rels`);
    const drawingEntry = zip.getEntry(drawingPath);
    const drawingRelEntry = zip.getEntry(drawingRelPath);
    if (!drawingEntry || !drawingRelEntry) return [];

    const drawingXml = zip.readAsText(drawingEntry);
    const drawingRelXml = zip.readAsText(drawingRelEntry);
    const relationshipMatches = [...drawingRelXml.matchAll(/Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/gi)];
    const relationshipMap = new Map(
      relationshipMatches.map((match) => [match[1], resolveZipPath(drawingPath, match[2])]),
    );

    const anchorPattern = /<xdr:twoCellAnchor[\s\S]*?<xdr:from><xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>[\s\S]*?<xdr:to><xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:to>[\s\S]*?<xdr:cNvPr[^>]+name="([^"]+)"[\s\S]*?<a:blip[^>]+r:embed="([^"]+)"/gi;
    const images = [];

    for (const match of drawingXml.matchAll(anchorPattern)) {
      const fromCol = Number(match[1]);
      const fromRow = Number(match[2]);
      const toCol = Number(match[3]);
      const toRow = Number(match[4]);
      const name = normalizeText(match[5]) || "Sheet Image";
      const relationId = match[6];
      const mediaPath = relationshipMap.get(relationId);
      if (!mediaPath) continue;

      const mediaEntry = zip.getEntry(mediaPath);
      if (!mediaEntry) continue;

      images.push({
        name,
        media_path: mediaPath,
        content_type: inferImageContentType(mediaPath),
        anchor: {
          from_col: fromCol,
          from_row: fromRow,
          to_col: toCol,
          to_row: toRow,
          range_label: `${columnNumberToLabel(fromCol)}${fromRow + 1}:${columnNumberToLabel(toCol)}${toRow + 1}`,
        },
        buffer: mediaEntry.getData(),
      });
    }

    return images;
  } catch (error) {
    return [];
  }
};

const getSheetSnapshotLines = (sheet) => {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  return rows
    .map((row, index) => {
      const values = (Array.isArray(row) ? row : [])
        .map((value) => normalizeText(value))
        .filter(Boolean);

      if (values.length === 0) return "";
      return `${String(index + 1).padStart(2, "0")} | ${values.join(" | ")}`;
    })
    .filter(Boolean);
};

const formatMeasurementEntry = (entry = {}, { weightKey = "", weightLabel = "" } = {}) => {
  const dimensions = [entry?.L, entry?.B, entry?.H]
    .map((value) => roundNumber(Number(value || 0), 3))
    .join(" x ");
  const remark = normalizeText(entry?.remark || "single");
  const weightValue = roundNumber(Number(entry?.[weightKey] || 0), 3);

  return `${remark}: ${dimensions}${weightLabel ? ` | ${weightLabel} ${weightValue}` : ""}`;
};

const toDisplayValue = (value, fallback = "-") => {
  const normalized = normalizeText(value);
  return normalized || fallback;
};

const ensurePdfSpace = (doc, minHeight = 24) => {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + minHeight <= bottom) return;
  doc.addPage();
};

const drawSectionTitle = (doc, title) => {
  ensurePdfSpace(doc, 24);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#111827")
    .text(normalizeText(title));
  doc.moveDown(0.25);
};

const drawKeyValueGrid = (doc, rows = []) => {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelWidth = 140;
  const valueWidth = pageWidth - labelWidth;
  const paddingX = 6;
  const paddingY = 5;

  doc.font("Helvetica").fontSize(9.5);

  for (const row of rows) {
    const label = toDisplayValue(row?.label);
    const value = toDisplayValue(row?.value);
    const labelHeight = doc.heightOfString(label, { width: labelWidth - paddingX * 2 });
    const valueHeight = doc.heightOfString(value, { width: valueWidth - paddingX * 2 });
    const rowHeight = Math.max(20, labelHeight, valueHeight) + paddingY * 2;

    ensurePdfSpace(doc, rowHeight + 2);
    const y = doc.y;
    const x = doc.page.margins.left;

    doc
      .lineWidth(0.6)
      .fillColor("#f3f4f6")
      .rect(x, y, labelWidth, rowHeight)
      .fillAndStroke("#f3f4f6", "#d1d5db");
    doc.rect(x + labelWidth, y, valueWidth, rowHeight).stroke("#d1d5db");

    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .text(label, x + paddingX, y + paddingY, { width: labelWidth - paddingX * 2 });
    doc
      .fillColor("#111827")
      .font("Helvetica")
      .text(value, x + labelWidth + paddingX, y + paddingY, { width: valueWidth - paddingX * 2 });

    doc.y = y + rowHeight;
  }

  doc.moveDown(0.35);
};

const drawTable = (doc, { columns = [], rows = [] } = {}) => {
  const safeColumns = Array.isArray(columns) ? columns : [];
  if (safeColumns.length === 0) return;

  const safeRows = Array.isArray(rows) && rows.length > 0
    ? rows
    : [{ __empty: "No data" }];
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const paddingX = 6;
  const paddingY = 5;
  const totalRatio = safeColumns.reduce((sum, column) => sum + Number(column?.width || 1), 0) || safeColumns.length;
  const widths = safeColumns.map((column) => (tableWidth * Number(column?.width || 1)) / totalRatio);

  const drawHeader = () => {
    ensurePdfSpace(doc, 24);
    const y = doc.y;
    let x = doc.page.margins.left;

    doc.font("Helvetica-Bold").fontSize(9.5);
    safeColumns.forEach((column, index) => {
      const width = widths[index];
      doc
        .lineWidth(0.6)
        .fillColor("#e5e7eb")
        .rect(x, y, width, 22)
        .fillAndStroke("#e5e7eb", "#9ca3af");
      doc
        .fillColor("#111827")
        .text(toDisplayValue(column?.label), x + paddingX, y + paddingY, {
          width: width - paddingX * 2,
          align: column?.align || "left",
        });
      x += width;
    });

    doc.y = y + 22;
  };

  drawHeader();

  doc.font("Helvetica").fontSize(9);
  for (const row of safeRows) {
    const values = safeColumns.map((column) =>
      row?.__empty ? row.__empty : toDisplayValue(row?.[column.key]),
    );
    const rowHeight = Math.max(
      20,
      ...values.map((value, index) =>
        doc.heightOfString(value, { width: widths[index] - paddingX * 2 }),
      ),
    ) + paddingY * 2;

    ensurePdfSpace(doc, rowHeight + 2);
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }

    const y = doc.y;
    let x = doc.page.margins.left;

    safeColumns.forEach((column, index) => {
      const width = widths[index];
      doc
        .lineWidth(0.6)
        .rect(x, y, width, rowHeight)
        .stroke("#d1d5db");
      doc
        .fillColor("#111827")
        .text(values[index], x + paddingX, y + paddingY, {
          width: width - paddingX * 2,
          align: column?.align || "left",
        });
      x += width;
    });

    doc.y = y + rowHeight;
  }

  doc.moveDown(0.4);
};

const toBooleanDisplay = (value) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
};

const drawImageGallery = (doc, images = []) => {
  const safeImages = Array.isArray(images) ? images : [];
  if (safeImages.length === 0) {
    drawTable(doc, {
      columns: [{ label: "Images", key: "message", width: 1 }],
      rows: [{ message: "No embedded sheet images found." }],
    });
    return;
  }

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const maxHeight = 220;

  for (const image of safeImages) {
    const caption = `${toDisplayValue(image?.name, "Sheet Image")} (${toDisplayValue(image?.anchor?.range_label)})`;
    ensurePdfSpace(doc, 36);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111827").text(caption);
    doc.moveDown(0.2);

    let imageObject = null;
    try {
      imageObject = doc.openImage(image.buffer);
    } catch (_) {
      imageObject = null;
    }

    if (!imageObject) {
      doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text("Image could not be rendered.");
      doc.moveDown(0.35);
      continue;
    }

    const scale = Math.min(pageWidth / imageObject.width, maxHeight / imageObject.height, 1);
    const drawWidth = Math.max(1, Math.floor(imageObject.width * scale));
    const drawHeight = Math.max(1, Math.floor(imageObject.height * scale));

    ensurePdfSpace(doc, drawHeight + 18);
    const x = doc.page.margins.left + ((pageWidth - drawWidth) / 2);
    const y = doc.y;

    doc.image(image.buffer, x, y, { width: drawWidth, height: drawHeight });
    doc
      .lineWidth(0.5)
      .rect(x, y, drawWidth, drawHeight)
      .stroke("#d1d5db");

    doc.y = y + drawHeight + 10;
  }
};

const escapePdfHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const flattenPdfValues = (value, prefix = "", rows = []) => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      flattenPdfValues(entry, `${prefix}${prefix ? " " : ""}${index + 1}`, rows));
    return rows;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) =>
      flattenPdfValues(entry, `${prefix}${prefix ? " · " : ""}${key}`, rows));
    return rows;
  }
  rows.push({ label: prefix || "Value", value: toDisplayValue(value) });
  return rows;
};

const createPdfBuffer = async (parsedWorkbook) => {
  const summaryRows = [
    ["Article Number", parsedWorkbook?.code || "N/A"],
    ["Sheet Name", parsedWorkbook?.sheet_name || "N/A"],
    ["Source File", parsedWorkbook?.file_name || "N/A"],
    ["Dimension Unit", parsedWorkbook?.dimension_unit || "N/A"],
    ["PIS Barcode", parsedWorkbook?.payload?.pis_barcode || "N/A"],
    ["Calculated PIS CBM", parsedWorkbook?.payload?.cbm?.calculated_pis_total || "0"],
  ];
  const detailRows = flattenPdfValues(parsedWorkbook?.details || {});
  const imageHtml = (parsedWorkbook?.sheet_images || []).map((image) => {
    const mimeType = String(image?.mime_type || image?.contentType || "image/png");
    const source = Buffer.isBuffer(image?.buffer)
      ? `data:${mimeType};base64,${image.buffer.toString("base64")}`
      : "";
    return source
      ? `<figure class="pdf-keep-together"><img src="${source}" alt="${escapePdfHtml(image?.name || "Sheet image")}" /><figcaption>${escapePdfHtml(image?.name || "Sheet image")}</figcaption></figure>`
      : "";
  }).join("");
  const tableRows = (rows) => rows.map((row) => `
    <tr><th>${escapePdfHtml(row.label ?? row[0])}</th><td>${escapePdfHtml(row.value ?? row[1])}</td></tr>
  `).join("");

  return renderPdf({
    html: `
      <section class="pis-snapshot">
        <h1>PIS Sheet - ${escapePdfHtml(parsedWorkbook?.code || "Unknown Item")}</h1>
        <section class="pdf-report-section"><h2>Summary</h2><table><tbody>${tableRows(summaryRows)}</tbody></table></section>
        ${imageHtml ? `<section class="pdf-report-section"><h2>Sheet Images</h2><div class="images">${imageHtml}</div></section>` : ""}
        <section><h2>Workbook Details</h2><table><tbody>${tableRows(detailRows)}</tbody></table></section>
      </section>
    `,
    format: "A4",
    landscape: false,
    margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    extraCss: `
      body { font-family: Arial, sans-serif; font-size: 10px; }
      h1 { margin: 0 0 8mm; font-size: 18px; }
      h2 { margin: 5mm 0 2mm; font-size: 13px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 5px 7px; border: 1px solid #d1d5db; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
      th { width: 35%; background: #f3f4f6; }
      .images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5mm; }
      figure { margin: 0; }
      img { display: block; max-width: 100%; max-height: 80mm; margin: 0 auto; object-fit: contain; }
      figcaption { margin-top: 2mm; color: #6b7280; text-align: center; }
    `,
  });
};

const extractWorkbookData = (filePath) => {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const snapshotLines = getSheetSnapshotLines(sheet);
  const productInfo = extractProductInfo(sheet);
  const tradePackaging = extractTradePackaging(sheet);
  const pricingHeaders = extractPricingHeaders(sheet);
  const materials = extractMaterials(sheet);
  const hardware = extractHardware(sheet);
  const features = extractFeatures(sheet);
  const branding = extractBranding(sheet);
  const sheetImages = extractSheetImages(filePath);
  const dimensionUnit = getDimensionUnit(sheet);
  const dimensionRow = findRowByLabel(sheet, /^dimension in\b/i, {
    col: 1,
    startRow: 1,
    endRow: 60,
  });
  const hardwareRow = findRowByLabel(sheet, /^hardware$/i, {
    col: 1,
    startRow: (dimensionRow || 30) + 1,
    endRow: 80,
  });
  const articleRow = findRowByLabel(sheet, /^article number$/i, {
    col: 6,
    startRow: 1,
    endRow: 15,
  });
  const barcodeRow = findRowByLabel(sheet, /^barcode pcs$/i, {
    col: 6,
    startRow: 1,
    endRow: 20,
  });

  const warnings = [];
  const itemRows = [];
  const boxRows = [];
  if (!dimensionRow || !articleRow) {
    return {
      file_name: path.basename(filePath),
      file_path: path.resolve(filePath),
      sheet_name: sheetName,
      code: "",
      dimension_unit: dimensionUnit,
      snapshot_lines: snapshotLines,
      details: {
        product_info: productInfo,
        trade_packaging: tradePackaging,
        pricing_headers_present: pricingHeaders,
        materials,
        hardware,
        features,
        branding,
      },
      sheet_images: sheetImages,
      warnings: ["Unsupported PIS workbook layout."],
      payload: {
        pis_barcode: "",
        pis_item_sizes: [],
        pis_box_sizes: [],
        pis_weight: {
          top_net: 0,
          top_gross: 0,
          bottom_net: 0,
          bottom_gross: 0,
          total_net: 0,
          total_gross: 0,
        },
        cbm: {
          top: "0",
          bottom: "0",
          total: "0",
          calculated_pis_total: "0",
        },
      },
    };
  }
  const startRow = (dimensionRow || 30) + 1;
  const endRow = hardwareRow ? hardwareRow - 1 : Math.min(startRow + 12, getMaxRow(sheet));

  for (let row = startRow; row <= endRow; row += 1) {
    const label = normalizeText(cell(sheet, row, 1));
    if (!label) continue;

    const lbh = extractLbh(sheet, row, dimensionUnit);
    if (!lbh) continue;

    const entry = {
      label,
      L: lbh.L,
      B: lbh.B,
      H: lbh.H,
      weight: roundNumber(Number(toNumber(cell(sheet, row, 14)) || 0), 3),
    };

    if (/^box sizes?\b/i.test(label)) {
      boxRows.push(entry);
    } else {
      itemRows.push(entry);
    }
  }

  if (itemRows.length > ITEM_SIZE_ENTRY_LIMIT) {
    warnings.push(`Found ${itemRows.length} item rows; using first ${ITEM_SIZE_ENTRY_LIMIT}.`);
  }
  if (boxRows.length > BOX_SIZE_ENTRY_LIMIT) {
    warnings.push(`Found ${boxRows.length} box rows; using first ${BOX_SIZE_ENTRY_LIMIT}.`);
  }

  const itemEntries = assignRemarks(itemRows, ITEM_REMARKS, ITEM_SIZE_ENTRY_LIMIT).map((entry) => ({
    remark: entry.remark,
    L: entry.L,
    B: entry.B,
    H: entry.H,
    net_weight: entry.weight,
  }));
  const boxEntries = assignRemarks(boxRows, BOX_REMARKS, BOX_SIZE_ENTRY_LIMIT).map((entry) => ({
    remark: entry.remark,
    L: entry.L,
    B: entry.B,
    H: entry.H,
    gross_weight: entry.weight,
  }));

  const itemWeightSummary = buildLegacyFields(itemEntries, "net_weight", ITEM_SIZE_ENTRY_LIMIT);
  const boxWeightSummary = buildLegacyFields(boxEntries, "gross_weight", BOX_SIZE_ENTRY_LIMIT);
  const cbmSource = boxEntries.length > 0 ? boxEntries : itemEntries;
  const cbmTotal = cbmSource.reduce(
    (sum, entry) => sum + Number(calculateCbmFromLbh(entry) || 0),
    0,
  );

  return {
    file_name: path.basename(filePath),
    file_path: path.resolve(filePath),
    sheet_name: sheetName,
    code: normalizeCode(productInfo.article_number || (articleRow ? cell(sheet, articleRow, 10) : "")),
    dimension_unit: dimensionUnit,
    snapshot_lines: snapshotLines,
    details: {
      product_info: productInfo,
      trade_packaging: tradePackaging,
      pricing_headers_present: pricingHeaders,
      materials,
      hardware,
      features,
      branding,
    },
    sheet_images: sheetImages,
    warnings,
    payload: {
      pis_barcode: normalizeText(barcodeRow ? cell(sheet, barcodeRow, 9) : ""),
      pis_item_sizes: itemEntries,
      pis_box_sizes: boxEntries,
      pis_weight: {
        top_net: itemWeightSummary.topWeight,
        top_gross: boxWeightSummary.topWeight,
        bottom_net: itemWeightSummary.bottomWeight,
        bottom_gross: boxWeightSummary.bottomWeight,
        total_net: itemWeightSummary.totalWeight,
        total_gross: boxWeightSummary.totalWeight,
      },
      cbm: {
        top: cbmSource[0] ? calculateCbmFromLbh(cbmSource[0]) : "0",
        bottom: cbmSource[1] ? calculateCbmFromLbh(cbmSource[1]) : "0",
        total: formatCbmTotal(cbmTotal),
        calculated_pis_total: formatCbmTotal(cbmTotal),
      },
    },
  };
};

const listWorkbookFiles = (targetPath) => {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path not found: ${resolved}`);
  }

  const stats = fs.statSync(resolved);
  if (stats.isFile()) return [resolved];

  return fs.readdirSync(resolved)
    .filter((name) => /\.xlsx$/i.test(name))
    .filter((name) => !name.startsWith("~$"))
    .map((name) => path.join(resolved, name))
    .sort((left, right) => left.localeCompare(right));
};

const readPath = (source, dottedPath) =>
  dottedPath.split(".").reduce((current, key) => (current == null ? undefined : current[key]), source);

const toComparable = (value) => {
  if (Array.isArray(value)) return value.map((entry) => toComparable(entry));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, key) => {
        accumulator[key] = toComparable(value[key]);
        return accumulator;
      }, {});
  }
  return value;
};

const valuesEqual = (left, right) =>
  JSON.stringify(toComparable(left)) === JSON.stringify(toComparable(right));

const applyValueIfChanged = (item, dottedPath, nextValue, changedPaths) => {
  const currentValue = readPath(item.toObject({ depopulate: true }), dottedPath);
  if (valuesEqual(currentValue, nextValue)) return;
  item.set(dottedPath, nextValue);
  changedPaths.push(dottedPath);
};

const applyWorkbookPayload = (item, payload) => {
  const changedPaths = [];

  applyValueIfChanged(item, "pis_item_sizes", payload.pis_item_sizes, changedPaths);
  applyValueIfChanged(item, "pis_box_sizes", payload.pis_box_sizes, changedPaths);
  applyValueIfChanged(item, "cbm.top", payload?.cbm?.top || "0", changedPaths);
  applyValueIfChanged(item, "cbm.bottom", payload?.cbm?.bottom || "0", changedPaths);
  applyValueIfChanged(item, "cbm.total", payload?.cbm?.total || "0", changedPaths);
  applyValueIfChanged(
    item,
    "cbm.calculated_pis_total",
    payload?.cbm?.calculated_pis_total || "0",
    changedPaths,
  );

  if (normalizeText(payload?.pis_barcode)) {
    applyValueIfChanged(item, "pis_barcode", normalizeText(payload.pis_barcode), changedPaths);
  }

  const cleanupResult = cleanupLegacyItemSizeFields(item, {
    groups: ["pis_item", "pis_box"],
  });
  cleanupResult.changedPaths.forEach((path) => {
    if (!changedPaths.includes(path)) changedPaths.push(path);
  });

  return changedPaths;
};

const buildPdfOriginalName = (parsedWorkbook) =>
  `${normalizeCode(parsedWorkbook?.code) || "item"}-pis.pdf`;

const uploadPisPdfSnapshot = async (item, parsedWorkbook) => {
  if (!isWasabiConfigured()) {
    return {
      uploaded: false,
      skipped: true,
      reason: "Wasabi storage is not configured",
    };
  }

  const pdfBuffer = await createPdfBuffer(parsedWorkbook);
  const originalName = buildPdfOriginalName(parsedWorkbook);
  const previousStorageKey = normalizeText(item?.pis_file?.key);

  const uploadResult = await uploadBuffer({
    buffer: pdfBuffer,
    key: createStorageKey({
      folder: "item-pis",
      originalName,
      extension: ".pdf",
    }),
    originalName,
    contentType: "application/pdf",
  });

  item.pis_file = {
    key: uploadResult.key,
    originalName: uploadResult.originalName,
    contentType: uploadResult.contentType,
    size: uploadResult.size,
    link: getObjectUrl(uploadResult.key),
    public_id: uploadResult.key,
  };

  return {
    uploaded: true,
    skipped: false,
    previousStorageKey,
    uploadedKey: uploadResult.key,
    fileSize: uploadResult.size,
  };
};

const parseArgs = (argv = []) => {
  const args = Array.isArray(argv) ? argv : [];
  const nonFlags = args.filter((arg) => !String(arg).startsWith("--"));
  const flags = new Set(args.filter((arg) => String(arg).startsWith("--")));
  return {
    targetPath: nonFlags[0] || path.join(__dirname, "data"),
    write: flags.has("--write"),
    verbose: flags.has("--verbose"),
    skipPdf: flags.has("--skip-pdf"),
  };
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
  });

  const options = parseArgs(process.argv.slice(2));
  const workbookFiles = listWorkbookFiles(options.targetPath);

  if (workbookFiles.length === 0) {
    throw new Error(`No .xlsx files found in ${path.resolve(options.targetPath)}`);
  }

  console.log(`Target path : ${path.resolve(options.targetPath)}`);
  console.log(`Workbook(s) : ${workbookFiles.length}`);
  console.log(`Mode        : ${options.write ? "write" : "dry-run"}`);
  console.log(`PDF upload  : ${options.skipPdf ? "disabled" : (options.write ? "enabled" : "planned")}`);

  await connectDB();

  const summary = {
    parsed: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    pdf_uploaded: 0,
    pdf_skipped: 0,
    not_found: 0,
    missing_code: 0,
    failed: 0,
    warnings: 0,
  };
  const misses = [];
  const failures = [];

  for (const workbookFile of workbookFiles) {
    let uploadedPdfKey = "";
    try {
      const parsed = extractWorkbookData(workbookFile);
      summary.parsed += 1;
      summary.warnings += parsed.warnings.length;

      if (!parsed.code) {
        summary.missing_code += 1;
        console.log(`SKIP  missing article number :: ${parsed.file_name}`);
        continue;
      }

      const item = await Item.findOne({ code: parsed.code });
      if (!item) {
        summary.not_found += 1;
        misses.push({ file: parsed.file_name, code: parsed.code });
        console.log(`MISS  ${parsed.code} :: ${parsed.file_name}`);
        continue;
      }

      summary.matched += 1;
      const changedPaths = applyWorkbookPayload(item, parsed.payload);
      let pdfResult = null;

      if (options.write) {
        if (!options.skipPdf) {
          pdfResult = await uploadPisPdfSnapshot(item, parsed);
          if (pdfResult.uploaded) {
            uploadedPdfKey = pdfResult.uploadedKey;
            changedPaths.push("pis_file");
            summary.pdf_uploaded += 1;
          } else if (pdfResult.skipped) {
            summary.pdf_skipped += 1;
          }
        } else {
          summary.pdf_skipped += 1;
        }

        if (changedPaths.length === 0) {
          summary.unchanged += 1;
          console.log(`SAME  ${parsed.code} :: ${parsed.file_name}`);
          continue;
        }

        await item.save();
        if (pdfResult?.uploaded && pdfResult.previousStorageKey && pdfResult.previousStorageKey !== pdfResult.uploadedKey) {
          deleteObject(pdfResult.previousStorageKey).catch((error) => {
            console.error("Delete previous PIS PDF failed:", {
              code: parsed.code,
              previousStorageKey: pdfResult.previousStorageKey,
              error: error?.message || String(error),
            });
          });
        }
      } else {
        if (changedPaths.length === 0) {
          summary.unchanged += 1;
          console.log(`SAME  ${parsed.code} :: ${parsed.file_name}`);
          continue;
        }
      }

      summary.updated += 1;
      console.log(`${options.write ? "SAVE" : "PLAN"}  ${parsed.code} :: ${parsed.file_name}`);

      if (options.verbose) {
        console.log(`      unit=${parsed.dimension_unit} changed=${changedPaths.join(", ")}`);
        if (!options.skipPdf) {
          console.log(`      pdf=${options.write ? (pdfResult?.uploaded ? "uploaded" : (pdfResult?.reason || "skipped")) : "will-upload-on-write"}`);
        }
        if (parsed.warnings.length > 0) {
          console.log(`      warnings=${parsed.warnings.join(" | ")}`);
        }
      }
    } catch (error) {
      if (uploadedPdfKey) {
        try {
          await deleteObject(uploadedPdfKey);
        } catch (_) {
          // best-effort cleanup for failed save flow
        }
      }
      summary.failed += 1;
      failures.push({ file: path.basename(workbookFile), message: error?.message || String(error) });
      console.log(`FAIL  ${path.basename(workbookFile)} :: ${error?.message || String(error)}`);
    }
  }

  console.log("");
  console.log("PIS workbook sync summary");
  console.log("-------------------------");
  console.log(`Parsed      : ${summary.parsed}`);
  console.log(`Matched     : ${summary.matched}`);
  console.log(`Updated     : ${summary.updated}`);
  console.log(`Unchanged   : ${summary.unchanged}`);
  console.log(`PDF uploaded: ${summary.pdf_uploaded}`);
  console.log(`PDF skipped : ${summary.pdf_skipped}`);
  console.log(`Not found   : ${summary.not_found}`);
  console.log(`Missing code: ${summary.missing_code}`);
  console.log(`Warnings    : ${summary.warnings}`);
  console.log(`Failed      : ${summary.failed}`);

  if (misses.length > 0) {
    console.log("");
    console.log("Items not found");
    console.table(misses.slice(0, 20));
  }

  if (failures.length > 0) {
    console.log("");
    console.log("Failures");
    console.table(failures.slice(0, 20));
  }
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("PIS workbook sync failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await mongoose.disconnect();
      } catch (_) {
        // ignore disconnect errors
      }
    });
}

module.exports = {
  createPdfBuffer,
  extractWorkbookData,
  listWorkbookFiles,
};
