const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_LABEL_STORAGE_STATE,
  LabelStorageService,
} = require("../services/labels/labelStorage.service");

const createService = ({ state = null, legacyRead, modernRead } = {}) => {
  const events = [];
  const failures = [];
  const service = new LabelStorageService({
    storageStateModel: {
      findOne: () => ({ lean: async () => state }),
    },
    syncFailureModel: {
      create: async (failure) => failures.push(failure),
    },
    legacy: {
      getAllottedLabels: async () => {
        events.push("legacy:read");
        return legacyRead ?? [1];
      },
    },
    modern: {
      getAllottedLabels: async () => {
        events.push("modern:read");
        if (modernRead instanceof Error) throw modernRead;
        return modernRead ?? [2];
      },
    },
    logger: { error: () => {} },
  });
  return { events, failures, service };
};

test("missing storage state defaults reads and writes to legacy", async () => {
  const { events, service } = createService();

  assert.deepEqual(await service.getState("inspector-1"), DEFAULT_LABEL_STORAGE_STATE);
  assert.deepEqual(await service.getAllottedLabels("inspector-1"), [1]);
  const result = await service.write("inspector-1", "allocate", {
    legacyWrite: async () => {
      events.push("legacy:write");
      return "legacy result";
    },
    modernWrite: async () => events.push("modern:write"),
  });

  assert.equal(result, "legacy result");
  assert.deepEqual(events, ["legacy:read", "legacy:write"]);
});

for (const migrationStatus of ["legacy", "backfilling", "backfilled", "verifying"] ) {
  test(`${migrationStatus} state cannot read modern data`, async () => {
    const { events, service } = createService({
      state: {
        migration_status: migrationStatus,
        read_source: migrationStatus === "legacy" ? "legacy" : "modern",
      },
    });

    assert.deepEqual(await service.getAllottedLabels("inspector-1"), [1]);
    assert.deepEqual(events, ["legacy:read"]);
  });
}

test("verified modern reads accept an empty result without fallback", async () => {
  const { events, service } = createService({
    state: {
      migration_status: "verified",
      read_source: "modern",
      legacy_fallback_enabled: true,
    },
    modernRead: [],
  });

  assert.deepEqual(await service.getAllottedLabels("inspector-1"), []);
  assert.deepEqual(events, ["modern:read"]);
});

test("schema version 1 state cannot read the corrected modern model", async () => {
  const { events, service } = createService({
    state: {
      schema_version: 1,
      migration_status: "verified",
      read_source: "modern",
    },
  });

  assert.deepEqual(await service.getAllottedLabels("inspector-1"), [1]);
  assert.deepEqual(events, ["legacy:read"]);
});

test("modern read failures use legacy only when fallback is enabled", async () => {
  const { events, service } = createService({
    state: {
      migration_status: "modern",
      read_source: "modern",
      legacy_fallback_enabled: true,
    },
    legacyRead: [9],
    modernRead: new Error("modern unavailable"),
  });

  assert.deepEqual(await service.getAllottedLabels("inspector-1"), [9]);
  assert.deepEqual(events, ["modern:read", "legacy:read"]);
});

test("modern read failures propagate when fallback is disabled", async () => {
  const { events, service } = createService({
    state: {
      migration_status: "verified",
      read_source: "modern",
      legacy_fallback_enabled: false,
    },
    modernRead: new Error("modern unavailable"),
  });

  await assert.rejects(
    service.getAllottedLabels("inspector-1"),
    /modern unavailable/,
  );
  assert.deepEqual(events, ["modern:read"]);
});

test("explicit legacy write mode calls only legacy", async () => {
  const { events, service } = createService({
    state: { write_mode: "legacy" },
  });
  const result = await service.write("inspector-1", "reject", {
    legacyWrite: async () => {
      events.push("legacy:write");
      return "ok";
    },
    modernWrite: async () => events.push("modern:write"),
  });

  assert.equal(result, "ok");
  assert.deepEqual(events, ["legacy:write"]);
});

test("dual writes run legacy first and return its result", async () => {
  const { events, service } = createService({ state: { write_mode: "dual" } });
  const result = await service.write("inspector-1", "allocate", {
    legacyWrite: async () => {
      events.push("legacy:write");
      return "legacy result";
    },
    modernWrite: async () => events.push("modern:write"),
  });

  assert.equal(result, "legacy result");
  assert.deepEqual(events, ["legacy:write", "modern:write"]);
});

test("dual write records a failed modern mirror without failing legacy", async () => {
  const { events, failures, service } = createService({
    state: { write_mode: "dual" },
  });
  const result = await service.write("inspector-1", "transfer", {
    legacyWrite: async () => {
      events.push("legacy:write");
      return "legacy result";
    },
    modernWrite: async () => {
      events.push("modern:write");
      throw new Error("mirror failed");
    },
    payload: { labels: [10] },
  });

  assert.equal(result, "legacy result");
  assert.deepEqual(events, ["legacy:write", "modern:write"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].operation, "transfer");
  assert.deepEqual(failures[0].payload, { labels: [10] });
});

test("dual write stops when the authoritative legacy write fails", async () => {
  const { events, failures, service } = createService({
    state: { write_mode: "dual" },
  });

  await assert.rejects(
    service.write("inspector-1", "allocate", {
      legacyWrite: async () => {
        events.push("legacy:write");
        throw new Error("legacy failed");
      },
      modernWrite: async () => events.push("modern:write"),
    }),
    /legacy failed/,
  );
  assert.deepEqual(events, ["legacy:write"]);
  assert.equal(failures.length, 0);
});

test("modern write mode calls only modern", async () => {
  const { events, service } = createService({ state: { write_mode: "modern" } });
  const result = await service.write("inspector-1", "allocate", {
    legacyWrite: async () => events.push("legacy:write"),
    modernWrite: async () => {
      events.push("modern:write");
      return "modern result";
    },
  });

  assert.equal(result, "modern result");
  assert.deepEqual(events, ["modern:write"]);
});
