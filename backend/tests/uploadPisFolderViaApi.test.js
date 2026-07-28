const test = require("node:test");
const assert = require("node:assert/strict");

const {
  apiRequest,
  deriveIsaaFolderCode,
  evaluateIsaaCandidate,
} = require("../scripts/uploadPisFolderViaApi");

test("ISAA folder code validation only permits exact PIS article matches", () => {
  assert.equal(deriveIsaaFolderCode("86310_Pot Tasmania"), "86310");
  assert.equal(deriveIsaaFolderCode("old"), "");

  assert.deepEqual(
    evaluateIsaaCandidate({ folderCode: "86310", articleNumber: "86310" }),
    { upload: true, reason: "" },
  );
  assert.deepEqual(
    evaluateIsaaCandidate({ folderCode: "86310", articleNumber: "89310" }),
    {
      upload: false,
      reason: "PIS article number 89310 does not match folder code 86310",
    },
  );
});

test("retries transient GET lookup failures and reports their transport cause", async () => {
  let calls = 0;
  const payload = await apiRequest("http://example.test/items", {
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new TypeError("fetch failed");
        error.cause = { code: "ECONNRESET", message: "socket closed" };
        throw error;
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ data: [] }),
      };
    },
  });

  assert.equal(calls, 3);
  assert.deepEqual(payload, { data: [] });
});
