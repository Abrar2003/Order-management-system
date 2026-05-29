const LEGACY_SIZE_CLEANUP_GROUPS = Object.freeze({
  inspected_item: {
    modernPath: "inspected_item_sizes",
    legacyLbhPaths: Object.freeze([
      "inspected_item_LBH",
      "inspected_item_top_LBH",
      "inspected_item_bottom_LBH",
    ]),
    weightPath: "inspected_weight",
    weightKey: "net_weight",
    legacyWeightPaths: Object.freeze([
      "inspected_weight.top_net",
      "inspected_weight.bottom_net",
      "inspected_weight.total_net",
    ]),
  },
  inspected_box: {
    modernPath: "inspected_box_sizes",
    legacyLbhPaths: Object.freeze([
      "inspected_box_LBH",
      "inspected_box_top_LBH",
      "inspected_box_bottom_LBH",
      "inspected_top_LBH",
      "inspected_bottom_LBH",
    ]),
    weightPath: "inspected_weight",
    weightKey: "gross_weight",
    legacyWeightPaths: Object.freeze([
      "inspected_weight.top_gross",
      "inspected_weight.bottom_gross",
      "inspected_weight.total_gross",
    ]),
  },
  pis_item: {
    modernPath: "pis_item_sizes",
    legacyLbhPaths: Object.freeze([
      "pis_item_LBH",
      "pis_item_top_LBH",
      "pis_item_bottom_LBH",
    ]),
    weightPath: "pis_weight",
    weightKey: "net_weight",
    legacyWeightPaths: Object.freeze([
      "pis_weight.top_net",
      "pis_weight.bottom_net",
      "pis_weight.total_net",
    ]),
  },
  pis_box: {
    modernPath: "pis_box_sizes",
    legacyLbhPaths: Object.freeze([
      "pis_box_LBH",
      "pis_box_top_LBH",
      "pis_box_bottom_LBH",
    ]),
    weightPath: "pis_weight",
    weightKey: "gross_weight",
    legacyWeightPaths: Object.freeze([
      "pis_weight.top_gross",
      "pis_weight.bottom_gross",
      "pis_weight.total_gross",
    ]),
  },
});

const getPathValue = (source = {}, path = "") => {
  if (!source || !path) return undefined;
  if (typeof source.get === "function") return source.get(path);
  return path.split(".").reduce(
    (current, key) => (current == null ? undefined : current[key]),
    source,
  );
};

const hasPositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const entriesHaveDimensionData = (entries = []) =>
  (Array.isArray(entries) ? entries : []).some((entry = {}) =>
    ["L", "B", "H"].some((field) => hasPositiveNumber(entry?.[field])),
  );

const entriesHaveWeightData = (entries = [], weightKey = "") =>
  Boolean(weightKey) &&
  (Array.isArray(entries) ? entries : []).some((entry = {}) =>
    hasPositiveNumber(entry?.[weightKey]),
  );

const hasLegacyLbhData = (value = {}) => {
  if (!value || typeof value !== "object") return false;
  return ["L", "B", "H"].some((field) => value[field] !== undefined && value[field] !== null);
};

const hasLegacyWeightData = (value) => value !== undefined && value !== null;

const unsetPath = (doc, path = "") => {
  if (!doc || !path) return;
  if (typeof doc.set === "function") {
    doc.set(path, undefined);
  } else {
    const keys = path.split(".");
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!current || typeof current !== "object") return null;
      return current[key];
    }, doc);
    if (target && typeof target === "object") {
      delete target[lastKey];
    }
  }
  if (typeof doc.markModified === "function") {
    doc.markModified(path.split(".")[0]);
  }
};

const addCount = (counts, key) => {
  counts[key] = (counts[key] || 0) + 1;
};

const cleanupLegacyItemSizeFields = (itemDoc, { groups = null, dryRun = false } = {}) => {
  const groupKeys = Array.isArray(groups) && groups.length > 0
    ? groups
    : Object.keys(LEGACY_SIZE_CLEANUP_GROUPS);
  const changedPaths = [];
  const counts = {};

  groupKeys.forEach((groupKey) => {
    const config = LEGACY_SIZE_CLEANUP_GROUPS[groupKey];
    if (!config) return;

    const modernEntries = getPathValue(itemDoc, config.modernPath);
    const shouldClearLbh = entriesHaveDimensionData(modernEntries);
    const shouldClearWeight = entriesHaveWeightData(modernEntries, config.weightKey);

    if (shouldClearLbh) {
      config.legacyLbhPaths.forEach((path) => {
        if (!hasLegacyLbhData(getPathValue(itemDoc, path))) return;
        changedPaths.push(path);
        addCount(counts, `${groupKey}_lbh`);
        if (!dryRun) unsetPath(itemDoc, path);
      });
    }

    if (shouldClearWeight) {
      config.legacyWeightPaths.forEach((path) => {
        if (!hasLegacyWeightData(getPathValue(itemDoc, path))) return;
        changedPaths.push(path);
        addCount(counts, `${groupKey}_weight`);
        if (!dryRun) unsetPath(itemDoc, path);
      });
    }
  });

  return {
    changed: changedPaths.length > 0,
    changedPaths,
    counts,
  };
};

module.exports = {
  LEGACY_SIZE_CLEANUP_GROUPS,
  cleanupLegacyItemSizeFields,
};
