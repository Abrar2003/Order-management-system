const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");

const logContext = new AsyncLocalStorage();

const trim = (value, limit = 2_000) => String(value ?? "").slice(0, limit);

const write = (level, event, details = {}) => {
  const context = logContext.getStore();
  if (!context) return;
  context.sequence += 1;
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: "oms-assistant",
    event,
    request_id: context.requestId,
    sequence: context.sequence,
    elapsed_ms: Date.now() - context.startedAt,
    ...(context.userId ? { user_id: context.userId } : {}),
    ...(context.conversationId ? { conversation_id: context.conversationId } : {}),
    ...Object.fromEntries(
      Object.entries(details).filter(([, value]) => value !== undefined),
    ),
  };
  const logger = level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.log;
  logger(`[oms-assistant] ${JSON.stringify(record)}`);
};

const logOmsChatEvent = (event, details) => write("info", event, details);
const warnOmsChatEvent = (event, details) => write("warn", event, details);

const logOmsChatError = (event, error, details = {}) => write("error", event, {
  ...details,
  error_name: trim(error?.name || "Error", 120),
  error_message: trim(error?.message || error),
  error_category: trim(error?.category, 120),
  error_code: trim(error?.code, 120),
  status_code: Number(error?.statusCode || 0) || undefined,
  provider_status: Number(error?.providerStatus || 0) || undefined,
  stack: trim(error?.stack, 6_000),
});

const updateOmsChatLogContext = (values = {}) => {
  const context = logContext.getStore();
  if (!context) return;
  if (values.userId) context.userId = trim(values.userId, 120);
  if (values.conversationId) {
    context.conversationId = trim(values.conversationId, 120);
  }
};

const omsChatRequestLogger = (req, res, next) => {
  const requestId = crypto.randomUUID();
  const context = {
    requestId,
    startedAt: Date.now(),
    sequence: 0,
    userId: "",
    conversationId: "",
  };
  res.locals.omsChatRequestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  logContext.run(context, () => {
    logOmsChatEvent("request.received", {
      method: req.method,
      path: req.originalUrl,
      content_length: Number(req.get?.("content-length") || 0),
    });
    res.once("finish", () => logContext.run(context, () => {
      logOmsChatEvent("request.completed", {
        status_code: Number(res.statusCode || 0),
        failure_category: trim(
          res.locals?.omsChatAudit?.failureCategory,
          120,
        ),
      });
    }));
    next();
  });
};

const omsChatRouteStep = (event) => (req, _res, next) => {
  updateOmsChatLogContext({
    userId: req.user?._id || req.user?.id,
  });
  logOmsChatEvent(event);
  next();
};

module.exports = {
  logOmsChatError,
  logOmsChatEvent,
  omsChatRequestLogger,
  omsChatRouteStep,
  updateOmsChatLogContext,
  warnOmsChatEvent,
  __test__: { logContext },
};
