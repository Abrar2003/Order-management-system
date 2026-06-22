const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLIENT_SRC = path.join(REPO_ROOT, "client", "OMS", "src");
const BACKEND_ROOT = path.join(REPO_ROOT, "backend");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

const walkFiles = (directory) => {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  });
  return files;
};

test("all browser report exports use the centralized PDF client", () => {
  const expectedFiles = [
    "components/UpcomingEtdExportModal.jsx",
    "pages/DailyReport.jsx",
    "pages/DelayedPoReports.jsx",
    "pages/FinalPISCheck.jsx",
    "pages/PISDiffs.jsx",
    "pages/PackedGoods.jsx",
    "pages/PendingPoReport.jsx",
    "pages/PoStatusReport.jsx",
    "pages/WeeklySummary.jsx",
    "pages/inspection_report.jsx",
  ];

  expectedFiles.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(CLIENT_SRC, relativePath), "utf8");
    assert.match(
      source,
      /pdfExport\.service/,
      `${relativePath} must use pdfExport.service`,
    );
  });
});

test("no live report export uses screenshot or jsPDF generation", () => {
  const forbidden = [
    /html2canvas/i,
    /from\s+["']jspdf["']/i,
    /new\s+jsPDF/i,
    /\.addImage\s*\(/i,
    /canvas\.toDataURL\s*\(/i,
  ];
  const files = [
    ...walkFiles(CLIENT_SRC),
    ...walkFiles(path.join(BACKEND_ROOT, "controllers")),
    ...walkFiles(path.join(BACKEND_ROOT, "routers")),
    ...walkFiles(path.join(BACKEND_ROOT, "services")),
  ].filter((filePath) => !filePath.endsWith("pdfArchitecture.test.js"));

  files.forEach((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    forbidden.forEach((pattern) => {
      assert.doesNotMatch(
        source,
        pattern,
        `${path.relative(REPO_ROOT, filePath)} contains forbidden PDF code`,
      );
    });
  });
});

test("permission-protected PDF routes delegate to the central renderer", () => {
  [
    "routers/reports.routes.js",
    "routers/items.routes.js",
    "routers/qc.routes.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(BACKEND_ROOT, relativePath), "utf8");
    assert.match(source, /\/pdf\/render/);
    assert.match(source, /renderHtmlPdf/);
    assert.match(source, /requirePermission/);
  });
});
