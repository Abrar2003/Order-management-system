import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyShipmentPdfHtml } from "./dailyShipmentPdf.js";

test("daily shipment PDF includes each container, all item details, and complete PO notes", () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    container: `CONT-${index}`, brand: "Brand A", vendor: "Vendor A", stuffed_cbm: 1.25,
    stuffing_dates: ["2026-10-16"], shipping_etas: ["2026-11-18"], shipping_etds: ["2026-10-18"],
    items: [{ order_id: `PO-${index}`, item_code: `ITEM-${index}`, order_quantity: 100, stuffed_quantity: 40, remaining_quantity: 60 }],
  }));
  rows[0].items.push({ order_id: "PO-COMPLETE", fully_shipped: true });
  const html = buildDailyShipmentPdfHtml(rows, "2026-10-16");
  assert.match(html, /Stuffing date: 16\/10\/2026 \| Containers: 101/);
  assert.equal((html.match(/<section/g) || []).length, 101);
  assert.equal((html.match(/class="daily-shipment-pdf-summary"/g) || []).length, 1);
  const summary = html.slice(html.indexOf('<table class="daily-shipment-pdf-summary">'), html.indexOf("Container Details"));
  assert.equal((summary.match(/<tr>/g) || []).length, 102);
  assert.match(summary, /CONT-100/);
  assert.doesNotMatch(summary, /ITEM-0|PO-COMPLETE/);
  assert.ok(html.indexOf("Container Details") < html.indexOf("<section"));
  assert.match(html, /ITEM-100/);
  assert.match(html, /<td>100<\/td><td>40<\/td><td>60<\/td>/);
  assert.match(html, /PO-COMPLETE<\/td><td colspan="4">All items are shipped/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("daily shipment PDF escapes record text and handles empty days", () => {
  const html = buildDailyShipmentPdfHtml([{
    container: '<script>alert("container")</script>', brand: "A & B", vendor: "Vendor", stuffed_cbm: 0,
    stuffing_dates: [], shipping_etas: [], shipping_etds: [],
    items: [{ order_id: '<img src="x">', item_code: "A<B", order_quantity: 1, stuffed_quantity: 0, remaining_quantity: 1 }],
  }], "2026-10-16");
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(buildDailyShipmentPdfHtml([], "2026-10-16"), /No containers were stuffed on this date/);
});
