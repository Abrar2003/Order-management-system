const { deleteCacheByPattern } = require("./cache.service");

const CACHE_PREFIXES = Object.freeze({
  orders: "orders:*",
  dashboard: "dashboard:*",
  reports: "reports:*",
  analytics: "analytics:*",
  qc: "qc:*",
  items: "items:*",
  options: "options:*",
});

const uniquePatterns = (patterns = []) =>
  [...new Set((Array.isArray(patterns) ? patterns : []).filter(Boolean))];

const invalidatePatterns = async (patterns = []) => {
  const normalizedPatterns = uniquePatterns(patterns);
  if (normalizedPatterns.length === 0) return { deleted: 0, patterns: [] };

  const results = await Promise.allSettled(
    normalizedPatterns.map((pattern) => deleteCacheByPattern(pattern)),
  );

  return {
    deleted: results.reduce(
      (sum, result) =>
        sum + (result.status === "fulfilled" ? Number(result.value || 0) : 0),
      0,
    ),
    patterns: normalizedPatterns,
  };
};

const invalidateOrderCaches = () =>
  invalidatePatterns([
    CACHE_PREFIXES.orders,
    CACHE_PREFIXES.dashboard,
    CACHE_PREFIXES.reports,
    CACHE_PREFIXES.analytics,
    CACHE_PREFIXES.qc,
    CACHE_PREFIXES.items,
    CACHE_PREFIXES.options,
  ]);

const invalidateQcCaches = () =>
  invalidatePatterns([
    CACHE_PREFIXES.qc,
    CACHE_PREFIXES.orders,
    CACHE_PREFIXES.dashboard,
    CACHE_PREFIXES.reports,
    CACHE_PREFIXES.analytics,
    CACHE_PREFIXES.items,
  ]);

const invalidateItemCaches = () =>
  invalidatePatterns([
    CACHE_PREFIXES.items,
    CACHE_PREFIXES.options,
    CACHE_PREFIXES.analytics,
    CACHE_PREFIXES.reports,
    CACHE_PREFIXES.orders,
    CACHE_PREFIXES.qc,
    CACHE_PREFIXES.dashboard,
  ]);

const invalidateReportCaches = () =>
  invalidatePatterns([
    CACHE_PREFIXES.reports,
    CACHE_PREFIXES.analytics,
    CACHE_PREFIXES.dashboard,
  ]);

const invalidateAllOmsCaches = () =>
  invalidatePatterns(Object.values(CACHE_PREFIXES));

module.exports = {
  invalidateOrderCaches,
  invalidateQcCaches,
  invalidateItemCaches,
  invalidateReportCaches,
  invalidateAllOmsCaches,
  invalidatePatterns,
};
