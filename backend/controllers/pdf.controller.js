const path = require("path");

const { renderPdf } = require("../services/pdfRenderer");

const PDF_REPORT_KEYS = new Set([
  "daily-inspection-report",
  "delayed-po-report",
  "final-pis-check",
  "inspection-report",
  "packed-goods",
  "pending-po-report",
  "pis-diffs",
  "po-status-report",
  "upcoming-etd-report",
  "weekly-order-summary",
]);

const sanitizeFilename = (value, fallback = "report.pdf") => {
  const parsed = path.basename(String(value || fallback).trim() || fallback);
  const safe = parsed.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
};

const renderHtmlPdf = async (req, res) => {
  const startedAt = Date.now();
  const reportKey = String(req.body?.reportKey || "").trim().toLowerCase();

  try {
    if (!PDF_REPORT_KEYS.has(reportKey)) {
      return res.status(400).json({ message: "Unsupported PDF report type" });
    }

    const filename = sanitizeFilename(
      req.body?.filename,
      `${reportKey}-${new Date().toISOString().slice(0, 10)}.pdf`,
    );
    const pdfBuffer = await renderPdf({
      html: req.body?.html,
      styles: req.body?.styles,
      format: req.body?.format || "A4",
      landscape: req.body?.landscape !== false,
      margin: req.body?.margin || {
        top: "10mm",
        right: "8mm",
        bottom: "10mm",
        left: "8mm",
      },
      printBackground: req.body?.printBackground !== false,
      width: req.body?.width,
      height: req.body?.height,
      extraCss: req.body?.extraCss,
      header: req.body?.header,
    });

    console.log("PDF rendered", {
      reportKey,
      filename,
      bytes: pdfBuffer.length,
      durationMs: Date.now() - startedAt,
      userId: String(req.user?._id || req.user?.id || ""),
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error("PDF render failed", {
      reportKey,
      durationMs: Date.now() - startedAt,
      message: error?.message || String(error),
      stack: error?.stack,
    });
    return res.status(500).json({
      message: "Failed to generate PDF report",
      error: error?.message || String(error),
    });
  }
};

module.exports = {
  PDF_REPORT_KEYS,
  renderHtmlPdf,
};
