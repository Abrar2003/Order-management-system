// Run after building client/OMS: node tests/eudrChain.browser.js
// All API requests use isolated in-memory fixtures; this never connects to the OMS database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");

const root = path.resolve(__dirname, "../../client/OMS/dist");
const output = path.resolve(__dirname, "../../.tmp");
const user = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "super_admin", name: "Document reviewer" };
const time = "2026-10-12T10:30:00.000Z";
const attachment = (id, type, name, image = false) => ({ _id: id, type, name, content_type: image ? "image/png" : "application/pdf", uploaded_at: time });
const fullChain = () => ({
  _id: "bbbbbbbbbbbbbbbbbbbbbbbb", container: "TEST-CONTAINER", vendor: { _id: "cccccccccccccccccccccccc", name: "Test shipping vendor", gst: "GST-VENDOR", pan: "PAN-VENDOR" }, declared_milli_cft: 17600, stuffed_cft: 17.6, complete: true, current_stage_id: "",
  stages: [
    { _id: "mill", kind: "sawmill", fields: { name: "Test sawmill", gst: "GST-MILL", pan: "PAN-MILL", permission_number: "P001", cutting_limit_cft: "1000", invoice_number: "CUT001", invoice_date: "2026-10-01" }, documents: [attachment("cut", "cutting_invoice", "cutting-invoice.pdf"), attachment("license", "license", "sawmill-license.pdf"), attachment("permit", "permission", "permission.png", true)], verified_at: time, verified_by_name: user.name, verification_method: "manual" },
    { _id: "truck", kind: "transport", fields: { transporter_name: "Test transporter", truck_number: "TRUCK001", driver_license_number: "D001", ewaybill_number: "E001", billty_number: "B001" }, documents: [attachment("weight", "weight_slip", "weight-slip.pdf"), attachment("bilty", "billty", "bilty.png", true), attachment("missing", "driver_license", "unavailable-license.png", true), attachment("eway", "ewaybill", "e-way-bill.pdf")], verified_at: time, verified_by_name: user.name },
    { _id: "receiver", kind: "receiver", fields: { name: "Test shipping vendor", gst: "GST-VENDOR", pan: "PAN-VENDOR", received_cft: "17.6", invoice_number: "REC001", invoice_date: "2026-10-02", issuer_name: "Test issuer", issuer_gst: "GST-ISSUER", issuer_pan: "PAN-ISSUER" }, documents: [attachment("received", "invoice", "receiver-invoice.pdf")], verified_at: time, verified_by_name: user.name },
    { _id: "declaration", kind: "declaration", fields: {}, documents: [attachment("declared", "declaration", "declaration.pdf")], verified_at: time, verified_by_name: user.name },
  ],
  shipment_rows: [{ source: "order", shipment_id: "s1", order_id: "PO001", invoice_number: "SHIP001", code: "ITEM001", quantity: 10, timber_cft: 1.76, line_milli_cft: 17600 }, { source: "sample", shipment_id: "s2", order_id: "Sample", code: "SAMPLE001", quantity: 1, timber_cft: null, line_milli_cft: null }],
  excluded: [{ source: "sample", shipment_id: "s2", code: "SAMPLE001", quantity: 1 }], unassigned: [],
  history: Array.from({ length: 8 }, (_, index) => ({ _id: `event${index}`, event: "stage_verified", stage_id: "mill", actor_name: user.name, at: time, detail: { method: "manual", replaced: attachment("superseded", "cutting_invoice", "old.pdf") } })),
});
let chain = fullChain();
let siblingChains = [];
const allChains = () => [chain, ...siblingChains];
const coverage = () => {
  const allocated = allChains().reduce((sum, entry) => sum + (entry.contribution_milli_cft ?? entry.declared_milli_cft), 0);
  const verified = allChains().filter((entry) => entry.complete).reduce((sum, entry) => sum + (entry.contribution_milli_cft ?? entry.declared_milli_cft), 0);
  return { chain_count: allChains().length, allocated_cft: allocated / 1000, verified_cft: verified / 1000, remaining_cft: 17.6 - allocated / 1000, complete: allocated === 17600 && verified === allocated };
};
let pdf;
let png;
let jpeg;
let webp;
let downloads = 0;
const writes = [];
const savedBuyers = new Map();
const contentRequests = [];
// Reproduce production: unknown .mjs assets are served as octet-stream, not executable modules.
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/download/")) { res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=test.pdf" }); return res.end(pdf); }
  let file = path.resolve(root, "." + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || [path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"), path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe")].find((candidate) => fs.existsSync(candidate));
  const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const fixture = await browser.newPage();
    await fixture.setContent('<h1>Actual PDF test invoice</h1><p>GST-MILL · CUT001 · 17.600 CFT</p><div style="break-after:page"></div><h1>Actual PDF second page</h1><p>Transport evidence</p>');
    pdf = Buffer.from(await fixture.pdf({ format: "A4" }));
    png = Buffer.from(await fixture.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 800; const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 800); ctx.fillStyle = "#2e2925"; ctx.font = "28px sans-serif"; ctx.fillText("Actual uploaded test image", 40, 90); ctx.fillText("B001 / GST-MILL", 40, 150); return canvas.toDataURL("image/png").split(",")[1]; }), "base64");
    for (const type of ["jpeg", "webp"]) {
      const bytes = Buffer.from(await fixture.evaluate((type) => { const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 800; const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 800); ctx.fillStyle = "black"; ctx.font = "30px sans-serif"; ctx.fillText(`Actual ${type} timber evidence`, 30, 100); return canvas.toDataURL(`image/${type}`).split(",")[1]; }, type), "base64");
      if (type === "jpeg") jpeg = bytes; else webp = bytes;
    }
    await fixture.close();
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      const url = new URL(request.url());
      if (["blob:", "data:"].includes(url.protocol)) return request.continue();
      if (request.isNavigationRequest() && url.origin === origin && url.pathname === "/eudr") return request.continue();
      const route = url.pathname.replace(/^\/api/, "");
      const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type,range", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS", "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges", "Cache-Control": "private, no-store" };
      const respond = (body, status = 200) => request.respond({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
      try {
        if (url.pathname.endsWith("/bootstrap.min.css") || url.pathname.endsWith("/bootstrap.bundle.min.js")) { const css = url.pathname.endsWith(".css"); return request.respond({ status: 200, contentType: css ? "text/css" : "text/javascript", body: fs.readFileSync(path.resolve(__dirname, `../../client/OMS/node_modules/bootstrap/dist/${css ? "css/bootstrap.min.css" : "js/bootstrap.bundle.min.js"}`)) }); }
        if (request.method() === "OPTIONS") return respond({});
        if (route.startsWith("/auth/")) return respond({ user });
        if (route === "/permissions/me") return respond({ role: user.role, permissions: {} });
        if (route.startsWith("/notifications")) return respond({ data: [], unreadCount: 0 });
        if (route === "/eudr/directory") {
          const kind = url.searchParams.get("kind");
          if (kind === "buyer") return respond({ data: [...savedBuyers.values()] });
          if (kind === "vendor") return respond({ data: [{ _id: chain.vendor._id, name: chain.vendor.name, fields: { sold_to: chain.vendor.name, buyer_gst: chain.vendor.gst, buyer_pan: chain.vendor.pan } }, { _id: "missing-tax", name: "Vendor missing PAN", fields: { sold_to: "Vendor missing PAN", buyer_gst: "GST-ONLY", buyer_pan: "" } }] });
          return respond({ data: kind === "sawmill" ? [{ _id: "saved-mill", name: "Saved mill", identity_key: "GST-MILL|PAN-MILL", fields: { name: "Saved mill", gst: "GST-MILL", pan: "PAN-MILL", permission_number: "P-SAVED", cutting_limit_cft: "2000" }, evidence: [{ _id: "saved-license", type: "license", name: "saved-license.pdf" }] }] : kind === "transporter" ? [{ _id: "saved-transporter", name: "Saved transporter", identity_key: "saved-transporter", fields: { transporter_name: "Saved transporter", gst: "GST-TRANSPORT" }, evidence: [] }] : [{ _id: "saved-vehicle", name: "RJ-SAVED / DL-SAVED", fields: { truck_number: "RJ-SAVED", truck_registration_number: "REG-SAVED", driver_license_number: "DL-SAVED" }, evidence: [] }] });
        }
        if (route === "/eudr/container") return respond({ container: chain.container, vendors: [{ vendor: chain.vendor, rows: chain.shipment_rows, excluded: chain.excluded, stuffed_cft: 17.6, coverage: coverage() }], unassigned: [], chains: allChains().map((entry) => ({ _id: entry._id, vendor_id: entry.vendor._id, declared_cft: 17.6, contribution_cft: (entry.contribution_milli_cft ?? entry.declared_milli_cft) / 1000, complete: entry.complete })) });
        if (route === "/eudr") {
          if (request.method() === "POST") {
            const payload = JSON.parse(request.postData()); assert.equal(Number(payload.declared_cft), 17.6); assert.equal(Number(payload.contribution_cft), 7.6);
            siblingChains.push(chain);
            chain = { ...fullChain(), _id: "dddddddddddddddddddddddd", contribution_milli_cft: 7600, complete: false, current_stage_id: "mill", stages: [{ _id: "mill", kind: "sawmill", workflow_version: 2, fields: {}, documents: [] }] };
            return respond({ data: { ...chain, coverage: coverage() } }, 201);
          }
          return respond({ data: allChains().map((entry) => ({ _id: entry._id, container: entry.container, vendor: entry.vendor, declared_cft: 17.6, contribution_cft: (entry.contribution_milli_cft ?? entry.declared_milli_cft) / 1000, complete: entry.complete })) });
        }
        if (route.endsWith("/content") || route.endsWith("/preview")) {
          const id = route.split("/").at(-2); contentRequests.push(id);
          if (id === "missing") return respond({ message: "Document not found" }, 404);
          const document = chain.stages.flatMap((stage) => stage.documents).find((document) => document._id === id);
          const bytes = route.endsWith("/preview") || document.content_type === "application/pdf" ? pdf : document.content_type === "image/jpeg" ? jpeg : document.content_type === "image/webp" ? webp : png;
          return request.respond({ status: 200, contentType: route.endsWith("/preview") ? "application/pdf" : document.content_type, headers: { ...headers, "Content-Length": String(bytes.length), "Accept-Ranges": "bytes" }, body: bytes });
        }
        if (route.endsWith("/url")) { assert.equal(url.searchParams.get("download"), "1"); downloads += 1; return respond({ url: `${origin}/download/test.pdf` }); }
        if (route.startsWith(`/eudr/${chain._id}`)) {
          const stageId = route.split("/")[4];
          const stage = chain.stages.find((stage) => stage._id === stageId);
          if (request.method() !== "GET") writes.push({ method: request.method(), route });
          if (request.method() === "PUT") {
            stage.fields = JSON.parse(request.postData()).fields;
            if (stage.fields.buyer_type === "other" && stage.fields.sold_to && stage.fields.buyer_gst && stage.fields.buyer_pan) savedBuyers.set("saved-buyer", { _id: "saved-buyer", name: stage.fields.sold_to, fields: { sold_to: stage.fields.sold_to, buyer_gst: stage.fields.buyer_gst, buyer_pan: stage.fields.buyer_pan } });
          }
          if (route.endsWith("/documents") && request.method() === "POST") stage.documents.push(attachment("new-weight", "weight_slip", "eudr-fixture.pdf"));
          if (route.endsWith("/reuse-evidence")) { assert.equal(JSON.parse(request.postData()).confirmed, true); stage.documents = stage.documents.filter((document) => document.type !== "license"); stage.documents.push(attachment("saved-license", "license", "saved-license.pdf")); }
          if (route.endsWith("/verify")) { stage.verified_at = time; stage.verified_by_name = user.name; chain.stages.push({ _id: "new-truck", kind: "transport", fields: {}, documents: [] }); chain.current_stage_id = "new-truck"; }
          if (request.method() === "PATCH") {
            if (route.endsWith("/contribution")) { chain.contribution_milli_cft = Math.round(JSON.parse(request.postData()).contribution_cft * 1000); chain.complete = false; }
            else chain.declared_milli_cft = Math.round(JSON.parse(request.postData()).declared_cft * 1000);
          }
          return respond({ data: { ...chain, coverage: coverage() } });
        }
        if (url.pathname.startsWith("/api/")) return respond({ data: [] });
        if (url.origin !== origin) return request.abort();
        return request.continue();
      } catch (error) { errors.push(error.message); return respond({ message: error.message }, 500); }
    });
    const click = async (text, scope = "") => {
      await page.waitForFunction((label, scope) => [...document.querySelectorAll(`${scope} button`)].some((button) => button.textContent.trim() === label && !button.disabled), {}, text, scope);
      await page.evaluate((label, scope) => [...document.querySelectorAll(`${scope} button`)].find((button) => button.textContent.trim() === label && !button.disabled).click(), text, scope);
    };
    const open = async () => { await page.goto(`${origin}/eudr`, { waitUntil: "networkidle0" }); await click("Open"); await page.waitForSelector(".eudr-report"); };
    await open();
    assert.equal(await page.$$eval(".eudr-report input", (elements) => elements.length), 0);
    assert.match(await page.$eval(".eudr-summary-grid", (element) => element.textContent), /1\/2.*lines included/);
    assert.equal(await page.$$eval(".eudr-activity-list > li", (elements) => elements.length), 6);
    await click("View Full Audit History (8)");
    assert.equal(await page.$$eval(".eudr-activity-list > li", (elements) => elements.length), 8);
    await page.waitForFunction(() => [...document.querySelectorAll("#eudr-stage-mill .eudr-thumbnail img")].filter((image) => image.complete && image.naturalWidth > 0).length === 3);
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "eudr-chain-report.png"), fullPage: true });
    await click("View All Documents (9)");
    await page.waitForSelector(".eudr-gallery-dialog[open]");
    assert.equal(await page.$$eval(".eudr-gallery-dialog .eudr-document-card", (cards) => cards.length), 9);
    assert.match(await page.$eval(".eudr-gallery-dialog", (element) => element.textContent), /Verified stages: 4\/4/);
    await page.screenshot({ path: path.join(output, "eudr-documents-desktop.png") });
    await click("Transport (4)", ".eudr-gallery-dialog");
    assert.equal(await page.$$eval(".eudr-gallery-dialog .eudr-document-card", (cards) => cards.length), 4);
    await page.type(".eudr-document-search input", "billty");
    assert.equal(await page.$$eval(".eudr-gallery-dialog .eudr-document-card", (cards) => cards.length), 1);
    await page.$eval(".eudr-document-search input", (input) => { input.focus(); });
    await page.keyboard.down("Control"); await page.keyboard.press("A"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace");
    await page.$eval(".eudr-gallery-body", (element) => { element.scrollTop = 80; });
    const galleryScroll = await page.$eval(".eudr-gallery-body", (element) => element.scrollTop);
    await page.$eval(".eudr-gallery-dialog .eudr-document-actions button", (button) => button.focus({ preventScroll: true }));
    await click("Preview", ".eudr-gallery-dialog");
    await page.waitForSelector(".eudr-viewer-dialog[open]");
    await page.waitForFunction(() => { const canvas = document.querySelector(".eudr-viewer-dialog canvas"); if (!canvas?.width) return false; const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data; return bytes.some((value, index) => index % 4 !== 3 && value < 200 && bytes[index - index % 4 + 3] > 0); });
    assert.match(await page.$eval(".eudr-page-controls", (element) => element.textContent), /of 2/);
    assert.match(await page.$eval(".eudr-viewer-metadata", (element) => element.textContent), /Test transporter/);
    await click("Next page");
    await page.waitForFunction(() => document.querySelector('[aria-label="PDF page number"]').value === "2");
    await page.click('[aria-label="Zoom in"]');
    assert.equal(await page.$eval('[aria-label="Zoom level"]', (element) => element.textContent), "125%");
    await click("Fit width");
    assert.equal(await page.$eval('[aria-label="Zoom level"]', (element) => element.textContent), "100%");
    await page.waitForFunction(() => { const scroll = document.querySelector(".eudr-viewer-dialog .eudr-document-scroll"); const second = scroll.querySelector('[data-page-number="2"]'); return Math.abs(second.getBoundingClientRect().top - scroll.getBoundingClientRect().top) < 30; });
    await page.screenshot({ path: path.join(output, "eudr-document-viewer.png") });
    await click("Next document");
    await page.waitForFunction(() => document.querySelector(".eudr-image-document img")?.naturalWidth > 0);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".eudr-viewer-message")?.textContent.includes("could not be previewed"));
    await page.keyboard.press("Escape");
    assert.equal(await page.$(".eudr-viewer-dialog"), null);
    assert.equal(await page.$$eval(".eudr-gallery-dialog .eudr-document-card", (cards) => cards.length), 4);
    assert.equal(await page.$eval(".eudr-gallery-body", (element) => element.scrollTop), galleryScroll);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Preview");
    await click("All Documents (9)", ".eudr-gallery-dialog");
    await page.type(".eudr-document-search input", "sawmill sale invoice");
    assert.equal(await page.$$eval(".eudr-gallery-dialog .eudr-document-card", (cards) => cards.length), 1);
    const session = await page.createCDPSession(); await session.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await click("Download", ".eudr-gallery-dialog");
    await page.waitForFunction(() => ![...document.querySelectorAll(".eudr-gallery-dialog button")].some((button) => button.textContent === "Preparing…"));
    assert.equal(downloads, 1);
    await page.setViewport({ width: 768, height: 1024 });
    assert.equal(await page.$eval(".eudr-gallery-dialog .eudr-document-grid", (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 2);
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.$eval(".eudr-gallery-dialog .eudr-document-grid", (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 1);
    assert.equal(await page.$eval(".eudr-gallery-dialog", (element) => element.scrollWidth <= element.clientWidth), true);
    await page.screenshot({ path: path.join(output, "eudr-documents-mobile.png") });
    await click("Close gallery");
    assert.equal(writes.length, 0, "Viewing, filtering and downloading must not mutate the chain");

    await page.setViewport({ width: 1440, height: 1000 });
    chain = fullChain(); chain.complete = false; chain.stages = [chain.stages[0]]; chain.stages[0].verified_at = null; chain.current_stage_id = "mill";
    await open();
    await click("Update declaration amount");
    await page.click("#eudr-declared", { clickCount: 3 }); await page.type("#eudr-declared", "17");
    assert.equal(await page.$eval(".eudr-small-dialog form button", (button) => button.disabled), true);
    await page.click("#eudr-declared", { clickCount: 3 }); await page.type("#eudr-declared", "17.6");
    await click("Update declaration amount", ".eudr-small-dialog");
    await page.waitForFunction(() => !document.querySelector(".eudr-small-dialog"));
    assert.equal(chain.declared_milli_cft, 17600);
    await click("Edit Details");
    await page.waitForSelector(".eudr-drawer[open]");
    await page.waitForSelector('#saved-sawmill option[value="saved-mill"]');
    await page.select("#saved-sawmill", "saved-mill");
    assert.equal(await page.$eval("#mill-name", (input) => input.value), "Saved mill");
    assert.equal(await page.$eval("#mill-permission_number", (input) => input.value), "P-SAVED");
    assert.equal(await page.$eval("#mill-invoice_number", (input) => input.value), "CUT001");
    await page.waitForSelector(`#mill-sold-to-select option[value="${chain.vendor._id}"]`);
    await page.select("#mill-sold-to-select", chain.vendor._id);
    assert.equal(await page.$eval("#mill-sold_to", (input) => input.value), chain.vendor.name);
    assert.equal(await page.$eval("#mill-buyer_gst", (input) => input.value), chain.vendor.gst);
    assert.equal(await page.$eval("#mill-buyer_pan", (input) => input.value), chain.vendor.pan);
    assert.equal(await page.$eval("#mill-buyer_gst", (input) => input.readOnly), true);
    assert.equal(await page.$eval('#mill-sold-to-select option[value="missing-tax"]', (option) => option.disabled), true);
    assert.equal(await page.$eval("#mill-sold_cft", (input) => input.value), "");
    await page.$eval('input[name="mill-buyer-type"]:not(:checked)', (input) => input.click());
    assert.equal(await page.$eval("#mill-buyer_gst", (input) => input.value), "");
    assert.equal(await page.$eval("#mill-buyer_gst", (input) => input.readOnly), false);
    await page.type("#mill-sold_to", "Saved timber trader"); await page.type("#mill-buyer_gst", "GST-TRADER"); await page.type("#mill-buyer_pan", "PAN-TRADER"); await page.type("#mill-sold_cft", "17.6");
    await click("Confirm validity and reuse", ".eudr-drawer");
    await page.waitForFunction(() => document.querySelector(".eudr-drawer")?.textContent.includes("Currently uploaded: saved-license.pdf"));
    await page.click("#mill-name", { clickCount: 3 }); await page.type("#mill-name", "Updated test sawmill");
    await click("Save step", ".eudr-drawer");
    await page.waitForFunction(() => !document.querySelector("#mill-name").disabled);
    assert.equal(chain.stages[0].fields.name, "Updated test sawmill");
    await click("Close", ".eudr-drawer"); await click("Edit Details");
    await page.waitForSelector('#mill-sold-to-select option[value="saved-buyer"]');
    await page.click("#mill-sold_cft", { clickCount: 3 }); await page.keyboard.press("Backspace");
    await page.select("#mill-sold-to-select", "saved-buyer");
    assert.equal(await page.$eval("#mill-sold_to", (input) => input.value), "Saved timber trader");
    assert.equal(await page.$eval("#mill-sold_cft", (input) => input.value), "");
    assert.equal(await page.$eval("#mill-invoice_number", (input) => input.value), "CUT001");
    await page.type("#mill-sold_cft", "17.6");
    await page.$eval("#mill-sold_to", (input) => input.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(output, "eudr-sale-buyer-selection.png") });
    await click("Verify and continue", ".eudr-drawer");
    await page.waitForSelector("#eudr-stage-new-truck");
    assert.equal(await page.$(".eudr-drawer"), null);
    await page.$eval("#eudr-stage-new-truck button", (button) => button.click());
    await page.waitForSelector("#new-truck-weight_slip");
    await page.waitForSelector('#saved-transporter option[value="saved-transporter"]');
    await page.select("#saved-transporter", "saved-transporter");
    await page.waitForSelector('#saved-truck option[value="saved-vehicle"]');
    await page.select("#saved-truck", "saved-vehicle");
    assert.equal(await page.$eval("#new-truck-truck_number", (input) => input.value), "RJ-SAVED");
    assert.equal(await page.$eval("#new-truck-driver_license_number", (input) => input.value), "");
    await page.waitForSelector('#saved-driver option[value="saved-vehicle"]');
    await page.select("#saved-driver", "saved-vehicle");
    assert.equal(await page.$eval("#new-truck-driver_license_number", (input) => input.value), "DL-SAVED");
    assert.equal(await page.$eval("#new-truck-ewaybill_number", (input) => input.value), "");
    assert.ok(await page.$("#new-truck-truck_registration"));
    const uploadPath = path.join(output, "eudr-fixture.pdf"); fs.writeFileSync(uploadPath, pdf);
    const fileInput = await page.$("#new-truck-weight_slip"); await fileInput.uploadFile(uploadPath);
    await page.waitForFunction(() => document.querySelector(".eudr-drawer")?.textContent.includes("Uploaded eudr-fixture.pdf"));
    assert.equal(await page.$eval("#new-truck-weight_slip", (input) => input.files[0].name), "eudr-fixture.pdf");
    await click("Close", ".eudr-drawer");
    assert.ok(writes.some((write) => write.method === "PUT"));
    assert.ok(writes.some((write) => write.method === "PATCH"));
    assert.ok(writes.some((write) => write.route.endsWith("/verify")));
    assert.ok(writes.some((write) => write.route.endsWith("/documents")));

    chain = fullChain(); chain.complete = false; chain.current_stage_id = "receiver"; chain.stages = chain.stages.slice(0, 3);
    chain.stages[0].fields = { ...chain.stages[0].fields, sold_to: "Intermediate trader", buyer_gst: "GST-TRADER", buyer_pan: "PAN-TRADER", sold_cft: "17.6" };
    Object.assign(chain.stages[2], { incoming_invoice_stage_id: "mill", workflow_version: 2, verified_at: null, fields: { name: "Intermediate trader", gst: "GST-TRADER", pan: "PAN-TRADER" }, documents: [] });
    await open(); await page.$eval("#eudr-stage-receiver button", (button) => button.click());
    await page.waitForSelector("#receiver-sold-to-select");
    await page.$eval('input[name="receiver-buyer-type"]:not(:checked)', (input) => input.click());
    await page.waitForSelector('#receiver-sold-to-select option[value="saved-buyer"]');
    await page.select("#receiver-sold-to-select", "saved-buyer");
    assert.equal(await page.$eval("#receiver-sold_to", (input) => input.value), "Saved timber trader");
    assert.equal(await page.$eval("#receiver-buyer_gst", (input) => input.value), "GST-TRADER");
    assert.equal(await page.$eval("#receiver-invoice_number", (input) => input.value), "");
    assert.equal(await page.$eval("#receiver-sold_cft", (input) => input.value), "");
    assert.equal(await page.$eval("#receiver-received_cft", (input) => input.value), "");
    assert.equal(await page.$eval("#receiver-gst", (input) => input.readOnly), true);
    await page.$eval('input[name="receiver-buyer-type"]:not(:checked)', (input) => input.click());
    await page.waitForSelector(`#receiver-sold-to-select option[value="${chain.vendor._id}"]`);
    await page.select("#receiver-sold-to-select", chain.vendor._id);
    assert.equal(await page.$eval("#receiver-buyer_pan", (input) => input.value), chain.vendor.pan);
    await click("Close", ".eudr-drawer");

    chain = fullChain(); chain.complete = false; chain.current_stage_id = "mill"; chain.stages = [{ _id: "mill", kind: "sawmill", fields: {}, documents: [] }];
    await open(); await click("View All Documents (0)");
    assert.match(await page.$eval(".eudr-gallery-dialog", (element) => element.textContent), /No documents uploaded yet/);
    await click("Close gallery");
    chain.stages[0].documents = [attachment("single", "cutting_invoice", "single.pdf")];
    await open(); await click("View All Documents (1)");
    assert.equal(await page.$$eval(".eudr-gallery-dialog .eudr-document-card", (cards) => cards.length), 1);
    await click("Preview", ".eudr-gallery-dialog");
    assert.equal(await page.$eval(".eudr-viewer-toolbar button", (button) => button.disabled), true);
    await click("Close viewer"); await click("Close gallery"); await click("Back to Containers");
    await page.waitForSelector("#eudr-container");
    assert.equal(await page.$eval("#eudr-container", (input) => input.value), "TEST-CONTAINER");
    chain = fullChain(); chain.complete = false; chain.current_stage_id = "mill"; chain.stages = chain.stages.slice(0, 2);
    chain.stages[0].workflow_version = 2; chain.stages[0].verified_at = null;
    Object.assign(chain.stages[0].fields, { sold_to: chain.vendor.name, buyer_gst: chain.vendor.gst, buyer_pan: chain.vendor.pan, sold_cft: "17.6" });
    const formats = ["docx", "doc", "xls", "xlsx", "csv", "txt", "png", "jpeg", "pdf", "webp"];
    const documentTypes = ["cutting_invoice", "license", "permission", "buyer_gst", "buyer_pan", "weight_slip", "billty", "driver_license", "ewaybill", "truck_registration"];
    const allFiles = formats.map((ext, index) => ({ _id: `format-${ext}`, type: documentTypes[index], name: `verification.${ext}`, content_type: ["png", "jpeg", "webp"].includes(ext) ? `image/${ext}` : ext === "pdf" ? "application/pdf" : "application/octet-stream" }));
    chain.stages[0].documents = allFiles.slice(0, 5); chain.stages[1].documents = allFiles.slice(5);
    await open(); await click("View All Documents (10)");
    for (const card of await page.$$(".eudr-gallery-dialog .eudr-document-card")) {
      await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.waitForFunction((element) => element.querySelector("img")?.naturalWidth > 0, {}, card);
    }
    await page.$eval(".eudr-gallery-body", (element) => { element.scrollTop = 0; });
    await page.waitForFunction(() => [...document.querySelectorAll(".eudr-gallery-dialog .eudr-thumbnail img")].filter((img) => img.complete && img.naturalWidth).length === 10);
    await click("Preview", ".eudr-gallery-dialog");
    await page.waitForSelector('.eudr-viewer-dialog canvas[aria-label="PDF page 1"]');
    assert.match(await page.$eval(".eudr-viewer-preview", (element) => element.textContent), /Converted preview/);
    for (let index = 1; index < 10; index += 1) {
      await click("Next document");
      if (["png", "jpeg", "webp"].includes(formats[index])) await page.waitForFunction(() => document.querySelector(".eudr-image-document img")?.naturalWidth > 0);
      else await page.waitForFunction(() => document.querySelector('.eudr-viewer-dialog canvas[aria-label="PDF page 1"]')?.width > 0);
    }
    await page.screenshot({ path: path.join(output, "eudr-formats-viewer.png") });
    await click("Close viewer"); await click("Close gallery");
    chain = fullChain(); chain.contribution_milli_cft = 10000;
    await page.goto(`${origin}/eudr`, { waitUntil: "networkidle0" });
    await page.type("#eudr-container", chain.container); await click("Find shipments");
    const vendorId = chain.vendor._id;
    await page.waitForSelector(`#contribution-${vendorId}`);
    assert.match(await page.$eval(`[aria-label="Timber chains for ${chain.vendor.name}"]`, (element) => element.textContent), /coverage incomplete.*Allocated: 10.000.*Verified: 10.000.*Unallocated: 7.600/);
    await page.type(`#contribution-${vendorId}`, "7.601");
    assert.equal(await page.$$eval("button", (buttons) => buttons.find((button) => button.textContent === "Start chain").disabled), true);
    assert.match(await page.$eval(`[aria-label="Timber chains for ${chain.vendor.name}"]`, (element) => element.textContent), /Only 7.600 CFT/);
    await page.click(`#contribution-${vendorId}`, { clickCount: 3 }); await page.keyboard.type("7.6");
    await page.click(`#declared-${vendorId}`, { clickCount: 3 }); await page.keyboard.type("16");
    assert.equal(await page.$$eval("button", (buttons) => buttons.find((button) => button.textContent === "Start chain").disabled), true);
    await page.click(`#declared-${vendorId}`, { clickCount: 3 }); await page.keyboard.type("17.6");
    await click("Start chain"); await page.waitForSelector(".eudr-report");
    assert.match(await page.$eval('[aria-label="Chain CFT contribution"]', (element) => element.textContent), /contributes 7.600.*coverage incomplete.*2 chain\(s\).*Verified: 10.000/);
    await click("Edit Details", "#eudr-stage-mill"); await page.waitForSelector("#mill-sold_cft");
    assert.match(await page.$eval(".eudr-drawer", (element) => element.textContent), /cover at least 7.600 CFT contributed by this chain/);
    await click("Close", ".eudr-drawer");
    await click("Update chain contribution"); await page.waitForSelector("#eudr-contribution");
    await page.click("#eudr-contribution", { clickCount: 3 }); await page.keyboard.type("7.601");
    assert.equal(await page.$$eval(".eudr-small-dialog button", (buttons) => buttons.find((button) => button.textContent === "Update contribution").disabled), true);
    await click("Close", ".eudr-small-dialog");
    await click("Back to Containers"); await page.waitForFunction(() => [...document.querySelectorAll("button")].filter((button) => button.textContent === "Open chain").length === 2);
    assert.equal(await page.$$eval("button", (buttons) => buttons.filter((button) => button.textContent === "Start chain").length), 0);
    await page.screenshot({ path: path.join(output, "eudr-multiple-chains.png"), fullPage: true });
    chain.complete = true;
    await click("Find shipments"); await page.waitForFunction(() => document.querySelector('[aria-label^="Timber chains for"]')?.textContent.includes("Total timber coverage complete"));
    assert.deepEqual(errors, []);
    console.log("EUDR browser checks passed: read-only report, actual PDF/image previews, multipage controls, filtered navigation, authorized download requests, responsive gallery, editing/upload/verification, and empty/single-file states.");
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); server.close(); }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
