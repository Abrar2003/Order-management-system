const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");

const root = path.resolve(__dirname, "../../client/OMS/dist");
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  let file = path.resolve(root, "." + decodeURIComponent(pathname));
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
    page.on("pageerror", (error) => errors.push(error.message));
    const user = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "super_admin", name: "AQL reviewer" };
    const qc = {
      _id: "bbbbbbbbbbbbbbbbbbbbbbbb", request_type: "AQL", request_date: "2026-10-14", inspector: user,
      order_meta: { order_id: "PO-AQL", vendor: "Vendor", brand: "Brand" },
      item: { item_code: "ITEM-AQL", description: "AQL inspection" },
      quantities: { client_demand: 600, quantity_requested: 600, vendor_provision: 600, qc_checked: 50, qc_passed: 600, qc_rejected: 0, pending: 0 },
      order: { _id: "cccccccccccccccccccccccc", order_id: "PO-AQL", quantity: 600, status: "Inspection Done", shipment: [], item: { item_code: "ITEM-AQL" } },
      item_master: { code: "ITEM-AQL", inspected_item_sizes: [], inspected_box_sizes: [], pis_item_sizes: [], pis_box_sizes: [] },
      request_history: [{ _id: "dddddddddddddddddddddddd", request_date: "2026-10-14", request_type: "AQL", quantity_requested: 600, inspector: user, status: "inspected" }],
      inspection_record: [{ _id: "eeeeeeeeeeeeeeeeeeeeeeee", request_history_id: "dddddddddddddddddddddddd", requested_date: "2026-10-14", inspection_date: "2026-10-14", inspector: user, request_type: "AQL", vendor_requested: 600, vendor_offered: 600, checked: 50, passed: 50, aql_passed: 600, rejected: 0, pending_after: 0, status: "Inspection Done", remarks: "Passed as per AQL", cbm: { total: "0.01" } }],
      cbm: { total: "0.01" }, labels: [], qc_images: [], hardware_inspection: [],
    };
    qc.last_inspection = qc.inspection_record[0];
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url()), route = url.pathname.replace(/^\/api/, "");
      if (url.origin === origin && request.isNavigationRequest()) return request.continue();
      const respond = (body) => request.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return respond({});
      if (route.startsWith("/auth/")) return respond({ user, data: [] });
      if (route === `/qc/${qc._id}`) return respond({ data: qc });
      if (route === "/qc/list") return respond({ data: [qc], pagination: { totalPages: 1, totalRecords: 1 }, filters: {} });
      if (url.pathname.endsWith("/bootstrap.min.css")) return request.respond({ status: 200, contentType: "text/css", body: fs.readFileSync(path.resolve(__dirname, "../../client/OMS/node_modules/bootstrap/dist/css/bootstrap.min.css")) });
      if (url.pathname.endsWith("/bootstrap.bundle.min.js")) return request.respond({ status: 200, contentType: "text/javascript", body: fs.readFileSync(path.resolve(__dirname, "../../client/OMS/node_modules/bootstrap/dist/js/bootstrap.bundle.min.js")) });
      if (url.pathname.startsWith("/api/") || ["xhr", "fetch"].includes(request.resourceType())) return respond({ data: [], summary: {}, filters: {} });
      if (url.origin !== origin) return request.abort();
      return request.continue();
    });
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(`${origin}/qc/${qc._id}`, { waitUntil: "networkidle0" });
      await page.waitForSelector(".qc-details-record-table").catch(async (error) => {
        throw new Error(`${error.message}: ${await page.$eval("body", (node) => node.innerText)}; ${errors.join("; ")}`);
      });
      assert.deepEqual(await page.$$eval(".qc-details-record-table tbody tr:first-child td", (cells) => cells.slice(6, 9).map((cell) => cell.textContent)), ["50", "600", "0"]);
      const headers = await page.$$eval(".qc-details-record-table thead th", (cells) => cells.map((cell) => cell.textContent));
      assert.ok(headers.some((text) => text.includes("AQL passed")));
      const buttons = await page.$$("button");
      for (const button of buttons) if ((await button.evaluate((node) => node.textContent)).trim() === "Update QC Record") { await button.click(); break; }
      await page.waitForSelector(".qc-update-modal-dialog");
      assert.doesNotMatch(await page.$eval(".qc-update-modal-dialog", (node) => node.textContent), /AQL passed/i);
      await page.reload({ waitUntil: "networkidle0" });
      const output = path.resolve(__dirname, "../../output/aql");
      fs.mkdirSync(output, { recursive: true });
      const table = await page.$(".qc-details-table-wrap");
      await table.screenshot({ path: path.join(output, `qc-records-${width}.png`) });
    }
    await page.setViewport({ width: 1440, height: 1000 });
    qc.inspection_record.push({ ...qc.inspection_record[0], _id: "ffffffffffffffffffffffff", request_type: "FULL", aql_passed: null, passed: 7 });
    await page.reload({ waitUntil: "networkidle0" });
    const aqlCells = () => page.$$eval('.qc-details-record-table td[data-label="AQL passed"]', (cells) => cells.map((cell) => cell.textContent));
    assert.deepEqual(await aqlCells(), ["600", "—"]);
    await page.click('.qc-details-record-table button[aria-label^="AQL passed."]');
    assert.deepEqual(await aqlCells(), ["600", "—"]);
    await page.click('.qc-details-record-table button[aria-label^="AQL passed."]');
    assert.deepEqual(await aqlCells(), ["—", "600"]);
    qc.inspection_record.pop();
    await page.goto(`${origin}/qc`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".qc-list-table tbody tr");
    assert.equal(await page.$eval(".qc-list-table tbody tr td:nth-child(8)", (cell) => cell.textContent), "600");
    qc.request_type = "FULL";
    qc.request_history[0].request_type = "FULL";
    qc.inspection_record[0].request_type = "FULL";
    qc.inspection_record[0].aql_passed = null;
    await page.reload({ waitUntil: "networkidle0" });
    assert.equal(await page.$eval(".qc-list-table tbody tr td:nth-child(8)", (cell) => cell.textContent), "50");
    await page.goto(`${origin}/qc/${qc._id}`, { waitUntil: "networkidle0" });
    assert.doesNotMatch(await page.$eval(".qc-details-record-table thead", (node) => node.textContent), /AQL passed/i);
    assert.deepEqual(errors, []);
    console.log("AQL and normal inspection columns, sample quantities, update-modal exclusion, and desktop/mobile layouts passed.");
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
