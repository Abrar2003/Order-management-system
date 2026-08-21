const {
  getAmbiguousConcept,
  getCapability,
  searchCapabilities,
} = require("./omsKnowledgeBase.service");

const MAX_PLANNER_CAPABILITIES = 8;

const words = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const containsPhrase = (question, phrase) => {
  const normalizedQuestion = ` ${words(question)} `;
  const normalizedPhrase = words(phrase);
  if (normalizedPhrase === "delay") return /\b(delay|delayed)\b/.test(normalizedQuestion);
  return Boolean(normalizedPhrase && normalizedQuestion.includes(` ${normalizedPhrase} `));
};

const findAmbiguousConceptsInQuestion = (question) => {
  const concepts = [
    "delay",
    "pending",
    "packed",
    "shipment",
    "pis mismatch",
    "inspection mismatch",
    "order status",
  ];
  return concepts
    .filter((phrase) => containsPhrase(question, phrase))
    .map((phrase) => getAmbiguousConcept(phrase))
    .filter(Boolean)
    .map((concept) => ({
      phrase: concept.phrase,
      candidates: concept.candidates,
      distinctions: concept.distinctions,
      clarification: concept.clarification,
    }));
};

const strongIntentCapabilityIds = (question) => {
  const text = words(question);
  const ids = [];
  if (/(packed goods|goods ready|ready goods|ready cbm|ready to ship|available to ship|inspected but unshipped|next container)/.test(text)) ids.push("packed_goods");
  if (/(monthly shipments|containers? shipped|shipped last month)/.test(text)) ids.push("monthly_shipments");
  if (/(shipment cbm|po cbm|cubic meter)/.test(text)) ids.push("shipment_cbm");
  return ids;
};

const resolvedTerms = (resolvedEntities = {}, resolvedDates = {}) => [
  ...(resolvedEntities.brands || []),
  ...(resolvedEntities.vendorNames || resolvedEntities.vendors || []),
  ...(resolvedEntities.itemCodes || resolvedEntities.items || []),
  ...(resolvedEntities.orderIds || resolvedEntities.pos || []),
  ...(resolvedEntities.containers || []),
  ...(resolvedDates ? Object.values(resolvedDates).filter((value) => typeof value === "string") : []),
].filter(Boolean);

const findRelevantCapabilities = ({
  question,
  resolvedEntities = {},
  resolvedDates = {},
  limit = 5,
} = {}) => {
  const searchText = [question, ...resolvedTerms(resolvedEntities, resolvedDates)].join(" ");
  const preferred = strongIntentCapabilityIds(question).map(getCapability).filter(Boolean);
  const searched = searchCapabilities(searchText, { limit: 20 });
  return [...new Map([...preferred, ...searched].map((entry) => [entry.id, entry])).values()]
    .slice(0, Math.max(1, Math.min(MAX_PLANNER_CAPABILITIES, Number(limit) || 5)));
};

const resolveAmbiguity = (question, ambiguity) => {
  const text = words(question);
  const has = (pattern) => pattern.test(text);
  if (ambiguity.phrase === "delay") {
    if (has(/\b(packed|pack|shipped|shipment|missed etd|late shipment)\b/)) return "shipping_delay";
    if (has(/\b(delayed|overdue)\b/)) return "delayed_po";
  }
  if (ambiguity.phrase === "pending") {
    if (has(/\binspection\b/)) return "pending_po";
    if (has(/\b(shipping|ship|unshipped)\b/)) return "shipping_pending";
    if (has(/\b(order|orders|po)\b/)) return "pending_po";
  }
  if (ambiguity.phrase === "packed") {
    if (has(/\b(cbm|ready|ship|goods)\b/)) return "packed_goods";
    if (has(/\b(late|missed|delay|etd)\b/)) return "shipping_delay";
  }
  if (ambiguity.phrase === "shipment") {
    if (has(/\b(month|last month)\b/)) return "monthly_shipments";
    if (has(/\b(cbm|cubic)\b/)) return "shipment_cbm";
    if (has(/\bcontainer\b/)) return "containers";
    if (has(/\b(next|when|likely|forecast|vendor|total|totals|report)\b/)) return "shipments";
  }
  if (ambiguity.phrase === "pis mismatch") {
    if (has(/\b(three|master|inspection)\b/)) return "pis_inspection_master_comparison";
  }
  if (ambiguity.phrase === "inspection mismatch" && has(/\b(history|historical|report)\b/)) return "qc_report_mismatch";
  if (ambiguity.phrase === "order status" && has(/\b(line|order)\b/)) return "order_list";
  return null;
};

const getCanonicalCapabilityGuidance = (question, { adapterIds = [] } = {}) => {
  const available = new Set(adapterIds);
  return strongIntentCapabilityIds(question)
    .map(getCapability)
    .find((capability) => capability
      && capability.assistantRecommendation === "DIRECT_CAPABILITY"
      && available.has(capability.id)) || null;
};

const compactCapability = (capability, adapterIds) => ({
  id: capability.id,
  name: capability.name,
  businessMeaning: capability.description,
  assistantRecommendation: capability.assistantRecommendation,
  assistantStatus: capability.assistantStatus,
  adapterAvailable: adapterIds.has(capability.id),
  availableFilters: capability.filters.map((filter) => filter.name),
  resultGrain: capability.resultGrain,
  sourceOfTruthWarning: capability.rawFactsWarning || capability.risks?.[0] || "",
  ambiguity: capability.uncertainties?.length ? "Business confirmation may be required for documented edge cases." : "",
});

const buildCapabilityPlannerContext = ({ capabilities = [], adapterIds = [] } = {}) => {
  const registered = new Set(adapterIds);
  if (!capabilities.length) return "- No strong OMS capability match was found; use a safe bounded investigation only if needed.";
  return capabilities.map((capability) => {
    const compact = compactCapability(capability, registered);
    return `- ${compact.id} (${compact.name}): ${compact.businessMeaning} Recommendation: ${compact.assistantRecommendation}; status: ${compact.assistantStatus}; adapter: ${compact.adapterAvailable ? "ready" : "not registered"}. Filters: ${compact.availableFilters.join(", ") || "none"}. Grain: ${compact.resultGrain}.${compact.sourceOfTruthWarning ? ` Warning: ${compact.sourceOfTruthWarning}` : ""}${compact.ambiguity ? ` Ambiguity: ${compact.ambiguity}` : ""}`;
  }).join("\n");
};

const classifyCapabilityPlan = ({
  question,
  resolvedEntities = {},
  resolvedDates = {},
  adapterIds = [],
} = {}) => {
  const capabilities = findRelevantCapabilities({ question, resolvedEntities, resolvedDates });
  const ambiguities = findAmbiguousConceptsInQuestion(question).map((ambiguity) => ({
    ...ambiguity,
    resolvedCapability: resolveAmbiguity(question, ambiguity),
  }));
  const unresolvedAmbiguities = ambiguities.filter((ambiguity) => !ambiguity.resolvedCapability);
  const canonicalCapability = getCanonicalCapabilityGuidance(question, { adapterIds });
  return {
    capabilities,
    canonicalCapability,
    ambiguities,
    clarification: unresolvedAmbiguities[0]?.clarification || "",
    context: buildCapabilityPlannerContext({ capabilities, adapterIds }),
  };
};

module.exports = {
  MAX_PLANNER_CAPABILITIES,
  buildCapabilityPlannerContext,
  classifyCapabilityPlan,
  findAmbiguousConceptsInQuestion,
  findRelevantCapabilities,
  getCanonicalCapabilityGuidance,
};
