const normalizeOrientation = (landscape) => (landscape ? "landscape" : "portrait");

const buildPdfPrintStyles = ({
  format = "A4",
  landscape = false,
  margin = {},
  extraCss = "",
} = {}) => {
  const resolvedMargin = {
    top: margin.top || "10mm",
    right: margin.right || "8mm",
    bottom: margin.bottom || "10mm",
    left: margin.left || "8mm",
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
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }

    * {
      box-sizing: border-box;
      print-color-adjust: exact !important;
      -webkit-print-color-adjust: exact !important;
    }

    .pdf-report {
      width: 100%;
      max-width: none !important;
      margin: 0 !important;
      background: #ffffff !important;
    }

    .pdf-report table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
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
    .card,
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
