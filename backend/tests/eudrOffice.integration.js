// Generated, trusted fixtures only. Linux uses the real conversion sandbox; Windows checks conversion with its installed LibreOffice.
// Run: node tests/eudrOffice.integration.js (does not connect to MongoDB or Wasabi).
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const Zip = require("adm-zip");
const XLSX = require("xlsx");
const artifactDir = process.env.EUDR_OFFICE_FIXTURE_OUTPUT;
const PDFParse = artifactDir ? null : require("pdf-parse").PDFParse;
const { convertOfficeToPdf, runLibreOfficeConversion, sandboxCommand } = require("../services/convertXlsxToPDF.service");
const xml = '<?xml version="1.0" encoding="UTF-8"?>';
const zip = new Zip();
zip.addFile("[Content_Types].xml", Buffer.from(`${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`));
zip.addFile("_rels/.rels", Buffer.from(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`));
zip.addFile("word/document.xml", Buffer.from(`${xml}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SAWMILL-SALE-FIRST-PAGE</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>BUYER-SECOND-PAGE</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`));
const workbook = XLSX.utils.book_new();
for (const name of ["Timber", "Receipts"]) {
  const sheet = XLSX.utils.aoa_to_sheet([[`${name}-SHEET-EVIDENCE`, "CFT"], ["Wood", 17.6]]);
  sheet["!cols"] = [{ wch: 40 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}
const runOffice = process.platform === "win32" ? (args, options) => runLibreOfficeConversion(args, { timeoutMs: options.timeoutMs }) : runLibreOfficeConversion;

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "eudr-office-fixtures-"));
  try {
    if (process.platform === "linux") {
      const sandbox = path.join(temp, "sandbox");
      const canary = path.join(temp, "outside-private-canary");
      await fs.mkdir(sandbox); await fs.writeFile(canary, "must stay outside");
      const invocation = await sandboxCommand("/bin/sh", ["-c", 'test ! -e "$1" && test -z "$EUDR_TEST_SECRET" && test "$(wc -l < /proc/net/route)" -eq 1', "isolation-check", canary], sandbox);
      await execFile(invocation.command, invocation.args, { timeout: 5000, env: { PATH: "/usr/bin:/bin", EUDR_TEST_SECRET: "not-for-converter" } });
      console.log("Real sandbox passed: private filesystem hidden, environment cleared, network isolated");
    }
    await fs.writeFile(path.join(temp, "source.docx"), zip.toBuffer());
    await runOffice(["--headless", "--nologo", `-env:UserInstallation=${pathToFileURL(path.join(temp, "profile")).href}`, "--convert-to", "doc:MS Word 97", "--outdir", temp, path.join(temp, "source.docx")], { timeoutMs: 60000, sandboxDir: temp });
    const documents = [
      { name: "sale.docx", buffer: zip.toBuffer(), expected: ["SAWMILL-SALE-FIRST-PAGE", "BUYER-SECOND-PAGE"], pages: 2 },
      { name: "sale.doc", buffer: await fs.readFile(path.join(temp, "source.doc")), expected: ["SAWMILL-SALE-FIRST-PAGE", "BUYER-SECOND-PAGE"], pages: 2 },
      ...["xls", "xlsx"].map((ext) => ({ name: `sale.${ext}`, buffer: XLSX.write(workbook, { type: "buffer", bookType: ext === "xls" ? "biff8" : "xlsx" }), expected: ["Timber-SHEET-EVIDENCE", "Receipts-SHEET-EVIDENCE"], pages: 2 })),
      { name: "sale.csv", buffer: Buffer.from("Invoice,CFT\nCSV-SALE-001,17.6\n"), expected: ["CSV-SALE-001"] },
      { name: "sale.txt", buffer: Buffer.from("TEXT-TIMBER-EVIDENCE\nSold 17.600 CFT"), expected: ["TEXT-TIMBER-EVIDENCE"] },
    ];
    for (const document of documents) {
      const buffer = await convertOfficeToPdf({ buffer: document.buffer, originalName: document.name, runOffice });
      if (artifactDir) {
        await fs.mkdir(artifactDir, { recursive: true });
        await fs.writeFile(path.join(artifactDir, `${document.name}.pdf`), buffer);
        console.log(`Converted fixture for external verification: ${document.name}`);
        continue;
      }
      const parser = new PDFParse({ data: buffer });
      try {
        const text = await parser.getText();
        for (const expected of document.expected) assert.ok(text.text.includes(expected), `${document.name} is missing ${expected}: ${text.text}`);
        if (document.pages) assert.ok((await parser.getInfo()).total >= document.pages, `${document.name}: missing pages/sheets`);
      } finally { await parser.destroy(); }
      console.log(`Real Office preview passed: ${document.name}`);
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
