const fs = require("fs");
const path = require("path");

const {
  createPdfBuffer,
  extractWorkbookData,
  listWorkbookFiles,
} = require("./syncPisWorkbooks");

const normalizeCode = (value) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return /^\d+\.0+$/.test(normalized) ? normalized.replace(/\.0+$/, "") : normalized;
};

const buildPdfFileName = (parsedWorkbook) => {
  const code = normalizeCode(parsedWorkbook?.code);
  if (code) return `${code}-pis.pdf`;

  const sourceName = String(parsedWorkbook?.file_name || "pis-workbook")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${sourceName || "pis-workbook"}-example.pdf`;
};

const main = async () => {
  const inputPath = process.argv[2] || path.join(__dirname, "data");
  const outputDir = process.argv[3] || path.join(__dirname, "output", "pis-pdf-example");
  const workbookFiles = listWorkbookFiles(inputPath);

  if (workbookFiles.length === 0) {
    throw new Error(`No .xlsx files found in ${path.resolve(inputPath)}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Input path : ${path.resolve(inputPath)}`);
  console.log(`Output dir : ${path.resolve(outputDir)}`);
  console.log(`Workbook(s): ${workbookFiles.length}`);

  let exported = 0;
  let skipped = 0;

  for (const workbookFile of workbookFiles) {
    const parsed = extractWorkbookData(workbookFile);
    if (!parsed.code) {
      skipped += 1;
      console.log(`SKIP  ${path.basename(workbookFile)} :: unsupported PIS layout`);
      continue;
    }

    const pdfBuffer = await createPdfBuffer(parsed);
    const outputFile = path.join(outputDir, buildPdfFileName(parsed));
    fs.writeFileSync(outputFile, pdfBuffer);

    exported += 1;
    console.log(`SAVE  ${parsed.code} :: ${outputFile}`);
  }

  console.log("");
  console.log("Local PIS PDF export summary");
  console.log("----------------------------");
  console.log(`Exported: ${exported}`);
  console.log(`Skipped : ${skipped}`);
};

main().catch((error) => {
  console.error("Local PIS PDF export failed:", error);
  process.exit(1);
});
