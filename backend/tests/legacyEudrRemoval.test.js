const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { COLLECTIONS, FIELDS, inspectDatabase, applyCleanup } = require("../scripts/removeLegacyEudr");
const { applyMetadata, composition, hsCode } = require("../helpers/timberSpecies");

test("cleanup rejects extra collections and fields and preserves business data", async () => {
  const mutations = [];
  const db = { databaseName: "isolated_test",
    listCollections: () => ({ toArray: async () => ["items", "orders", "vendors", "eudr_chains", "eudr_species", "eudr_unknown"].map(name => ({ name, type: "collection" })) }),
    collection: name => ({ countDocuments: async () => 1, listIndexes: () => ({ toArray: async () => [{ key: { _id: 1 }, name: "_id_" }] }),
      drop: async () => mutations.push(["drop", name]), updateMany: async (...args) => mutations.push(["update", name, ...args]) }),
  };
  const manifest = await inspectDatabase(db, "test-target");
  for (const altered of [
    { ...manifest, collections: [...manifest.collections, { name: "orders" }] },
    { ...manifest, fields: [{ collection: "items", names: ["hs_code"] }] },
    { ...manifest, target: "another-host" },
    { ...manifest, collections: manifest.collections.map(row => ({ ...row, documents: 2 })) },
  ]) await assert.rejects(applyCleanup(db, altered, "test-target"));
  assert.deepEqual(mutations, []);
  await applyCleanup(db, manifest, "test-target");
  assert.deepEqual(mutations.filter(row => row[0] === "drop"), [["drop", "eudr_chains"]]);
  for (const [, name, query, update] of mutations.filter(row => row[0] === "update")) {
    assert.deepEqual(Object.keys(update.$unset), FIELDS[name]);
    assert.deepEqual(query.$or.map(row => Object.keys(row)[0]), FIELDS[name]);
  }
  assert.ok(!COLLECTIONS.includes("eudr_species"));
});

test("shared metadata validates and records timber changes without an EUDR database", async () => {
  const species = "507f1f77bcf86cd799439011";
  const record = { timber_cft: 2 };
  await applyMetadata(record, { hs_code: "9403 60", species_composition: [{ species, share_bp: 10000 }] }, {}, 1);
  assert.equal(record.hs_code, "940360");
  assert.deepEqual(record.species_composition, [{ species, share_bp: 10000 }]);
  assert.deepEqual([record.timber_cft_history[0].from, record.timber_cft_history[0].to], [1, 2]);
  assert.throws(() => hsCode("bad"));
  assert.throws(() => composition([{ species, share_bp: 9999 }]));
  assert.throws(() => composition([{ species: "invalid", share_bp: 10000 }]));
  assert.throws(() => composition([null]), { code: "COMPOSITION_INVALID" });
});

test("destructive CLI refuses noninteractive execution before connecting", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/removeLegacyEudr.js"),
    "--database", "test", "--manifest", "not-read.json", "--apply"], { encoding: "utf8", windowsHide: true,
    env: { ...process.env, LEGACY_EUDR_CLEANUP_URI: "mongodb://unused:never-log-this@127.0.0.1:1/test" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
  assert.doesNotMatch(result.stderr, /never-log-this/);
});

test("active backend and frontend have no legacy imports, endpoints or flags", () => {
  for (const folder of ["controllers", "models", "services", "routers", "middlewares", "helpers", "config", "queues", "workers", "realtime", "knowledge"]) {
    for (const entry of fs.readdirSync(path.join(__dirname, "..", folder), { recursive: true })) {
      const file = path.join(__dirname, "..", folder, entry);
      if (fs.statSync(file).isFile() && /\.(js|cjs)$/.test(file)) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /eudr|timber.?trace/i, file);
    }
  }
  const root = path.join(__dirname, "../../client/OMS/src");
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, entry);
    if (fs.statSync(file).isFile() && /\.(jsx?|css)$/.test(file)) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /eudr|timber.?trace/i, file);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../index.js"), "utf8"), /eudr|timber.?trace/i);
  for (const file of ["item", "sample", "order", "vendor"]) {
    const model = require(`../models/${file}.model`);
    assert.equal(model.$eudrSourceWrites, undefined);
    assert.equal(model.schema.path("eudr_review_fence"), undefined);
  }
});
