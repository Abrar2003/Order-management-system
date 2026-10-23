const crypto = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Vendor = require("../models/vendor.model");
const Brand = require("../models/brand.model");
const { getEffectivePermissionsForUser } = require("../services/permission.service");
const { getUserBrandScope, getAllowedVendorNames, getAllowedBrandNames, isUserAllowedData } = require("../services/userDataAccess.service");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = (code, message, statusCode = 403) => Object.assign(new Error(message), { code, statusCode });
const tokenSchema = fields => new mongoose.Schema({ _id: String, expiresAt: { type: Date, index: { expires: 0 } }, ...fields });
const Nonce = mongoose.model("OmsV2Nonce", tokenSchema({}), "oms_v2_nonces");
const Handoff = mongoose.model("OmsV2Handoff", tokenSchema({ userId: mongoose.Schema.Types.ObjectId, state: String, audience: String, scope: String }), "oms_v2_handoffs");
function config() {
  const secret = process.env.OMS_V2_BRIDGE_SECRET || "";
  if (secret.length < 32) throw fail("INTEGRATION_NOT_CONFIGURED", "OMS V2 integration is not configured", 503);
  const publicUrl = new URL(process.env.EUDR_V2_PUBLIC_URL || "http://127.0.0.1:8018/eudr-tool/");
  const omsUrl = new URL(process.env.OMS_PUBLIC_URL || "http://localhost:5174/");
  for (const url of [publicUrl, omsUrl]) if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw fail("INTEGRATION_NOT_CONFIGURED", "Invalid integration public URL configuration", 503);
  if (publicUrl.pathname !== "/eudr-tool/") throw fail("INTEGRATION_NOT_CONFIGURED", "EUDR public URL must use /eudr-tool/", 503);
  return { secret, publicUrl, omsUrl };
}
const same = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function signed(req, _res, next) {
  try {
    const { secret } = config();
    const timestamp = req.get("X-EUDR-Timestamp"), nonce = req.get("X-EUDR-Nonce"), actor = req.get("X-EUDR-Actor") || "", signature = req.get("X-EUDR-Signature");
    if (!/^\d{13}$/.test(timestamp || "") || Math.abs(Date.now() - Number(timestamp)) > 30000 || !/^[a-f0-9]{32}$/.test(nonce || "") || !/^[a-f0-9]{64}$/.test(signature || "") || (actor && !/^[a-f0-9]{24}$/i.test(actor))) throw fail("BRIDGE_AUTH_INVALID", "Invalid integration authentication", 401);
    const expected = crypto.createHmac("sha256", secret).update([req.method, req.originalUrl, timestamp, nonce, actor, digest(req.rawBody || Buffer.alloc(0))].join("\n")).digest("hex");
    if (!same(expected, signature)) throw fail("BRIDGE_AUTH_INVALID", "Invalid integration authentication", 401);
    try { await Nonce.create({ _id: nonce, expiresAt: new Date(Date.now() + 65000) }); }
    catch (error) { if (error.code === 11000) throw fail("BRIDGE_REPLAY", "Integration nonce was already used", 401); throw error; }
    next();
  } catch (error) { next(error); }
}
function scopeToken(userId, scope) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw fail("AUTH_NOT_CONFIGURED", "OMS authentication is not configured", 503);
  const body = Buffer.from(JSON.stringify({ userId: String(userId), scope, expires: Date.now() + 3 * 60 * 60 * 1000 })).toString("base64url");
  return body + "." + crypto.createHmac("sha256", secret).update("oms-v2-scope\n" + body).digest("hex");
}
function readScope(token, userId) {
  if (typeof token !== "string" || token.length > 512 || !process.env.JWT_SECRET) throw fail("SCOPE_INVALID", "An OMS-issued scope context is required");
  const [body, signature, extra] = token.split(".");
  const expected = crypto.createHmac("sha256", process.env.JWT_SECRET).update("oms-v2-scope\n" + body).digest("hex");
  if (extra || !same(signature, expected)) throw fail("SCOPE_INVALID", "Invalid OMS scope context");
  let value;
  try { value = JSON.parse(Buffer.from(body, "base64url")); } catch { throw fail("SCOPE_INVALID", "Invalid OMS scope context"); }
  if (value.userId !== String(userId) || !Number.isSafeInteger(value.expires) || value.expires <= Date.now() || !["all", "giga", "dutch"].includes(value.scope)) throw fail("SCOPE_INVALID", "OMS scope context expired or mismatched");
  return value.scope;
}
async function account(id, scope = "all") {
  if (!mongoose.isObjectIdOrHexString(id)) throw fail("ACCESS_REVOKED", "OMS access is unavailable");
  const user = await User.findById(id).select("name role allowed_brands allowed_vendors isQC is_active active deleted_at").lean();
  if (!user || user.is_active === false || user.active === false || user.deleted_at) throw fail("ACCESS_REVOKED", "OMS account is inactive or unavailable");
  const brandIds = user.allowed_brands || [];
  const brands = brandIds.length ? await Brand.find({ _id: { $in: brandIds } }).select("_id name").lean() : [];
  if (brands.length !== new Set(brandIds.map(String)).size) throw fail("ACCESS_REVOKED", "An OMS brand restriction cannot be resolved");
  user.allowed_brands = brands;
  user.brand_scope = scope;
  const { permissions } = await getEffectivePermissionsForUser(user);
  if (!permissions.eudr?.view) throw fail("ACCESS_REVOKED", "EUDR access has not been granted");
  user.integrationPermissions = ["eudr:read", ...(permissions.eudr.edit ? ["eudr:write"] : []), ...(permissions.eudr.approve ? ["eudr:review"] : []), ...(permissions.eudr.manage ? ["eudr:rules"] : [])];
  return user;
}
async function projection(user, context) {
  const allVendors = !getAllowedVendorNames(user) && !getAllowedBrandNames(user) && getUserBrandScope(user) === "all";
  let vendorIds = [];
  if (!allVendors) {
    // The directory already owns brand/vendor associations; no order history or private fields are exposed.
    const match = { deleted_at: null };
    const names = getAllowedVendorNames(user), brands = getAllowedBrandNames(user), scope = getUserBrandScope(user);
    const exact = value => new RegExp("^" + value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
    if (names) match.name = { $in: names.map(exact) };
    const brandMatch = brands ? { $in: brands.map(exact) } : scope === "giga" ? /^giga$/i : scope === "dutch" ? { $not: /^giga$/i } : null;
    if (brandMatch) match.$or = [{ brands: { $elemMatch: { brand_name: brandMatch } } }, { vendor_code: { $elemMatch: { brand: brandMatch } } }];
    const vendors = await Vendor.find(match).select("_id name brands vendor_code").limit(10001).lean();
    if (vendors.length > 10000) throw fail("SCOPE_TOO_LARGE", "Vendor scope requires a narrower account selection", 503);
    vendorIds = vendors.filter(vendor => {
      const brands = [...(vendor.brands || []).map(row => row.brand_name), ...(vendor.vendor_code || []).map(row => row.brand)].filter(Boolean);
      return isUserAllowedData(user, { brands, vendors: [vendor.name] });
    }).map(vendor => String(vendor._id)).sort();
  }
  const brandNames = getAllowedBrandNames(user);
  return { id: String(user._id), name: user.name, active: true, permissions: user.integrationPermissions, allVendors, vendorIds,
    allBrands: brandNames === null, brandNames: brandNames || [], brandScope: getUserBrandScope(user), omsScope: context };
}
async function actor(req, _res, next) {
  try {
    const id = req.get("X-EUDR-Actor");
    req.integrationUser = await account(id, readScope(req.get("X-EUDR-Scope"), id));
    next();
  } catch (error) { next(error); }
}
module.exports = { config, signed, actor, account, projection, scopeToken, readScope, digest, same, fail, Handoff, Nonce };
