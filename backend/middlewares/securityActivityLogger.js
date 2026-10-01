const fs = require("fs");
const path = require("path");
const { logSecurityActivity } = require("../services/securityMonitoringService");

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const QC_UPDATE_LOG_FILE = path.resolve(
  process.env.QC_UPDATE_LOG_FILE || path.join(__dirname, "..", "logs", "qc-updates.log"),
);
let qcLogWrites = Promise.resolve();

const isQcUpdateRequest = (req = {}) => {
  const path = String(req.path || req.url || "").split("?")[0];
  return (
    MUTATION_METHODS.has(String(req.method || "").toUpperCase()) &&
    path !== "/pdf/render" &&
    path !== "/scan-barcode" &&
    !path.endsWith("/images/download")
  );
};

const summarizeFile = (file = {}) => ({
  field: file.fieldname || "",
  name: file.originalname || "",
  type: file.mimetype || "",
  size: Number(file.size || 0),
});

const getUploadPayload = (req = {}) => {
  const files = Array.isArray(req.files)
    ? req.files
    : Object.values(req.files || {}).flat();
  return [...(req.file ? [req.file] : []), ...files].map(summarizeFile);
};

const buildQcUpdateMetadata = ({
  req = {},
  res = {},
  receivedAt,
  completedAt,
  responseBody,
  terminalState = "finished",
} = {}) => {
  const statusCode = Number(res.statusCode || 0);
  const failed = statusCode >= 400 || terminalState === "aborted";

  return {
    method: req.method,
    path: req.originalUrl || req.url || "",
    route: req.route?.path || "",
    request_received_at: receivedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - receivedAt.getTime(),
    status_code: statusCode,
    outcome: terminalState === "aborted" ? "aborted" : failed ? "failed" : "completed",
    payload: {
      params: req.params || {},
      query: req.query || {},
      body: req.body || {},
      files: getUploadPayload(req),
    },
    ...(failed
      ? {
          failure: {
            response: responseBody === undefined ? null : responseBody,
            error:
              res.locals?.requestError ||
              (terminalState === "aborted"
                ? {
                    name: "RequestAborted",
                    message: "Client connection closed before the response completed.",
                    code: "CLIENT_ABORTED",
                  }
                : null),
          },
        }
      : {}),
  };
};

// ponytail: single JSONL file; use logrotate when retention or size requires it.
const appendQcUpdateLog = (metadata, filePath = QC_UPDATE_LOG_FILE) => {
  qcLogWrites = qcLogWrites
    .catch(() => undefined)
    .then(async () => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.appendFile(filePath, `${JSON.stringify(metadata)}\n`, "utf8");
    });
  return qcLogWrites;
};

// One lifecycle record covers validation, authorization, controller, and commit failures.
const qcUpdateLog = (req, res, next) => {
  if (!isQcUpdateRequest(req)) return next();

  const receivedAt = new Date();
  let responseBody;
  const originalJson = res.json;
  const originalSend = res.send;
  let recorded = false;

  res.json = function captureJson(body) {
    responseBody = body;
    return originalJson.call(this, body);
  };
  res.send = function captureSend(body) {
    if (responseBody === undefined) responseBody = body;
    return originalSend.call(this, body);
  };

  const recordLifecycle = (terminalState) => {
    if (recorded) return;
    recorded = true;
    const completedAt = new Date();
    const metadata = buildQcUpdateMetadata({
      req,
      res,
      receivedAt,
      completedAt,
      responseBody,
      terminalState,
    });
    const resourceId =
      req.params?.id ||
      req.body?.qc_id ||
      req.body?.qcId ||
      req.params?.uploadId ||
      "";

    appendQcUpdateLog({
      ...metadata,
      qc_id: resourceId,
    }).catch((error) => {
      console.error("[qc-update] lifecycle log failed", {
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        message: error?.message || String(error),
      });
    });
  };

  res.once("finish", () => recordLifecycle("finished"));
  res.once("close", () => {
    if (!res.writableEnded) recordLifecycle("aborted");
  });

  next();
};

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
    if (
      (statusCode < 200 || statusCode >= 400)
      && options.includeFailures !== true
    ) {
      return;
    }

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
  qcUpdateLog,
  __test__: {
    buildQcUpdateMetadata,
    isQcUpdateRequest,
    appendQcUpdateLog,
  },
};
