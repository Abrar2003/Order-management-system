import assert from "node:assert/strict";
import test from "node:test";
import {
  createOmsAssistantState,
  omsAssistantReducer,
} from "./omsAssistantState.js";

test("OMS Assistant state covers submit, success, and error", () => {
  const loading = omsAssistantReducer(createOmsAssistantState(), {
    type: "submit",
    payload: { id: "user-1", message: "How many orders are delayed?" },
  });

  assert.equal(loading.status, "loading");
  assert.equal(loading.messages[0].role, "user");

  const success = omsAssistantReducer(loading, {
    type: "success",
    payload: {
      id: "assistant-1",
      answer: "There are 4 delayed orders.",
      conversationId: "conversation-1",
      metadata: { returnedRows: 1 },
      rows: [{ count: 4 }],
    },
  });

  assert.equal(success.status, "success");
  assert.equal(success.conversationId, "conversation-1");
  assert.equal(success.messages[1].text, "There are 4 delayed orders.");
  assert.deepEqual(success.messages[1].rows, [{ count: 4 }]);

  const failure = omsAssistantReducer(loading, {
    type: "error",
    payload: { message: "The assistant is temporarily unavailable." },
  });

  assert.equal(failure.status, "error");
  assert.equal(failure.messages.length, 1);
  assert.equal(failure.error, "The assistant is temporarily unavailable.");
});
