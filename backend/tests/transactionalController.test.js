const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runTransactionalController,
} = require("../helpers/transactionalController");

const createResponse = () => {
  const state = {
    statusCode: 200,
    body: undefined,
    ended: false,
  };

  const res = {
    status(statusCode) {
      state.statusCode = statusCode;
      return this;
    },
    json(body) {
      state.body = body;
      return this;
    },
    end() {
      state.ended = true;
      return this;
    },
  };

  return { res, state };
};

test("commits before sending a successful controller response", async () => {
  const events = [];
  const connection = {
    async transaction(callback) {
      events.push("transaction:start");
      await callback();
      events.push("transaction:commit");
    },
  };
  const { res, state } = createResponse();
  const originalJson = res.json;
  res.json = function json(body) {
    events.push("response:json");
    return originalJson.call(this, body);
  };

  await runTransactionalController({
    connection,
    req: { method: "PATCH", originalUrl: "/qc/update-qc/1" },
    res,
    handler: async (_req, deferredRes) => {
      events.push("controller:start");
      deferredRes.json({ ok: true });
      events.push("controller:end");
    },
  });

  assert.deepEqual(events, [
    "transaction:start",
    "controller:start",
    "controller:end",
    "transaction:commit",
    "response:json",
  ]);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { ok: true });
});

test("rolls back and preserves an expected controller error response", async () => {
  let committed = false;
  let rolledBack = false;
  const connection = {
    async transaction(callback) {
      try {
        await callback();
        committed = true;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  };
  const { res, state } = createResponse();

  await runTransactionalController({
    connection,
    req: { method: "PATCH", originalUrl: "/qc/update-qc/1" },
    res,
    handler: async (_req, deferredRes) => {
      deferredRes.status(400).json({ message: "Invalid update" });
    },
  });

  assert.equal(committed, false);
  assert.equal(rolledBack, true);
  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.body, { message: "Invalid update" });
});

test("returns a safe error when transaction commit fails", async () => {
  const connection = {
    async transaction(callback) {
      await callback();
      throw new Error("commit failed");
    },
  };
  const { res, state } = createResponse();

  await runTransactionalController({
    connection,
    req: { method: "PATCH", originalUrl: "/qc/update-qc/1" },
    res,
    handler: async (_req, deferredRes) => {
      deferredRes.json({ ok: true });
    },
  });

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, {
    message: "The QC update could not be completed. No changes were saved.",
  });
});

test("retries the whole transaction once after a version conflict", async () => {
  let attempts = 0;
  const connection = {
    async transaction(callback) {
      attempts += 1;
      await callback();
      if (attempts === 1) {
        const error = new Error("stale document");
        error.name = "VersionError";
        throw error;
      }
    },
  };
  const { res, state } = createResponse();

  await runTransactionalController({
    connection,
    req: { method: "PATCH", originalUrl: "/qc/update-qc/1" },
    res,
    handler: async (_req, deferredRes) => {
      deferredRes.json({ ok: true });
    },
  });

  assert.equal(attempts, 2);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body, { ok: true });
});
