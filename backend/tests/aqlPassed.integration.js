const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const mongoose = require("mongoose");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const { buildInspectionPassedStages, buildEffectivePassedQuantityByInspectionId } = require("../helpers/inspectionPassedQuantity");

test("stored AQL fields, Mongo report ownership, and dry-run/apply backfill agree", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oms-aql-test-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.env.AQL_TEST_MONGOD || "mongod", ["--dbpath", directory, "--port", String(port), "--bind_ip", "127.0.0.1", "--logpath", path.join(directory, "mongo.log")], { windowsHide: true, stdio: "ignore" });
  let spawnError;
  child.on("error", (error) => { spawnError = error; });
  t.after(async () => {
    await mongoose.disconnect();
    if (child.exitCode === null && !spawnError) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill(); await exited;
    }
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith("oms-aql-test-"));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const uri = `mongodb://127.0.0.1:${port}/aql_test`;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (spawnError) throw spawnError;
    try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 250, autoIndex: false }); break; }
    catch (error) { if (Date.now() > deadline) throw error; }
  }
  const id = () => new mongoose.Types.ObjectId();
  const qcId = id(), inspector = id(), first = id(), second = id(), normal = id(), orderId = id();
  const qc = {
    _id: qcId, order: orderId, request_type: "FULL", quantities: { client_demand: 1000, qc_passed: 0, pending: 1000 },
    item: { item_code: "ITEM", description: "Item" }, order_meta: { vendor: "Vendor", brand: "Brand", order_id: "PO-1" },
    request_history: [
      { _id: first, request_type: "AQL", request_date: "2026-10-01", inspector, quantity_requested: 600 },
      { _id: second, request_type: "AQL", request_date: "2026-10-03", inspector, quantity_requested: 300 },
      { _id: normal, request_type: "FULL", request_date: "2026-10-04", inspector, quantity_requested: 100 },
    ],
  };
  await QC.collection.insertOne(qc);
  await mongoose.connection.collection("orders").insertOne({ _id: orderId, order_id: "PO-1", item: qc.item, brand: "Brand", vendor: "Vendor", quantity: 1000, status: "Inspection Done", archived: false, shipment: [] });
  await mongoose.connection.collection("users").insertOne({ _id: inspector, name: "Inspector", role: "qc" });
  const create = (overrides) => Inspection.create({
    qc: qcId, inspector, createdBy: inspector, request_history_id: first, requested_date: "2026-10-01",
    inspection_date: "2026-10-01", vendor_requested: 600, vendor_offered: 600,
    checked: 50, passed: 50, rejected: 0, pending_after: 0, status: "Inspection Done", aql_passed: 999,
    ...overrides,
  });
  const old = await create({});
  const latest = await create({ inspection_date: "2026-10-02", passed: 1 });
  const next = await create({ request_history_id: second, requested_date: "2026-10-03", inspection_date: "2026-10-03", vendor_requested: 300, passed: 1 });
  const full = await create({ request_history_id: normal, passed: 7 });
  await create({ request_history_id: normal, passed: 3, inspection_date: "2026-10-02" });
  await create({ status: "transferred", inspection_date: "2026-10-04" });
  await create({ request_history_id: null, passed: 2 });
  assert.equal(old.aql_passed, 600);
  assert.equal(next.aql_passed, 300);
  assert.equal(full.aql_passed, null);

  const records = await Inspection.find({ qc: qcId }).lean();
  const expected = buildEffectivePassedQuantityByInspectionId(records.map((record) => ({ ...record, qc })));
  const aggregated = await Inspection.aggregate(buildInspectionPassedStages());
  assert.deepEqual(Object.fromEntries(aggregated.map((record) => [String(record._id), record.effective_passed])), Object.fromEntries(expected));
  assert.equal(aggregated.reduce((sum, record) => sum + record.effective_passed, 0), 910);
  const earlier = await Inspection.aggregate([{ $match: { _id: old._id } }, ...buildInspectionPassedStages()]);
  assert.equal(earlier[0].effective_passed, 0);
  assert.equal(earlier[0].aql_passed, 600);

  const reports = require("../controllers/reports.controller");
  const request = { query: { vendor: "Vendor", timeline: "custom", from_date: "2026-10-01", to_date: "2026-10-05" }, user: { role: "admin", allowed_brands: [], allowed_vendors: ["all"] } };
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const summary = response(), detailed = response();
  await reports.getVendorWiseQaSummary(request, summary);
  await reports.getVendorWiseQaDetailed(request, detailed);
  assert.equal(summary.statusCode, 200, JSON.stringify(summary.body));
  assert.equal(detailed.statusCode, 200, JSON.stringify(detailed.body));
  assert.equal(summary.body.summary.inspected_quantity, 910);
  assert.equal(detailed.body.summary.total_passed_quantity, 910);

  const qcController = require("../controllers/qc.controller");
  const inspectorReport = response();
  await qcController.getInspectorReports(request, inspectorReport);
  assert.equal(inspectorReport.statusCode, 200, JSON.stringify(inspectorReport.body));
  assert.equal(inspectorReport.body.summary.total_passed, 910);
  const day = response();
  await qcController.getDailyOrderSummary({ ...request, query: { date: "2026-10-02" } }, day);
  assert.equal(day.statusCode, 200, JSON.stringify(day.body));
  assert.equal(day.body.vendors[0].items[0].passed_quantity, 603);
  const olderDay = response();
  await qcController.getDailyOrderSummary({ ...request, query: { date: "2026-10-01" } }, olderDay);
  assert.equal(olderDay.body.vendors[0].items[0].passed_quantity, 7);

  const runBackfill = (args) => promisify(execFile)(process.execPath, [path.resolve(__dirname, "../scripts/backfillAqlPassed.js"), ...args], {
    cwd: path.resolve(__dirname, ".."), env: { ...process.env, MONGO_URI: uri, NODE_ENV: "test" }, windowsHide: true,
  });
  await Inspection.collection.updateOne({ _id: old._id }, { $unset: { aql_passed: "" } });
  await runBackfill(["--dry-run"]);
  assert.equal((await Inspection.collection.findOne({ _id: old._id })).aql_passed, undefined);
  await runBackfill(["--apply"]);
  assert.equal((await Inspection.findById(old._id)).aql_passed, 600);
  assert.equal((await QC.findById(qcId)).quantities.qc_passed, 910);
  const again = await runBackfill(["--apply"]);
  assert.match(again.stdout, /"inspections":0/);
  assert.equal((await Inspection.findById(old._id)).passed, 50);
  latest.passed = 0; latest.aql_passed = 999;
  await latest.save();
  assert.equal(latest.aql_passed, 0);
});
