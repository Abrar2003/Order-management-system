const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");

// Run after building client/OMS; API traffic is intercepted with isolated fixtures.
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
  const id = "507f1f77bcf86cd799439011";
  const species = { _id: "507f1f77bcf86cd799439012", name: "Mango", scientific_name: "Mangifera indica", active: true };
  const order = { _id: id, order_id: "PO-EUDR", item: { item_code: "TABLE", description: "Table" }, quantity: 10, order_quantity: 10,
    status: "Inspection Done", shippable_quantity: 10, passed_quantity: 10, shipment: [], vendor: "Test Vendor", line_type: "order" };
  const sample = { _id: id, code: "SAMPLE-EUDR", brand: "Giga", name: "Sample", shipment: [] };
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage(), errors = [], mutations = [];
    page.setDefaultTimeout(5000);
    await page.setViewport({ width: 1440, height: 1100 });
    page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = new URL(request.url()), route = url.pathname.replace(/^\/api/, "");
      if (url.origin === origin && request.isNavigationRequest()) return request.continue();
      const respond = body => request.respond({ status: 200, contentType: "application/json", headers: {
        "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      }, body: JSON.stringify(body) });
      if (url.pathname.endsWith("/bootstrap.min.css") || url.pathname.endsWith("/bootstrap.bundle.min.js")) {
        const css = url.pathname.endsWith(".css");
        return request.respond({ status: 200, contentType: css ? "text/css" : "text/javascript", body: fs.readFileSync(path.resolve(__dirname, `../../client/OMS/node_modules/bootstrap/dist/${css ? "css/bootstrap.min.css" : "js/bootstrap.bundle.min.js"}`)) });
      }
      if (request.method() === "OPTIONS") return respond({});
      if (request.method() === "PATCH" || request.method() === "POST" && route === "/samples") {
        mutations.push(JSON.parse(request.postData()));
        return respond({ data: sample });
      }
      if (route.startsWith("/auth/")) return respond({ user: { id, role: "super_admin", name: "Admin", brand_scope: "all" } });
      if (route === "/permissions/me") return respond({ role: "super_admin", permissions: { orders: { edit: true }, items: { view: true }, shipments: { edit: true, view: true } } });
      if (route === "/orders/brands-and-vendors") return respond({ brands: ["Giga"], vendors: ["Test Vendor"] });
      if (route === "/wood-species") return respond({ data: [species] });
      if (route.startsWith("/orders/shipments/timber-cft/")) return respond({ timber_cft: null });
      if (route === "/orders/shipments") return respond({ data: [order], pagination: { page: 1, totalPages: 1, totalRecords: 1 }, filters: {}, summary: {} });
      if (route === "/qc/list") return respond({ data: [
        { order, item: order.item, quantities: { qc_passed: 10, client_demand: 10 } },
        { order: { ...order, _id: species._id, order_id: "PO-SECOND" }, item: order.item, quantities: { qc_passed: 10, client_demand: 10 } },
      ], pagination: { totalPages: 1 } });
      if (route === "/samples") return respond({ data: [sample], pagination: { totalPages: 1 } });
      if (url.origin !== origin || url.pathname.startsWith("/api/")) return respond({ data: [], unreadCount: 0 });
      return request.continue();
    });
    const click = text => page.evaluate(text => [...(document.querySelector(".modal") || document).querySelectorAll("button")].find(node => !node.closest("thead") && node.textContent.trim() === text).click(), text);
    const field = (label, value) => page.evaluate((label, value) => {
      const node = [...(document.querySelector(".modal") || document).querySelectorAll("label")].find(node => node.textContent.trim() === label);
      const input = node.querySelector("input,select") || node.parentElement.querySelector("input,select");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
      input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }, label, value);
    const toggle = () => page.evaluate(() => [...document.querySelectorAll("label")].find(node => node.textContent.trim() === "EUDR needed").querySelector("input").click());
    const wood = async () => {
      await page.waitForSelector('input[id$="volume"]');
      await field("Finished wood volume in one product (CFT / m³)", "0.5");
      await field("HSN / HS code", "9403 60");
      await click("Add species");
      await page.waitForFunction(id => [...document.querySelectorAll('select[id$="species0"] option')].some(option => option.value === id), {}, species._id);
      await page.select('select[id$="species0"]', species._id);
    };
    const saved = async (button, count = 1) => {
      const before = mutations.length;
      await click(button);
      await page.waitForFunction(() => !document.querySelector(".modal"));
      await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(node => node.textContent.trim() === "Saving..."));
      assert.equal(mutations.length, before + count);
      for (const payload of mutations.slice(before)) {
        assert.equal(payload.eudr_needed, true);
        assert.deepEqual(payload.finished_wood_volume, { value: "0.5", unit: "cft" });
        assert.deepEqual(payload.species_composition, [{ species: species._id, share_bp: 10000 }]);
        assert.equal(payload.hs_code, "9403 60");
      }
    };
    await page.goto(origin + "/signin", { waitUntil: "networkidle0" });
    await page.type('input[name="username"]', "test-admin");
    await page.type('input[name="password"]', "test-password");
    await page.locator('.signin-page-shell button[type="submit"]').click();
    await page.waitForFunction(() => location.pathname === "/");

    await page.goto(origin + "/shipments", { waitUntil: "networkidle0" });
    await click("Finalize");
    await page.waitForSelector(".modal");
    assert.equal(await page.$("fieldset"), null);
    await field("Container Number", "MSCU-123456-7");
    await field("Shipped By", "shipped_by_vendor");
    await field("Quantity", "2");
    await toggle();
    await click("Finalize");
    await page.waitForFunction(() => document.querySelector(".alert-danger")?.textContent.includes("CFT per item"));
    assert.equal(mutations.length, 0);
    await wood();
    assert.match(await page.$eval(".modal", node => node.innerText), /Stuffed timber CFT: 1\.000/);
    await saved("Finalize");

    await click("Add Sample");
    await page.waitForSelector(".modal");
    await field("Existing Sample", id);
    await field("Quantity", "2");
    await field("Container Number", "MSCU-123456-7");
    await field("Shipped By", "shipped_by_vendor");
    await toggle();
    await wood();
    await saved("Add Sample");

    await page.goto(origin + "/container?vendor=Test%20Vendor", { waitUntil: "networkidle0" });
    await field("Container Number", "MSCU-123456-7");
    await field("Stuffed By", "shipped_by_vendor");
    await page.$$eval('tbody input[type="checkbox"]', nodes => nodes.forEach(node => node.click()));
    await toggle();
    await page.waitForSelector("fieldset");
    assert.equal((await page.$$("fieldset")).length, 1, "One wood form per item, even across two POs");
    const before = mutations.length;
    await click("Finalize Bulk");
    await page.waitForFunction(() => document.querySelector(".alert-danger")?.textContent.includes("CFT per item"));
    assert.equal(mutations.length, before);
    await wood();
    await saved("Finalize Bulk", 2);
    assert.deepEqual(errors, []);
    console.log("EUDR browser checks passed: individual, sample and bulk shipping; required fields; shared item forms; live CFT preview.");
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
