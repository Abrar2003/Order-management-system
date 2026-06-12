const { logSecurityActivity } = require("../services/securityMonitoringService");

const safeResolve = (resolver, req, res) => {
  if (typeof resolver !== "function") return resolver;
  try {
    return resolver(req, res);
  } catch {
    return undefined;
  }
};

const securityLog = (action, resourceType, options = {}) => (req, res, next) => {
  res.on("finish", () => {
    const statusCode = Number(res.statusCode || 0);
    if (statusCode < 200 || statusCode >= 400) return;

    const metadata = {
      method: req.method,
      path: req.originalUrl,
      status_code: statusCode,
      ...(safeResolve(options.metadata, req, res) || {}),
    };
    const resourceId =
      safeResolve(options.resourceId, req, res) ||
      req.params?.id ||
      req.params?.itemCode ||
      req.params?.itemId ||
      req.params?.recordId ||
      "";

    logSecurityActivity(req, {
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      metadata,
    }).catch((error) => {
      console.warn("[security] activity log failed", {
        action,
        resourceType,
        path: req.originalUrl,
        message: error?.message || String(error),
      });
    });
  });

  next();
};

module.exports = {
  securityLog,
};
