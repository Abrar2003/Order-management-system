const express = require("express");
const auth = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");
const { securityLog } = require("../middlewares/securityActivityLogger");
const {
  omsChatRateLimit,
} = require("../middlewares/omsChatRateLimit.middleware");
const {
  omsChatRequestLogger,
  omsChatRouteStep,
} = require("../services/omsChatLogger.service");
const { ask } = require("../controllers/omsChat.controller");

const router = express.Router();

const inferFailureCategory = (statusCode, recorded) => {
  if (recorded) return recorded;
  if (statusCode === 401) return "unauthorized";
  if (statusCode === 403) return "permission_denied";
  if (statusCode === 429) return "rate_limited";
  if (statusCode >= 400) return "request_failed";
  return "";
};

const omsChatAuditLogger = securityLog("oms_assistant_query", "oms_assistant", {
  includeFailures: true,
  resourceId: (_req, res) => res.locals?.omsChatConversationId || "",
  metadata: (req, res) => {
    const details = res.locals?.omsChatAudit || {};
    const statusCode = Number(res.statusCode || 0);
    return {
      request_id: String(res.locals?.omsChatRequestId || ""),
      question: String(details.question ?? req.body?.message ?? ""),
      selected_collection: Array.isArray(details.collections)
        ? details.collections.join(",")
        : "",
      stage_count: Number(details.stageCount || 0),
      query_duration_ms: Number(details.durationMs || 0),
      returned_rows: Number(details.returnedRows || 0),
      truncated: Boolean(details.truncated),
      answer_type: String(details.answerType || ""),
      forecast_confidence: String(details.forecastConfidence || ""),
      tool_call_count: Number(details.toolCallCount || 0),
      capability_count: Number(details.capabilityCount || 0),
      capabilities_used: Array.isArray(details.capabilitiesUsed)
        ? details.capabilitiesUsed.join(",")
        : "",
      database_query_call_count: Number(details.databaseQueryCallCount || 0),
      analytics_call_count: Number(details.analyticsCallCount || 0),
      schema_call_count: Number(details.schemaCallCount || 0),
      invalid_tool_call_count: Number(details.invalidToolCallCount || 0),
      analysis_type: String(details.analysisType || ""),
      success: statusCode >= 200 && statusCode < 400,
      failure_category: inferFailureCategory(
        statusCode,
        details.failureCategory,
      ),
    };
  },
});
const requireOmsAssistantView = requirePermission("oms_assistant", "view");

router.post(
  "/ask",
  omsChatRequestLogger,
  omsChatAuditLogger,
  auth,
  omsChatRouteStep("authentication.completed"),
  requireOmsAssistantView,
  omsChatRouteStep("authorization.completed"),
  omsChatRateLimit,
  ask,
);

module.exports = router;
module.exports.__test__ = {
  inferFailureCategory,
  omsChatRequestLogger,
  omsChatAuditLogger,
  requireOmsAssistantView,
};
