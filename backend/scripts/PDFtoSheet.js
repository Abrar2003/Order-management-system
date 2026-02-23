const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { google } = require("googleapis");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const DATA_DIR = path.join(__dirname, "data");
const HEADER = [
  "Order Number",
  "Refer",
  "Order Date",
  "ETD",
  "Days Till ETD",
  "Our Item Code",
  "Your Item Code",
  "Description",
  "Quantity",
];

function parseArgs(argv) {
  const args = {
    filePath: null,
    sheetName: null,
    spreadsheetId: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if ((token === "--file" || token === "-f") && argv[i + 1]) {
      args.filePath = argv[i + 1];
      i += 1;
      continue;
    }
    if ((token === "--sheet" || token === "-s") && argv[i + 1]) {
      args.sheetName = argv[i + 1];
      i += 1;
      continue;
    }
    if ((token === "--spreadsheet" || token === "--spreadsheet-id") && argv[i + 1]) {
      args.spreadsheetId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function pickDefaultPdfFile() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .map((fileName) => {
      const fullPath = path.join(DATA_DIR, fileName);
      const stat = fs.statSync(fullPath);
      return {
        fullPath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error(`No PDF files found in ${DATA_DIR}`);
  }

  return files[0].fullPath;
}

function parsePdfObjects(pdfBuffer) {
  const pdfText = pdfBuffer.toString("latin1");
  const objectMap = new Map();
  const objectPattern = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let match = null;

  while ((match = objectPattern.exec(pdfText))) {
    const objectNumber = Number(match[1]);
    const generation = Number(match[2]);
    const body = match[3];
    objectMap.set(objectNumber, {
      objectNumber,
      generation,
      body,
    });
  }

  return objectMap;
}

function extractStreamText(objectBody) {
  const streamIndex = objectBody.indexOf("stream");
  if (streamIndex < 0) return null;

  let startIndex = streamIndex + "stream".length;
  if (objectBody[startIndex] === "\r" && objectBody[startIndex + 1] === "\n") {
    startIndex += 2;
  } else if (objectBody[startIndex] === "\n") {
    startIndex += 1;
  }

  const endIndex = objectBody.indexOf("endstream", startIndex);
  if (endIndex < 0) return null;

  return objectBody.slice(startIndex, endIndex);
}

function inflatePdfStream(streamText) {
  const rawBuffer = Buffer.from(streamText, "latin1");
  try {
    return zlib.inflateSync(rawBuffer).toString("latin1");
  } catch {
    return rawBuffer.toString("latin1");
  }
}

function decodeUtf16Hex(hexValue) {
  const buffer = Buffer.from(hexValue, "hex");
  const codeUnits = [];
  for (let i = 0; i < buffer.length; i += 2) {
    const high = buffer[i];
    const low = buffer[i + 1] ?? 0;
    codeUnits.push((high << 8) | low);
  }
  return String.fromCharCode(...codeUnits);
}

function parseToUnicodeMap(cmapText) {
  const charMap = new Map();
  let codeByteLength = 2;

  const codeSpaceSection = cmapText.match(
    /begincodespacerange([\s\S]*?)endcodespacerange/
  );
  if (codeSpaceSection) {
    const ranges = [...codeSpaceSection[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)];
    if (ranges.length > 0) {
      codeByteLength = Math.max(
        ...ranges.map((entry) => Math.max(entry[1].length, entry[2].length) / 2)
      );
    }
  }

  const rangeSections = cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
  for (const sectionMatch of rangeSections) {
    const lines = sectionMatch[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const direct = line.match(
        /^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>$/
      );
      if (direct) {
        const startCode = parseInt(direct[1], 16);
        const endCode = parseInt(direct[2], 16);
        let unicodeCodePoint = parseInt(direct[3], 16);
        for (let sourceCode = startCode; sourceCode <= endCode; sourceCode += 1) {
          charMap.set(sourceCode, String.fromCodePoint(unicodeCodePoint));
          unicodeCodePoint += 1;
        }
        continue;
      }

      const arrayMapped = line.match(
        /^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.+)\]$/
      );
      if (arrayMapped) {
        const startCode = parseInt(arrayMapped[1], 16);
        const endCode = parseInt(arrayMapped[2], 16);
        const unicodeValues = [...arrayMapped[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(
          (entry) => decodeUtf16Hex(entry[1])
        );

        for (let sourceCode = startCode; sourceCode <= endCode; sourceCode += 1) {
          const index = sourceCode - startCode;
          if (unicodeValues[index]) {
            charMap.set(sourceCode, unicodeValues[index]);
          }
        }
      }
    }
  }

  const charSections = cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
  for (const sectionMatch of charSections) {
    const lines = sectionMatch[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const charEntry = line.match(/^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>$/);
      if (!charEntry) continue;
      charMap.set(parseInt(charEntry[1], 16), decodeUtf16Hex(charEntry[2]));
    }
  }

  return {
    codeByteLength,
    charMap,
  };
}

function buildToUnicodeFontMap(objectMap) {
  const toUnicodeByFontObject = new Map();
  for (const [objectNumber, objectInfo] of objectMap.entries()) {
    const toUnicodeRef = objectInfo.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (!toUnicodeRef) continue;

    const cmapObject = objectMap.get(Number(toUnicodeRef[1]));
    if (!cmapObject) continue;

    const cmapStream = extractStreamText(cmapObject.body);
    if (!cmapStream) continue;

    const cmapText = inflatePdfStream(cmapStream);
    const parsed = parseToUnicodeMap(cmapText);
    toUnicodeByFontObject.set(objectNumber, parsed);
  }
  return toUnicodeByFontObject;
}

function decodePdfHexString(hexText, toUnicode) {
  if (!toUnicode) return "";
  const { codeByteLength, charMap } = toUnicode;
  const chars = [];

  for (let index = 0; index < hexText.length; index += codeByteLength * 2) {
    const codeHex = hexText.slice(index, index + codeByteLength * 2);
    if (codeHex.length < codeByteLength * 2) continue;
    const code = parseInt(codeHex, 16);
    const mapped = charMap.get(code);
    if (mapped) {
      chars.push(mapped);
      continue;
    }
    if (code >= 32 && code <= 126) {
      chars.push(String.fromCharCode(code));
    }
  }

  return chars.join("");
}

function parseObjectReferences(textValue) {
  return [...textValue.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
}

function collectPageFontRefs(pageBody, objectMap) {
  const fontRefs = new Map();
  const consume = (textValue) => {
    if (!textValue) return;
    for (const match of textValue.matchAll(/\/(F\d+)\s+(\d+)\s+\d+\s+R/g)) {
      fontRefs.set(match[1], Number(match[2]));
    }
  };

  consume(pageBody);

  const resourceRef = pageBody.match(/\/Resources\s+(\d+)\s+\d+\s+R/);
  if (resourceRef) {
    const resourceObject = objectMap.get(Number(resourceRef[1]));
    consume(resourceObject?.body || "");
  }

  return fontRefs;
}

function extractPageFragments(pageObject, pageIndex, objectMap, toUnicodeByFontObject) {
  const pageBody = pageObject.body;
  const contentsMatch = pageBody.match(/\/Contents\s+(\[[^\]]+\]|\d+\s+\d+\s+R)/s);
  if (!contentsMatch) return [];

  const contentObjectRefs = parseObjectReferences(contentsMatch[1]);
  const fontRefs = collectPageFontRefs(pageBody, objectMap);
  const fragments = [];
  let currentFont = "F0";

  for (const contentRef of contentObjectRefs) {
    const contentObject = objectMap.get(contentRef);
    if (!contentObject) continue;
    const rawStream = extractStreamText(contentObject.body);
    if (!rawStream) continue;

    const content = inflatePdfStream(rawStream);
    const textBlocks = content.matchAll(/BT([\s\S]*?)ET/g);
    for (const blockMatch of textBlocks) {
      const block = blockMatch[1];
      let x = 0;
      let y = 0;

      const tokenPattern =
        /\/(F\d+)\s+([+-]?\d*\.?\d+)\s+Tf|([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Tm|([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s+Td|\[([^\]]*)\]\s*TJ|<([0-9A-Fa-f]+)>\s*Tj|\(([^()]*)\)\s*Tj/g;
      let tokenMatch = null;

      while ((tokenMatch = tokenPattern.exec(block))) {
        if (tokenMatch[1]) {
          currentFont = tokenMatch[1];
          continue;
        }

        if (tokenMatch[3]) {
          x = Number(tokenMatch[7]);
          y = Number(tokenMatch[8]);
          continue;
        }

        if (tokenMatch[9]) {
          x += Number(tokenMatch[9]);
          y += Number(tokenMatch[10]);
          continue;
        }

        const fontObjectRef = fontRefs.get(currentFont);
        const toUnicode = toUnicodeByFontObject.get(fontObjectRef);
        let textValue = "";

        if (tokenMatch[11]) {
          const arrayTokens = tokenMatch[11].matchAll(
            /<([0-9A-Fa-f]+)>|\(([^()]*)\)|([+-]?\d*\.?\d+)/g
          );
          for (const arrayToken of arrayTokens) {
            if (arrayToken[1]) {
              textValue += decodePdfHexString(arrayToken[1], toUnicode);
            } else if (arrayToken[2]) {
              textValue += arrayToken[2];
            }
          }
        } else if (tokenMatch[12]) {
          textValue = decodePdfHexString(tokenMatch[12], toUnicode);
        } else if (tokenMatch[13]) {
          textValue = tokenMatch[13];
        }

        const normalized = textValue.replace(/\s+/g, " ").trim();
        if (!normalized) continue;

        fragments.push({
          pageIndex,
          x,
          y,
          text: normalized,
        });
      }
    }
  }

  return fragments;
}

function columnForX(xValue) {
  if (xValue < 100) return "orderNumber";
  if (xValue < 175) return "refer";
  if (xValue < 234) return "orderDate";
  if (xValue < 294) return "etd";
  if (xValue < 336) return "daysTillEtd";
  if (xValue < 421) return "ourItemCode";
  if (xValue < 505) return "yourItemCode";
  if (xValue < 759) return "description";
  return "quantity";
}

function appendText(base, addition) {
  if (!base) return addition;
  if (!addition) return base;
  return `${base} ${addition}`.replace(/\s+/g, " ").trim();
}

function clusterFragmentsByLine(fragments, yTolerance = 0.8) {
  const sorted = [...fragments].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > yTolerance) return yDiff;
    return a.x - b.x;
  });

  const lines = [];
  for (const fragment of sorted) {
    const line = lines[lines.length - 1];
    if (
      !line ||
      line.pageIndex !== fragment.pageIndex ||
      Math.abs(line.anchorY - fragment.y) > yTolerance
    ) {
      lines.push({
        pageIndex: fragment.pageIndex,
        anchorY: fragment.y,
        fragments: [fragment],
      });
      continue;
    }
    line.fragments.push(fragment);
    line.anchorY = (line.anchorY + fragment.y) / 2;
  }

  return lines;
}

function isLikelyHeaderLine(cells, yValue) {
  if (yValue >= 470) return true;
  const lineText = [
    cells.orderNumber,
    cells.refer,
    cells.orderDate,
    cells.etd,
    cells.daysTillEtd,
    cells.ourItemCode,
    cells.yourItemCode,
    cells.description,
    cells.quantity,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!lineText) return true;
  return (
    lineText.includes("ordernr.") ||
    lineText.includes("report date") ||
    lineText.includes("supplier") ||
    lineText.includes("notification letter") ||
    lineText.includes("shippingdate")
  );
}

function lineToCells(line) {
  const cells = {
    orderNumber: "",
    refer: "",
    orderDate: "",
    etd: "",
    daysTillEtd: "",
    ourItemCode: "",
    yourItemCode: "",
    description: "",
    quantity: "",
  };

  const sortedFragments = [...line.fragments].sort((a, b) => a.x - b.x);
  for (const fragment of sortedFragments) {
    const column = columnForX(fragment.x);
    cells[column] = appendText(cells[column], fragment.text);
  }

  return cells;
}

function mergeSupplementLine(previousRow, supplement) {
  if (!previousRow) return;
  if (supplement.description) {
    previousRow.description = appendText(previousRow.description, supplement.description);
  }
  if (supplement.yourItemCode) {
    previousRow.yourItemCode = appendText(previousRow.yourItemCode, supplement.yourItemCode);
  }
  if (supplement.ourItemCode) {
    previousRow.ourItemCode = appendText(previousRow.ourItemCode, supplement.ourItemCode);
  }
  if (supplement.refer) {
    if (/^[A-Za-z]{2,8}$/.test(supplement.refer) && previousRow.quantity) {
      previousRow.quantity = appendText(previousRow.quantity, supplement.refer);
    } else {
      previousRow.refer = appendText(previousRow.refer, supplement.refer);
    }
  }
}

function extractRowsFromFragments(fragments) {
  const lines = clusterFragmentsByLine(fragments);
  const rows = [];

  for (const line of lines) {
    const cells = lineToCells(line);
    if (isLikelyHeaderLine(cells, line.anchorY)) continue;

    const hasCoreData = Boolean(
      cells.orderDate ||
        cells.etd ||
        cells.daysTillEtd ||
        cells.ourItemCode ||
        cells.yourItemCode ||
        cells.description ||
        cells.quantity
    );
    const hasAnyData = Boolean(
      cells.orderNumber ||
        cells.refer ||
        cells.orderDate ||
        cells.etd ||
        cells.daysTillEtd ||
        cells.ourItemCode ||
        cells.yourItemCode ||
        cells.description ||
        cells.quantity
    );

    if (!hasAnyData) continue;

    const isSupplementOnly =
      !cells.orderNumber &&
      !cells.orderDate &&
      !cells.etd &&
      !cells.daysTillEtd &&
      !cells.ourItemCode &&
      !cells.quantity &&
      (cells.refer || cells.description || cells.yourItemCode);

    if (isSupplementOnly && rows.length > 0) {
      mergeSupplementLine(rows[rows.length - 1], cells);
      continue;
    }

    if (!hasCoreData && cells.refer && rows.length > 0) {
      mergeSupplementLine(rows[rows.length - 1], cells);
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

function normalizeAndGroupRowsByOrder(rows) {
  const normalized = rows.map((row, index) => ({
    ...row,
    _index: index,
  }));

  let currentOrder = "";
  for (const row of normalized) {
    if (row.orderNumber) {
      currentOrder = row.orderNumber;
    } else if (currentOrder) {
      row.orderNumber = currentOrder;
    }
  }

  const grouped = new Map();
  for (const row of normalized) {
    const key = row.orderNumber || "__NO_ORDER__";
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  const sequenced = [];
  for (const groupRows of grouped.values()) {
    groupRows.sort((a, b) => a._index - b._index);
    sequenced.push(...groupRows);
  }

  return sequenced.map(({ _index, ...rest }) => rest);
}

function extractTableRowsFromPdf(pdfFilePath) {
  const pdfBuffer = fs.readFileSync(pdfFilePath);
  const objectMap = parsePdfObjects(pdfBuffer);
  const toUnicodeByFontObject = buildToUnicodeFontMap(objectMap);

  const pageObjects = [...objectMap.values()]
    .filter(
      (objectInfo) =>
        /\/Type\s*\/Page\b/.test(objectInfo.body) &&
        !/\/Type\s*\/Pages\b/.test(objectInfo.body)
    )
    .sort((a, b) => a.objectNumber - b.objectNumber);

  const allFragments = [];
  for (let pageIndex = 0; pageIndex < pageObjects.length; pageIndex += 1) {
    const fragments = extractPageFragments(
      pageObjects[pageIndex],
      pageIndex,
      objectMap,
      toUnicodeByFontObject
    );
    allFragments.push(...fragments);
  }

  const extractedRows = extractRowsFromFragments(allFragments);
  return normalizeAndGroupRowsByOrder(extractedRows);
}

function rowToSheetArray(row) {
  return [
    row.orderNumber || "",
    row.refer || "",
    row.orderDate || "",
    row.etd || "",
    row.daysTillEtd || "",
    row.ourItemCode || "",
    row.yourItemCode || "",
    row.description || "",
    row.quantity || "",
  ];
}

function quoteSheetName(sheetName) {
  return `'${String(sheetName || "Sheet1").replace(/'/g, "''")}'`;
}

function getSheetsClient() {
  const missing = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_REFRESH_TOKEN",
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing Google OAuth env vars: ${missing.join(", ")}`);
  }

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  return google.sheets({ version: "v4", auth });
}

async function uploadRowsToGoogleSheet({ spreadsheetId, sheetName, rows }) {
  const sheets = getSheetsClient();
  const quotedSheet = quoteSheetName(sheetName);
  const values = [HEADER, ...rows.map(rowToSheetArray)];

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quotedSheet}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quotedSheet}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.filePath
    ? path.resolve(process.cwd(), args.filePath)
    : pickDefaultPdfFile();
  const sheetName =
    args.sheetName || process.env.GOOGLE_SHEETS_SHEET_NAME || process.env.GOOGLE_SHEET_NAME || "Sheet1";
  const spreadsheetId =
    args.spreadsheetId ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID

  const rows = extractTableRowsFromPdf(filePath);
  const uniqueOrders = new Set(rows.map((row) => row.orderNumber).filter(Boolean));

  console.log(`PDF: ${filePath}`);
  console.log(`Rows extracted: ${rows.length}`);
  console.log(`Unique orders: ${uniqueOrders.size}`);
  console.log("Preview (first 5 rows):");
  console.table(rows.slice(0, 5).map((row) => ({
    orderNumber: row.orderNumber,
    refer: row.refer,
    etd: row.etd,
    yourItemCode: row.yourItemCode,
    quantity: row.quantity,
  })));

  if (args.dryRun) {
    console.log("Dry run enabled. Google Sheets update skipped.");
    return;
  }

  if (!spreadsheetId) {
    throw new Error(
      "Missing spreadsheet id. Set GOOGLE_SHEETS_SPREADSHEET_ID (or use --spreadsheet)."
    );
  }

  await uploadRowsToGoogleSheet({
    spreadsheetId,
    sheetName,
    rows,
  });

  console.log(
    `Google Sheet updated: spreadsheetId=${spreadsheetId}, sheet=${sheetName}, rows=${rows.length}`
  );
}

main().catch((error) => {
  console.error("PDF to Google Sheet sync failed.");
  console.error(error?.message || error);
  process.exitCode = 1;
});
