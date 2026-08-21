const assert = require("node:assert/strict");
const test = require("node:test");

const catalog = require("../knowledge/omsKnowledgeBase.catalog");
const {
  getAmbiguousConcept,
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
const expectedAuditIds = new Set([
  ...Array.from({ length: 15 }, (_, index) => `ORD-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `SHP-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 13 }, (_, index) => `QC-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 16 }, (_, index) => `ITM-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `VEN-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `SAM-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 6 }, (_, index) => `WF-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `CMP-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, index) => `OTH-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, index) => `SEC-${String(index + 1).padStart(2, "0")}`),
]);
const countBy = (key) => catalog.capabilities.reduce((counts, capability) => {
  counts[capability[key]] = (counts[capability[key]] || 0) + 1;
  return counts;
}, {});

test("OMS Knowledge Base V2 loads as a frozen, read-only 74-capability catalog", () => {
  const validation = validateKnowledgeBase();

  assert.equal(Object.isFrozen(getKnowledgeBase()), true);
  assert.equal(catalog.version, "2.0.0");
  assert.equal(catalog.scope.step, "knowledge_base_v2");
  assert.equal(catalog.scope.behaviorChange, false);
  assert.deepEqual(catalog.scope.existingCapabilityAdapters, ["packed_goods", "monthly_shipments", "shipment_cbm"]);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.stats.capabilities, 74);
  assert.equal(validation.stats.auditIds, 74);
  assert.equal(validation.stats.uncertainties, 25);
  assert.ok(validation.stats.domains >= 10);
  assert.ok(validation.stats.collections >= 30);
  assert.ok(validation.stats.relationships >= 20);
  assert.ok(catalog.capabilities.every((entry) => entry.safety.readOnly && !entry.safety.mutationAllowed));
});

test("Knowledge Base covers every audited capability ID exactly once", () => {
  const actual = catalog.capabilities.map((entry) => entry.auditId);
  assert.equal(actual.length, 74);
  assert.equal(new Set(actual).size, 74);
  assert.equal(new Set(catalog.capabilities.map((entry) => entry.id)).size, 74);
  assert.deepEqual(new Set(actual), expectedAuditIds);
});

test("audited Assistant recommendation counts cannot drift", () => {
  assert.deepEqual(countBy("assistantRecommendation"), {
    CAPABILITY_PLUS_MONGO: 9,
    DIRECT_CAPABILITY: 3,
    EXPORT_ONLY: 5,
    EXTRACT_TO_SERVICE_THEN_CAPABILITY: 28,
    NOT_ASSISTANT_SAFE: 19,
    PRESENTATION_ONLY: 1,
    RAW_MONGO: 9,
  });
  assert.equal(countBy("assistantRecommendation").FORECAST_INPUT || 0, 0);
});

test("audited source-class counts cannot drift", () => {
  assert.deepEqual(countBy("sourceClass"), {
    CANONICAL: 20,
    CANONICAL_WITH_FALLBACK: 12,
    DERIVED_HELPER: 9,
    DUPLICATED_LOGIC: 23,
    PRESENTATION_ONLY: 2,
    RAW_COLLECTION: 7,
    UNCLEAR: 1,
  });
});

test("schema rejects duplicate IDs, unknown collection/relationship references, and bad ambiguity targets", () => {
  const duplicate = copy();
  duplicate.capabilities.push({ ...duplicate.capabilities[0] });
  let validation = validateKnowledgeBase(duplicate, { checkSourcePaths: false });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /duplicate capability id|duplicate capability auditId/);

  const unknownCollection = copy();
  unknownCollection.capabilities[0].collections.push("not_a_collection");
  assert.match(validateKnowledgeBase(unknownCollection, { checkSourcePaths: false }).errors.join("\n"), /unknown collection/);

  const unknownRelationship = copy();
  unknownRelationship.capabilities[0].relationships.push("not_a_relationship");
  assert.match(validateKnowledgeBase(unknownRelationship, { checkSourcePaths: false }).errors.join("\n"), /unknown relationship/);

  const unknownAmbiguity = copy();
  unknownAmbiguity.ambiguousConcepts[0].candidates.push("not_a_capability");
  assert.match(validateKnowledgeBase(unknownAmbiguity, { checkSourcePaths: false }).errors.join("\n"), /ambiguous concept.*unknown capability/);
});

test("schema prevents unsafe/export/presentation readiness and validates extraction/direct sources", () => {
  const unsafeReady = copy();
  unsafeReady.capabilities.find((entry) => entry.assistantRecommendation === "NOT_ASSISTANT_SAFE").assistantStatus = "ready";
  assert.match(validateKnowledgeBase(unsafeReady, { checkSourcePaths: false }).errors.join("\n"), /non-analytical and cannot be marked ready/);

  const directWithoutService = copy();
  directWithoutService.capabilities.find((entry) => entry.assistantRecommendation === "DIRECT_CAPABILITY").sourceOfTruth.reusable = false;
  assert.match(validateKnowledgeBase(directWithoutService, { checkSourcePaths: false }).errors.join("\n"), /must reference a reusable canonical implementation/);

  const extractWithoutSource = copy();
  const extract = extractWithoutSource.capabilities.find((entry) => entry.assistantRecommendation === "EXTRACT_TO_SERVICE_THEN_CAPABILITY");
  extract.sourceOfTruth.controllerLocal = false;
  extract.sourceOfTruth.kind = "collection";
  assert.match(validateKnowledgeBase(extractWithoutSource, { checkSourcePaths: false }).errors.join("\n"), /must identify its current controller\/helper source/);
});

test("Knowledge Base validates relationship, source, and source-of-truth references", () => {
  const validation = validateKnowledgeBase();
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.ok(catalog.relationships.every((entry) => entry.sources.length > 0));
  assert.ok(catalog.sourceOfTruthRules.every((entry) => entry.sources.length > 0));
  assert.ok(catalog.businessDefinitions.every((entry) => catalog.sourceOfTruthRules.some((rule) => rule.id === entry.sourceOfTruthRule)));
  assert.ok(getRelationshipsForCollection("orders").some((entry) => entry.id === "order_shipment_entries"));
  assert.equal(getCapability("ITM-09").id, "final_pis_check");
  assert.equal(getCapability("partner_master_data").id, "vendor_master");
});

test("deterministic search covers IDs, audit IDs, purpose, aliases, intents, and concept mappings", () => {
  const first = searchCapabilities("packed goods");
  const second = searchCapabilities("packed goods");
  assert.deepEqual(first, second);
  assert.equal(first[0].id, "packed_goods");
  assert.equal(searchCapabilities("goods ready")[0].id, "packed_goods");
  assert.equal(searchCapabilities("ready to ship")[0].id, "packed_goods");
  assert.equal(searchCapabilities("ready CBM")[0].id, "packed_goods");
  assert.equal(searchCapabilities("SHP-01")[0].id, "packed_goods");
  assert.ok(first[0].matchScore > 0);
  assert.ok(first[0].matchedTerms.includes("packed"));
  assert.equal(first[0].assistantRecommendation, "DIRECT_CAPABILITY");
  assert.equal(first[0].assistantStatus, "existing_assistant_feature");
  assert.equal(getBusinessDefinition("po").id, "purchase_order");
  assert.ok(listCapabilities({ domain: "shipment_logistics" }).some((entry) => entry.id === "shipments"));
  assert.equal(getDomain("quality_control").id, "quality_control");
  assert.equal(getCollectionKnowledge("items").collection, "items");
});

test("ambiguous delay and PIS mismatch searches expose all audited candidates", () => {
  const delay = searchCapabilities("delay").filter((entry) => entry.ambiguityFlag);
  assert.deepEqual(new Set(delay.map((entry) => entry.id)), new Set(["delayed_po", "shipping_delay"]));
  assert.ok(delay.every((entry) => entry.ambiguity.candidates.includes("delayed_po")));
  assert.match(getAmbiguousConcept("delay").clarification, /Do you mean/);

  const pisMismatch = searchCapabilities("PIS mismatch").filter((entry) => entry.ambiguityFlag);
  assert.deepEqual(new Set(pisMismatch.map((entry) => entry.id)), new Set([
    "pis_differences",
    "final_pis_check",
    "pis_inspection_master_comparison",
    "qc_report_mismatch",
  ]));
});

test("Packed Goods preserves its audited canonical contract", () => {
  const packedGoods = getCapability("packed_goods");
  assert.equal(packedGoods.auditId, "SHP-01");
  assert.equal(packedGoods.sourceClass, "CANONICAL_WITH_FALLBACK");
  assert.equal(packedGoods.assistantRecommendation, "DIRECT_CAPABILITY");
  assert.equal(packedGoods.sourceOfTruth.canonicalFile, "backend/services/packedGoods.service.js");
  assert.deepEqual(packedGoods.sourceOfTruth.canonicalSymbols, ["buildPackedGoodsDataset"]);
  assert.equal(packedGoods.sourceOfTruth.reusable, true);
  assert.deepEqual(packedGoods.collections, ["orders", "qcs", "items"]);
  assert.equal(packedGoods.resultGrain, "order_line");
  assert.match(packedGoods.sourceOfTruth.rawFactsWarning, /Do not reconstruct Packed Goods/i);
  assert.deepEqual(packedGoods.routes.map((entry) => `${entry.method} ${entry.path}`), [
    "GET /orders/packed-goods",
    "GET /orders/packed-goods/export",
  ]);
  assert.ok(packedGoods.filters.some((entry) => entry.name === "brands"));
  assert.ok(packedGoods.filters.some((entry) => entry.name === "from_date"));
  assert.ok(packedGoods.outputFields.some((entry) => entry.name === "cbm_source"));
  assert.equal(packedGoods.cbmSemantics.provenanceRequired, true);
  assert.equal(packedGoods.cbmSemantics.partialQuantitiesProrated, true);
  assert.equal(packedGoods.statusSemantics.storedStatusAuthoritative, false);
});

test("current executable Final PIS truth and all 25 business questions are recorded", () => {
  const finalPis = getCapability("final_pis_check");
  assert.equal(catalog.uncertainties.length, 25);
  assert.match(finalPis.description, /Master/);
  assert.match(finalPis.sourceOfTruth.fallbackRules.join(" "), /PIS is not a fallback/i);
  assert.ok(finalPis.uncertainties.includes("BQ-10"));
  assert.equal(getCapability("product_analytics").assistantStatus, "blocked_business_confirmation");
  assert.equal(listCapabilities({ assistantRecommendation: "FORECAST_INPUT" }).length, 0);
});
