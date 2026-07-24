const OmsChatRateBucket = require("../models/omsChatRateBucket.model");

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 10;

const omsChatRateLimit = async (req, res, next) => {
  const userId = String(req.user?._id || req.user?.id || "").trim();
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Date.now();
  const bucketStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const resetAt = bucketStart + WINDOW_MS;
  const bucketId = `${userId}:${bucketStart}`;

  try {
    const bucket = await OmsChatRateBucket.findOneAndUpdate(
      { _id: bucketId },
      {
        $inc: { count: 1 },
        $setOnInsert: { expires_at: new Date(resetAt) },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    const count = Number(bucket?.count || 0);
    res.setHeader("RateLimit-Limit", String(MAX_REQUESTS));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, MAX_REQUESTS - count)),
    );
    res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (count > MAX_REQUESTS) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.locals.omsChatAudit = {
        ...(res.locals.omsChatAudit || {}),
        failureCategory: "rate_limited",
      };
      return res.status(429).json({
        message: "Too many OMS Assistant requests. Please try again shortly.",
      });
    }
    return next();
  } catch {
    res.locals.omsChatAudit = {
      ...(res.locals.omsChatAudit || {}),
      failureCategory: "rate_limit_unavailable",
    };
    return res.status(503).json({
      message: "OMS Assistant is temporarily unavailable",
    });
  }
};

module.exports = {
  omsChatRateLimit,
  __test__: { MAX_REQUESTS, WINDOW_MS },
};
