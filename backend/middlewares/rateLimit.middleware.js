const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 20;

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const createRateLimiter = ({
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS,
  keyPrefix = "rate",
  message = "Too many requests. Please try again later.",
} = {}) => {
  const buckets = new Map();
  const resolvedWindowMs = parsePositiveInteger(windowMs, DEFAULT_WINDOW_MS);
  const resolvedMaxRequests = parsePositiveInteger(maxRequests, DEFAULT_MAX_REQUESTS);

  return (req, res, next) => {
    const now = Date.now();
    const clientKey = `${keyPrefix}:${req.ip || req.socket?.remoteAddress || "unknown"}`;
    const bucket = buckets.get(clientKey);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(clientKey, {
        count: 1,
        resetAt: now + resolvedWindowMs,
      });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > resolvedMaxRequests) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }

    return next();
  };
};

module.exports = createRateLimiter;
