const { parseDateOnly, toDateOnlyIso } = require("../helpers/dateOnly");

const getContainerEtaWeek = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = parseDateOnly(value);
  if (!day) return null;

  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  const start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  const end = day.toISOString().slice(0, 10);
  return { start, end };
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
});
const reportDateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
});
const formatDay = (value) => {
  const day = parseDateOnly(value);
  return day ? dayFormat.format(day) : "-";
};

const buildWeeklyContainerReport = (rows, { start, end, brands = [] }, now = new Date()) => {
  const matchingRows = rows.filter(({ shipping_ETA }) => shipping_ETA >= start && shipping_ETA <= end);
  const generatedDate = reportDateFormat.format(parseDateOnly(toDateOnlyIso(now)));

  return {
    format: "A4",
    landscape: false,
    margin: { top: "8.47mm", right: "0mm", bottom: "16.23mm", left: "0mm" },
    html: `
      <article class="container-register">
        <header>
          <div class="register-brand"><span>${generatedDate}</span></div>
          <h1>Container shipment report</h1>
          <div class="register-range">${formatDay(start)} - ${formatDay(end)}&nbsp; / &nbsp;${brands.length ? escapeHtml(brands.join(", ")) : "All containers"}</div>
        </header>
        <section>
          <h2>Shipment register</h2>
          <table>
            <colgroup><col style="width:89pt"><col style="width:59pt"><col style="width:138pt"><col style="width:68pt"><col style="width:68pt"><col style="width:65pt"><col></colgroup>
            <thead><tr><th>Container</th><th>Brand</th><th>Vendor</th><th>Shipping date</th><th>ETD</th><th>ETA</th><th>CBM (m³)</th></tr></thead>
            <tbody>${matchingRows.length ? matchingRows.map((row) => `
              <tr>
                <td>${escapeHtml(row.container)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.vendor)}</td>
                <td>${formatDay(row.shipping_date)}</td><td>${formatDay(row.shipping_ETD)}</td><td>${formatDay(row.shipping_ETA)}</td>
                <td>${Number(row.total_cbm ?? 0).toFixed(2)}</td>
              </tr>`).join("") : '<tr><td colspan="7">No containers have an ETA in this week.</td></tr>'}</tbody>
          </table>
        </section>
      </article>`,
    extraCss: `
      @page {
        @bottom-left {
          content: "Green House Sourcing  /  OMS";
          width: 431pt; margin-left: 32pt; border-top: 0.5pt solid #dcddd7;
          padding-top: 7pt; vertical-align: top; text-align: left;
          color: #66766f; font: bold 8pt Lato, Arial, sans-serif;
        }
        @bottom-right {
          content: counter(page, decimal-leading-zero) " / " counter(pages, decimal-leading-zero);
          width: 100pt; margin-right: 32pt; border-top: 0.5pt solid #dcddd7;
          padding-top: 7pt; vertical-align: top; text-align: right;
          color: #66766f; font: 8pt Lato, Arial, sans-serif;
        }
      }
      @page :first { margin-top: 0; }
      .container-register { color: #263430; font: 8.8pt/11.3pt Lato, Arial, sans-serif; }
      .container-register header { height: 111pt; padding: 22pt 32pt 0; background: #f2efe9; }
      .register-brand { display: flex; justify-content: flex-end; color: #68665e; font-size: 8.4pt; font-weight: bold; }
      .pdf-report .container-register h1, .pdf-report .container-register h2 {
        color: #30392f; font-family: "DejaVu Serif", Georgia, serif; font-weight: normal;
      }
      .pdf-report .container-register h1 { font-size: 25pt; margin: 7pt 0 6pt; }
      .register-range { color: #68665e; font-size: 9pt; }
      .container-register section { padding: 15pt 32pt 0; }
      .pdf-report .container-register h2 { font-size: 15pt; margin: 0 0 10pt; break-after: avoid; }
      .pdf-report .container-register th, .pdf-report .container-register td {
        padding: 0 4.5pt; text-align: left; line-height: 11.3pt;
      }
      .pdf-report .container-register th {
        height: 29pt; background: #f0ece5 !important; color: #66766f !important;
        font-size: 8pt; border: 0 !important;
      }
      .pdf-report .container-register td {
        height: 44pt; padding-block: 16pt; border-bottom: 0.5pt solid #dcddd7; overflow-wrap: anywhere;
      }
      .pdf-report .container-register td:first-child { font-weight: bold; }
      .pdf-report .container-register th:last-child, .pdf-report .container-register td:last-child:not([colspan]) { text-align: right; }
    `,
  };
};

module.exports = { getContainerEtaWeek, buildWeeklyContainerReport };
