const catalog = require("../knowledge/omsKnowledgeBase.catalog");
const { normalize, validateKnowledgeBase: validateCatalog } = require("../knowledge/omsKnowledgeBase.schema");

const normalizeQuery = (value) => normalize(value).replace(/[^a-z0-9]+/g, " ").trim();
const words = (value) => [...new Set(normalizeQuery(value).split(" ").filter(Boolean))];
const byId = (entries, id) => entries.find((entry) => entry.id === id) || null;
const freeze = (value) => Object.freeze(value);

const capabilityAliases = () => catalog.aliases
  .filter((alias) => alias.target?.kind === "capability")
  .reduce((result, alias) => {
    const aliases = result.get(alias.target.id) || [];
    aliases.push(alias.alias);
    result.set(alias.target.id, aliases);
    return result;
  }, new Map());

const getKnowledgeBase = () => catalog;

const getDomain = (id) => {
  const domain = byId(catalog.domains, id);
  if (!domain) return null;
  return freeze({
    ...domain,
    collections: catalog.collections.filter((entry) => entry.domain === domain.id),
    capabilities: catalog.capabilities.filter((entry) => entry.domain === domain.id),
  });
};

const getRelationshipsForCollection = (collectionId) => catalog.relationships.filter(
  (relationship) => relationship.from.collection === collectionId
    || relationship.to.collection === collectionId,
);

const getCollectionKnowledge = (id) => {
  const item = byId(catalog.collections, id);
  if (!item) return null;
  return freeze({
    ...item,
    relationships: getRelationshipsForCollection(item.id),
    capabilities: catalog.capabilities.filter((capability) => capability.collections.includes(item.id)),
  });
};

const getCapability = (id) => {
  const direct = byId(catalog.capabilities, id);
  if (direct) return direct;
  const alias = catalog.aliases.find(
    (entry) => normalizeQuery(entry.alias) === normalizeQuery(id)
      && entry.target?.kind === "capability",
  );
  return alias ? byId(catalog.capabilities, alias.target.id) : null;
};

const listCapabilities = ({ domain, assistantStatus } = {}) => catalog.capabilities.filter(
  (capability) => (!domain || capability.domain === domain)
    && (!assistantStatus || capability.assistantStatus === assistantStatus),
);

const searchCapabilities = (query, { domain, limit = 20 } = {}) => {
  const queryText = normalizeQuery(query);
  const queryWords = words(queryText);
  const aliases = capabilityAliases();
  const candidates = listCapabilities({ domain });
  if (!queryWords.length) return candidates.slice(0, Math.max(0, limit));

  return candidates
    .map((capability) => {
      const aliasValues = aliases.get(capability.id) || [];
      const fields = [
        capability.id,
        capability.name,
        capability.description,
        capability.domain,
        ...capability.keywords,
        ...aliasValues,
      ].map(normalizeQuery);
      const haystack = fields.join(" ");
      const matchedWords = queryWords.filter((word) => haystack.includes(word)).length;
      const exactAlias = aliasValues.some((alias) => normalizeQuery(alias) === queryText);
      const exactName = normalizeQuery(capability.name) === queryText;
      const exactId = normalizeQuery(capability.id) === queryText;
      const phraseMatch = queryText.length > 2 && haystack.includes(queryText);
      const score = (exactId ? 1000 : 0)
        + (exactName ? 900 : 0)
        + (exactAlias ? 800 : 0)
        + (phraseMatch ? 100 : 0)
        + (matchedWords * 10);
      return { capability, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score
      || left.capability.name.localeCompare(right.capability.name)
      || left.capability.id.localeCompare(right.capability.id))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map(({ capability }) => capability);
};

const getBusinessDefinition = (idOrTerm) => {
  const direct = byId(catalog.businessDefinitions, idOrTerm);
  if (direct) return direct;
  const query = normalizeQuery(idOrTerm);
  const alias = catalog.aliases.find(
    (entry) => normalizeQuery(entry.alias) === query
      && entry.target?.kind === "business_definition",
  );
  if (alias) return byId(catalog.businessDefinitions, alias.target.id);
  return catalog.businessDefinitions.find(
    (definition) => normalizeQuery(definition.term) === query,
  ) || null;
};

const validateKnowledgeBase = (input = catalog, options = {}) => validateCatalog(input, options);

module.exports = {
  getKnowledgeBase,
  getDomain,
  getCollectionKnowledge,
  getCapability,
  listCapabilities,
  searchCapabilities,
  getRelationshipsForCollection,
  getBusinessDefinition,
  validateKnowledgeBase,
};
