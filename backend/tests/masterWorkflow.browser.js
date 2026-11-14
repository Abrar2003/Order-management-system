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
const { compareInspectionSizeSnapshot } = require("../helpers/inspectionSizeSnapshot");
const { getMasterComparisonSource } = require("../helpers/qcMismatchMaster");

const root = path.resolve(__dirname, "../../client/OMS/dist");
assert.ok(fs.existsSync(path.join(root, "index.html")), "Build client/OMS first");
const user = { _id: "507f1f77bcf86cd799439011", id: "507f1f77bcf86cd799439011", role: "super_admin", name: "Workflow reviewer" };
const qcId = "507f1f77bcf86cd799439013";
const size = { L: 100, B: 50, H: 75, net_weight: 10, remark: "item" };
const box = { L: 110, B: 60, H: 85, gross_weight: 12, remark: "box", box_type: "individual" };
let item = {
  _id: "507f1f77bcf86cd799439012", code: "SANITY-001", description: "Representative table", brand: "Test", vendors: ["Test vendor"],
  pis_item_sizes: [{ ...size, L: 90 }], pis_box_sizes: [box], pis_barcode: "VENDOR-PIS", country_of_origin: "India", pis_checked_flag: true,
  master_item_sizes: [], master_box_sizes: [], master_box_mode: "individual", master_master_barcode: "MASTER", master_inner_barcode: "", master_country_of_origin: "India",
  pd_item_sizes: [size], pd_box_sizes: [box], pd_box_mode: "individual", pd_measurement_revision: 0,
};
const pisBefore = JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => key.startsWith("pis_") || key === "country_of_origin")));
let simulatedTime = Date.now() - 600000;
const records = [];
const addVisits = (pos) => pos.forEach((po) => records.push({
  _id: `visit-${po}`, qc: qcId, po, inspector: user.id, is_approved: true,
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
    let pdfPayload;
    let reviewDone = false;
    let qcImages = [{ _id: "test-image", url: `${origin}/logo.png`, originalName: "Test QC image" }];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const url = new URL(request.url());
      const route = url.pathname.replace(/^\/api/, "");
      const respond = (body, status = 200) => request.respond({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS" }, body: JSON.stringify(body) });
      try {
        if (request.isNavigationRequest() && url.origin === origin) return request.continue();
        if (url.pathname.endsWith("/bootstrap.min.css") || url.pathname.endsWith("/bootstrap.bundle.min.js")) {
          const css = url.pathname.endsWith(".css");
          const asset = path.resolve(__dirname, `../../client/OMS/node_modules/bootstrap/dist/${css ? "css/bootstrap.min.css" : "js/bootstrap.bundle.min.js"}`);
          return request.respond({ status: 200, contentType: css ? "text/css" : "text/javascript", body: fs.readFileSync(asset) });
        }
        if (request.method() === "OPTIONS") return respond({});
        if (route.startsWith("/auth/")) return respond({ user });
        if (route === "/permissions/me") return respond({ role: user.role, permissions: { pis: { view: true, edit: true, export: true }, items: { view: true }, product_database: { view: true }, reports: { view: true }, qc: { view: true } } });
        if (route.startsWith("/notifications")) return respond({ data: [], unreadCount: 0 });
        if (route === `/qc/${qcId}`) return respond({ data: {
          _id: qcId, item: { item_code: item.code, description: item.description },
          order: { order_id: "PO-1" }, quantities: {}, qc_images: qcImages,
        } });
        if (route === "/items/pdf/render") {
          pdfPayload = JSON.parse(request.postData());
          return respond({});
        }
        if (route === `/reports/qc-report-mismatch/${item.code}/review-done` && request.method() === "POST") {
          reviewDone = true;
          return respond({ success: true });
        }
        if (route === "/reports/qc-report-mismatch" || route === "/reports/qc-report-mismatch-level-2") {
          if (reviewDone && !route.endsWith("-2")) return respond({ rows: [], pagination: { total: 0, totalPages: 1 } });
          const master = route.endsWith("-2") ? getWorkflow(item).reviews.find((review) => review.stage === "master_1").master : item;
          const comparison = compareInspectionSizeSnapshot({
            inspected_item_sizes: [{ L: 120, B: 50, H: 75, remark: "item" }],
          }, getMasterComparisonSource(master));
          return respond({
            rows: [{
              id: "test-item", item_code: item.code, inspection_count: 3, po_count: 3,
              master_snapshot: comparison.current_snapshot,
              mismatch_summary: { has_mismatch: true, mismatch_inspection_count: 3 },
              inspection_records: [1, 2, 3].map((index) => ({
                inspection_id: String(index), sheet_label: `Inspection ${index}`,
                inspection_snapshot: comparison.inspection_snapshot, item_size_mismatches: comparison.item_size_mismatches,
              })),
            }],
            pagination: { total: 1, totalPages: 1 },
          });
        }
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
            if (route.endsWith("/export-preview")) return respond({ data: { rows } });
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
    assert.doesNotMatch(await page.$eval("main", (e) => e.textContent), /Cycle started/);
    const detailsLink = await page.$eval(".mw-source a", (link) => link.getAttribute("href"));
    assert.equal(detailsLink, `/qc/${qcId}`);
    const gallery = '[aria-label="QC image gallery"]';
    await clickButton("View QC Images");
    await page.waitForSelector(`${gallery} [title="Test QC image"]`);
    assert.equal(new URL(page.url()).pathname, "/pis-diffs");
    await page.click(`${gallery} .qc-image-gallery-accordion-summary`);
    await page.click(`${gallery} [title="Test QC image"]`);
    await page.waitForSelector('[aria-label="QC image carousel"]');
    await page.keyboard.press("Escape");
    await page.waitForSelector('[aria-label="QC image carousel"]', { hidden: true });
    await page.keyboard.press("Escape");
    await page.waitForSelector(gallery, { hidden: true });
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "View QC Images");
    qcImages = [];
    await clickButton("View QC Images");
    await page.waitForSelector(".qc-image-gallery-empty-state");
    assert.match(await page.$eval(".qc-image-gallery-empty-state", (e) => e.textContent), /No QC images found/);
    await page.click(`${gallery} .qc-image-gallery-actions .btn-outline-secondary:last-child`);
    await page.waitForSelector(gallery, { hidden: true });
    await clickButton("Use measurements from PO-1");
    await checked(".mw-editor input[type=checkbox]");
    await clickButton("Save Master");
    await waitStage("master");
    await openPage("final-pis-check");
    const cycleStarted = await page.$eval(".mw-item-heading p", (e) => e.textContent);
    assert.match(cycleStarted, /Cycle started/);
    await clickButton("Export PDF");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Export PDF" && !b.disabled));
    assert.ok(pdfPayload.html.includes(cycleStarted));
    assert.doesNotMatch(pdfPayload.html, /Cycle 3 October 2026/);
    assert.match(await page.$eval(".mw-review", (e) => e.textContent), /0 \/ 3 qualifying/);
    addVisits(["PO-1", "PO-2", "PO-3", "PO-4"]);
    await openPage("final-pis-check");
    await checked(".mw-editor input[type=checkbox]");
    await clickButton("Confirm unchanged as Master 1");
    await waitStage("master_1");
    addVisits(["PO-5", "PO-6", "PO-7"]);
    await openPage("final-pis-check");
    await checked(".mw-editor input[type=checkbox]");
    await clickButton("Confirm unchanged as Master 2");
    await waitStage("master_2");
    addVisits(["PO-8", "PO-9", "PO-10"]);
    await openPage("final-masters");
    await checked(".mw-editor input[type=checkbox]");
    await clickButton("Confirm unchanged as Final Master");
    await waitStage("final_master");
    assert.deepEqual(item.master_workflow.reviews.map((r) => r.evidence.length), [1, 3, 3, 3]);
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
    item.master_item_sizes = [{ ...size, L: 110 }];
    for (const [route, label, value] of [["qc-report-mismatch", "Master", "110"], ["qc-report-mismatch-level-2", "Master 1", "100"]]) {
      await page.goto(`${origin}/reports/${route}`, { waitUntil: "networkidle0" });
      assert.match(await page.$eval("body", (e) => e.innerText), /View Details/, route);
      await clickButton("View Details");
      await page.waitForSelector(".modal tbody");
      const headers = await page.$$eval(".modal table:first-of-type thead th", (cells) => cells.map((cell) => cell.textContent.trim()));
      assert.equal(headers[1], label);
      const fields = await page.$$eval(".modal tbody tr", (rows) => rows.map((row) => [...row.cells].map((cell) => cell.textContent.trim())));
      const length = fields.find(([field]) => field === "Item Size 1 - L");
      assert.deepEqual(length.slice(1), [value, "120Mismatch", "120Mismatch", "120Mismatch"]);
      const weight = fields.find(([field]) => field === "Item Size 1 - Net Weight");
      assert.match(weight[2], /No comparable data/);
      if (route === "qc-report-mismatch") {
        await clickButton("Review Done");
        await page.waitForSelector(".modal", { hidden: true });
        await page.waitForSelector(".qc-details-comment-button", { hidden: true });
        assert.equal(reviewDone, true);
      } else {
        assert.doesNotMatch(await page.$eval(".modal-footer", (e) => e.textContent), /Review Done/);
      }
    }
    assert.deepEqual(pageErrors, []);
    console.log("Browser workflow, QC image gallery, PDF export payload, and both QC mismatch detail modals passed.");
    console.log(`Screenshot: ${screenshot}`);
  } finally { await browser.close(); server.close(); }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
