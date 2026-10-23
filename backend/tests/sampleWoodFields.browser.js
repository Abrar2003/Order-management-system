const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");

// Run after building client/OMS; all API requests use isolated fixtures.
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
  ].find(candidate => fs.existsSync(candidate));
  const species = { _id: "507f1f77bcf86cd799439012", name: "Mango", scientific_name: "Mangifera indica", active: true };
  let sample = { _id: "507f1f77bcf86cd799439011", code: "SAMPLE-WOOD", name: "Table", brand: "Giga", vendor: [], timber_cft: 0.5, hs_code: "940360", species_composition: [{ species: species._id, share_bp: 10000 }], shipment: [] };
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage(), errors = [], mutations = [];
    await page.setViewport({ width: 1440, height: 1100 });
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => { window.confirm = () => true; });
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
      if (route.startsWith("/auth/")) return respond({ user: { id: sample._id, role: "super_admin", name: "Test Admin", brand_scope: "all" } });
      if (route === "/permissions/me") return respond({ role: "super_admin", permissions: { items: { create: true }, pis: { edit: true }, shipments: { edit: true } } });
      if (route === "/orders/brands-and-vendors") return respond({ brands: ["Giga"], vendors: [] });
      if (route === "/wood-species") return respond({ data: [species] });
      if (route.startsWith("/samples")) {
        if (["POST", "PATCH"].includes(request.method())) {
          const payload = JSON.parse(request.postData());
          mutations.push(payload);
          sample = { ...sample, ...payload, timber_volume_input: payload.finished_wood_volume };
          return respond({ data: sample });
        }
        return respond({ data: [sample], pagination: { page: 1, totalPages: 1, totalRecords: 1 } });
      }
      if (url.origin !== origin || url.pathname.startsWith("/api/")) return respond({ data: [], unreadCount: 0 });
      return request.continue();
    });
    const click = text => page.evaluate(text => [...(document.querySelector(".modal") || document).querySelectorAll("button")].find(button => button.textContent.trim() === text).click(), text);
    const fill = (selector, value) => page.$eval(selector, (input, value) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    const fillField = (label, value) => page.evaluate((label, value) => {
      const node = [...document.querySelectorAll(".modal label")].find(node => node.textContent.trim() === label);
      const input = node.querySelector("input,textarea,select") || node.parentElement.querySelector("input,textarea,select");
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
      input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }, label, value);
    const save = async label => {
      const response = page.waitForResponse(response => /\/samples(?:\/[a-f0-9]{24})?$/.test(new URL(response.url()).pathname) && ["POST", "PATCH"].includes(response.request().method()));
      await click(label);
      assert.equal((await response).status(), 200);
      await page.waitForFunction(() => !document.querySelector(".modal"));
      assert.equal(Object.hasOwn(mutations.at(-1), "timber_cft"), false);
      return mutations.at(-1);
    };
    await page.goto(origin + "/signin", { waitUntil: "networkidle0" });
    await page.type('input[name="username"]', "test-admin");
    await page.type('input[name="password"]', "test-password");
    await page.locator('.signin-page-shell button[type="submit"]').click();
    await page.waitForFunction(() => window.location.pathname === "/");

    await page.goto(origin + "/samples", { waitUntil: "networkidle0" });
    await click("Edit");
    await page.waitForSelector('input[id$="volume"]');
    assert.equal(await page.$eval('input[id$="volume"]', node => node.value), "0.5");
    assert.equal(await page.$eval('input[id$="share0"]', node => node.value), "100.00");
    await page.select('select[id$="unit"]', "m3");
    let payload = await save("Save Changes");
    assert.deepEqual(payload.finished_wood_volume, { value: "0.014158423296", unit: "m3" });
    assert.deepEqual(payload.species_composition, [{ species: species._id, share_bp: 10000 }]);

    await click("Edit");
    await page.waitForSelector('input[id$="volume"]');
    assert.equal(await page.$eval('select[id$="unit"]', node => node.value), "m3");
    await click("Remove");
    await page.$eval('fieldset input[type="checkbox"]', node => node.click());
    await page.waitForFunction(() => document.querySelector('input[id$="volume"]').value === "0");
    payload = await save("Save Changes");
    assert.deepEqual(payload.species_composition, []);
    assert.equal(payload.finished_wood_volume.value, "0");

    for (const route of ["/samples", "/items", "/shipments"]) {
      await page.goto(origin + route, { waitUntil: "networkidle0" });
      const shipping = route === "/shipments";
      await click(shipping ? "Add Sample" : "Create Sample");
      if (shipping) await click("Create New");
      await page.waitForSelector('input[id$="volume"]');
      await fillField("Sample Code", "SAMPLE-NEW");
      await fillField(route === "/samples" ? "Name" : "Sample Name", "Table");
      await fillField("Brand", "Giga");
      await page.select('select[id$="unit"]', "m3");
      await fill('input[id$="volume"]', "0.014158423296");
      await fill('input[id$="hs"]', "9403 60");
      await click("Add species");
      await page.waitForFunction(id => [...document.querySelectorAll('select[id$="species0"] option')].some(option => option.value === id), {}, species._id);
      await page.select('select[id$="species0"]', species._id);
      if (shipping) {
        await fillField("Quantity", "3");
        await fillField("Container Number", "MSCU-123456-7");
        await fillField("Shipped By", "shipped_by_vendor");
        assert.match(await page.$eval(".modal", node => node.innerText), /Stuffed timber CFT: 1\.500/);
      }
      const submit = shipping ? "Create and Add Sample" : route === "/samples" ? "Save Sample" : "Create Sample";
      await fill('input[id$="share0"]', "99");
      assert.match(await page.$eval("fieldset", node => node.innerText), /Total: 99\.00%/, `Share did not update on ${route}`);
      const count = mutations.length;
      await click(submit);
      await page.waitForFunction(() => document.querySelector(".modal")?.innerText.includes("exactly 100%"));
      assert.equal(mutations.length, count);
      await fill('input[id$="share0"]', "100");
      payload = await save(submit);
      assert.deepEqual(payload.finished_wood_volume, { value: "0.014158423296", unit: "m3" });
      assert.equal(payload.hs_code, "9403 60");
      assert.deepEqual(payload.species_composition, [{ species: species._id, share_bp: 10000 }]);
      if (shipping) assert.equal(payload.shipment[0].quantity, 3);
    }
    assert.deepEqual(errors, []);
    console.log("Sample wood browser checks passed: edit, reopen, clear, both creation forms, shipping conversion, and percentage validation.");
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
