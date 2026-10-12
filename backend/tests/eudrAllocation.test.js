const test = require("node:test");
const assert = require("node:assert/strict");
const EudrChain = require("../models/eudrChain.model");
const Allocation = require("../models/eudrAllocation.model");
const allocation = require("../services/eudrAllocation.service");
const { contributionMilliCft, chainCoverage, validateStage } = require("../services/eudrChain.service");

const group = { stuffed_milli_cft: 17600, stuffed_cft: 17.6, vendor_signature: "vendor", shipment_signature: "shipment" };
const chain = (contribution) => ({ declared_milli_cft: 17600, contribution_milli_cft: contribution, stages: [{ kind: "sawmill", verified_at: new Date() }, { kind: "transport", verified_at: new Date() }, { kind: "receiver", verified_at: new Date(), vendor_signature: "vendor" }, { kind: "declaration", verified_at: new Date(), shipment_signature: "shipment" }] });

test("empty draft invoice keys are omitted for the existing sparse unique index; real keys remain", async () => {
  const draft = new EudrChain({ container: "C1", container_key: "c1", vendor: "aaaaaaaaaaaaaaaaaaaaaaaa", declared_milli_cft: 17600, contribution_milli_cft: 10000 });
  assert.equal(draft.toObject().invoice_keys, undefined);
  draft.invoice_keys = []; await draft.validate();
  assert.equal(Object.hasOwn(draft.toObject(), "invoice_keys"), false);
  draft.invoice_keys = ["GST|2026|INV1"]; await draft.validate();
  assert.deepEqual(draft.toObject().invoice_keys, ["GST|2026|INV1"]);
});

test("coverage counts each explicit contribution once, not the purchase invoice's full sold CFT", () => {
  const first = chain(10000); const second = chain(7600);
  first.stages[0].fields = { sold_cft: "100" };
  assert.deepEqual(chainCoverage([first], group), { chain_count: 1, allocated_cft: 10, verified_cft: 10, remaining_cft: 7.6, complete: false });
  assert.equal(chainCoverage([first, second], group).complete, true);
  assert.equal(chainCoverage([first, second], group).verified_cft, 17.6);
  second.stages[3].verified_at = null;
  assert.equal(chainCoverage([first, second], group).complete, false);
  assert.equal(chainCoverage([first, second], group).verified_cft, 10);
  second.stages[3].verified_at = new Date(); second.contribution_milli_cft = 7601;
  assert.equal(chainCoverage([first, second], group).complete, false);
  second.contribution_milli_cft = 7599;
  assert.equal(chainCoverage([first, second], group).complete, false);
});

test("legacy chains retain full contributions and stale signatures never contribute verified coverage", () => {
  const legacy = chain(null);
  assert.equal(contributionMilliCft(legacy), 17600);
  assert.equal(chainCoverage([legacy], group).complete, true);
  for (const changed of [{ ...group, vendor_signature: "edited" }, { ...group, shipment_signature: "edited" }, { ...group, stuffed_milli_cft: 17601 }]) {
    assert.equal(chainCoverage([legacy], changed).verified_cft, 0);
    assert.equal(chainCoverage([legacy], changed).complete, false);
  }
  assert.equal(chainCoverage([legacy], group, [{}]).complete, false);
  assert.equal(chainCoverage([legacy], null).complete, false);
  legacy.stages[0].verified_at = null;
  assert.equal(chainCoverage([legacy], group).verified_cft, 0);
});

test("sale quantities only need to cover their chain contribution, including intermediate sales", () => {
  const stage = { kind: "sawmill", workflow_version: 2, fields: { name: "Mill", gst: "G", pan: "P", permission_number: "1", invoice_number: "1", invoice_date: "2026-10-12", sold_to: "Buyer", buyer_gst: "G2", buyer_pan: "P2", sold_cft: "10" }, documents: ["cutting_invoice", "license", "permission", "buyer_gst", "buyer_pan"].map((type) => ({ type })) };
  const context = { declaredMilliCft: 17600, contributionMilliCft: 10000, vendor: { gst: "V", pan: "V" } };
  assert.doesNotThrow(() => validateStage(stage, context));
  stage.fields.sold_cft = "9.999";
  assert.throws(() => validateStage(stage, context), /10.000.*contributed by this chain/);
  stage.kind = "receiver"; stage.fields.received_cft = "9"; stage.fields.sold_cft = "10";
  stage.documents = ["invoice", "buyer_gst", "buyer_pan"].map((type) => ({ type }));
  assert.doesNotThrow(() => validateStage(stage, context));
});

test("allocations enforce three-decimal exact capacity and allow editing an existing contribution", () => {
  const first = { ...chain(10000), _id: "one" };
  assert.doesNotThrow(() => allocation.assertAllocation([first], 7600, 17600));
  assert.throws(() => allocation.assertAllocation([first], 7601, 17600), /7.600 CFT/);
  assert.doesNotThrow(() => allocation.assertAllocation([first], 17600, 17600, "one"));
});

test("index upgrade only removes the obsolete container/vendor unique index and is safe to repeat", async (t) => {
  const calls = [];
  t.mock.method(EudrChain, "createIndexes", async () => calls.push("create"));
  t.mock.method(Allocation, "createCollection", async () => {});
  t.mock.method(EudrChain.collection, "indexes", async () => [
    { name: "_id_", key: { _id: 1 }, unique: true },
    { name: "container_key_1_vendor_1", key: { container_key: 1, vendor: 1 }, unique: true },
    { name: "invoice_keys_1", key: { invoice_keys: 1 }, unique: true },
    { name: "lookup", key: { container_key: 1, vendor: 1, createdAt: 1 } },
  ]);
  t.mock.method(EudrChain.collection, "dropIndex", async (name) => { calls.push(name); });
  await allocation.ensureIndexes();
  assert.deepEqual(calls, ["create", "container_key_1_vendor_1"]);
  t.mock.method(EudrChain.collection, "dropIndex", async () => { throw Object.assign(new Error("already dropped by another worker"), { code: 27 }); });
  await assert.doesNotReject(() => allocation.ensureIndexes());
});

test("allocation writes take a shared database lock before reading siblings, scoped by container/vendor", async (t) => {
  const session = {}; const calls = [];
  t.mock.method(EudrChain.db, "transaction", async (operation) => operation(session));
  t.mock.method(Allocation, "findOneAndUpdate", async (filter, update, options) => { calls.push("lock"); assert.deepEqual(filter, { _id: "c1|vendor1" }); assert.equal(update.$inc.revision, 1); assert.equal(options.upsert, true); assert.equal(options.session, session); });
  t.mock.method(EudrChain, "find", (filter) => { calls.push("read"); assert.deepEqual(filter, { container_key: "c1", vendor: "vendor1" }); return { session: async (current) => { assert.equal(current, session); return [chain(10000)]; } }; });
  const result = await allocation.withAllocation(" C1 ", "vendor1", async (chains, current) => { calls.push("write"); assert.equal(current, session); assert.equal(chains.length, 1); return "saved"; });
  assert.equal(result, "saved"); assert.deepEqual(calls, ["lock", "read", "write"]);
});

test("allocations fail closed when MongoDB cannot provide atomic transactions", async (t) => {
  t.mock.method(EudrChain.db, "transaction", async () => { throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"), { code: 20 }); });
  await assert.rejects(() => allocation.withAllocation("C", "V", () => assert.fail("must not write")), (error) => error.statusCode === 503 && /No changes were saved/.test(error.message));
});
