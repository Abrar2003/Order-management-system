import { formatDateDDMMYYYY } from "./date.js";

const escapeHtml = (value) => String(value ?? "-").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const number = (value) => escapeHtml(Number(value).toLocaleString("en-IN", { maximumFractionDigits: 6 }));
const dates = (values) => values.length ? values.map((value) => escapeHtml(formatDateDDMMYYYY(value, "-"))).join(", ") : "-";

export const buildDailyShipmentPdfHtml = (rows, stuffingDate) => `
  <h1>Daily Shipment Report</h1>
  <p>Stuffing date: ${escapeHtml(formatDateDDMMYYYY(stuffingDate, "-"))} | Containers: ${rows.length}</p>
  ${rows.length ? `
    <h2>Container Summary</h2>
    <table class="daily-shipment-pdf-summary">
      <thead><tr><th>Container Number</th><th>Brand</th><th>Vendor</th><th>Stuffed CBM</th><th>Stuffing Date</th><th>ETA</th><th>ETD</th></tr></thead>
      <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.container)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.vendor)}</td><td>${number(row.stuffed_cbm)}</td><td>${dates(row.stuffing_dates)}</td><td>${dates(row.shipping_etas)}</td><td>${dates(row.shipping_etds)}</td></tr>`).join("")}</tbody>
    </table>
    <h2 class="daily-shipment-pdf-details">Container Details</h2>
    ${rows.map((row) => `
    <section class="daily-shipment-pdf-container">
      <table class="daily-shipment-pdf-items">
        <thead><tr><th colspan="5">Items shipped under container ${escapeHtml(row.container)}</th></tr><tr><th>PO</th><th>Item Code</th><th>Order Quantity</th><th>Stuffed Quantity</th><th>Remaining Quantity</th></tr></thead>
        <tbody>${row.items.map((item) => `<tr><td>${escapeHtml(item.order_id)}</td>${item.fully_shipped
          ? '<td colspan="4">All items are shipped</td>'
          : `<td>${escapeHtml(item.item_code)}</td><td>${number(item.order_quantity)}</td><td>${number(item.stuffed_quantity)}</td><td>${number(item.remaining_quantity)}</td>`}</tr>`).join("")}</tbody>
      </table>
    </section>`).join("")}` : "<p>No containers were stuffed on this date.</p>"}
`;

export const DAILY_SHIPMENT_PDF_CSS = `
  .daily-shipment-pdf-container { margin-bottom: 6mm; }
  .daily-shipment-pdf-details { break-before: page; page-break-before: always; }
  .daily-shipment-pdf-items { margin-top: 2mm; }
  .daily-shipment-pdf-summary th, .daily-shipment-pdf-summary td,
  .daily-shipment-pdf-container th, .daily-shipment-pdf-container td {
    border: 1px solid #d8cbb8; white-space: normal !important; overflow-wrap: anywhere;
  }
`;
