const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ACCESS_COOKIE_NAME = "oms_access_token";
const REFRESH_COOKIE_NAME = "oms_refresh_token";
const ACCESS_TOKEN_EXPIRES_IN = "3h";
const REFRESH_TOKEN_EXPIRES_IN = "24h";
const ACCESS_COOKIE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const normalizeText = (value) => String(value || "").trim();

const isTruthy = (value) =>
  ["1", "true", "yes", "y", "on"].includes(
    String(value ?? "").trim().toLowerCase(),
  );

const getRequiredSecret = (key) => {
  const secret = normalizeText(process.env[key]);
  if (!secret) {
    throw new Error(`${key} is not configured`);
  }
  return secret;
};

const getCookieOptions = (maxAge) => {
  const sameSite = normalizeText(process.env.AUTH_COOKIE_SAME_SITE || "lax").toLowerCase();
  const secure =
    process.env.AUTH_COOKIE_SECURE !== undefined
      ? isTruthy(process.env.AUTH_COOKIE_SECURE)
      : normalizeText(process.env.NODE_ENV).toLowerCase() === "production";
  const options = {
    httpOnly: true,
    secure,
    sameSite: ["strict", "lax", "none"].includes(sameSite) ? sameSite : "lax",
    path: "/",
    maxAge,
  };
  const domain = normalizeText(process.env.AUTH_COOKIE_DOMAIN);
  if (domain) options.domain = domain;
  return options;
};

const parseCookies = (cookieHeader = "") =>
  String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex < 0) return cookies;
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key) return cookies;
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});

const getCookie = (req, name) =>
  parseCookies(req?.headers?.cookie || "")[name] || "";

const hashToken = (token = "") =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const buildUserPayload = (user = {}) => ({
  id: user?._id || user?.id,
  role: user?.role,
  email: user?.email,
  name: user?.name,
  brand_scope: user?.brand_scope || "all",
  brand_scope_choice_completed: Boolean(user?.brand_scope_choice_completed),
});

const signAccessToken = (user = {}) =>
  jwt.sign(
    buildUserPayload(user),
    getRequiredSecret("JWT_SECRET"),
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
  );

const signRefreshToken = ({ user, sessionId }) =>
  jwt.sign(
    {
      sub: String(user?._id || user?.id || ""),
      sid: String(sessionId || ""),
      typ: "refresh",
    },
    getRequiredSecret("JWT_REFRESH_SECRET"),
    {
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      jwtid: crypto.randomUUID(),
    },
  );

const verifyAccessToken = (token = "") =>
  jwt.verify(token, getRequiredSecret("JWT_SECRET"));

const verifyRefreshToken = (token = "") =>
  jwt.verify(token, getRequiredSecret("JWT_REFRESH_SECRET"));

const setAuthCookies = (res, { accessToken, refreshToken }) => {
  res.cookie(ACCESS_COOKIE_NAME, accessToken, getCookieOptions(ACCESS_COOKIE_MAX_AGE_MS));
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getCookieOptions(REFRESH_COOKIE_MAX_AGE_MS));
};

const clearAuthCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE_NAME, getCookieOptions(0));
  res.clearCookie(REFRESH_COOKIE_NAME, getCookieOptions(0));
};

module.exports = {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_MS,
  buildUserPayload,
  clearAuthCookies,
  getCookie,
  hashToken,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
