const assert = require("node:assert/strict");
const test = require("node:test");

const catalog = require("../knowledge/omsKnowledgeBase.catalog");
const {
  getBusinessDefinition,
  getCapability,
  getCollectionKnowledge,
  getDomain,
  getKnowledgeBase,
  getRelationshipsForCollection,
  listCapabilities,
  searchCapabilities,
  validateKnowledgeBase,
} = require("../services/omsKnowledgeBase.service");

const copy = () => JSON.parse(JSON.stringify(catalog));

test("OMS Knowledge Base loads as a read-only, valid Step 2 catalog", () => {
  const validation = validateKnowledgeBase();

  assert.equal(Object.isFrozen(getKnowledgeBase()), true);
  assert.equal(catalog.scope.assistantIntegration, "canonical_first_capability_tool");
  assert.equal(catalog.scope.behaviorChange, true);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.ok(validation.stats.domains >= 10);
  assert.ok(validation.stats.collections >= 30);
  assert.ok(validation.stats.capabilities >= 20);
  assert.ok(validation.stats.relationships >= 20);
  assert.ok(catalog.capabilities.every((entry) => entry.safety === "read_only"));
  assert.deepEqual(
    listCapabilities({ assistantStatus: "tool_eligible" }).map((entry) => entry.id).sort(),
    ["monthly_shipments", "packed_goods"],
  );
  assert.equal(catalog.capabilities.length, 28);
  assert.ok(catalog.capabilities.every((entry) => [
    "tool_eligible",
    "existing_assistant_feature",
    "documented_not_tool_eligible",
  ].includes(entry.assistantStatus)));
});

test("OMS Knowledge Base rejects duplicate IDs and unknown references", () => {
  const duplicate = copy();
  duplicate.capabilities.push({ ...duplicate.capabilities[0] });
  assert.equal(validateKnowledgeBase(duplicate, { checkSourcePaths: false }).valid, false);
  assert.match(
    validateKnowledgeBase(duplicate, { checkSourcePaths: false }).errors.join("\n"),
    /duplicate capability id/,
  );

  const unknown = copy();
  unknown.capabilities[0].collections.push("not_a_collection");
  assert.match(
    validateKnowledgeBase(unknown, { checkSourcePaths: false }).errors.join("\n"),
    /unknown collection/,
  );
});

test("OMS Knowledge Base validates relationship, source, and source-of-truth references", () => {
  const validation = validateKnowledgeBase();
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.ok(catalog.relationships.every((entry) => entry.sources.length > 0));
  assert.ok(catalog.sourceOfTruthRules.every((entry) => entry.sources.length > 0));
  assert.ok(catalog.businessDefinitions.every((entry) =>
    catalog.sourceOfTruthRules.some((rule) => rule.id === entry.sourceOfTruthRule),
  ));
  assert.ok(getRelationshipsForCollection("orders").some((entry) => entry.id === "order_qc_record"));
});

test("OMS Knowledge Base provides deterministic metadata search and aliases", () => {
  const first = searchCapabilities("packed goods").map((entry) => entry.id);
  const second = searchCapabilities("packed goods").map((entry) => entry.id);

  assert.deepEqual(first, second);
  assert.equal(first[0], "packed_goods");
  assert.equal(searchCapabilities("goods ready")[0].id, "packed_goods");
  assert.equal(getCapability("packed").id, "packed_goods");
  assert.equal(getBusinessDefinition("po").id, "purchase_order");
  assert.ok(listCapabilities({ domain: "shipment_logistics" }).some((entry) => entry.id === "shipments"));
  assert.equal(getDomain("quality_control").id, "quality_control");
  assert.equal(getCollectionKnowledge("items").collection, "items");
});

test("Packed Goods metadata preserves the exact canonical route, source chain, and fallback warning", () => {
  const packedGoods = getCapability("packed_goods");
  const routes = packedGoods.routes.map((entry) => `${entry.method} ${entry.path}`);
  const sources = packedGoods.sources.map((entry) => entry.path);

  assert.deepEqual(routes, [
    "GET /orders/packed-goods",
    "GET /orders/packed-goods/export",
  ]);
  assert.equal(packedGoods.sourceOfTruth.kind, "canonical_report_query");
  assert.equal(packedGoods.sourceOfTruth.canonical, "buildPackedGoodsDataset");
  assert.match(packedGoods.sourceOfTruth.rawFactsWarning, /fallback/i);
  assert.ok(sources.includes("backend/controllers/order.controller.js"));
  assert.ok(sources.includes("backend/services/packedGoods.service.js"));
  assert.ok(sources.includes("backend/services/shipmentCbmAllocation.service.js"));
  assert.ok(sources.includes("client/OMS/src/pages/PackedGoods.jsx"));
  assert.ok(packedGoods.collections.includes("orders"));
  assert.ok(packedGoods.collections.includes("qcs"));
  assert.ok(packedGoods.outputs.includes("cbm_source"));
});
