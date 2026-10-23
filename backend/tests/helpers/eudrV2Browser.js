const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const puppeteer = require("puppeteer");

module.exports = async function browserWorkflow({ oms, eudr, uiPort, acaciaId, groupKey }) {
  const dist = path.resolve(__dirname, "../../../.tmp/v2-oms-dist");
  assert.ok(fs.existsSync(path.join(dist, "index.html")), "Build the OMS browser-test bundle with VITE_API_BASE_URL=/api first");
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/socket.io")) {
      const upstream = http.request(new URL(req.url.replace(/^\/api/, ""), oms), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on("error", () => { res.statusCode = 502; res.end(); }); req.pipe(upstream); return;
    }
    let file = path.resolve(dist, "." + new URL(req.url, "http://localhost").pathname);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(uiPort, "127.0.0.1", resolve));
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || [
    path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
  ].find(candidate => fs.existsSync(candidate));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage(), errors = [];
    await page.setViewport({ width: 1440, height: 1100 }); page.on("pageerror", error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.protocol === "data:" || url.protocol === "blob:") return request.continue();
      if (url.pathname.endsWith("/bootstrap.min.css") || url.pathname.endsWith("/bootstrap.bundle.min.js")) {
        const css = url.pathname.endsWith(".css");
        return request.respond({ status: 200, contentType: css ? "text/css" : "text/javascript", body: fs.readFileSync(path.resolve(__dirname, `../../../client/OMS/node_modules/bootstrap/dist/${css ? "css/bootstrap.min.css" : "js/bootstrap.bundle.min.js"}`)) });
      }
      return request.abort();
    });
    const ui = `http://127.0.0.1:${uiPort}`;
    await page.goto(ui + "/signin", { waitUntil: "networkidle0" });
    await page.type('input[name="username"]', "v2-admin"); await page.type('input[name="password"]', "test-only-password");
    await page.locator('.signin-page-shell button[type="submit"]').click();
    await page.waitForSelector(".brand-scope-card form"); await page.$eval(".brand-scope-card form", form => form.requestSubmit());
    await page.waitForFunction(() => window.location.pathname === "/");
    await page.goto(ui + "/settings/wood-species", { waitUntil: "networkidle0" });
    await page.type("#wood-common", "Teak"); await page.type("#wood-scientific", "Tectona grandis");
    const created = page.waitForResponse(response => response.url().endsWith("/api/wood-species") && response.request().method() === "POST");
    await page.$eval("main form", form => form.requestSubmit()); assert.equal((await created).status(), 201);
    await page.waitForFunction(() => document.querySelector("tbody")?.innerText.includes("Teak"));
    await page.goto(ui + "/items", { waitUntil: "networkidle0" });
    await page.waitForSelector('[title="Edit item"]'); await page.locator('[title="Edit item"]').click();
    await page.waitForSelector('input[id$="volume"]');
    await page.select('select[id$="unit"]', "cft");
    await page.locator('input[id$="volume"]').fill("0.5");
    await page.locator('input[id$="share0"]').fill("60");
    await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Add species").click());
    await page.waitForFunction(id => [...document.querySelectorAll('select[id$="species1"] option')].some(option => option.value === id), {}, acaciaId);
    await page.select('select[id$="species1"]', acaciaId); await page.locator('input[id$="share1"]').fill("40");
    await page.locator('input[id$="hs"]').fill("9403 60");
    assert.match(await page.$eval('fieldset', node => node.innerText), /100\.00%/);
    await page.screenshot({ path: path.resolve(__dirname, "../../../.tmp/v2-oms-wood.png"), fullPage: true });
    const saved = page.waitForResponse(response => /\/api\/items\/[a-f0-9]{24}$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH");
    await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Save Item").click());
    assert.equal((await saved).status(), 200, "Item metadata did not save from the normal editor");
    await page.goto(eudr + "/eudr-tool/api/auth/launch", { waitUntil: "networkidle0" });
    await page.waitForSelector(".page-heading h1");
    assert.equal(await page.$eval(".page-heading h1", node => node.textContent), "Chains");
    await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("Create New Chain")).click());
    await page.type('input[placeholder="Enter a container number"]', "TEST-V2-001");
    await page.$eval("dialog form", form => form.requestSubmit());
    await page.waitForSelector(".container-result"); await page.locator(".container-result").click();
    await page.waitForFunction(key => [...document.querySelectorAll("dialog select option")].some(option => option.value === key), {}, groupKey);
    await page.select("dialog select", groupKey);
    await page.waitForFunction(() => document.querySelector("dialog")?.innerText.includes("60%"));
    const text = await page.$eval("dialog", node => node.innerText);
    assert.match(text, /Vendor A/); assert.match(text, /96517/); assert.match(text, /Mango: 60%/); assert.match(text, /Acacia wood: 40%/); assert.match(text, /940360/);
    await page.screenshot({ path: path.resolve(__dirname, "../../../.tmp/v2-eudr-connected.png"), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
};
