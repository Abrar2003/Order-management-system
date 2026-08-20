const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OmsAiProviderError,
  createOmsAiSession,
  getOmsAiConfiguration,
  __test__: providerInternals,
} = require("../services/omsAiProvider.service");

const finalInteraction = (text = "Done.", id = "interaction-final") => ({
  id,
  status: "completed",
  output_text: text,
  steps: [{
    type: "model_output",
    content: [{ type: "text", text }],
  }],
});

const toolInteraction = ({
  name = "query_oms_database",
  id = "call-1",
  arguments: args = { collection: "orders", pipeline: [{ $count: "total" }], purpose: "Count orders" },
} = {}) => ({
  id: `interaction-${id}`,
  status: "completed",
  steps: [{ type: "function_call", id, name, arguments: args }],
});

const fakeGemini = (...responses) => {
  const calls = [];
  return {
    calls,
    interactions: {
      async create(body, options) {
        calls.push({ body, options });
        assert.ok(responses.length, "unexpected Gemini interaction");
        const response = responses.shift();
        if (typeof response === "function") return response();
        return response;
      },
    },
  };
};

const createSession = (client) => createOmsAiSession({
  apiKey: "test-key-not-sent-anywhere",
  model: "gemini-test",
  history: [{ role: "assistant", content: "Earlier answer." }],
  userMessage: "Count open orders.",
  aiClient: client,
});

test("Gemini final text is normalized and every interaction disables storage", async () => {
  const client = fakeGemini(finalInteraction("There are 4 open orders."));
  const response = await createSession(client).createTurn({
    systemInstructions: "Use validated OMS evidence.",
    reasoningLevel: "high",
  });

  assert.equal(response.text, "There are 4 open orders.");
  assert.deepEqual(response.toolCalls, []);
  assert.equal(client.calls[0].body.store, false);
  assert.equal(client.calls[0].body.model, "gemini-test");
  assert.equal(client.calls[0].body.generation_config.thinking_level, "high");
  assert.equal(client.calls[0].body.generation_config.thinking_summaries, "none");
  assert.equal(client.calls[0].body.previous_interaction_id, undefined);
  assert.equal(client.calls[0].options.maxRetries, 0);
  assert.doesNotMatch(JSON.stringify(client.calls), /test-key-not-sent-anywhere/);
});

test("Gemini function calls are normalized without trusting their arguments", async () => {
  const client = fakeGemini(
    toolInteraction(),
    toolInteraction({ name: "unknown_tool", id: "unknown", arguments: "{ malformed" }),
  );
  const session = createSession(client);

  const valid = await session.createTurn({
    systemInstructions: "Use tools.",
    tools: [{
      name: "query_oms_database",
      description: "Read OMS data.",
      parameters: { type: "object" },
      strict: true,
    }],
  });
  assert.equal(valid.toolCalls[0].name, "query_oms_database");
  assert.match(valid.toolCalls[0].arguments, /"collection":"orders"/);
  assert.equal(client.calls[0].body.tools[0].strict, undefined);

  const untrusted = await session.createTurn({
    systemInstructions: "Use tools.",
    tools: [{ name: "query_oms_database", parameters: { type: "object" } }],
    toolResults: [{
      callId: "call-1",
      name: "query_oms_database",
      result: { rows: [{ total: 4 }], metadata: { returnedRows: 1 } },
    }],
  });
  assert.equal(untrusted.toolCalls[0].name, "unknown_tool");
  assert.equal(untrusted.toolCalls[0].arguments, "{ malformed");
});

test("Gemini accepts function-only turns without an interaction ID", async () => {
  const client = fakeGemini(
    {
      status: "requires_action",
      steps: [
        { type: "thought", signature: "opaque-thought-state" },
        {
          type: "function_call",
          id: "call-without-interaction-id",
          name: "query_oms_database",
          arguments: { collection: "orders", pipeline: [{ $count: "total" }], purpose: "Count orders" },
        },
      ],
    },
    {
      status: "completed",
      output_text: "There are 4 open orders.",
      steps: [{
        type: "model_output",
        content: [{ type: "text", text: "There are 4 open orders." }],
      }],
    },
  );
  const session = createSession(client);

  const first = await session.createTurn({
    systemInstructions: "Use tools.",
    tools: [{ name: "query_oms_database", parameters: { type: "object" } }],
  });
  const final = await session.createTurn({
    systemInstructions: "Use the result.",
    tools: [{ name: "query_oms_database", parameters: { type: "object" } }],
    toolResults: [{
      callId: first.toolCalls[0].id,
      name: first.toolCalls[0].name,
      result: { rows: [{ total: 4 }] },
    }],
  });

  assert.equal(first.id, "");
  assert.equal(first.text, "");
  assert.equal(first.toolCalls[0].id, "call-without-interaction-id");
  assert.equal(final.text, "There are 4 open orders.");
  assert.deepEqual(
    client.calls[1].body.input.slice(-3).map((step) => step.type),
    ["thought", "function_call", "function_result"],
  );
  assert.equal(client.calls[1].body.input.at(-1).call_id, "call-without-interaction-id");
  assert.equal(client.calls[1].body.previous_interaction_id, undefined);
});

test("Gemini preserves multiple and mixed text/function-call turns", async () => {
  const client = fakeGemini({
    status: "requires_action",
    output_text: "Checking both sources.",
    steps: [
      {
        type: "model_output",
        content: [{ type: "text", text: "Checking both sources." }],
      },
      { type: "function_call", id: "call-1", name: "inspect_oms_schema", arguments: { collections: ["orders"] } },
      { type: "function_call", id: "call-2", name: "query_oms_database", arguments: { collection: "orders" } },
    ],
  });

  const response = await createSession(client).createTurn({
    systemInstructions: "Use tools.",
    tools: [{ name: "query_oms_database", parameters: { type: "object" } }],
  });

  assert.equal(response.text, "Checking both sources.");
  assert.deepEqual(response.toolCalls.map((call) => call.id), ["call-1", "call-2"]);
  assert.deepEqual(response.toolCalls.map((call) => call.name), ["inspect_oms_schema", "query_oms_database"]);
});

test("stateless Gemini sessions preserve sequential calls and ordered function results", async () => {
  const client = fakeGemini(
    toolInteraction({ id: "query-call" }),
    toolInteraction({
      name: "analyze_oms_business_data",
      id: "forecast-call",
      arguments: { analysisType: "vendor_next_shipment_forecast", vendor: "Boranada" },
    }),
    finalInteraction("Boranada is forecast to be ready next month."),
  );
  const session = createSession(client);
  const first = await session.createTurn({
    systemInstructions: "Investigate.",
    tools: [{ name: "query_oms_database", parameters: { type: "object" } }],
  });
  const second = await session.createTurn({
    systemInstructions: "Continue.",
    tools: [{ name: "analyze_oms_business_data", parameters: { type: "object" } }],
    toolResults: [{ callId: first.toolCalls[0].id, name: first.toolCalls[0].name, result: { rows: [{ total: 2 }] } }],
  });
  const final = await session.createTurn({
    systemInstructions: "Finish.",
    tools: [{ name: "analyze_oms_business_data", parameters: { type: "object" } }],
    toolChoice: "none",
    toolResults: [{ callId: second.toolCalls[0].id, name: second.toolCalls[0].name, result: { planningDate: "2026-09-05" } }],
  });

  assert.equal(client.calls.length, 3);
  assert.deepEqual(
    client.calls[2].body.input.map((step) => step.type),
    [
      "model_output",
      "user_input",
      "function_call",
      "function_result",
      "function_call",
      "function_result",
    ],
  );
  assert.equal(client.calls[2].body.input[3].call_id, "query-call");
  assert.equal(client.calls[2].body.input[5].call_id, "forecast-call");
  assert.equal(client.calls[2].body.tools[0].name, "analyze_oms_business_data");
  assert.equal(client.calls[2].body.generation_config.tool_choice, "none");
  assert.equal(final.text, "Boranada is forecast to be ready next month.");
  assert.equal(client.calls.every((call) => call.body.store === false), true);
});

test("Gemini provider normalizes timeout, 429, and 5xx failures", async (t) => {
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const timeoutClient = fakeGemini(() => { throw abortError; });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => createSession(timeoutClient).createTurn({
      systemInstructions: "Test timeout.",
      signal: controller.signal,
    }),
    (error) => error instanceof OmsAiProviderError
      && error.category === "provider_timeout"
      && error.statusCode === 504,
  );

  for (const [status, category] of [[429, "provider_rate_limited"], [503, "provider_unavailable"]]) {
    const failure = () => {
      const error = new Error("upstream failure");
      error.status = status;
      error.headers = { get: () => "0ms" };
      throw error;
    };
    const client = fakeGemini(failure, failure, failure);
    await assert.rejects(
      () => createSession(client).createTurn({ systemInstructions: "Retry safely." }),
      (error) => error instanceof OmsAiProviderError
        && error.category === category
        && error.providerStatus === status,
    );
    assert.equal(client.calls.length, 3);
  }
});

test("Gemini retries missing Retry-After headers with bounded backoff", () => {
  assert.equal(providerInternals.retryAfterMs({}, 0), 2_000);
  assert.equal(providerInternals.retryAfterMs({}, 1), 8_000);
  assert.equal(
    providerInternals.retryAfterMs({ headers: { "retry-after": "250ms" } }, 0),
    250,
  );
});

test("Gemini provider rejects malformed protocol responses without retrying", async () => {
  for (const [response, category] of [
    [null, "provider_unrecognized_response"],
    [{ id: "empty", status: "completed", steps: [] }, "provider_missing_text_and_tools"],
    [{ id: "incomplete", status: "incomplete", steps: [{ type: "model_output", content: [{ type: "text", text: "partial" }] }] }, "provider_unrecognized_response"],
    [{ id: "missing-steps", status: "completed", output_text: "text" }, "provider_unrecognized_response"],
    [{ status: "requires_action", steps: [{ type: "function_call", name: "query_oms_database", arguments: {} }] }, "provider_missing_tool_call_id"],
  ]) {
    const client = fakeGemini(response);
    await assert.rejects(
      () => createSession(client).createTurn({ systemInstructions: "Validate." }),
      (error) => error instanceof OmsAiProviderError
        && error.category === category,
    );
    assert.equal(client.calls.length, 1);
  }
});

test("Gemini configuration is backend-only and defaults to Gemini 3.7 Flash", (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.OMS_CHAT_LLM_MODEL;
  t.after(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OMS_CHAT_LLM_MODEL;
    else process.env.OMS_CHAT_LLM_MODEL = originalModel;
  });

  process.env.GEMINI_API_KEY = "configured-in-backend";
  delete process.env.OMS_CHAT_LLM_MODEL;
  assert.deepEqual(getOmsAiConfiguration(), {
    apiKey: "configured-in-backend",
    model: "gemini-3.7-flash",
    provider: "gemini",
  });

  delete process.env.GEMINI_API_KEY;
  assert.throws(
    () => getOmsAiConfiguration(),
    (error) => error instanceof OmsAiProviderError
      && error.category === "provider_configuration",
  );
});
