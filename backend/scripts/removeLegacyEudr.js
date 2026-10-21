// Manual maintenance only: never loaded by application startup or deployment.
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { parseArgs } = require("node:util");
const { MongoClient } = require("mongoose").mongo;

const COLLECTIONS = Object.freeze([
  "eudr_allocations", "eudr_chains", "eudr_parties", "eudr_documents",
  "eudr_invoices", "eudr_source_batches", "eudr_timber_lots", "eudr_timber_transfers",
  "eudr_timber_mixes", "eudr_timber_commitments", "eudr_inventory_audit",
  "eudr_migration_reviews", "eudr_inventory_state", "eudr_rules", "eudr_plots",
  "eudr_production_proof_ownership", "eudr_report_submissions", "eudr_login_codes",
  "eudr_source_changes", "eudr_plugin_ownership", "eudr_bridge_state",
]);
const FIELDS = Object.freeze({
  items: ["eudr_review_fence"], samples: ["eudr_review_fence"],
  orders: ["eudr_review_fence"], vendors: ["eudr_review_fence", "gst_snapshot"],
});
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
async function hashFile(file) {
  assert.ok((await fs.stat(file)).size > 0, "Database backup archive is empty");
  const hash = crypto.createHash("sha256");
  for await (const chunk of require("node:fs").createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const fieldQuery = fields => ({ $or: fields.map(field => ({ [field]: { $exists: true } })) });

async function inspectDatabase(db, target) {
  const existing = await db.listCollections({}, { nameOnly: false }).toArray();
  const collections = [];
  const fields = [];
  for (const name of COLLECTIONS) {
    const info = existing.find(row => row.name === name);
    if (!info) continue;
    assert.equal(info.type, "collection", "Cleanup targets must be ordinary collections");
    collections.push({ name, uuid: info.info?.uuid?.toString("base64") || null,
      documents: await db.collection(name).countDocuments(),
      indexes: await db.collection(name).listIndexes().toArray() });
  }
  for (const [name, names] of Object.entries(FIELDS)) {
    if (!existing.some(row => row.name === name)) continue;
    fields.push({ collection: name, names,
      documents: await db.collection(name).countDocuments(fieldQuery(names)) });
  }
  return { version: 1, database: db.databaseName, target, collections, fields,
    unclassified: existing.map(row => row.name).filter(name => /^eudr_/i.test(name) && name !== "eudr_species" && !COLLECTIONS.includes(name)).sort(),
    retained: ["eudr_species", "all other collections and fields", "all object-storage files"] };
}

async function applyCleanup(db, manifest, target) {
  // Recompute the exact allowlist so a modified/stale manifest cannot expand deletion scope.
  assert.deepEqual(manifest, await inspectDatabase(db, target), "Manifest changed; generate and review it again");
  for (const { name } of manifest.collections) await db.collection(name).drop();
  for (const { collection, names, documents } of manifest.fields) {
    if (documents) await db.collection(collection).updateMany(fieldQuery(names), {
      $unset: Object.fromEntries(names.map(name => [name, ""])),
    });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    database: { type: "string" }, manifest: { type: "string" }, apply: { type: "boolean" },
    "approved-manifest-sha256": { type: "string" }, backup: { type: "string" },
    "backup-sha256": { type: "string" }, "backup-restore-verified": { type: "boolean" },
  } });
  assert.ok(values.database && values.manifest && process.env.LEGACY_EUDR_CLEANUP_URI,
    "Provide --database, --manifest and LEGACY_EUDR_CLEANUP_URI (no application env is loaded)");
  let manifest;
  if (values.apply) {
    assert.ok(process.stdin.isTTY && process.stdout.isTTY, "Apply requires an interactive terminal and execution-time approval");
    assert.ok(values.backup && values["backup-restore-verified"], "A separately restore-verified database archive is required");
    assert.equal(await hashFile(values.backup), values["backup-sha256"], "Database backup checksum does not match");
    const reviewed = await fs.readFile(values.manifest);
    assert.equal(sha256(reviewed), values["approved-manifest-sha256"], "Reviewed manifest checksum does not match");
    manifest = JSON.parse(reviewed);
    assert.equal(manifest.database, values.database, "Manifest database does not match");
  }
  const client = new MongoClient(process.env.LEGACY_EUDR_CLEANUP_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(values.database);
    assert.ok(!["admin", "local", "config"].includes(db.databaseName), "System databases are forbidden");
    const target = sha256(JSON.stringify(client.options.hosts.map(host => host.toString()).sort()));
    if (!values.apply) {
      const output = JSON.stringify(await inspectDatabase(db, target), null, 2) + "\n";
      await fs.writeFile(values.manifest, output, { flag: "wx" });
      console.log("Read-only manifest written. SHA256:", sha256(output));
      return;
    }
    assert.deepEqual(manifest, await inspectDatabase(db, target), "Manifest changed; generate and review it again");
    const prompt = require("node:readline/promises").createInterface({ input: process.stdin, output: process.stdout });
    try {
      const phrase = `REMOVE LEGACY EUDR FROM ${db.databaseName}`;
      assert.equal(await prompt.question(`Stop all database writers before continuing. Type ${phrase}: `), phrase,
        "Execution-time approval was not given");
    } finally { prompt.close(); }
    await applyCleanup(db, manifest, target);
    console.log("Legacy cleanup finished. OMS records, product metadata and species were preserved.");
  } finally { await client.close(); }
}

if (require.main === module) main().catch(error => {
  // Driver errors may contain connection details; never log their messages or the URI.
  console.error(error instanceof assert.AssertionError ? error.message.split("\n")[0] : "Cleanup failed; inspect database diagnostics privately.");
  process.exitCode = 1;
});
module.exports = { COLLECTIONS, FIELDS, inspectDatabase, applyCleanup };
