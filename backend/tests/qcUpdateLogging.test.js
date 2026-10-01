const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  __test__: { appendQcUpdateLog, buildQcUpdateMetadata, isQcUpdateRequest },
} = require("../middlewares/securityActivityLogger");

test("records a failed QC update with its payload, timing, and exact response", () => {
  const receivedAt = new Date("2026-10-01T10:00:00.000Z");
  const completedAt = new Date("2026-10-01T10:00:01.250Z");
  const req = {
    method: "PATCH",
    originalUrl: "/qc/update-qc/qc-1",
    route: { path: "/update-qc/:id" },
    params: { id: "qc-1" },
    query: { force: "true" },
    body: { qc_passed: 3 },
  };
  const metadata = buildQcUpdateMetadata({
    req,
    res: {
      statusCode: 400,
      locals: { requestError: { name: "Error", message: "Passed exceeds checked" } },
    },
    receivedAt,
    completedAt,
    responseBody: { message: "Passed exceeds checked" },
  });

  assert.equal(isQcUpdateRequest(req), true);
  assert.equal(metadata.outcome, "failed");
  assert.equal(metadata.duration_ms, 1250);
  assert.deepEqual(metadata.payload.body, { qc_passed: 3 });
  assert.equal(metadata.failure.response.message, "Passed exceeds checked");
  assert.equal(metadata.failure.error.message, "Passed exceeds checked");
});

test("records a disconnected QC update as an aborted failure", () => {
  const metadata = buildQcUpdateMetadata({
    req: { method: "PATCH", originalUrl: "/qc/update-qc/qc-1" },
    res: { statusCode: 200, locals: {} },
    receivedAt: new Date("2026-10-01T10:00:00.000Z"),
    completedAt: new Date("2026-10-01T10:00:00.100Z"),
    terminalState: "aborted",
  });

  assert.equal(metadata.outcome, "aborted");
  assert.equal(metadata.failure.error.code, "CLIENT_ABORTED");
});

test("appends each QC lifecycle record as one JSON log line", async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qc-update-log-"));
  const logFile = path.join(directory, "qc-updates.log");
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));

  await appendQcUpdateLog({ outcome: "completed", qc_id: "qc-1" }, logFile);

  assert.deepEqual(
    JSON.parse(await fs.promises.readFile(logFile, "utf8")),
    { outcome: "completed", qc_id: "qc-1" },
  );
});
