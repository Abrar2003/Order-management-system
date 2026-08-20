const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_CERTAINTIES = new Set(["verified", "strongly_inferred", "unknown"]);
const REQUIRED_SOURCE_CLASSES = new Set(["CANONICAL", "CANONICAL_WITH_FALLBACK", "DERIVED_HELPER", "RAW_COLLECTION", "PRESENTATION_ONLY", "DUPLICATED_LOGIC", "UNCLEAR"]);
const REQUIRED_ASSISTANT_RECOMMENDATIONS = new Set(["DIRECT_CAPABILITY", "EXTRACT_TO_SERVICE_THEN_CAPABILITY", "CAPABILITY_PLUS_MONGO", "RAW_MONGO", "FORECAST_INPUT", "NOT_ASSISTANT_SAFE", "EXPORT_ONLY", "PRESENTATION_ONLY"]);
const REQUIRED_ASSISTANT_STATUSES = new Set(["ready", "not_ready", "blocked_business_confirmation", "not_tool_eligible", "existing_assistant_feature"]);
const REQUIRED_SOURCE_OF_TRUTH_KINDS = new Set(["collection", "canonical_service", "canonical_report_query", "derived_helper", "frontend_presentation", "unmounted_route", "control_plane"]);
const REQUIRED_RAW_MONGO_MODES = new Set(["preferred_scoped_projection", "supplemental_scoped_projection", "not_primary", "denied"]);
const NON_ANALYTICAL_RECOMMENDATIONS = new Set(["NOT_ASSISTANT_SAFE", "EXPORT_ONLY", "PRESENTATION_ONLY"]);

const normalize = (value) => String(value || "").trim().toLowerCase();
const unique = (values) => new Set(values).size === values.length;
const sourcePaths = (sources = []) => sources.map((source) => typeof source === "string" ? source : source?.path).filter(Boolean);
const isText = (value) => Boolean(String(value || "").trim());
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

const validateKnowledgeBase = (catalog, { rootDir = path.resolve(__dirname, "..", ".."), checkSourcePaths = true } = {}) => {
  const errors = [];
  const warnings = [];
  const add = (condition, message) => { if (!condition) errors.push(message); };
  const arrays = ["domains", "collections", "capabilities", "relationships", "businessDefinitions", "aliases", "sourceOfTruthRules", "legacyData", "auditFindings", "businessConceptMappings", "ambiguousConcepts", "uncertainties"];

  add(catalog && typeof catalog === "object", "catalog must be an object");
  if (!catalog || typeof catalog !== "object") return { valid: false, errors, warnings, stats: {} };
  add(isText(catalog.version), "catalog.version is required");
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
  const auditIds = new Map();
  catalog.capabilities.forEach((capability, index) => {
    const id = String(capability?.id || "").trim();
    const auditId = String(capability?.auditId || "").trim();
    const label = id || index;
    add(Boolean(id && auditId && capability?.name && capability?.description && capability?.businessPurpose && capability?.domain && capability?.type), `capabilities[${index}] requires id, auditId, name, domain, description, businessPurpose, and type`);
    add(/^(ORD|SHP|QC|ITM|VEN|SAM|WF|CMP|OTH|SEC)-\d{2}$/.test(auditId), `capability ${label} has invalid auditId`);
    add(domains.has(capability?.domain), `capability ${label} references unknown domain ${capability?.domain || ""}`);
    if (capabilities.has(id)) errors.push(`duplicate capability id: ${id}`);
    if (auditIds.has(auditId)) errors.push(`duplicate capability auditId: ${auditId}`);
    capabilities.set(id, capability);
    auditIds.set(auditId, capability);
    if (!REQUIRED_CERTAINTIES.has(capability?.certainty)) errors.push(`capability ${label} has invalid certainty`);
    if (!REQUIRED_SOURCE_CLASSES.has(capability?.sourceClass)) errors.push(`capability ${label} has invalid source class`);
    if (!REQUIRED_ASSISTANT_RECOMMENDATIONS.has(capability?.assistantRecommendation)) errors.push(`capability ${label} has invalid Assistant recommendation`);
    if (!REQUIRED_ASSISTANT_STATUSES.has(capability?.assistantStatus)) errors.push(`capability ${label} has invalid Assistant status`);

    ["keywords", "aliases", "userIntentExamples", "collections", "relationships", "routes", "filters", "outputFields", "quantitySemantics", "limitations", "uncertainties", "risks", "sources"].forEach((key) => add(Array.isArray(capability?.[key]), `capability ${label} ${key} must be an array`));
    add(isText(capability?.resultGrain), `capability ${label} requires resultGrain`);
    add(capability?.sourceProvenance && isText(capability.sourceProvenance.audit) && isText(capability.sourceProvenance.implementation), `capability ${label} requires sourceProvenance`);
    add(capability?.safety?.readOnly === true && capability?.safety?.mutationAllowed === false, `capability ${label} must be read-only`);
    add(REQUIRED_RAW_MONGO_MODES.has(capability?.rawMongoPolicy?.mode), `capability ${label} has invalid raw Mongo policy`);
    (capability?.collections || []).forEach((collectionId) => { if (!collections.has(collectionId)) errors.push(`capability ${label} references unknown collection ${collectionId}`); });

    const truth = capability?.sourceOfTruth;
    add(truth && REQUIRED_SOURCE_OF_TRUTH_KINDS.has(truth.kind), `capability ${label} has invalid source-of-truth kind`);
    add(typeof truth?.canonical === "boolean", `capability ${label} sourceOfTruth.canonical must be boolean`);
    add(isText(truth?.canonicalFile), `capability ${label} requires sourceOfTruth.canonicalFile`);
    add(isStringArray(truth?.canonicalSymbols), `capability ${label} canonicalSymbols must be an array of strings`);
    add(typeof truth?.reusable === "boolean" && typeof truth?.controllerLocal === "boolean", `capability ${label} sourceOfTruth requires reusable/controllerLocal booleans`);
    add(isStringArray(truth?.fallbackRules), `capability ${label} fallbackRules must be an array of strings`);

    (capability?.filters || []).forEach((item, filterIndex) => {
      add(Boolean(item?.name && item?.type && typeof item?.required === "boolean" && isText(item?.semantics)), `capability ${label} filter ${filterIndex} is invalid`);
      add(isStringArray(item?.aliases), `capability ${label} filter ${filterIndex} aliases must be strings`);
    });
    (capability?.outputFields || []).forEach((item, fieldIndex) => add(Boolean(item?.name && item?.meaning && item?.valueType && item?.provenance), `capability ${label} output field ${fieldIndex} is invalid`));
    add(capability?.dateSemantics && Array.isArray(capability.dateSemantics.fields) && isText(capability.dateSemantics.timezone), `capability ${label} dateSemantics is invalid`);
    add(capability?.cbmSemantics && typeof capability.cbmSemantics.applicable === "boolean" && Array.isArray(capability.cbmSemantics.sourceHierarchy) && typeof capability.cbmSemantics.provenanceRequired === "boolean", `capability ${label} cbmSemantics is invalid`);
    add(capability?.statusSemantics && typeof capability.statusSemantics.applicable === "boolean", `capability ${label} statusSemantics is invalid`);

    if (NON_ANALYTICAL_RECOMMENDATIONS.has(capability?.assistantRecommendation) && capability?.assistantStatus !== "not_tool_eligible") errors.push(`capability ${label} is non-analytical and cannot be marked ready`);
    if (capability?.assistantRecommendation === "NOT_ASSISTANT_SAFE" && capability?.rawMongoPolicy?.mode !== "denied") errors.push(`capability ${label} is not Assistant-safe and raw Mongo must be denied`);
    if (capability?.assistantRecommendation === "DIRECT_CAPABILITY" && truth?.reusable !== true) errors.push(`DIRECT_CAPABILITY ${label} must reference a reusable canonical implementation`);
    if (capability?.assistantRecommendation === "EXTRACT_TO_SERVICE_THEN_CAPABILITY" && !(truth?.controllerLocal || ["derived_helper", "canonical_report_query"].includes(truth?.kind))) errors.push(`EXTRACT_TO_SERVICE_THEN_CAPABILITY ${label} must identify its current controller/helper source`);
  });

  if (catalog.scope?.auditCapabilityCount != null) {
    add(catalog.capabilities.length === catalog.scope.auditCapabilityCount, `catalog must contain ${catalog.scope.auditCapabilityCount} audited capabilities`);
    add(auditIds.size === catalog.scope.auditCapabilityCount, `catalog must contain ${catalog.scope.auditCapabilityCount} unique audit IDs`);
  }

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
  catalog.capabilities.forEach((capability) => capability.relationships.forEach((id) => { if (!relationshipIds.has(id)) errors.push(`capability ${capability.id} references unknown relationship ${id}`); }));

  const truthRuleIds = new Set();
  catalog.sourceOfTruthRules.forEach((rule, index) => {
    const id = String(rule?.id || "").trim();
    add(Boolean(id && rule?.description && rule?.canonicalSource), `sourceOfTruthRules[${index}] requires id, description, and canonicalSource`);
    if (truthRuleIds.has(id)) errors.push(`duplicate source-of-truth rule id: ${id}`);
    truthRuleIds.add(id);
    if (!REQUIRED_CERTAINTIES.has(rule?.certainty)) errors.push(`source-of-truth rule ${id || index} has invalid certainty`);
  });

  const definitionIds = new Set();
  catalog.businessDefinitions.forEach((definition, index) => {
    const id = String(definition?.id || "").trim();
    add(Boolean(id && definition?.term && definition?.definition && definition?.sourceOfTruthRule), `businessDefinitions[${index}] requires id, term, definition, and sourceOfTruthRule`);
    if (definitionIds.has(id)) errors.push(`duplicate business definition id: ${id}`);
    definitionIds.add(id);
    if (!truthRuleIds.has(definition?.sourceOfTruthRule)) errors.push(`business definition ${id} references unknown source-of-truth rule`);
  });

  const aliasKeys = catalog.aliases.map((alias) => normalize(alias?.alias));
  if (aliasKeys.some((alias) => !alias)) errors.push("aliases must have non-empty alias values");
  if (!unique(aliasKeys)) errors.push("duplicate alias values");
  catalog.aliases.forEach((alias, index) => {
    const target = alias?.target || {};
    const validTarget = (target.kind === "capability" && capabilities.has(target.id)) || (target.kind === "business_definition" && definitionIds.has(target.id)) || (target.kind === "collection" && collections.has(target.id));
    if (!validTarget) errors.push(`alias ${alias?.alias || index} has an unknown target`);
  });

  catalog.businessConceptMappings.forEach((mapping, index) => {
    add(Boolean(mapping?.phrase && mapping?.distinction && Array.isArray(mapping?.capabilityIds)), `businessConceptMappings[${index}] is invalid`);
    (mapping?.capabilityIds || []).forEach((id) => { if (!capabilities.has(id)) errors.push(`business concept ${mapping?.phrase || index} has unknown capability ${id}`); });
  });

  const ambiguousPhrases = new Set();
  catalog.ambiguousConcepts.forEach((concept, index) => {
    const phrase = normalize(concept?.phrase);
    add(Boolean(phrase && concept?.clarification && Array.isArray(concept?.candidates) && concept.candidates.length > 1 && Array.isArray(concept?.distinctions)), `ambiguousConcepts[${index}] is invalid`);
    if (ambiguousPhrases.has(phrase)) errors.push(`duplicate ambiguous concept: ${phrase}`);
    ambiguousPhrases.add(phrase);
    (concept?.candidates || []).forEach((id) => { if (!capabilities.has(id)) errors.push(`ambiguous concept ${concept?.phrase || index} has unknown capability ${id}`); });
  });

  const uncertaintyIds = new Set();
  catalog.uncertainties.forEach((uncertainty, index) => {
    const id = String(uncertainty?.id || "").trim();
    add(Boolean(id && uncertainty?.question && Array.isArray(uncertainty?.capabilityIds)), `uncertainties[${index}] is invalid`);
    if (uncertaintyIds.has(id)) errors.push(`duplicate uncertainty id: ${id}`);
    uncertaintyIds.add(id);
    (uncertainty?.capabilityIds || []).forEach((capabilityId) => { if (!capabilities.has(capabilityId)) errors.push(`uncertainty ${id || index} has unknown capability ${capabilityId}`); });
  });
  catalog.capabilities.forEach((capability) => capability.uncertainties.forEach((id) => { if (!uncertaintyIds.has(id)) errors.push(`capability ${capability.id} references unknown uncertainty ${id}`); }));

  const sources = [...catalog.collections, ...catalog.capabilities, ...catalog.relationships, ...catalog.businessDefinitions, ...catalog.sourceOfTruthRules, ...catalog.legacyData, ...catalog.auditFindings].flatMap((entry) => sourcePaths(entry?.sources));
  catalog.capabilities.forEach((capability) => sources.push(capability.sourceOfTruth.canonicalFile, capability.sourceProvenance.audit));
  if (checkSourcePaths) [...new Set(sources)].forEach((source) => { if (!fs.existsSync(path.resolve(rootDir, source))) errors.push(`source path does not exist: ${source}`); });
  if (!sources.length) warnings.push("catalog contains no provenance source paths");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      domains: catalog.domains.length,
      collections: catalog.collections.length,
      capabilities: catalog.capabilities.length,
      auditIds: auditIds.size,
      relationships: catalog.relationships.length,
      businessDefinitions: catalog.businessDefinitions.length,
      ambiguousConcepts: catalog.ambiguousConcepts.length,
      uncertainties: catalog.uncertainties.length,
      sourcePaths: new Set(sources).size,
    },
  };
};

module.exports = { REQUIRED_ASSISTANT_RECOMMENDATIONS, REQUIRED_ASSISTANT_STATUSES, REQUIRED_CERTAINTIES, REQUIRED_SOURCE_CLASSES, REQUIRED_SOURCE_OF_TRUTH_KINDS, normalize, validateKnowledgeBase };
