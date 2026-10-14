const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");

// Run after the frontend build; API fixtures keep this check independent of live data.
const root = path.resolve(__dirname, "../../client/OMS/dist");
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  let file = path.resolve(root, "." + decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"].map(value => path.join(process.env.PROGRAMFILES || "", value)).find(value => fs.existsSync(value));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const po = { orderId: "20250480", orderDate: "2025-09-19", brand: "Eleonora", vendor: "Boranada", orderQuantity: 130, passedQuantity: 120, shippedQuantity: 100, inspectionCount: 1, inspectionTimeDays: 1 };
    let rows = [{ id: "item-1", itemCode: "ITEM-1", poCount: 1, ...po, orders: [po] }, { id: "item-2", itemCode: "ITEM-2", poCount: 1, orderQuantity: 10, passedQuantity: 0, shippedQuantity: 0, orders: [] }];
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = new URL(request.url());
      const route = url.pathname.replace(/^\/api/, "");
      const respond = body => request.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type" }, body: JSON.stringify(body) });
      if (request.method() === "OPTIONS") return respond({});
      if (route.startsWith("/auth/")) return respond({ user: { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "super_admin", name: "Analytics reviewer" } });
      if (route === "/items/product-analytics") return respond({ data: rows, pagination: { totalPages: 1, totalRecords: rows.length }, filters: {} });
      if (url.pathname.endsWith("/bootstrap.min.css")) return request.respond({ status: 200, contentType: "text/css", body: fs.readFileSync(path.resolve(__dirname, "../../client/OMS/node_modules/bootstrap/dist/css/bootstrap.min.css")) });
      if (url.pathname.startsWith("/api/")) return respond({ data: [] });
      if (url.origin !== origin) return request.abort();
      return request.continue();
    });
    for (const width of [1440, 1128, 390]) {
      await page.setViewport({ width, height: 950 });
      await page.goto(origin + "/reports/product-analytics", { waitUntil: "networkidle0" });
      await page.waitForSelector(".product-analytics-parent-row");
      assert.deepEqual(await page.$$eval(".product-analytics-parent-row:first-child > td", cells => cells.slice(2, 5).map(cell => cell.textContent)), ["130", "120", "100"]);
      await page.click('[aria-label="Expand PO rows"]');
      assert.deepEqual(await page.$$eval(".product-analytics-detail-table tbody tr:first-child > td", cells => cells.slice(3, 6).map(cell => cell.textContent)), ["130", "120", "100"]);
      assert.equal(await page.$$eval(".product-analytics-detail-table th", cells => cells.length), 11);
      assert.equal(await page.$eval(".product-analytics-detail-table tbody td", el => getComputedStyle(el).whiteSpace), "nowrap");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow at ${width}px`);
      assert.ok(await page.$eval(".product-analytics-scroll", el => getComputedStyle(el).overflowX === "auto"));
      if (width === 1128) await page.screenshot({ path: path.resolve(__dirname, "../../.tmp/product-analytics-quantities.png"), fullPage: true });
    }
    const shippedSort = await page.$$(".product-analytics-table > thead button");
    await shippedSort[4].click();
    assert.match(await page.$eval(".product-analytics-parent-row", el => el.textContent), /ITEM-1/);
    await shippedSort[4].click();
    assert.match(await page.$eval(".product-analytics-parent-row", el => el.textContent), /ITEM-2/);
    rows = [];
    await page.reload({ waitUntil: "networkidle0" });
    assert.equal(await page.$eval(".product-analytics-table tbody td", el => el.colSpan), 10);
    assert.deepEqual(errors, []);
    console.log("Product analytics quantities, sorting, empty state and responsive layout passed at 1440, 1128 and 390px.");
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
