// Run after building client/OMS: node tests/masterWorkflow.browser.js
// Uses only synthetic in-memory data. All API calls are intercepted, including
// calls from builds configured with a remote API URL; no database is connected.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");
const { buildRow, parseMasterValues, VIEW_STAGES } = require("../services/masterWorkflow.service");
const { buildEvidence, transition, clone, getWorkflow } = require("../helpers/masterWorkflow");
const { parseDateOnly } = require("../helpers/dateOnly");

const root = path.resolve(__dirname, "../../client/OMS/dist");
assert.ok(fs.existsSync(path.join(root, "index.html")), "Build client/OMS first");
const user = { _id: "507f1f77bcf86cd799439011", id: "507f1f77bcf86cd799439011", role: "super_admin", name: "Workflow reviewer" };
const size = { L: 100, B: 50, H: 75, net_weight: 10, remark: "item" };
const box = { L: 110, B: 60, H: 85, gross_weight: 12, remark: "box", box_type: "individual" };
let item = {
  _id: "507f1f77bcf86cd799439012", code: "SANITY-001", description: "Representative table", brand: "Test", vendors: ["Test vendor"],
  pis_item_sizes: [{ ...size, L: 90 }], pis_box_sizes: [box], pis_barcode: "VENDOR-PIS", country_of_origin: "India", pis_checked_flag: true,
  master_item_sizes: [size], master_box_sizes: [box], master_box_mode: "individual", master_master_barcode: "MASTER", master_inner_barcode: "", master_country_of_origin: "India",
  pd_item_sizes: [size], pd_box_sizes: [box], pd_box_mode: "individual", pd_measurement_revision: 0,
};
const pisBefore = JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => key.startsWith("pis_") || key === "country_of_origin")));
let simulatedTime = Date.now() - 600000;
const records = [];
const addVisits = (pos) => pos.forEach((po) => records.push({
  _id: `visit-${po}`, qc: "test-qc", po, inspector: user.id, is_approved: true,
  inspection_date: parseDateOnly(new Date(simulatedTime)), createdAt: new Date(simulatedTime += 1000),
  inspected_item_sizes: [size], inspected_box_sizes: [box], inspected_box_mode: "individual",
}));
addVisits(["PO-1"]);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = path.resolve(root, "." + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || [
    path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
  ].find((candidate) => fs.existsSync(candidate));
  const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const url = new URL(request.url());
      const route = url.pathname.replace(/^\/api/, "");
      const respond = (body, status = 200) => request.respond({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS" }, body: JSON.stringify(body) });
      try {
        if (url.pathname.endsWith("/bootstrap.min.css") || url.pathname.endsWith("/bootstrap.bundle.min.js")) {
          const css = url.pathname.endsWith(".css");
          const asset = path.resolve(__dirname, `../../client/OMS/node_modules/bootstrap/dist/${css ? "css/bootstrap.min.css" : "js/bootstrap.bundle.min.js"}`);
          return request.respond({ status: 200, contentType: css ? "text/css" : "text/javascript", body: fs.readFileSync(asset) });
        }
        if (request.method() === "OPTIONS") return respond({});
        if (route.startsWith("/auth/")) return respond({ user });
        if (route === "/permissions/me") return respond({ role: user.role, permissions: { pis: { view: true, edit: true, export: true }, items: { view: true }, product_database: { view: true } } });
        if (route.startsWith("/notifications")) return respond({ data: [], unreadCount: 0 });
        if (route.includes("/master-workflow/")) {
          const action = route.split("/").at(-1) === "final-master" ? "correct" : route.split("/").at(-1);
          const payload = JSON.parse(request.postData());
          assert.ok(Object.keys(payload.values || {}).every((field) => field.startsWith("master_")));
          item = transition({ item, user, payload, action, evidence: buildEvidence(item, records), values: payload.values ? parseMasterValues(item, payload.values) : null, now: new Date(simulatedTime += 1000) });
          return respond({ success: true, message: action === "finalize" ? "Final Master is permanently locked." : "Master review saved.", data: buildRow(item, records, user) });
        }
        if (route.startsWith("/items/")) {
          const view = route.split("/")[2];
          if (VIEW_STAGES[view]) {
            const rows = VIEW_STAGES[view].includes(getWorkflow(item).stage) ? [buildRow(item, records, user)] : [];
            return respond({ data: rows, pagination: { totalPages: 1, totalRecords: rows.length } });
          }
        }
        if (url.pathname.startsWith("/api/")) return respond({ data: [] });
        if (url.origin !== origin) return request.abort();
        return request.continue();
      } catch (error) { return respond({ message: error.message }, error.status || 500); }
    });
    const clickButton = async (text) => {
      await page.waitForFunction((label) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === label && !b.disabled), {}, text);
      await page.evaluate((label) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label).click(), text);
    };
    const openPage = async (view) => {
      await page.goto(`${origin}/${view}`, { waitUntil: "networkidle0" });
      await clickButton(getWorkflow(item).stage === "finalized" ? "View" : "Review");
    };
    const checked = (selector) => page.$eval(selector, (input) => { if (!input.checked) input.click(); });
    const waitStage = (stage) => new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => getWorkflow(item).stage === stage ? resolve() : Date.now() > deadline ? reject(Error(`Stage did not reach ${stage}`)) : setTimeout(check, 25);
      check();
    });
    await openPage("pis-diffs");
    await checked(".mw-editor input[type=checkbox]");
    await clickButton("Confirm unchanged as Master 1");
    await waitStage("master_1");
    await openPage("final-pis-check");
    assert.match(await page.$eval(".mw-review", (e) => e.textContent), /0 \/ 3 qualifying/);
    addVisits(["PO-1", "PO-2", "PO-3", "PO-4"]);
    await openPage("final-pis-check");
    await checked(".mw-editor input[type=checkbox]");
    await clickButton("Confirm unchanged as Master 2");
    await waitStage("master_2");
    addVisits(["PO-5", "PO-6", "PO-7"]);
    await openPage("final-masters");
    await checked(".mw-editor input[type=checkbox]");
    await clickButton("Confirm unchanged as Final Master");
    await waitStage("final_master");
    assert.deepEqual(item.master_workflow.reviews.map((r) => r.evidence.length), [1, 3, 3]);
    item.pd_item_sizes = [{ ...size, L: 125 }]; item.pd_measurement_revision++;
    await openPage("master-vs-pd");
    assert.equal(await page.$$eval("textarea[aria-label^='Acceptance reason']", (inputs) => inputs.length), 1);
    await page.type("textarea[aria-label^='Acceptance reason']", "Packaging team confirmed this documented PD variance.");
    await checked(".mw-review > section input[type=checkbox]");
    await clickButton("Sign off comparison");
    await page.waitForSelector(".mw-finalize");
    item.pd_measurement_revision++;
    await openPage("master-vs-pd");
    assert.equal(await page.$(".mw-finalize"), null, "A changed PD revision must require another sign-off");
    await page.type("textarea[aria-label^='Acceptance reason']", "Rechecked the current PD values.");
    await checked(".mw-review > section input[type=checkbox]");
    await clickButton("Sign off comparison");
    await page.waitForSelector(".mw-finalize");
    await checked(".mw-finalize input[type=checkbox]");
    await clickButton("Finalize PIS — lock Final Master");
    await waitStage("finalized");
    await openPage("final-masters");
    assert.equal(await page.$(".mw-editor"), null);
    assert.match(await page.$eval(".mw-review", (e) => e.textContent), /Final Master locked by/);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => key.startsWith("pis_") || key === "country_of_origin"))), pisBefore);
    assert.deepEqual(pageErrors, []);
    const screenshot = path.resolve(__dirname, "../../.tmp/master-workflow-browser.png");
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log("Browser workflow passed: legacy review, unchanged 1 + 3 + 3, PO exclusion, PD reason/sign-off invalidation, final lock and unchanged PIS.");
    console.log(`Screenshot: ${screenshot}`);
  } finally { await browser.close(); server.close(); }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
