// node tests/eudrAllocation.integration.js /path/to/mongod
// Starts its own loopback-only replica set; never uses MONGO_URI or the OMS database.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const mongoose = require("mongoose");
const EudrChain = require("../models/eudrChain.model");
const allocation = require("../services/eudrAllocation.service");

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const vendor = "aaaaaaaaaaaaaaaaaaaaaaaa";

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "oms-eudr-allocation-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const mongod = spawn(process.argv[2] || "mongod", ["--dbpath", temporary, "--port", String(port), "--bind_ip", "127.0.0.1", "--replSet", "eudr-test", "--logpath", path.join(temporary, "mongod.log")], { windowsHide: true, stdio: "ignore" });
  let spawnError; mongod.on("error", (error) => { spawnError = error; });
  const bootstrap = new mongoose.mongo.MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      if (spawnError) throw spawnError;
      if (mongod.exitCode != null) throw new Error(`Test mongod exited with ${mongod.exitCode}`);
      try { await bootstrap.connect(); break; }
      catch (error) { if (Date.now() > deadline) throw error; await pause(); }
    }
    const admin = bootstrap.db("admin");
    assert.equal((await admin.command({ serverStatus: 1 })).pid, mongod.pid);
    await admin.command({ replSetInitiate: { _id: "eudr-test", members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    while (!(await admin.command({ hello: 1 })).isWritablePrimary) {
      if (Date.now() > deadline) throw new Error("Test replica set did not elect a primary");
      await pause();
    }
    mongoose.set("transactionAsyncLocalStorage", true);
    await mongoose.connect(`mongodb://127.0.0.1:${port}/eudr_allocation_test?replicaSet=eudr-test`);
    await EudrChain.init();
    await EudrChain.collection.createIndex({ container_key: 1, vendor: 1 }, { unique: true });
    await allocation.ensureIndexes();
    const indexes = await EudrChain.collection.indexes();
    assert.ok(!indexes.some((index) => index.name === "container_key_1_vendor_1"));
    assert.ok(indexes.some((index) => index.name === "invoice_keys_1" && index.unique));

    const allocate = (container, contribution) => allocation.withAllocation(container, vendor, async (chains, session) => {
      allocation.assertAllocation(chains, contribution, 10000);
      const chain = new EudrChain({ container, container_key: container, vendor, declared_milli_cft: 10000, contribution_milli_cft: contribution });
      await chain.save({ session }); return chain;
    });
    await allocate("split", 6000); await allocate("split", 4000);
    await assert.rejects(() => allocate("split", 1), (error) => error.statusCode === 409);
    assert.equal(await EudrChain.countDocuments({ container_key: "split", invoice_keys: { $exists: false } }), 2);

    const concurrent = await Promise.allSettled(Array.from({ length: 12 }, () => allocate("concurrent", 2000)));
    const saved = await EudrChain.find({ container_key: "concurrent" }).lean();
    assert.equal(saved.length, 5); assert.equal(saved.reduce((sum, chain) => sum + chain.contribution_milli_cft, 0), 10000);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 5);
    for (const result of concurrent.filter((result) => result.status === "rejected")) assert.ok(result.reason.statusCode === 409 || result.reason.code === 11000);

    const first = await EudrChain.findOne({ container_key: "split" });
    first.invoice_keys = ["GST|2026|INV1"]; await first.save();
    const second = await EudrChain.findOne({ container_key: "split", _id: { $ne: first._id } });
    second.invoice_keys = ["GST|2026|INV1"];
    await assert.rejects(() => second.save(), (error) => error.code === 11000);
    second.invoice_keys = ["OTHER-GST|2026|INV1", "GST|2025|INV1"]; await second.save();

    await assert.rejects(() => allocation.withAllocation("split", vendor, async (chains, session) => {
      chains[0].contribution_milli_cft = 1; await chains[0].save({ session }); throw new Error("rollback check");
    }), /rollback check/);
    assert.equal((await EudrChain.find({ container_key: "split" })).reduce((sum, chain) => sum + chain.contribution_milli_cft, 0), 10000);
    console.log("EUDR MongoDB checks passed: index upgrade, multiple empty drafts, 12 competing allocations, exact capacity, invoice collisions, and transaction rollback.");
  } finally {
    await mongoose.disconnect(); await bootstrap.close();
    if (mongod.exitCode == null && !spawnError) {
      const exited = new Promise((resolve) => mongod.once("exit", resolve)); mongod.kill(); await exited;
    }
    assert.equal(path.dirname(temporary), os.tmpdir());
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
