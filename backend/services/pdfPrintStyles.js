const normalizeOrientation = (landscape) => (landscape ? "landscape" : "portrait");

const buildPdfPrintStyles = ({
  format = "A4",
  landscape = false,
  margin = {},
  extraCss = "",
} = {}) => {
  const resolvedMargin = {
    top: margin.top || "12mm",
    right: margin.right || "10mm",
    bottom: margin.bottom || "12mm",
    left: margin.left || "10mm",
  };

  return `
    @page {
      size: ${format} ${normalizeOrientation(landscape)};
      margin: ${resolvedMargin.top} ${resolvedMargin.right} ${resolvedMargin.bottom} ${resolvedMargin.left};
    }

    html,
    body {
      margin: 0;
      padding: 0;
      background: #ffffff !important;
      color: #2e2925;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      line-height: 1.45;
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }

    * {
      box-sizing: border-box;
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }

    .pdf-report {
      position: relative !important;
      left: auto !important;
      right: auto !important;
      top: auto !important;
      bottom: auto !important;
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      background: #ffffff !important;
    }

    .pdf-report h1,
    .pdf-report h2,
    .pdf-report h3,
    .pdf-report h4,
    .pdf-report h5,
    .pdf-report h6 {
      margin-top: 0;
      margin-bottom: 3mm;
      line-height: 1.25;
    }

    .pdf-report p {
      line-height: 1.45;
    }

    .pdf-report section + section,
    .pdf-report .pdf-report-section + .pdf-report-section {
      margin-top: 5mm;
    }

    .pdf-report .gap-1 { gap: 1.5mm !important; }
    .pdf-report .gap-2 { gap: 2.5mm !important; }
    .pdf-report .gap-3 { gap: 4mm !important; }
    .pdf-report .gap-4 { gap: 6mm !important; }

    .pdf-report .mb-1 { margin-bottom: 1.5mm !important; }
    .pdf-report .mb-2 { margin-bottom: 2.5mm !important; }
    .pdf-report .mb-3 { margin-bottom: 4mm !important; }
    .pdf-report .mb-4 { margin-bottom: 6mm !important; }
    .pdf-report .mt-1 { margin-top: 1.5mm !important; }
    .pdf-report .mt-2 { margin-top: 2.5mm !important; }
    .pdf-report .mt-3 { margin-top: 4mm !important; }
    .pdf-report .mt-4 { margin-top: 6mm !important; }

    .pdf-report .om-summary-chip,
    .pdf-report .badge {
      line-height: 1.25;
    }

    .pdf-report .om-summary-chip {
      margin: 0 1mm 1.5mm 0;
      padding: 1.5mm 3mm !important;
    }

    .pdf-report .card-body {
      padding: 4mm;
    }

    .pdf-report .alert {
      margin-bottom: 4mm;
      padding: 3mm 4mm;
      line-height: 1.4;
    }

    .pdf-report table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .pdf-report table > :not(caption) > * > * {
      padding: 1.8mm 1.5mm;
      line-height: 1.35;
      vertical-align: middle;
    }

    .pdf-report thead {
      display: table-header-group;
    }

    .pdf-report tfoot {
      display: table-footer-group;
    }

    .pdf-report tr,
    .pdf-report td,
    .pdf-report th,
    .pdf-keep-together,
    .pdf-report-section,
    .card:not(.om-card):not(.inspection-report-card),
    .pis-diff-report-item,
    .inspection-report-section {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }

    .pdf-page-break-before {
      break-before: page;
      page-break-before: always;
    }

    .pdf-page-break-after {
      break-after: page;
      page-break-after: always;
    }

    .pdf-hide,
    .no-print,
    button,
    [role="button"] {
      display: none !important;
    }

    .table-responsive,
    [class*="preview-scroll"],
    [class*="table-wrap"] {
      overflow: visible !important;
      max-height: none !important;
    }

    ${extraCss}
  `;
};

module.exports = {
  buildPdfPrintStyles,
};
