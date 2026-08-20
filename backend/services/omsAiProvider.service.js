const { GoogleGenAI } = require("@google/genai");
const {
  logOmsChatError,
  logOmsChatEvent,
  warnOmsChatEvent,
} = require("./omsChatLogger.service");

const PROVIDER_NAME = "gemini";
const DEFAULT_MODEL = "gemini-3.7-flash";
const MAX_PROVIDER_ATTEMPTS = 3;
const RETRY_DELAYS_MS = Object.freeze([2_000, 8_000]);
const PROTOCOL_ERROR_CATEGORIES = new Set([
  "provider_missing_text_and_tools",
  "provider_missing_tool_call_id",
  "provider_tool_protocol_error",
  "provider_unrecognized_response",
]);

class OmsAiProviderError extends Error {
  constructor(
    message,
    { statusCode = 502, category = "provider_unavailable", providerStatus } = {},
  ) {
    super(message);
    this.name = "OmsAiProviderError";
    this.statusCode = statusCode;
    this.category = category;
    this.providerStatus = providerStatus;
    this.expose = true;
  }
}

const getOmsAiConfiguration = () => {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = String(process.env.OMS_CHAT_LLM_MODEL || DEFAULT_MODEL).trim();

  if (!apiKey) {
    throw new OmsAiProviderError("OMS Assistant is not configured", {
      statusCode: 503,
      category: "provider_configuration",
    });
  }
  if (!model || !/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) {
    throw new OmsAiProviderError("OMS Assistant is not configured", {
      statusCode: 503,
      category: "provider_configuration",
    });
  }

  return { apiKey, model, provider: PROVIDER_NAME };
};

const providerStatus = (error) => {
  const value = Number(
    error?.status
    || error?.statusCode
    || error?.response?.status
    || error?.cause?.status,
  );
  return Number.isInteger(value) && value > 0 ? value : undefined;
};

const isAbortError = (error, signal) =>
  Boolean(signal?.aborted)
  || error?.name === "AbortError"
  || error?.code === "ABORT_ERR";

const isTransientNetworkError = (error) =>
  ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "ETIMEDOUT"]
    .includes(String(error?.code || error?.cause?.code || "").toUpperCase())
  || /fetch failed|network|socket|temporar(?:y|ily)|timed?\s*out/i.test(
    String(error?.message || ""),
  );

const toProviderError = (error, signal) => {
  if (error instanceof OmsAiProviderError) return error;
  const status = providerStatus(error);

  if (isAbortError(error, signal)) {
    return new OmsAiProviderError("OMS Assistant timed out", {
      statusCode: 504,
      category: "provider_timeout",
      providerStatus: status,
    });
  }
  if (status === 401 || status === 403) {
    return new OmsAiProviderError("OMS Assistant is not configured", {
      statusCode: 503,
      category: "provider_configuration",
      providerStatus: status,
    });
  }
  if (status === 429) {
    return new OmsAiProviderError("OMS Assistant provider is rate limited", {
      statusCode: 502,
      category: "provider_rate_limited",
      providerStatus: status,
    });
  }
  if (status === 413) {
    return new OmsAiProviderError("OMS Assistant provider request is too large", {
      statusCode: 502,
      category: "provider_request_too_large",
      providerStatus: status,
    });
  }
  if ((status && status >= 500) || isTransientNetworkError(error)) {
    return new OmsAiProviderError("OMS Assistant provider is unavailable", {
      statusCode: 502,
      category: "provider_unavailable",
      providerStatus: status,
    });
  }
  return new OmsAiProviderError("OMS Assistant provider returned an invalid response", {
    statusCode: 502,
    category: "provider_bad_response",
    providerStatus: status,
  });
};

const isRetryableProviderError = (error, signal) => {
  if (error instanceof OmsAiProviderError) return false;
  if (isAbortError(error, signal)) return false;
  const status = providerStatus(error);
  return status === 429 || Boolean(status && status >= 500) || isTransientNetworkError(error);
};

const retryAfterMs = (error, attempt) => {
  const headers = error?.headers || error?.response?.headers;
  const raw = headers?.get?.("retry-after") || headers?.["retry-after"] || "";
  const numeric = Number.parseFloat(raw);
  if (Number.isFinite(numeric)) {
    return Math.min(20_000, Math.max(100, numeric * (String(raw).endsWith("ms") ? 1 : 1_000)));
  }
  const retryAt = Date.parse(raw);
  if (Number.isFinite(retryAt)) {
    return Math.min(20_000, Math.max(100, retryAt - Date.now()));
  }
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const toTextContent = (text) => [{ type: "text", text: String(text || "") }];

const conversationSteps = (history, userMessage) => [
  ...(Array.isArray(history) ? history : []).map((message) => ({
    type: message?.role === "assistant" ? "model_output" : "user_input",
    content: toTextContent(message?.content),
  })),
  { type: "user_input", content: toTextContent(userMessage) },
];

const normalizeTools = (tools) => (Array.isArray(tools) ? tools : []).map((tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
}));

const textFromSteps = (steps) => (Array.isArray(steps) ? steps : [])
  .filter((step) => step?.type === "model_output")
  .flatMap((step) => Array.isArray(step.content) ? step.content : [])
  .filter((content) => content?.type === "text" && typeof content.text === "string")
  .map((content) => content.text)
  .join("")
  .trim();

const interactionSummary = (interaction) => {
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : null;
  const toolCalls = steps
    ? steps.filter((step) => step?.type === "function_call")
    : [];
  const httpStatus = Number(interaction?.sdkHttpResponse?.status);

  return {
    http_status: Number.isInteger(httpStatus) ? httpStatus : undefined,
    response_id_present: typeof interaction?.id === "string" && Boolean(interaction.id.trim()),
    interaction_status: typeof interaction?.status === "string"
      ? interaction.status.toLowerCase()
      : undefined,
    steps_present: Boolean(steps),
    step_count: steps?.length,
    step_types: steps?.map((step) => String(step?.type || "").slice(0, 80)).filter(Boolean),
    output_text_present: typeof interaction?.output_text === "string"
      && Boolean(interaction.output_text.trim()),
    function_call_count: toolCalls.length,
  };
};

const serializeToolArguments = (value) => {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") return serialized;
  } catch {
    // The provider supplied an unusable tool payload; never evaluate it.
  }
  throw new OmsAiProviderError("OMS Assistant provider returned invalid tool arguments", {
    category: "provider_tool_protocol_error",
  });
};

const normalizeInteraction = (interaction) => {
  if (!interaction || typeof interaction !== "object") {
    throw new OmsAiProviderError("OMS Assistant provider returned an invalid response", {
      category: "provider_unrecognized_response",
    });
  }
  const id = typeof interaction.id === "string" ? interaction.id.trim() : "";
  const steps = Array.isArray(interaction.steps) ? interaction.steps : null;
  const status = String(interaction.status || "").toLowerCase();
  if (!steps || !["completed", "requires_action"].includes(status)) {
    throw new OmsAiProviderError("OMS Assistant provider returned an incomplete response", {
      category: "provider_unrecognized_response",
    });
  }

  const toolCalls = steps
    .filter((step) => step?.type === "function_call")
    .map((step) => ({
      id: typeof step.id === "string" ? step.id.trim() : "",
      name: typeof step.name === "string" ? step.name.trim() : "",
      arguments: serializeToolArguments(step.arguments),
    }));
  if (toolCalls.some((call) => !call.id)) {
    throw new OmsAiProviderError("OMS Assistant provider returned a tool call without an ID", {
      category: "provider_missing_tool_call_id",
    });
  }
  if (toolCalls.some((call) => !call.name)) {
    throw new OmsAiProviderError("OMS Assistant provider returned an invalid tool call", {
      category: "provider_tool_protocol_error",
    });
  }

  const text = String(interaction.output_text || textFromSteps(steps)).trim();
  if (!text && toolCalls.length === 0) {
    throw new OmsAiProviderError("OMS Assistant provider returned an empty response", {
      category: "provider_missing_text_and_tools",
    });
  }

  return {
    id,
    status: "completed",
    text,
    toolCalls,
    identifiers: [id, ...toolCalls.map((call) => call.id)].filter(Boolean),
    steps,
  };
};

const createOmsAiSession = ({
  apiKey,
  model,
  history = [],
  userMessage,
  aiClient = null,
} = {}) => {
  const client = aiClient || new GoogleGenAI({ apiKey });
  if (typeof client?.interactions?.create !== "function") {
    throw new OmsAiProviderError("OMS Assistant provider is not configured", {
      statusCode: 503,
      category: "provider_configuration",
    });
  }
  const input = conversationSteps(history, userMessage);

  const createTurn = async ({
    systemInstructions,
    tools = [],
    toolResults = [],
    signal,
    phase = "continuation",
    reasoningLevel = "high",
    toolChoice = tools.length ? "auto" : "none",
  } = {}) => {
    for (const result of toolResults) {
      input.push({
        type: "function_result",
        name: result.name,
        call_id: result.callId,
        result: toTextContent(JSON.stringify(result.result ?? null)),
      });
    }

    const request = {
      model,
      store: false,
      system_instruction: String(systemInstructions || ""),
      input: [...input],
      generation_config: {
        thinking_level: reasoningLevel,
        thinking_summaries: "none",
        tool_choice: toolChoice,
      },
      ...(tools.length ? { tools: normalizeTools(tools) } : {}),
    };
    const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    const startedAt = Date.now();

    for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      const attemptStartedAt = Date.now();
      logOmsChatEvent("provider.request_started", {
        provider: PROVIDER_NAME,
        model,
        phase,
        attempt: attempt + 1,
        request_bytes: requestBytes,
      });
      try {
        const interaction = await client.interactions.create(request, {
          signal,
          maxRetries: 0,
        });
        const summary = interactionSummary(interaction);
        logOmsChatEvent("provider.response_received", {
          provider: PROVIDER_NAME,
          model,
          phase,
          attempt: attempt + 1,
          ...summary,
        });
        const normalized = normalizeInteraction(interaction);
        input.push(...normalized.steps);
        logOmsChatEvent("provider.response_normalized", {
          provider: PROVIDER_NAME,
          model,
          phase,
          attempt: attempt + 1,
          response_id_present: Boolean(normalized.id),
          text_present: Boolean(normalized.text),
          tool_call_count: normalized.toolCalls.length,
        });
        if (normalized.toolCalls.length) {
          logOmsChatEvent("provider.tool_calls_detected", {
            provider: PROVIDER_NAME,
            model,
            phase,
            attempt: attempt + 1,
            tool_call_count: normalized.toolCalls.length,
          });
        }
        logOmsChatEvent("provider.request_completed", {
          provider: PROVIDER_NAME,
          model,
          phase,
          attempt: attempt + 1,
          duration_ms: Date.now() - startedAt,
          response_status: normalized.status,
          tool_call_count: normalized.toolCalls.length,
        });
        const { steps: _steps, ...publicTurn } = normalized;
        return publicTurn;
      } catch (error) {
        if (attempt < MAX_PROVIDER_ATTEMPTS - 1 && isRetryableProviderError(error, signal)) {
          const delayMs = retryAfterMs(error, attempt);
          warnOmsChatEvent("provider.request_retrying", {
            provider: PROVIDER_NAME,
            model,
            phase,
            attempt: attempt + 1,
            provider_status: providerStatus(error),
            retry_delay_ms: delayMs,
          });
          await sleep(delayMs);
          continue;
        }
        const safeError = toProviderError(error, signal);
        if (PROTOCOL_ERROR_CATEGORIES.has(safeError.category)) {
          logOmsChatError("provider.protocol_error", safeError, {
            provider: PROVIDER_NAME,
            model,
            phase,
            attempt: attempt + 1,
          });
        }
        logOmsChatError("provider.request_failed", safeError, {
          provider: PROVIDER_NAME,
          model,
          phase,
          attempt: attempt + 1,
          duration_ms: Date.now() - attemptStartedAt,
        });
        throw safeError;
      }
    }

    throw new OmsAiProviderError("OMS Assistant provider is unavailable");
  };

  return { createTurn };
};

module.exports = {
  DEFAULT_MODEL,
  OmsAiProviderError,
  PROVIDER_NAME,
  createOmsAiSession,
  getOmsAiConfiguration,
  __test__: {
    MAX_PROVIDER_ATTEMPTS,
    conversationSteps,
    isRetryableProviderError,
    normalizeInteraction,
    normalizeTools,
    interactionSummary,
    retryAfterMs,
    textFromSteps,
    toProviderError,
  },
};
