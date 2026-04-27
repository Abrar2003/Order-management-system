const crypto = require("crypto");
const {
  createRedisClient,
  isRedisCacheEnabled,
} = require("../config/redis");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SHORT_CACHE_TTL = parsePositiveInt(process.env.CACHE_TTL_SHORT_SECONDS, 60);
const MEDIUM_CACHE_TTL = parsePositiveInt(process.env.CACHE_TTL_MEDIUM_SECONDS, 300);
const LONG_CACHE_TTL = parsePositiveInt(process.env.CACHE_TTL_LONG_SECONDS, 900);

const CACHE_CONNECT_TIMEOUT_MS = parsePositiveInt(
  process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS,
  1000,
);
const CACHE_RETRY_COOLDOWN_MS = parsePositiveInt(
  process.env.REDIS_CACHE_RETRY_COOLDOWN_MS,
  30000,
);

let cacheClient = null;
let cacheConnectPromise = null;
let unavailableUntil = 0;
let lastUnavailableLogAt = 0;

const normalizeText = (value) => String(value ?? "").trim();

const withTimeout = (promise, timeoutMs, label = "operation") =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const markCacheUnavailable = (error) => {
  unavailableUntil = Date.now() + CACHE_RETRY_COOLDOWN_MS;
  if (error) {
    const now = Date.now();
    if (!lastUnavailableLogAt || now - lastUnavailableLogAt > 60000) {
      lastUnavailableLogAt = now;
      console.warn("[cache] Redis cache unavailable; skipping cache temporarily", {
        message: error?.message || String(error),
      });
    }
  }
};

const getClient = async () => {
  if (!isRedisCacheEnabled()) return null;
  if (Date.now() < unavailableUntil) return null;

  if (!cacheClient) {
    cacheClient = createRedisClient({ label: "cache" });
  }

  if (cacheClient.status === "ready") return cacheClient;

  if (!cacheConnectPromise) {
    cacheConnectPromise = cacheClient.connect().finally(() => {
      cacheConnectPromise = null;
    });
  }

  try {
    await withTimeout(cacheConnectPromise, CACHE_CONNECT_TIMEOUT_MS, "Redis cache connect");
    return cacheClient.status === "ready" ? cacheClient : null;
  } catch (error) {
    markCacheUnavailable(error);
    return null;
  }
};

const getCache = async (key) => {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return null;

  const client = await getClient();
  if (!client) return null;

  try {
    const rawValue = await client.get(normalizedKey);
    if (rawValue === null || rawValue === undefined) return null;
    return JSON.parse(rawValue);
  } catch (error) {
    markCacheUnavailable(error);
    return null;
  }
};

const setCache = async (key, value, ttlSeconds = SHORT_CACHE_TTL) => {
  const normalizedKey = normalizeText(key);
  const ttl = parsePositiveInt(ttlSeconds, SHORT_CACHE_TTL);
  if (!normalizedKey || ttl <= 0) return false;

  const client = await getClient();
  if (!client) return false;

  try {
    await client.set(normalizedKey, JSON.stringify(value), "EX", ttl);
    return true;
  } catch (error) {
    markCacheUnavailable(error);
    return false;
  }
};

const deleteCache = async (key) => {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return 0;

  const client = await getClient();
  if (!client) return 0;

  try {
    return await client.del(normalizedKey);
  } catch (error) {
    markCacheUnavailable(error);
    return 0;
  }
};

const deleteCacheByPattern = async (pattern) => {
  const normalizedPattern = normalizeText(pattern);
  if (!normalizedPattern) return 0;

  const client = await getClient();
  if (!client) return 0;

  let cursor = "0";
  let deleted = 0;

  try {
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        normalizedPattern,
        "COUNT",
        250,
      );
      cursor = nextCursor;

      if (Array.isArray(keys) && keys.length > 0) {
        deleted += await client.del(...keys);
      }
    } while (cursor !== "0");

    return deleted;
  } catch (error) {
    markCacheUnavailable(error);
    return deleted;
  }
};

const sanitizePrefix = (prefix = "route") =>
  normalizeText(prefix)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "route";

const buildCacheKey = (prefix, req) => {
  const safePrefix = sanitizePrefix(prefix);
  const originalUrl = normalizeText(req?.originalUrl || req?.url || "");
  const urlHash = crypto
    .createHash("sha256")
    .update(originalUrl)
    .digest("hex")
    .slice(0, 32);
  const userRole = normalizeText(req?.user?.role || "anonymous").toLowerCase();
  const userId = normalizeText(req?.user?._id || req?.user?.id || "anonymous");

  return `${safePrefix}:${userRole}:${userId}:${urlHash}`;
};

const withCache = async (key, ttl, producerFn) => {
  const cached = await getCache(key);
  if (cached !== null) return cached;

  const value = await producerFn();
  await setCache(key, value, ttl);
  return value;
};

module.exports = {
  SHORT_CACHE_TTL,
  MEDIUM_CACHE_TTL,
  LONG_CACHE_TTL,
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPattern,
  buildCacheKey,
  withCache,
};
