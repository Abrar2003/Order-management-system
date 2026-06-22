# Central PDF Export System

OMS PDF output is rendered by headless Chromium through one backend service:

- Renderer: `backend/services/pdfRenderer.js`
- Shared print CSS: `backend/services/pdfPrintStyles.js`
- HTTP controller: `backend/controllers/pdf.controller.js`
- Browser client: `client/OMS/src/services/pdfExport.service.js`

Canvas screenshots, stitched images, `html2canvas`, `jsPDF`, and PDFKit are not
allowed for report generation.

## Architecture

1. A report page renders its normal, already-filtered report markup.
2. `exportElementToPdf()` clones that markup, inlines images, captures the active
   application CSS, and posts it to a permission-protected PDF route.
3. The backend validates the report key and calls `renderPdf()`.
4. Chromium renders real HTML with print media enabled and returns a PDF buffer.
5. The browser downloads the returned `application/pdf` response.

Available routes:

| Route | Permission |
| --- | --- |
| `POST /reports/pdf/render` | `reports.view` |
| `POST /items/pdf/render` | `pis.export` |
| `POST /qc/pdf/render` | `qc.view` |

## Shared print behavior

The shared stylesheet provides:

- A4 portrait or landscape page sizing
- Exact print colors
- Real table layout
- Repeating `<thead>` and `<tfoot>` groups
- `break-inside: avoid` for rows, cells, cards, and report sections
- `.pdf-page-break-before` and `.pdf-page-break-after`
- Removal of interactive buttons
- Expanded table/preview scroll containers

Important classes:

- `.pdf-report`
- `.pdf-keep-together`
- `.pdf-report-section`
- `.pdf-page-break-before`
- `.pdf-page-break-after`
- `.pdf-hide` / `.no-print`

For long tabular reports, use semantic table elements:

```html
<table>
  <thead>
    <tr class="pdf-report-meta-row">
      <th colspan="7">
        <div class="pdf-report-title">Report title</div>
        <div class="pdf-report-subtitle">Date and selected filters</div>
      </th>
    </tr>
    <tr>
      <th>Column 1</th>
      <th>Column 2</th>
    </tr>
  </thead>
  <tbody>
    <tr>...</tr>
  </tbody>
</table>
```

`repeatHeader.inTable: true` inserts the report title and metadata into the first
table `<thead>`. Other reports use Chromium's repeated page header plus repeated
table column headers.

## Adding a report

```js
await exportElementToPdf({
  element: reportRef.current,
  reportKey: "my-report",
  filename: "my-report-2026-06-22.pdf",
  landscape: true,
  repeatHeader: {
    title: "My Report",
    subtitle: "Brand: All · Vendor: All",
  },
});
```

Then:

1. Add the report key to `PDF_REPORT_KEYS`.
2. Use the route whose permission matches the feature.
3. Use a real table for tabular data.
4. Put indivisible cards/groups in `.pdf-keep-together`.
5. Add a multi-page fixture if the layout is new.

Custom paper sizes are supported by `renderPdf()` through `width`, `height`, and
`@page` CSS. Labels should use exact physical dimensions rather than image-based
PDFs.

## Existing PDF producers migrated

| Feature | Previous method | Current endpoint | Layout |
| --- | --- | --- | --- |
| Delayed PO Summary / Detailed | `html2canvas` + sliced `jsPDF` images | `/reports/pdf/render` | A4 landscape |
| Daily Inspection Report | `html2canvas` + `jsPDF` | `/reports/pdf/render` | A4 portrait |
| Packed Goods | `html2canvas` + `jsPDF` | `/reports/pdf/render` | A4 portrait |
| Pending PO Report | `html2canvas` + `jsPDF` | `/reports/pdf/render` | A4 portrait |
| PO Status Report | `html2canvas` + `jsPDF` | `/reports/pdf/render` | A4 landscape |
| Weekly Order Summary | `html2canvas` + `jsPDF` | `/reports/pdf/render` | A4 portrait |
| PIS Diffs | `html2canvas` + `jsPDF` | `/items/pdf/render` | A4 portrait |
| Final PIS Check | `html2canvas` + `jsPDF` | `/items/pdf/render` | A4 portrait |
| Inspection Report | `html2canvas` + `jsPDF` | `/qc/pdf/render` | A4 portrait |
| Upcoming ETD | manually drawn `jsPDF` table | `/reports/pdf/render` | A4 landscape |
| Uploaded PIS spreadsheet conversion | LibreOffice directly generated PDF | LibreOffice HTML + shared Chromium renderer | A4 landscape |
| PIS workbook snapshot scripts | PDFKit | shared Chromium renderer | A4 portrait |

PDF readers, uploaded PDF files, PDF previews, barcode scanning of uploaded PDFs,
and `PDFtoSheet.js` are consumers rather than PDF producers and are intentionally
not changed.

## Chromium deployment

`puppeteer` is installed in the backend. The renderer searches:

1. `PUPPETEER_EXECUTABLE_PATH`
2. `CHROME_EXECUTABLE_PATH`
3. Common Windows Chrome/Edge locations
4. Common Linux Chrome/Chromium locations
5. Puppeteer's downloaded browser

For a Linux VPS, install Chrome/Chromium and its required shared libraries, or
run Puppeteer's browser installer during deployment:

```bash
npx puppeteer browsers install chrome --install-deps
```

The launch configuration includes:

```txt
--no-sandbox
--disable-setuid-sandbox
--disable-dev-shm-usage
--disable-gpu
```

The browser instance is reused and is closed during graceful server shutdown.

## Validation

Run:

```bash
cd backend
npm test
npm run test:pdf

cd ../client/OMS
npm run build
```

The PDF tests verify:

- Known report exporters use the central client
- No live export contains screenshot/`jsPDF` generation
- PDF routes are permission protected and use the central controller
- A real multi-page Chromium PDF opens successfully
- The report heading and column headers repeat on page two
- Row start/end markers stay on the same page
