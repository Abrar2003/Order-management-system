const {
  OmsChatServiceError,
  askOmsAssistant,
} = require("../services/omsChat.service");
const { OmsChatQueryError } = require("../services/omsChatQuery.service");

const MAX_BODY_BYTES = 8 * 1024;

const publicError = (error) => {
  const statusCode = Number(error?.statusCode || 500);
  if (statusCode === 400 || statusCode === 404 || statusCode === 413) {
    return error.message;
  }
  if (statusCode === 422) {
    return "I could not safely produce that report. Please rephrase or narrow the question.";
  }
  if (statusCode === 504) {
    return "The OMS Assistant request timed out. Please narrow the question and try again.";
  }
  if (
    statusCode === 503 &&
    String(error?.category || "").startsWith("missing_")
  ) {
    return "OMS Assistant is not configured";
  }
  if (
    statusCode === 503 &&
    error?.category === "unsafe_chat_database_configuration"
  ) {
    return "OMS Assistant database isolation is not configured";
  }
  return "OMS Assistant is temporarily unavailable";
};

const ask = async (req, res) => {
  const audit = {
    question: typeof req.body?.message === "string" ? req.body.message : "",
    collections: [],
    stageCount: 0,
    durationMs: 0,
    returnedRows: 0,
    truncated: false,
    failureCategory: "",
  };
  res.locals.omsChatAudit = audit;

  try {
    const serializedBody = JSON.stringify(req.body || {});
    if (Buffer.byteLength(serializedBody, "utf8") > MAX_BODY_BYTES) {
      throw new OmsChatServiceError("Request is too large", {
        statusCode: 413,
        category: "invalid_request",
      });
    }
    const allowedKeys = new Set(["message", "conversationId"]);
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => !allowedKeys.has(key))
    ) {
      throw new OmsChatServiceError("Invalid request body", {
        statusCode: 400,
        category: "invalid_request",
      });
    }

    const result = await askOmsAssistant({
      message: req.body.message,
      conversationId: req.body.conversationId,
      user: req.user,
    });
    Object.assign(audit, {
      collections: result.audit.collections,
      stageCount: result.audit.stageCount,
      durationMs: result.audit.durationMs,
      returnedRows: result.audit.returnedRows,
      truncated: result.audit.truncated,
    });
    res.locals.omsChatConversationId = result.conversationId;

    const { audit: _audit, ...response } = result;
    return res.status(200).json(response);
  } catch (error) {
    const safeError =
      error instanceof OmsChatServiceError || error instanceof OmsChatQueryError
        ? error
        : new OmsChatServiceError("OMS Assistant failed", {
            statusCode: 500,
            category: "internal_failure",
          });
    if (error?.audit) {
      Object.assign(audit, {
        collections: Array.isArray(error.audit.collections)
          ? error.audit.collections
          : error.audit.collection
            ? [error.audit.collection]
            : [],
        stageCount: Number(error.audit.stageCount || 0),
        durationMs: Number(error.audit.durationMs || 0),
        returnedRows: Number(error.audit.returnedRows || 0),
        truncated: Boolean(error.audit.truncated),
      });
    }
    audit.failureCategory = safeError.category || "assistant_failure";
    return res
      .status(Number(safeError.statusCode || 500))
      .json({ message: publicError(safeError) });
  }
};

module.exports = {
  ask,
  __test__: { MAX_BODY_BYTES, publicError },
};
