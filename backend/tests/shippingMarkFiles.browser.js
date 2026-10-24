const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");

// Run after building client/OMS; uploads use isolated API fixtures.
const root = path.resolve(__dirname, "../../client/OMS/dist");
const server = http.createServer((req, res) => {
  let file = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || [
    path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
  ].find(file => fs.existsSync(file));
  const options = ["shipping_marks", "flat_carton", "ean", "logistics_ean", "three_d_carton"];
  const labels = ["Shipping Mark", "Flat Carton", "EAN", "Logistics EAN", "3D Carton"];
  const item = { _id: "507f1f77bcf86cd799439011", code: "KD-ITEM", name: "Test item", kd: true, shipping_marks: {} };
  const other = { _id: "507f1f77bcf86cd799439012", code: "NON-KD", name: "Other item", kd: false };
  const fields = { shipping_marks: "files", flat_carton: "flat_carton", ean: "ean", three_d_carton: "three_d_carton" };
  let canUpload = true;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage(), errors = [], uploads = [], previews = [];
    page.setDefaultTimeout(5000);
    await page.setViewport({ width: 1600, height: 1000 });
    page.on("pageerror", error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async request => {
      const url = new URL(request.url()), route = url.pathname.replace(/^\/api/, "");
      const respond = body => request.respond({ status: 200, contentType: "application/json", headers: {
        "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      }, body: JSON.stringify(body) });
      if (request.isNavigationRequest()) return request.continue();
      if (url.pathname.endsWith("/bootstrap.min.css") || url.pathname.endsWith("/bootstrap.bundle.min.js")) {
        const css = url.pathname.endsWith(".css");
        return request.respond({ status: 200, contentType: css ? "text/css" : "text/javascript", body: fs.readFileSync(path.resolve(__dirname, `../../client/OMS/node_modules/bootstrap/dist/${css ? "css/bootstrap.min.css" : "js/bootstrap.bundle.min.js"}`)) });
      }
      if (request.method() === "OPTIONS") return respond({});
      if (route.startsWith("/auth/")) return respond({ user: { id: item._id, role: "manager", brand_scope: "all" } });
      if (route === "/permissions/me") return respond({ role: "manager", permissions: { items: { view: true }, images_documents: { upload: canUpload } } });
      if (request.method() === "POST" && route.endsWith("/files")) {
        const data = request.postData() || await request.fetchPostData();
        const type = /name="file_type"\r\n\r\n([^\r]+)/.exec(data)?.[1];
        uploads.push({ type, data });
        const file = { key: `${type}.pdf`, originalName: `${type}.pdf` };
        if (type === "logistics_ean") item.logistics_ean = file;
        else item.shipping_marks[fields[type]] = ["shipping_marks", "flat_carton"].includes(type) ? [file] : file;
        return respond({ message: "File uploaded" });
      }
      if (/\/files\/[^/]+\/url$/.test(route)) {
        previews.push(route.split("/").at(-2));
        return respond({ data: { url: "data:application/pdf;base64,JVBERi0xLjQ=", file: {} } });
      }
      if (route === "/items") return respond({ data: [item, other], filters: {}, pagination: { totalPages: 1, totalRecords: 2 } });
      if (url.origin !== origin || url.pathname.startsWith("/api/")) return respond({ data: [], unreadCount: 0 });
      return request.continue();
    });
    const load = async route => {
      await page.goto(origin + route, { waitUntil: "networkidle0" });
      await page.waitForSelector("tbody tr");
    };
    const drop = async (label, names) => page.evaluate((label, names) => {
      const zone = document.querySelector(`[aria-label="Upload ${label} for KD-ITEM"]`);
      const dataTransfer = new DataTransfer();
      names.forEach(name => dataTransfer.items.add(new File(["test"], name, { type: name.endsWith(".pdf") ? "application/pdf" : "text/plain" })));
      zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    }, label, names);
    await load("/shipping-mark-files");
    assert.equal(await page.$eval("h2", node => node.textContent), "Shipping Mark Files");
    assert.equal((await page.$$("tbody tr:first-child .item-file-dropzone")).length, 5);
    assert.equal((await page.$$("tbody tr:nth-child(2) .item-file-dropzone")).length, 4);
    assert.equal((await page.$$("thead th")).length, 5);
    assert.equal((await page.$$('td[data-label="CBM"], .items-size-column')).length, 0);
    assert.equal(await page.$$eval("tbody button", buttons => buttons.some(button => button.textContent.trim() === "Preview")), false);
    assert.equal(await page.$eval(".shipping-mark-file-grid", grid => getComputedStyle(grid).gridTemplateColumns.split(" ").length), 5);
    assert.equal(await page.$eval(".shipping-mark-files-table", table => table.getBoundingClientRect().width > innerWidth * 0.9), true);
    assert.equal(await page.$$eval("tbody tr:first-child .item-file-dropzone", zones => zones.every(zone => {
      const cell = zone.closest(".shipping-mark-file-window").getBoundingClientRect();
      const box = zone.getBoundingClientRect();
      return box.left >= cell.left && box.right <= cell.right;
    })), true, "Desktop drop zones must fit inside their own columns");
    for (let index = 0; index < options.length; index++) {
      const names = ["shipping_marks", "flat_carton"].includes(options[index]) ? ["one.pdf", "two.pdf"] : ["one.pdf"];
      await drop(labels[index], names);
      await page.waitForFunction(() => document.querySelector(".alert-success"));
      await page.waitForSelector(".item-file-dropzone:not([disabled])");
      assert.equal(uploads.at(-1).type, options[index]);
      assert.equal((uploads.at(-1).data.match(/filename=/g) || []).length, names.length);
    }
    await drop("EAN", ["invalid.txt"]);
    await page.waitForSelector(".alert-danger");
    assert.equal(uploads.length, 5, "Invalid files must not reach the API");
    const [chooser] = await Promise.all([
      page.waitForFileChooser(),
      page.click('[aria-label="Upload Flat Carton for KD-ITEM"]'),
    ]);
    assert.equal(await page.$eval('input[type="file"]', input => input.multiple), true);
    await chooser.cancel();
    await page.$eval('input[type="file"]', input => {
      const files = new DataTransfer();
      files.items.add(new File(["test"], "picked.pdf", { type: "application/pdf" }));
      input.files = files.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForSelector(".alert-success");
    await page.waitForSelector(".item-file-dropzone:not([disabled])");
    assert.equal(uploads.length, 6);
    assert.equal(uploads.at(-1).type, "flat_carton", "The picker must retain its selected category");
    await page.setViewport({ width: 390, height: 844 });
    assert.equal((await page.$$("tbody tr:first-child .item-file-dropzone")).length, 5);
    assert.equal(await page.$eval(".shipping-mark-file-grid", grid => getComputedStyle(grid).gridTemplateColumns.split(" ").length), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewport({ width: 1600, height: 1000 });
    await load("/item-files?file_type=ean");
    assert.equal((await page.$$("tbody tr:first-child .item-file-dropzone")).length, 1);
    assert.equal((await page.$$('td[data-label="CBM"]')).length, 2);
    await page.$$eval('tbody tr:first-child td[data-label="Action"] button', buttons => buttons.find(button => button.textContent.trim() === "Preview").click());
    await page.waitForSelector("[data-file-preview]");
    assert.equal(previews.at(-1), "ean", "Existing file pages retain their previews");
    await page.keyboard.press("Escape");
    canUpload = false;
    await load("/shipping-mark-files");
    assert.equal((await page.$$(".item-file-dropzone")).length, 0, "Upload permissions must be respected");
    assert.deepEqual(errors, []);
    console.log("Shipping mark file browser checks passed: compact grid, wider table, removed sizes/CBM/previews, five upload destinations, validation, picker, mobile, permissions and existing page.");
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
