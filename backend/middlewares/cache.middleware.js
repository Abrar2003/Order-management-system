const {
  SHORT_CACHE_TTL,
  buildCacheKey,
  getCache,
  setCache,
} = require("../services/cache.service");

const cacheRoute = (prefix, ttlSeconds = SHORT_CACHE_TTL) => async (req, res, next) => {
  if (req.method !== "GET") return next();

  const cacheKey = buildCacheKey(prefix, req);
  const cachedBody = await getCache(cacheKey);
  if (cachedBody !== null) {
    res.setHeader("X-OMS-Cache", "HIT");
    return res.status(200).json(cachedBody);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (!res.headersSent && res.statusCode < 400) {
      res.setHeader("X-OMS-Cache", "MISS");
      setCache(cacheKey, body, ttlSeconds).catch((error) => {
        console.warn("[cache] failed to store route response", {
          prefix,
          message: error?.message || String(error),
        });
      });
    }

    return originalJson(body);
  };

  return next();
};

const invalidateCacheOnSuccess = (invalidateFn) => (req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    Promise.resolve(invalidateFn(req)).catch((error) => {
      console.warn("[cache] invalidation failed", {
        message: error?.message || String(error),
      });
    });
  });

  next();
};

module.exports = {
  cacheRoute,
  invalidateCacheOnSuccess,
};
