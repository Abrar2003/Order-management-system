const express = require("express");
const crypto = require("node:crypto");
const auth = require("../middlewares/auth.middleware");
const rateLimit = require("../middlewares/rateLimit.middleware");
const A = require("./eudrV2.auth");
const source = require("./eudrV2.source");
const { getUserBrandScope } = require("../services/userDataAccess.service");
const router = express.Router();
const run = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); res.set("Referrer-Policy", "no-referrer"); next(); });
router.get("/auth/launch", rateLimit({ maxRequests: 30, windowMs: 60000, keyPrefix: "oms-v2-launch" }), run(async (req, res) => {
  const { state } = req.query;
  if (typeof state !== "string" || !/^[a-f0-9]{64}$/.test(state)) throw A.fail("STATE_INVALID", "Open EUDR to start a fresh login", 400);
  const settings = A.config();
  let authenticated = false;
  const response = { status() { return this; }, json() {} };
  await auth(req, response, () => { authenticated = true; });
  if (!authenticated) {
    const signin = new URL("/signin", settings.omsUrl);
    signin.searchParams.set("continue", "eudr-v2"); signin.searchParams.set("state", state);
    return res.redirect(302, signin.href);
  }
  const scope = getUserBrandScope(req.user), user = await A.account(req.user._id, scope);
  const code = crypto.randomBytes(32).toString("hex"), nonce = crypto.randomBytes(16).toString("hex");
  await A.Handoff.create({ _id: A.digest(code), userId: user._id, scope, state, audience: settings.publicUrl.href, expiresAt: new Date(Date.now() + 60000) });
  const callback = new URL("api/auth/callback", settings.publicUrl);
  const html = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  res.set("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${callback.origin}; base-uri 'none'; frame-ancestors 'none'`);
  res.type("html").send(`<form method="post" action="${html(callback.href)}"><input type="hidden" name="code" value="${code}"><input type="hidden" name="state" value="${state}"><button>Continue to EUDR</button></form><script nonce="${nonce}">document.forms[0].submit()</script>`);
}));
router.use(A.signed);
router.use((req, _res, next) => next(req.method === "POST" && !req.is("application/json") ? A.fail("CONTENT_TYPE_INVALID", "Integration POST requests require JSON", 415) : undefined));
router.post("/auth/redeem", rateLimit({ maxRequests: 60, windowMs: 60000, keyPrefix: "oms-v2-redeem" }), run(async (req, res) => {
  const { code, state, audience } = req.body || {};
  if (![code, state].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) || audience !== A.config().publicUrl.href) throw A.fail("HANDOFF_INVALID", "Invalid login handoff", 401);
  const record = await A.Handoff.findOneAndDelete({ _id: A.digest(code), state, audience, expiresAt: { $gt: new Date() } }).lean();
  if (!record) throw A.fail("HANDOFF_INVALID", "Login handoff expired or was already used", 401);
  const user = await A.account(record.userId, record.scope), context = A.scopeToken(user._id, record.scope);
  res.json({ user: await A.projection(user, context) });
}));
router.get("/auth/users/:id", run(async (req, res) => {
  const context = req.get("X-EUDR-Scope"), scope = A.readScope(context, req.params.id);
  res.json({ user: await A.projection(await A.account(req.params.id, scope), context) });
}));
router.get("/species", run(async (_req, res) => res.json(await source.speciesCatalog())));
router.get("/containers", A.actor, run(async (req, res) => res.json(await source.search(req.integrationUser, req.query.query, req.query.page === undefined ? 1 : Number(req.query.page), req.query.limit === undefined ? 25 : Number(req.query.limit)))));
router.get("/containers/:key", A.actor, run(async (req, res) => res.json(await source.snapshot(req.integrationUser, req.params.key))));
router.use((_req, res) => res.status(404).json({ code: "NOT_FOUND", message: "Integration endpoint not found" }));
router.use((error, _req, res, _next) => {
  const status = error.statusCode || 503;
  if (status >= 500) console.error("OMS V2 integration request failed", { code: typeof error.code === "string" ? error.code : "SOURCE_UNAVAILABLE" });
  res.status(status).json({ code: error.code && typeof error.code === "string" ? error.code : "SOURCE_UNAVAILABLE", message: status >= 500 ? "OMS source is temporarily unavailable" : error.message });
});
module.exports = router;
