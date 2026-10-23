const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");
const { resolveOrderRowCbmSummaryWithStoredFallback } = require("../services/shipmentCbmAllocation.service");

const fixtures = [
  { code: "8824177", inspected_item_sizes: [{ remark: "item", L: 120, B: 120, H: 77.5 }],
    inspected_box_sizes: [{ remark: "top", L: 135.5, B: 16.5, H: 135 }, { remark: "base", L: 57, B: 58, H: 81 }] },
  { code: "PIS", pis_box_sizes: [{ remark: "box", L: 100, B: 100, H: 50 }] },
  { code: "CARTON", inspected_box_mode: "carton", inspected_box_sizes: [
    { remark: "inner", box_type: "inner", L: 50, B: 50, H: 50, item_count_in_inner: 2 },
    { remark: "master", box_type: "master", L: 100, B: 100, H: 100, box_count_in_master: 5 },
  ] },
  { code: "MASTER", inspected_box_mode: "individual_master", inspected_box_sizes: [
    { remark: "master", box_type: "master", L: 100, B: 100, H: 100, box_count_in_master: 5 },
  ] },
  { code: "MISSING" },
];
const orders = fixtures.map((itemDoc, index) => {
  const summary = resolveOrderRowCbmSummaryWithStoredFallback({ itemDoc, quantity: 15, storedTotalCbm: 9 });
  return { _id: `order-${index}`, order_id: "117160", brand: "Giga", vendor: "Boranada", status: "Pending",
    quantity: 15, shipment: [], item: { item_code: itemDoc.code, description: "Packing CBM regression" },
    order_date: "2026-10-16", ETD: "2027-01-15", cbm_summary: summary, pending_cbm: summary.total };
});
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
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"]
    .map((value) => path.join(process.env.PROGRAMFILES || "", value)).find((value) => fs.existsSync(value));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = new URL(request.url()), route = url.pathname.replace(/^\/api/, "");
      if (url.origin === origin && request.isNavigationRequest()) return request.continue();
      const respond = (body) => request.respond({ status: 200, contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" }, body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return respond({});
      if (route.startsWith("/auth/")) return respond({ user: { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "super_admin", name: "CBM reviewer" } });
      if (route === "/permissions/me") return respond({ role: "super_admin", permissions: { orders: { view: true } } });
      if (route === "/orders/order-by-id/117160") return respond(orders);
      if (url.pathname.endsWith("/bootstrap.min.css")) return request.respond({ status: 200, contentType: "text/css", body: fs.readFileSync(path.resolve(__dirname, "../../client/OMS/node_modules/bootstrap/dist/css/bootstrap.min.css")) });
      if (url.pathname.endsWith("/bootstrap.bundle.min.js")) return request.respond({ status: 200, contentType: "text/javascript", body: fs.readFileSync(path.resolve(__dirname, "../../client/OMS/node_modules/bootstrap/dist/js/bootstrap.bundle.min.js")) });
      if (url.pathname.startsWith("/api/") || ["xhr", "fetch"].includes(request.resourceType())) return respond({ data: [], summary: {}, filters: {} });
      if (url.origin !== origin) return request.abort();
      return request.continue();
    });
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(`${origin}/orders?order_id=117160`, { waitUntil: "networkidle0" });
      await page.waitForSelector(".orders-cbm-trigger");
      for (const [code, display, tooltip] of [
        ["8824177", "Inspected", /0\.30182625 \+ 0\.267786 = 0\.56961225 m³ per item/],
        ["PIS", "PIS", /PIS box sizes/],
        ["CARTON", "Inspected", /1 ÷ \(2 × 5\) = 0\.1 m³ per item/],
        ["MASTER", "Inspected", /1 ÷ 5 = 0\.2 m³ per item/],
        ["MISSING", "N/A", /Usable inspected and PIS packing-box measurements are unavailable/],
      ]) {
        const index = await page.$$eval(".orders-table tbody tr", (rows, code) => rows.findIndex((row) => row.cells[0].textContent.trim() === code), code);
        assert.ok(index >= 0);
        const selector = `.orders-table tbody tr:nth-child(${index + 1}) .orders-cbm-trigger`;
        assert.equal(await page.$eval(selector, (button) => button.textContent), display);
        if (code !== "MISSING") {
          assert.match(await page.$eval(selector, (button) => button.closest(".orders-cbm-item").textContent), new RegExp(`Item:\\s*${code === "CARTON" ? "0\\.10" : code === "MASTER" ? "0\\.20" : code === "PIS" ? "0\\.50" : "0\\.57"} m³`));
        }
        await page.hover(selector);
        await page.waitForSelector('[role="tooltip"]');
        await page.waitForFunction(() => getComputedStyle(document.querySelector(".custom-tooltip")).opacity === "1");
        assert.match(await page.$eval('[role="tooltip"]', (node) => node.textContent), tooltip);
        if (code === "8824177") {
          assert.match(await page.$eval('[role="tooltip"]', (node) => node.textContent), /135\.5 × 16\.5 × 135 cm/);
          assert.match(await page.$eval(selector, (button) => button.closest("td").textContent), /Total:\s*8\.54/);
          assert.equal(await page.$eval(selector, (button) => button.closest("td").nextElementSibling.textContent.trim()), "8.54");
          if (width === 390) {
            assert.ok(await page.$eval(".orders-table-wrap", (node) => node.scrollWidth > node.clientWidth));
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            assert.ok(await page.$eval(selector, (button) => button.getBoundingClientRect().height < 60));
          }
          const output = path.resolve(__dirname, "../../output/order-cbm");
          fs.mkdirSync(output, { recursive: true });
          await page.screenshot({ path: path.join(output, `packing-${width}.png`), fullPage: true });
        }
        if (code === "CARTON") assert.doesNotMatch(await page.$eval('[role="tooltip"]', (node) => node.textContent), /50 × 50 × 50/);
        await page.mouse.move(0, 0);
        await page.waitForSelector('[role="tooltip"]', { hidden: true });
        await page.focus(selector);
        await page.waitForSelector('[role="tooltip"]');
        const id = await page.$eval(selector, (button) => button.getAttribute("aria-describedby"));
        assert.equal(await page.$eval('[role="tooltip"]', (node) => node.id), id);
        assert.match(await page.$eval('[role="tooltip"]', (node) => node.textContent), tooltip);
        await page.keyboard.press("Tab");
        await page.waitForSelector('[role="tooltip"]', { hidden: true });
      }
    }
    assert.deepEqual(errors, []);
    console.log("Orders CBM: packing sources, all packing modes, N/A, unchanged total/pending, hover and keyboard tooltips passed at desktop/mobile widths.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
