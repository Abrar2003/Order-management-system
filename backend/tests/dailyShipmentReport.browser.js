const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");
const { PDFParse } = require("pdf-parse");
const { renderHtmlPdf } = require("../controllers/pdf.controller");
const { closePdfRenderer } = require("../services/pdfRenderer");

const root = path.resolve(__dirname, "../../client/OMS/dist");
const server = http.createServer((req, res) => {
  let file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"].map((value) => path.join(process.env.PROGRAMFILES || "", value)).find((value) => fs.existsSync(value));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const requests = [];
    const pdfRequests = [];
    const pdfBuffers = [];
    let mode = "data";
    page.on("pageerror", (error) => errors.push(error.message));
    const user = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "super_admin", name: "Report reviewer" };
    const container = {
      id: "mscu-123456-7", container: "MSCU-123456-7", brand: "Brand A", vendor: "Vendor A", stuffed_cbm: 24.5,
      stuffing_dates: ["2026-10-16"], shipping_etas: ["2026-11-18"], shipping_etds: ["2026-10-18"],
      items: [
        { id: "partial", order_id: "PO-101", item_code: "ITEM-01", order_quantity: 100, stuffed_quantity: 40, remaining_quantity: 30 },
        { id: "complete", order_id: "PO-102", fully_shipped: true },
      ],
    };
    const exportContainers = Array.from({ length: 101 }, (_, index) => ({
      ...container, id: `export-${index + 1}`, container: `EXPORT-${String(index + 1).padStart(3, "0")}`,
      brand: index === 100 ? "Other Brand" : "Brand A", vendor: index === 100 ? "Other Vendor" : "Vendor A",
      items: index === 0 ? [
        ...Array.from({ length: 70 }, (_, itemIndex) => ({ ...container.items[0], id: `big-${itemIndex}`, order_id: `BIGPO-${itemIndex}`, item_code: `BIGITEM-${itemIndex}` })),
        container.items[1],
      ] : [{ ...container.items[0], order_id: `PO-${index + 1}`, item_code: `ITEM-${index + 1}` }],
    }));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url()), route = url.pathname.replace(/^\/api/, "");
      if (url.origin === origin && request.isNavigationRequest()) return request.continue();
      const respond = (body, status = 200) => request.respond({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }, body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return respond({});
      if (route.startsWith("/auth/")) return respond({ user });
      if (route === "/permissions/me") return respond({ role: user.role, permissions: { reports: { view: true } } });
      if (route === "/reports/pdf/render") {
        const body = JSON.parse(request.postData());
        pdfRequests.push(body);
        const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" };
        const res = {
          code: 200,
          setHeader(name, value) { headers[name] = String(value); },
          status(code) { this.code = code; return this; },
          json(payload) { return respond(payload, this.code); },
          send(buffer) { pdfBuffers.push(buffer); return request.respond({ status: this.code, headers, body: buffer }); },
        };
        renderHtmlPdf({ body, user }, res).catch((error) => { errors.push(error.message); respond({ message: error.message }, 500); });
        return;
      }
      if (route === "/reports/daily-shipments") {
        requests.push(Object.fromEntries(url.searchParams));
        if (mode === "error") return respond({ message: "Report unavailable" }, 500);
        if (url.searchParams.get("limit") === "100") {
          const exportPage = Number(url.searchParams.get("page"));
          if (mode === "export-error" && exportPage === 2) return respond({ message: "Second page unavailable" }, 500);
          return respond({ data: exportContainers.slice((exportPage - 1) * 100, exportPage * 100), pagination: { page: exportPage, totalPages: 2, totalRecords: 101 } });
        }
        return respond({ data: mode === "empty" ? [] : [{ ...container, stuffing_dates: [url.searchParams.get("stuffing_date")] }], pagination: { page: 1, totalPages: 1, totalRecords: mode === "empty" ? 0 : 1 }, filters: { brands: ["Brand A"], vendors: ["Vendor A"] } });
      }
      if (url.pathname.endsWith("/bootstrap.min.css")) return request.respond({ status: 200, contentType: "text/css", body: fs.readFileSync(path.resolve(__dirname, "../../client/OMS/node_modules/bootstrap/dist/css/bootstrap.min.css")) });
      if (url.pathname.endsWith("/bootstrap.bundle.min.js")) return request.respond({ status: 200, contentType: "text/javascript", body: fs.readFileSync(path.resolve(__dirname, "../../client/OMS/node_modules/bootstrap/dist/js/bootstrap.bundle.min.js")) });
      if (url.pathname.startsWith("/api/") || ["xhr", "fetch"].includes(request.resourceType())) return respond({ data: [], summary: {}, filters: {} });
      if (url.origin !== origin) return request.abort();
      return request.continue();
    });
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(`${origin}/reports/daily-shipments`, { waitUntil: "networkidle0" });
      await page.waitForSelector(".product-analytics-toggle");
      assert.equal(await page.$eval("h2", (node) => node.textContent), "Daily Shipment Report");
      assert.equal(await page.$$eval('form input[type="date"]', (inputs) => inputs.length), 1);
      assert.ok(await page.$eval("#daily-shipment-date", (input) => input.value));
      const controlTops = await page.$$eval("form input, form select, form button", (controls) => controls.map((control) => Math.round(control.getBoundingClientRect().top)));
      assert.ok(Math.max(...controlTops) - Math.min(...controlTops) <= 2, "All filters and buttons must share one row");
      assert.equal(await page.$(".product-analytics-detail-table"), null);
      await page.focus(".product-analytics-toggle");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".product-analytics-detail-table");
      assert.deepEqual(await page.$$eval(".product-analytics-detail-table tbody tr:first-child td", (cells) => cells.map((cell) => cell.textContent)), ["PO-101", "ITEM-01", "100", "40", "30"]);
      assert.deepEqual(await page.$$eval(".product-analytics-detail-table tbody tr:last-child td", (cells) => cells.map((cell) => cell.textContent)), ["PO-102", "All items are shipped"]);
      const output = path.resolve(__dirname, "../../output/daily-shipment-report");
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `report-${width}.png`), fullPage: true });
      await page.click(".product-analytics-toggle");
      assert.equal(await page.$(".product-analytics-detail-table"), null);
    }
    await page.type("#daily-shipment-search", "PO-101");
    await page.select("#daily-shipment-brand", "Brand A");
    await page.select("#daily-shipment-vendor", "Vendor A");
    await page.$eval("#daily-shipment-date", (input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "2026-10-16");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.$eval("form", (form) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector('[role="status"]'));
    assert.equal(requests.at(-1).search, "PO-101");
    assert.equal(requests.at(-1).brand, "Brand A");
    assert.equal(requests.at(-1).vendor, "Vendor A");
    assert.equal(requests.at(-1).stuffing_date, "2026-10-16");
    assert.equal(requests.at(-1).from_date, undefined);
    assert.equal(requests.at(-1).to_date, undefined);
    await page.evaluate(() => {
      window.pdfDownloads = [];
      HTMLAnchorElement.prototype.click = function () { window.pdfDownloads.push(this.download); };
    });
    const exportButton = 'button[title^="Export all containers"]';
    const requestCount = requests.length;
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/reports/pdf/render"), { timeout: 30000 }),
      page.click(exportButton),
    ]);
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.trim() === "Export PDF", { timeout: 30000 }, exportButton);
    assert.deepEqual(requests.slice(requestCount), [
      { stuffing_date: "2026-10-16", page: "1", limit: "100" },
      { stuffing_date: "2026-10-16", page: "2", limit: "100" },
    ]);
    assert.equal(pdfRequests.length, 1);
    assert.equal(pdfRequests[0].reportKey, "daily-shipment-report");
    assert.equal((pdfRequests[0].html.match(/<section/g) || []).length, 101);
    assert.match(pdfRequests[0].html, /EXPORT-101/);
    assert.match(pdfRequests[0].html, /Other Brand/);
    assert.match(pdfRequests[0].html, /Other Vendor/);
    assert.match(pdfRequests[0].html, /All items are shipped/);
    assert.ok(pdfRequests[0].html.indexOf("EXPORT-101") < pdfRequests[0].html.indexOf("BIGITEM-0"), "Every container summary must precede the first item detail");
    assert.deepEqual(await page.evaluate(() => window.pdfDownloads), ["daily-shipment-report-2026-10-16.pdf"]);
    const outputPdf = path.resolve(__dirname, "../../output/daily-shipment-report/export-fixture.pdf");
    fs.writeFileSync(outputPdf, pdfBuffers[0]);
    const parser = new PDFParse({ data: pdfBuffers[0] });
    try {
      const result = await parser.getText();
      assert.ok(result.pages.length > 2);
      assert.match(result.text, /EXPORT-101/);
      assert.match(result.text, /BIGITEM-69/);
      assert.match(result.text, /All items are shipped/);
      assert.match(result.pages[0].text, /Container Summary/);
      assert.doesNotMatch(result.pages[0].text, /BIGITEM-0/);
      assert.ok(result.text.indexOf("EXPORT-101") < result.text.indexOf("BIGITEM-0"));
      for (const pdfPage of result.pages) {
        assert.match(pdfPage.text, /Daily Shipment Report/);
        assert.match(pdfPage.text, /16\/10\/2026/);
      }
      console.log(`PDF export verified: 101 containers across ${result.pages.length} PDF pages, including a container with 71 PO rows.`);
    } finally {
      await parser.destroy();
    }
    mode = "export-error";
    await page.click(exportButton);
    await page.waitForSelector('[role="alert"]');
    assert.match(await page.$eval('[role="alert"]', (node) => node.textContent), /Failed to export/);
    assert.equal(pdfRequests.length, 1, "A failed data page must prevent an incomplete PDF download");
    mode = "empty";
    await page.reload({ waitUntil: "networkidle0" });
    assert.match(await page.$eval(".product-analytics-table", (node) => node.textContent), /No shipments found/);
    mode = "error";
    await page.reload({ waitUntil: "networkidle0" });
    assert.match(await page.$eval('[role="alert"]', (node) => node.textContent), /Report unavailable/);
    assert.deepEqual(errors, []);
    console.log("Daily Shipment Report: desktop/mobile expansion, keyboard access, PO summary, filters, empty and error states passed.");
  } finally {
    await closePdfRenderer();
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
