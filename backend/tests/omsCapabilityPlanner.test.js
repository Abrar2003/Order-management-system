const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyCapabilityPlan,
  findAmbiguousConceptsInQuestion,
} = require("../services/omsCapabilityPlanner.service");

const adapters = ["packed_goods", "monthly_shipments", "shipment_cbm"];

test("planner ranks direct canonical capabilities without sending the full catalog", () => {
  const plan = classifyCapabilityPlan({
    question: "Which vendor has the most ready CBM for By Boo?",
    resolvedEntities: { brands: ["By Boo"] },
    adapterIds: adapters,
  });

  assert.equal(plan.capabilities[0].id, "packed_goods");
  assert.equal(plan.canonicalCapability.id, "packed_goods");
  assert.ok(plan.capabilities.length <= 8);
  assert.match(plan.context, /Packed Goods/);
  assert.doesNotMatch(plan.context, /backend\/services/);
});

test("planner detects token-boundary ambiguities and resolves clear surrounding language", () => {
  assert.deepEqual(
    findAmbiguousConceptsInQuestion("show pending for By Boo").map(({ phrase }) => phrase),
    ["pending"],
  );
  assert.deepEqual(findAmbiguousConceptsInQuestion("impending delivery"), []);
  assert.deepEqual(
    findAmbiguousConceptsInQuestion("Which POs are delayed?").map(({ phrase }) => phrase),
    ["delay"],
  );

  const unresolved = classifyCapabilityPlan({ question: "show pending for By Boo", adapterIds: adapters });
  assert.match(unresolved.clarification, /unshipped|Shipping Pending|inspection/i);

  const resolved = classifyCapabilityPlan({ question: "show pending inspection for By Boo", adapterIds: adapters });
  assert.equal(resolved.clarification, "");
  assert.equal(resolved.ambiguities[0].resolvedCapability, "pending_po");
});
