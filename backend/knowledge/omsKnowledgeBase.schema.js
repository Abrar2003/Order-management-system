const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_CERTAINTIES = new Set(["verified", "strongly_inferred", "unknown"]);
const REQUIRED_SOURCE_OF_TRUTH_KINDS = new Set([
  "collection",
  "canonical_service",
  "canonical_report_query",
  "derived_helper",
  "frontend_presentation",
  "legacy_compatibility",
]);

const normalize = (value) => String(value || "").trim().toLowerCase();
const unique = (values) => new Set(values).size === values.length;
const sourcePaths = (sources = []) => sources
  .map((source) => typeof source === "string" ? source : source?.path)
  .filter(Boolean);

const validateKnowledgeBase = (catalog, {
  rootDir = path.resolve(__dirname, "..", ".."),
  checkSourcePaths = true,
} = {}) => {
  const errors = [];
  const warnings = [];
  const add = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const arrays = [
    "domains",
    "collections",
    "capabilities",
    "relationships",
    "businessDefinitions",
    "aliases",
    "sourceOfTruthRules",
    "legacyData",
    "auditFindings",
  ];

  add(catalog && typeof catalog === "object", "catalog must be an object");
  if (!catalog || typeof catalog !== "object") {
    return { valid: false, errors, warnings, stats: {} };
  }

  add(Boolean(String(catalog.version || "").trim()), "catalog.version is required");
  arrays.forEach((key) => add(Array.isArray(catalog[key]), `catalog.${key} must be an array`));
  if (errors.length) return { valid: false, errors, warnings, stats: {} };

  const domains = new Map();
  catalog.domains.forEach((domain, index) => {
    const id = String(domain?.id || "").trim();
    add(Boolean(id && domain?.name && domain?.description), `domains[${index}] requires id, name, and description`);
    if (domains.has(id)) errors.push(`duplicate domain id: ${id}`);
    domains.set(id, domain);
  });

  const collections = new Map();
  catalog.collections.forEach((collection, index) => {
    const id = String(collection?.id || "").trim();
    add(Boolean(id && collection?.collection && collection?.description && collection?.domain), `collections[${index}] requires id, collection, domain, and description`);
    add(domains.has(collection?.domain), `collection ${id || index} references unknown domain ${collection?.domain || ""}`);
    if (collections.has(id)) errors.push(`duplicate collection id: ${id}`);
    if (!REQUIRED_CERTAINTIES.has(collection?.certainty)) errors.push(`collection ${id || index} has invalid certainty`);
    collections.set(id, collection);
  });

  const capabilities = new Map();
  catalog.capabilities.forEach((capability, index) => {
    const id = String(capability?.id || "").trim();
    add(Boolean(id && capability?.name && capability?.description && capability?.domain), `capabilities[${index}] requires id, name, domain, and description`);
    add(domains.has(capability?.domain), `capability ${id || index} references unknown domain ${capability?.domain || ""}`);
    if (capabilities.has(id)) errors.push(`duplicate capability id: ${id}`);
    if (!REQUIRED_CERTAINTIES.has(capability?.certainty)) errors.push(`capability ${id || index} has invalid certainty`);
    if (!REQUIRED_SOURCE_OF_TRUTH_KINDS.has(capability?.sourceOfTruth?.kind)) {
      errors.push(`capability ${id || index} has invalid source-of-truth kind`);
    }
    (capability?.collections || []).forEach((collectionId) => {
      if (!collections.has(collectionId)) errors.push(`capability ${id || index} references unknown collection ${collectionId}`);
    });
    capabilities.set(id, capability);
  });

  const relationshipIds = new Set();
  catalog.relationships.forEach((relationship, index) => {
    const id = String(relationship?.id || "").trim();
    add(Boolean(id && relationship?.from && relationship?.to && relationship?.description), `relationships[${index}] requires id, from, to, and description`);
    if (relationshipIds.has(id)) errors.push(`duplicate relationship id: ${id}`);
    relationshipIds.add(id);
    if (!collections.has(relationship?.from?.collection)) errors.push(`relationship ${id || index} has unknown from collection`);
    if (!collections.has(relationship?.to?.collection)) errors.push(`relationship ${id || index} has unknown to collection`);
    if (!REQUIRED_CERTAINTIES.has(relationship?.certainty)) errors.push(`relationship ${id || index} has invalid certainty`);
  });

  const definitionIds = new Set();
  catalog.businessDefinitions.forEach((definition, index) => {
    const id = String(definition?.id || "").trim();
    add(Boolean(id && definition?.term && definition?.definition && definition?.sourceOfTruthRule), `businessDefinitions[${index}] requires id, term, definition, and sourceOfTruthRule`);
    if (definitionIds.has(id)) errors.push(`duplicate business definition id: ${id}`);
    definitionIds.add(id);
  });

  const truthRuleIds = new Set();
  catalog.sourceOfTruthRules.forEach((rule, index) => {
    const id = String(rule?.id || "").trim();
    add(Boolean(id && rule?.description && rule?.canonicalSource), `sourceOfTruthRules[${index}] requires id, description, and canonicalSource`);
    if (truthRuleIds.has(id)) errors.push(`duplicate source-of-truth rule id: ${id}`);
    truthRuleIds.add(id);
    if (!REQUIRED_CERTAINTIES.has(rule?.certainty)) errors.push(`source-of-truth rule ${id || index} has invalid certainty`);
  });
  catalog.businessDefinitions.forEach((definition) => {
    if (!truthRuleIds.has(definition?.sourceOfTruthRule)) {
      errors.push(`business definition ${definition?.id || ""} references unknown source-of-truth rule`);
    }
  });

  const aliasKeys = catalog.aliases.map((alias) => normalize(alias?.alias));
  if (aliasKeys.some((alias) => !alias)) errors.push("aliases must have non-empty alias values");
  if (!unique(aliasKeys)) errors.push("duplicate alias values");
  catalog.aliases.forEach((alias, index) => {
    const target = alias?.target || {};
    const validTarget = (target.kind === "capability" && capabilities.has(target.id))
      || (target.kind === "business_definition" && definitionIds.has(target.id))
      || (target.kind === "collection" && collections.has(target.id));
    if (!validTarget) errors.push(`alias ${alias?.alias || index} has an unknown target`);
  });

  const sources = [
    ...catalog.collections,
    ...catalog.capabilities,
    ...catalog.relationships,
    ...catalog.businessDefinitions,
    ...catalog.sourceOfTruthRules,
    ...catalog.legacyData,
    ...catalog.auditFindings,
  ].flatMap((entry) => sourcePaths(entry?.sources));
  if (checkSourcePaths) {
    sources.forEach((source) => {
      if (!fs.existsSync(path.resolve(rootDir, source))) errors.push(`source path does not exist: ${source}`);
    });
  }
  if (!sources.length) warnings.push("catalog contains no provenance source paths");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      domains: catalog.domains.length,
      collections: catalog.collections.length,
      capabilities: catalog.capabilities.length,
      relationships: catalog.relationships.length,
      businessDefinitions: catalog.businessDefinitions.length,
      sourcePaths: new Set(sources).size,
    },
  };
};

module.exports = {
  REQUIRED_CERTAINTIES,
  REQUIRED_SOURCE_OF_TRUTH_KINDS,
  normalize,
  validateKnowledgeBase,
};
