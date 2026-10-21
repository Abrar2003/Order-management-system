const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const os = require("node:os");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const replicaSet = require("./helpers/labelReplicaSet");
const { inspectDatabase, applyCleanup } = require("../scripts/removeLegacyEudr");

// This helper starts its own loopback MongoDB; application connection strings are never used.
test("OMS starts, authenticates and writes source records without legacy EUDR", { timeout: 60000 }, async t => {
  const replica = await replicaSet();
  t.after(replica.close);
  const db = mongoose.connection.db;
  const userId = new mongoose.Types.ObjectId();
  await db.collection("users").insertOne({ _id: userId, username: "cleanup-test", name: "Cleanup Test",
    email: "cleanup@example.invalid", role: "super_admin", allowed_brands: [], allowed_vendors: ["all"],
    password: await bcrypt.hash("test-only-password", 4) });
  await db.collection("brands").insertOne({ name: "Giga", vendors: [] });
  const species = new mongoose.Types.ObjectId();
  await db.collection("eudr_species").insertOne({ _id: species, name: "Preserved species" });
  await db.collection("items").insertOne({ code: "CLEANUP-1", name: "Chair", brand: "Giga", barcode_exempted: true,
    timber_cft: 1, hs_code: "940360", species_composition: [{ species, share_bp: 10000 }], eudr_review_fence: 2 });
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const host = mongoose.connection.getClient().options.hosts[0].toString();
  const server = spawn(process.execPath, [path.join(__dirname, "../index.js")], { windowsHide: true,
    cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
      NODE_ENV: "test", PORT: String(port), MONGO_URI: `mongodb://${host}/${db.databaseName}?replicaSet=ledger-test`,
      JWT_SECRET: "isolated-cleanup-test-secret", JWT_REFRESH_SECRET: "isolated-cleanup-refresh-secret",
      AUTH_COOKIE_SECURE: "false", AUTH_COOKIE_DOMAIN: "", REDIS_JOBS_ENABLED: "false", REDIS_CACHE_ENABLED: "false",
      FORCE_PUBLIC_DNS: "false", MONGO_DNS_SERVERS: "", OMS_CHAT_MONGO_URI: "",
      GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REFRESH_TOKEN: "",
    } });
  let logs = "";
  server.stdout.on("data", chunk => { logs += chunk; });
  server.stderr.on("data", chunk => { logs += chunk; });
  t.after(async () => { if (server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; } });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    assert.equal(server.exitCode, null, logs);
    try { if ((await fetch(base + "/healthz")).ok) break; } catch {}
    assert.ok(Date.now() < deadline, logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let cookies = "";
  const request = async (method, route, body, expected = 200) => {
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", Cookie: cookies },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${route}: ${text}`);
    return { response, data: text.startsWith("{") ? JSON.parse(text) : text };
  };
  const login = await request("POST", "/auth/signin", { username: "cleanup-test", password: "test-only-password" });
  cookies = login.response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.equal((await request("GET", "/auth/me")).data.user.username, "cleanup-test");
  const vendorPayload = { name: "Cleanup Vendor", country: "India", gst: "08AADCB3689G1ZH", pan: "AADCB3689G",
    vendor_code: [{ brand: "Giga", code: "CL" }] };
  const vendor = (await request("POST", "/vendors", vendorPayload, 201)).data.data;
  await request("PUT", `/vendors/${vendor._id}`, { ...vendorPayload, phone: "1234567890" });
  const item = await db.collection("items").findOne({ code: "CLEANUP-1" });
  await request("PATCH", `/items/${item._id}/pis`, { timber_cft: 2, hs_code: "9403 60" });
  await request("POST", "/orders/manual-orders", { po: { order_id: "CLEANUP-PO", brand: "Giga", vendor: vendor.name,
    order_date: "2026-10-01", ETD: "2026-11-01" }, items: [{ item_code: "CLEANUP-1", description: "Chair", quantity: 10 }] }, 201);
  const order = await db.collection("orders").findOne({ order_id: "CLEANUP-PO" });
  assert.ok(order);
  await require("../models/qc.model").create({ order: order._id, order_meta: { order_id: order.order_id,
    brand: order.brand, vendor: order.vendor }, item: order.item, request_date: "2026-10-20",
    last_inspected_date: "2026-10-21", quantities: { client_demand: 10, qc_passed: 10 }, createdBy: userId });
  await request("PATCH", `/orders/edit-order/${order._id}`, { description: "Updated chair", shipment: [{
    quantity: 2, container: "CLEANUP-C1", invoice_number: "CLEANUP-INV", stuffing_date: "2026-10-21",
    stuffed_by: { id: String(userId), name: "Cleanup Test" },
  }] });
  const sample = (await request("POST", "/samples", { code: "CLEANUP-S1", name: "Sample chair", brand: "Giga",
    vendor: [vendor.name], timber_cft: 1, hs_code: "940360" }, 201)).data.data;
  await request("PATCH", `/samples/${sample._id}`, { name: "Updated sample", timber_cft: 2 });
  for (const route of ["/vendors", "/orders/containers", "/orders/shipments", "/orders/packed-goods", "/qc/list",
    "/brands", "/orders/today-etd-orders", "/orders/Giga/vendor-summary", "/reports/daily-shipments?stuffing_date=2026-10-21"]) await request("GET", route);
  for (const route of ["/eudr", "/eudr/capabilities", "/eudr/species", "/integrations/eudr/launch", "/integrations/eudr/changes"]) await request("GET", route, null, 404);
  await request("POST", "/integrations/eudr/redeem", {}, 404);
  assert.doesNotMatch(logs, /EUDR|source watcher/);
  assert.equal((await db.listCollections().toArray()).some(row => row.name === "eudr_inventory_state"), false);

  await db.collection("eudr_chains").insertOne({ container: "CLEANUP-C1" });
  await db.collection("eudr_chains").createIndex({ container: 1 });
  const before = await db.collection("items").findOne({ _id: item._id });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oms-cleanup-manifest-"));
  const manifestFile = path.join(directory, "manifest.json");
  t.after(async () => { await fs.rm(manifestFile, { force: true }); await fs.rmdir(directory); });
  await promisify(execFile)(process.execPath, [path.join(__dirname, "../scripts/removeLegacyEudr.js"),
    "--database", db.databaseName, "--manifest", manifestFile], { windowsHide: true, env: { ...process.env,
      LEGACY_EUDR_CLEANUP_URI: `mongodb://${host}/${db.databaseName}?replicaSet=ledger-test` } });
  assert.equal(await db.collection("eudr_chains").countDocuments(), 1);
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  assert.deepEqual(manifest, await inspectDatabase(db, manifest.target));
  await applyCleanup(db, manifest, manifest.target);
  const after = await db.collection("items").findOne({ _id: item._id });
  delete before.eudr_review_fence;
  assert.deepEqual(after, before);
  assert.equal(await db.collection("orders").countDocuments(), 1);
  assert.equal(await db.collection("vendors").countDocuments(), 1);
  assert.equal(await db.collection("samples").countDocuments(), 1);
  assert.equal(await db.collection("eudr_species").countDocuments(), 1);
  assert.equal((await db.listCollections().toArray()).some(row => row.name === "eudr_chains"), false);
});
