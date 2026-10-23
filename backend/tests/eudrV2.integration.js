const test = require("node:test"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), { once } = require("node:events");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), net = require("node:net"), crypto = require("node:crypto");
const mongoose = require("mongoose"), bcrypt = require("bcryptjs");
const replicaSet = require("./helpers/labelReplicaSet");
const Species = require("../models/woodSpecies.model");
const { key } = require("../integrations/eudrV2.source");
const secret = "isolated-new-bridge-test-secret-more-than-32-characters";
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, "127.0.0.1", r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function cookies(response) { return response.headers.getSetCookie().map(value => value.split(";")[0]).filter(value => !value.endsWith("=")).join("; "); }

test("real OMS and EUDR V2 authenticate, exchange scoped source facts and create a declaration and purchase batch", { timeout: 120000 }, async t => {
  const replica = await replicaSet(); t.after(replica.close);
  const db = mongoose.connection.db, host = mongoose.connection.getClient().options.hosts[0].toString();
  const omsPort = await port(), eudrPort = await port(), uiPort = await port();
  const oms = `http://127.0.0.1:${omsPort}`, eudr = `http://127.0.0.1:${eudrPort}`, publicUrl = eudr + "/eudr-tool/";
  const eudrRepo = path.resolve(__dirname, "../../../eudr");
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "oms-v2-e2e-"));
  t.after(async () => { assert.ok(storage.startsWith(os.tmpdir() + path.sep)); assert.ok(path.basename(storage).startsWith("oms-v2-e2e-")); await fs.rm(storage, { recursive: true, force: true }); });
  const oid = () => new mongoose.Types.ObjectId();
  const admin = oid(), restricted = oid(), denied = oid(), brandA = oid(), brandB = oid(), vendorA = oid(), vendorB = oid(), itemId = oid(), orderId = oid(), shipmentId = oid();
  const password = await bcrypt.hash("test-only-password", 4);
  await db.collection("users").insertMany([
    { _id: admin, username: "v2-admin", name: "V2 Admin", email: "admin@example.invalid", password, role: "super admin", allowed_brands: [], allowed_vendors: ["all"] },
    { _id: restricted, username: "v2-restricted", name: "V2 Restricted", email: "restricted@example.invalid", password, role: "manager", allowed_brands: [brandA], allowed_vendors: ["Vendor A"] },
    { _id: denied, username: "v2-denied", name: "V2 Denied", email: "denied@example.invalid", password, role: "user" },
  ]);
  await db.collection("brands").insertMany([{ _id: brandA, name: "Giga" }, { _id: brandB, name: "By Boo" }]);
  await db.collection("vendors").insertMany([
    { _id: vendorA, name: "Vendor A", gst: "29AAAAA0001A1Z5", pan: "AAAAA0001A", vendor_code: [{ brand: "Giga", code: "VA" }] },
    { _id: vendorB, name: "Vendor B", gst: "29AAAAA0002A1Z5", pan: "AAAAA0002A", vendor_code: [{ brand: "By Boo", code: "VB" }] },
  ]);
  await db.collection("items").insertOne({ _id: itemId, code: "96517", description: "Wood chair", name: "Chair", brand: "Giga", brand_name: "Giga", brands: ["Giga"], vendors: [{ vendor_id: vendorA, name: "Vendor A", country: "India" }], barcode_exempted: true,
    qc: { barcode: 123456, master_barcode: 123456, inner_barcode: 0 }, inspected_box_mode: "individual",
    inspected_item_sizes: [{ remark: "item", L: 10, B: 10, H: 10, net_weight: 1 }], inspected_box_sizes: [{ remark: "box", box_type: "individual", L: 12, B: 12, H: 12, gross_weight: 2 }] });
  await db.collection("orders").insertMany([
    { _id: orderId, order_id: "PO-V2", brand: "Giga", vendor: { vendor_id: vendorA, name: "Vendor A" }, item: { item_code: "96517", description: "Wood chair" }, quantity: 999, status: "Partial Shipped", archived: false, shipment: [
      { _id: shipmentId, container: "TEST-V2-001", quantity: 100, invoice_number: "EXP-1", stuffing_date: new Date("2026-10-20") },
      { _id: oid(), container: "TEST-V2-001", quantity: 25, invoice_number: "EXP-2", stuffing_date: new Date("2026-10-21") },
      { _id: oid(), container: "NOT-STUFFED", quantity: 0, invoice_number: "EMPTY" },
    ] },
    { _id: oid(), order_id: "PO-OTHER", brand: "By Boo", vendor: { vendor_id: vendorB, name: "Vendor B" }, item: { item_code: "96517" }, quantity: 10, shipment: [{ _id: oid(), container: "TEST-V2-001", quantity: 10, invoice_number: "OTHER", stuffing_date: new Date("2026-10-21") }] },
    { _id: oid(), order_id: "PO-PRIVATE", brand: "By Boo", vendor: { vendor_id: vendorB, name: "Vendor B" }, item: { item_code: "96517" }, quantity: 1, shipment: [{ _id: oid(), container: "PRIVATE-ONLY", quantity: 1, invoice_number: "PRIVATE" }] },
    { _id: oid(), order_id: "PO-CROSS-BRAND", brand: "By Boo", vendor: { vendor_id: vendorA, name: "Vendor A" }, item: { item_code: "96517" }, quantity: 5, shipment: [{ _id: oid(), container: "TEST-V2-001", quantity: 5, invoice_number: "EXP-1", stuffing_date: new Date("2026-10-21") }] },
  ]);
  await Species.createCollection(); await Species.createIndexes();
  const legacySpeciesId = oid();
  await db.collection("eudr_species").insertOne({ _id: legacySpeciesId, name: "Walnut", scientific_name: "Juglans regia", active: true, max_yield_bp: 6500 });
  const { migrate } = require("../scripts/migrateWoodSpecies");
  assert.equal((await migrate(db)).applied, false); assert.equal(await Species.countDocuments(), 0);
  await migrate(db, true);
  assert.equal((await Species.findById(legacySpeciesId).lean()).max_yield_bp, undefined);
  assert.ok((await Species.findById(legacySpeciesId).lean()).createdAt instanceof Date);
  assert.equal(await db.collection("eudr_species").countDocuments(), 1);
  const processes = [];
  t.after(async () => { for (const child of processes.reverse()) if (child.exitCode === null) { const exit = once(child, "exit"); child.kill(); await exit; } });
  const baseEnv = { ...process.env, NODE_ENV: "test", JWT_SECRET: "isolated-v2-jwt-secret", JWT_REFRESH_SECRET: "isolated-v2-refresh-secret", REDIS_JOBS_ENABLED: "false", REDIS_CACHE_ENABLED: "false", AUTH_COOKIE_SECURE: "false", AUTH_COOKIE_DOMAIN: "", FORCE_PUBLIC_DNS: "false", MONGO_DNS_SERVERS: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REFRESH_TOKEN: "", OMS_V2_BRIDGE_SECRET: secret };
  function start(cwd, args, env) {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, env: { ...baseEnv, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    processes.push(child); child.stdout.on("data", () => {}); child.stderr.on("data", () => {}); return child;
  }
  const omsChild = start(path.resolve(__dirname, ".."), ["index.js"], { PORT: String(omsPort), MONGO_URI: `mongodb://${host}/${db.databaseName}?replicaSet=ledger-test`, EUDR_V2_PUBLIC_URL: publicUrl, OMS_PUBLIC_URL: `http://127.0.0.1:${uiPort}`, CORS_ORIGIN: `http://127.0.0.1:${uiPort}` });
  const eudrCode = `const mongoose=require('mongoose');const {readConfig}=require('./src/config');const {initialize}=require('./src/models');const {createApp}=require('./src/app');(async()=>{const config=readConfig();await mongoose.connect(config.mongoUri,{dbName:'eudr_v2'});await initialize();createApp(mongoose.connection.db,config,{storageRoot:process.env.TEST_EVIDENCE_ROOT}).listen(config.port,'127.0.0.1');})().catch(()=>process.exit(1));`;
  const eudrChild = start(path.join(eudrRepo, "backend"), ["-e", eudrCode], { PORT: String(eudrPort), MONGODB_URI: `mongodb://${host}/eudr_v2?replicaSet=ledger-test`, APP_PUBLIC_URL: publicUrl, OMS_V2_BASE_URL: oms, IDENTITY_PROVIDER_MODULE: "", TEST_EVIDENCE_ROOT: storage });
  for (const [child, url] of [[omsChild, oms + "/healthz"], [eudrChild, eudr + "/eudr-tool/api/health"]]) {
    const until = Date.now() + 20000;
    for (;;) { assert.equal(child.exitCode, null, "Application exited before startup"); try { if ((await fetch(url)).ok) break; } catch {} assert.ok(Date.now() < until, "Application startup timed out"); await new Promise(r => setTimeout(r, 100)); }
  }
  async function call(base, route, { method = "GET", body, headers = {}, expected = 200 } = {}) {
    const response = await fetch(base + route, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
    const text = await response.text(), data = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text;
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${route.split("?")[0]}: ${response.status} ${data?.code || "unexpected status"}`);
    return { response, data };
  }
  const login = async username => cookies((await call(oms, "/auth/signin", { method: "POST", body: { username, password: "test-only-password" } })).response);
  const adminCookies = await login("v2-admin");
  const normal = (route, options = {}) => call(oms, route, { ...options, headers: { Cookie: adminCookies, ...options.headers } });
  const mango = (await normal("/wood-species", { method: "POST", body: { name: "Mango", scientific_name: "Mangifera indica" }, expected: 201 })).data.data;
  const acacia = (await normal("/wood-species", { method: "POST", body: { name: "Acacia", scientific_name: "Acacia nilotica" }, expected: 201 })).data.data;
  const sampleId = oid();
  await db.collection("samples").insertOne({ _id: sampleId, code: "SAMPLE-V2", description: "Stuffed sample", brand: "Giga", vendor: [{ vendor_id: vendorA, name: "Vendor A" }], timber_cft: 0.2, hs_code: "940360", species_composition: [{ species: new mongoose.Types.ObjectId(mango._id), share_bp: 10000 }], shipment: [{ _id: oid(), container: "TEST-V2-001", quantity: 3, invoice_number: "EXP-SAMPLE", stuffing_date: new Date("2026-10-21") }] });
  await normal("/wood-species", { method: "POST", body: { name: "mango", scientific_name: "Other name" }, expected: 409 });
  await normal(`/wood-species/${acacia._id}`, { method: "PATCH", body: { active: false } });
  assert.ok(!(await normal("/wood-species?query=Acacia")).data.data.length);
  await normal(`/items/${itemId}`, { method: "PATCH", body: { species_composition: [{ species: acacia._id, share_bp: 10000 }] }, expected: 400 });
  await normal(`/wood-species/${acacia._id}`, { method: "PATCH", body: { name: "Acacia wood", active: true } });
  await normal(`/items/${itemId}`, { method: "PATCH", body: { finished_wood_volume: { value: "0.014158423296", unit: "m3" }, hs_code: "9403 60", species_composition: [{ species: mango._id, share_bp: 10000 }] } });
  const saved = await db.collection("items").findOne({ _id: itemId });
  assert.equal(saved.timber_cft, 0.5); assert.equal(saved.hs_code, "940360"); assert.ok(saved.timber_cft_history.length);
  await normal(`/items/${itemId}`, { method: "PATCH", body: { species_composition: [{ species: mango._id, share_bp: 9999 }] }, expected: 400 });
  async function issue(cookie = adminCookies) {
    const state = crypto.randomBytes(32).toString("hex");
    const { data } = await call(oms, "/integrations/eudr/v2/auth/launch?state=" + state, { headers: { Cookie: cookie } });
    const code = /name="code" value="([a-f0-9]{64})"/.exec(data)?.[1]; assert.ok(code, "OMS did not issue a handoff form"); return { code, state, audience: publicUrl };
  }
  async function signed(route, { method = "GET", body, actor = "", context = "", nonce = crypto.randomBytes(16).toString("hex"), timestamp = String(Date.now()), expected = 200, signature } = {}) {
    const raw = body ? JSON.stringify(body) : "", resource = "/integrations/eudr/v2" + route;
    const hmac = signature || crypto.createHmac("sha256", secret).update([method, resource, timestamp, nonce, actor, sha(raw)].join("\n")).digest("hex");
    return call(oms, resource, { method, body, expected, headers: { "X-EUDR-Timestamp": timestamp, "X-EUDR-Nonce": nonce, "X-EUDR-Actor": actor, "X-EUDR-Scope": context, "X-EUDR-Signature": hmac } });
  }
  await call(oms, "/integrations/eudr/v2/species", { expected: 401 });
  await signed("/species", { signature: "0".repeat(64), expected: 401 });
  await signed("/species", { timestamp: String(Date.now() - 31000), expected: 401 });
  const nonce = crypto.randomBytes(16).toString("hex"); await signed("/species", { nonce }); await signed("/species", { nonce, expected: 401 });
  const pending = await issue(); const user = (await signed("/auth/redeem", { method: "POST", body: pending })).data.user;
  await signed("/auth/redeem", { method: "POST", body: pending, expected: 401 });
  const expired = await issue(); await db.collection("oms_v2_handoffs").updateOne({ _id: sha(expired.code) }, { $set: { expiresAt: new Date(0) } });
  await signed("/auth/redeem", { method: "POST", body: expired, expected: 401 });
  const competing = await issue();
  const redeemed = await Promise.all([signed("/auth/redeem", { method: "POST", body: competing, expected: [200, 401] }), signed("/auth/redeem", { method: "POST", body: competing, expected: [200, 401] })]);
  assert.deepEqual(redeemed.map(r => r.response.status).sort(), [200, 401]);
  const restrictedUser = (await signed("/auth/redeem", { method: "POST", body: await issue(await login("v2-restricted")) })).data.user;
  assert.deepEqual(restrictedUser.vendorIds, [String(vendorA)]); assert.equal(restrictedUser.allVendors, false);
  await call(oms, "/integrations/eudr/v2/auth/launch?state=" + "a".repeat(64), { headers: { Cookie: await login("v2-denied") }, expected: 403 });
  const scoped = (route, options = {}) => signed(route, { actor: user.id, context: user.omsScope, ...options });
  assert.equal((await scoped("/containers?query=.*")).data.containers.length, 0);
  await scoped("/containers?query=TEST&limit=101", { expected: 400 });
  const malformed = await fetch(oms + "/integrations/eudr/v2/auth/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).code, "REQUEST_BODY_INVALID");
  assert.equal((await scoped("/containers?query=V2-00")).data.containers.length, 1);
  assert.equal((await scoped("/containers?query=NOT-STUFFED")).data.containers.length, 0);
  await signed("/containers?query=TEST", { actor: user.id, expected: 403 });
  await signed("/containers?query=PRIVATE", { actor: restrictedUser.id, context: restrictedUser.omsScope }).then(r => assert.equal(r.data.containers.length, 0));
  const containerKey = key("TEST-V2-001"), snap = (await scoped("/containers/" + containerKey)).data;
  assert.equal(snap.groups.length, 5); assert.equal(snap.groups.flatMap(g => g.items).reduce((n, row) => n + row.quantity, 0), 143);
  assert.equal(snap.groups.flatMap(g => g.items).find(row => row.source === "sample").itemId, String(sampleId));
  assert.equal((await signed("/containers/" + containerKey, { actor: restrictedUser.id, context: restrictedUser.omsScope })).data.groups.length, 3);
  await signed("/containers/" + key("PRIVATE-ONLY"), { actor: restrictedUser.id, context: restrictedUser.omsScope, expected: 404 });
  await db.collection("orders").updateOne({ _id: orderId }, { $set: { "shipment.0.quantity": 101 } });
  assert.notEqual((await scoped("/containers/" + containerKey)).data.hash, snap.hash);
  await db.collection("orders").updateOne({ _id: orderId }, { $set: { "shipment.0.quantity": 100 } });
  await normal(`/items/${itemId}`, { method: "PATCH", body: { species_composition: [{ species: mango._id, share_bp: 6000 }, { species: acacia._id, share_bp: 4000 }] } });
  assert.notEqual((await scoped("/containers/" + containerKey)).data.hash, snap.hash);
  await normal(`/items/${itemId}`, { method: "PATCH", body: { species_composition: [{ species: mango._id, share_bp: 10000 }] } });
  const before = await db.collection("items").findOne({ _id: itemId });
  await scoped("/containers/" + containerKey, { method: "PATCH", body: { quantity: 999 }, expected: 404 });
  assert.deepEqual(await db.collection("items").findOne({ _id: itemId }), before);
  for (const route of ["/eudr", "/eudr/capabilities", "/integrations/eudr/launch", "/integrations/eudr/redeem"]) await call(oms, route, { expected: 404 });

  // Real state cookie, HTML handoff and signed redemption through the actual EUDR app.
  const launch = await fetch(eudr + "/eudr-tool/api/auth/launch", { redirect: "manual" });
  const stateCookie = cookies(launch), handoffUrl = launch.headers.get("location");
  const form = await fetch(handoffUrl, { headers: { Cookie: adminCookies }, redirect: "manual" });
  const html = await form.text(), code = /name="code" value="([a-f0-9]{64})"/.exec(html)?.[1], state = new URL(handoffUrl).searchParams.get("state");
  assert.ok(code, "Handoff form missing");
  const callback = await fetch(eudr + "/eudr-tool/api/auth/callback", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: stateCookie }, body: new URLSearchParams({ code, state }), redirect: "manual" });
  assert.equal(callback.status, 303); const sessionCookie = cookies(callback);
  const current = await call(eudr, "/eudr-tool/api/auth/me", { headers: { Cookie: sessionCookie } });
  const eapi = (route, options = {}) => call(eudr, "/eudr-tool/api" + route, { ...options, headers: { Cookie: sessionCookie, Origin: eudr, "X-CSRF-Token": current.data.csrf } });
  await eapi(`/rules/${mango._id}`, { method: "PUT", body: { wastagePercentage: "20", revision: 0 } });
  assert.equal((await eapi("/oms/containers?query=V2-00")).data.containers.length, 1);
  const real = (await eapi("/oms/containers/" + containerKey)).data, group = real.groups.find(g => g.exportInvoiceNumber === "EXP-1" && g.brand === "Giga");
  assert.equal(group.items[0].finishedCftPerUnit, "0.500000"); assert.equal(group.vendor.id, String(vendorA));
  let chain = (await eapi("/chains", { method: "POST", body: { containerKey, groupKey: group.key }, expected: 201 })).data.chain;
  assert.equal(chain.calculation.finishedMicro, 50000000); assert.equal(chain.calculation.requiredMicro, 62500000);
  const manufacturer = (await eapi("/parties", { method: "POST", body: { chainId: chain._id, role: "manufacturer", name: "Vendor A", gstin: "29AAAAA0001A1Z5", pan: "AAAAA0001A" } })).data;
  chain = (await eapi(`/chains/${chain._id}/declaration`, { method: "PUT", body: { revision: chain.revision, manufacturerPartyId: manufacturer._id, identityConfirmed: true, date: "2026-10-21", finishedCft: "50" } })).data;
  const seller = (await eapi("/parties", { method: "POST", body: { chainId: chain._id, role: "sawmill", name: "Test Sawmill", gstin: "29AAAAA0003A1Z5", pan: "AAAAA0003A" } })).data;
  const documentIds = [];
  const { PDFDocument } = require(require.resolve("pdf-lib", { paths: [path.join(eudrRepo, "backend")] }));
  for (const type of ["purchaseInvoice", "bilty", "driverLicence", "transportPermission"]) {
    const pdf = await PDFDocument.create(); pdf.addPage().drawText("Isolated integration evidence " + type);
    const upload = new FormData(); upload.append("file", new Blob([await pdf.save()], { type: "application/pdf" }), type + ".pdf");
    for (const [name, value] of Object.entries({ ownerType: "draftInvoice", ownerId: chain._id, type })) upload.append(name, value);
    const response = await fetch(eudr + "/eudr-tool/api/evidence", { method: "POST", headers: { Cookie: sessionCookie, Origin: eudr, "X-CSRF-Token": current.data.csrf }, body: upload });
    assert.equal(response.status, 201, "Required invoice evidence upload failed"); documentIds.push((await response.json())._id);
  }
  const purchase = (await eapi("/invoices", { method: "POST", expected: 201, body: { chainId: chain._id, buyerId: manufacturer._id, sellerId: seller._id, invoiceNumber: "PURCHASE-V2", financialYearStart: 2026, invoiceDate: "2026-10-20", quantities: [{ speciesId: mango._id, quantity: "62.5" }], transport: [{ id: "legacy", biltyNumber: "BILTY-V2", vehicleNumber: "TEST-VEHICLE", driverLicenceNumber: "TEST-DRIVER-LICENCE" }], documentIds } })).data.invoice;
  assert.ok(purchase.batchCode); assert.equal((await eapi("/batches")).data.batches.length, 1);
  const privateGroup = real.groups.find(g => g.brand === "By Boo" && g.vendor.id === String(vendorA));
  const privateChain = (await eapi("/chains", { method: "POST", body: { containerKey, groupKey: privateGroup.key }, expected: 201 })).data.chain;
  await db.collection("users").updateOne({ _id: admin }, { $set: { allowed_brands: [brandA], allowed_vendors: ["Vendor A"] } });
  assert.equal((await eapi("/chains")).data.chains.length, 1);
  await eapi(`/chains/${privateChain._id}`, { expected: 404 });
  await db.collection("users").updateOne({ _id: admin }, { $set: { allowed_brands: [], allowed_vendors: ["all"] } });
  await db.collection("users").updateOne({ _id: admin }, { $set: { role: "user" } });
  await signed(`/auth/users/${admin}`, { context: user.omsScope, expected: 403 });
  await db.collection("users").updateOne({ _id: admin }, { $set: { role: "super admin" } });
  await require("./helpers/eudrV2Browser")({ oms, eudr, uiPort, acaciaId: acacia._id, groupKey: group.key });
  await db.collection("users").updateOne({ _id: admin }, { $set: { is_active: false } });
  await eapi("/auth/me", { expected: 403 });
});
