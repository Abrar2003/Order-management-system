const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("puppeteer");

const root = path.resolve(__dirname, "../../client/OMS/dist");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let file = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || [
    path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
  ].find(candidate => fs.existsSync(candidate));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const chooseBrand of [true, false]) {
      const page = await browser.newPage();
      const errors = [], legacyRequests = [];
      let user = { id: "507f1f77bcf86cd799439011", role: "super_admin", name: "Test Admin",
        requires_brand_scope_choice: chooseBrand, brand_scope: "all" };
      page.on("pageerror", error => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on("request", request => {
        const url = new URL(request.url());
        const route = url.pathname.replace(/^\/api/, "");
        if (/eudr|timber.?trace/i.test(url.pathname)) legacyRequests.push(url.pathname);
        const respond = body => request.respond({ status: 200, contentType: "application/json", headers: {
          "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        }, body: JSON.stringify(body) });
        if (url.pathname.endsWith("/bootstrap.min.css") || url.pathname.endsWith("/bootstrap.bundle.min.js")) {
          const css = url.pathname.endsWith(".css");
          return request.respond({ status: 200, contentType: css ? "text/css" : "text/javascript",
            body: fs.readFileSync(path.resolve(__dirname, `../../client/OMS/node_modules/bootstrap/dist/${css ? "css/bootstrap.min.css" : "js/bootstrap.bundle.min.js"}`)) });
        }
        if (request.method() === "OPTIONS") return respond({});
        if (route.startsWith("/auth/")) {
          if (route === "/auth/brand-scope") user = { ...user, requires_brand_scope_choice: false };
          return respond({ user });
        }
        if (route === "/permissions/me") return respond({ role: user.role, permissions: {} });
        if (route === "/brands/") return respond({ data: [{ _id: "brand1", name: "Giga" }] });
        if (url.origin !== origin || url.pathname.startsWith("/api/")) return respond({ data: [], unreadCount: 0 });
        return request.continue();
      });
      await page.goto(origin + "/signin?continue=eudr", { waitUntil: "networkidle0" });
      await page.type('input[name="username"]', "test-admin");
      await page.type('input[name="password"]', "test-password");
      await page.locator('.signin-page-shell button[type="submit"]').click();
      if (chooseBrand) {
        await page.waitForFunction(() => window.location.pathname === "/choose-brand-scope");
        await page.waitForSelector(".brand-scope-all-toggle");
        await page.waitForSelector('.brand-scope-card button[type="submit"]:not(:disabled)');
        await page.$eval(".brand-scope-card form", form => form.requestSubmit());
      }
      await page.waitForFunction(() => window.location.pathname === "/", { timeout: 10000 });
      await page.waitForSelector("nav");
      assert.match(await page.$eval("body", node => node.innerText), /Giga/);
      assert.doesNotMatch(await page.$eval("body", node => node.innerText), /EUDR Verification|Timber Trace/i);
      assert.deepEqual(legacyRequests, []);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("Browser smoke passed: both login paths reach the dashboard with no legacy requests or UI.");
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
