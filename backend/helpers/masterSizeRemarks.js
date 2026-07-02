const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const cloneSizeEntry = (entry = {}) => {
  if (!entry || typeof entry !== "object") return {};
  if (typeof entry.toObject === "function") {
    return entry.toObject({ depopulate: true });
  }
  return { ...entry };
};

const hasBlankRemark = (entry = {}) => !normalizeText(entry?.remark);

const normalizeSingleMasterSizeRemark = (entries = [], defaultRemark = "") => {
  const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) =>
    cloneSizeEntry(entry),
  );

  if (nextEntries.length === 1 && defaultRemark && hasBlankRemark(nextEntries[0])) {
    nextEntries[0].remark = defaultRemark;
  }

  return nextEntries;
};

const normalizeSingleItemSizeRemarks = (entries = []) =>
  normalizeSingleMasterSizeRemark(entries, "item");

const normalizeSingleBoxSizeRemarks = (entries = []) =>
  normalizeSingleMasterSizeRemark(entries, "box");

const normalizeSingleMasterItemSizeRemarks = normalizeSingleItemSizeRemarks;
const normalizeSingleMasterBoxSizeRemarks = normalizeSingleBoxSizeRemarks;

const normalizeSingleMasterSizeRemarks = ({
  master_item_sizes,
  masterItemSizes,
  master_box_sizes,
  masterBoxSizes,
} = {}) => ({
  master_item_sizes: normalizeSingleMasterItemSizeRemarks(
    master_item_sizes ?? masterItemSizes,
  ),
  master_box_sizes: normalizeSingleMasterBoxSizeRemarks(
    master_box_sizes ?? masterBoxSizes,
  ),
});

const needsSingleMasterItemRemarkBackfill = (entries = []) =>
  Array.isArray(entries) && entries.length === 1 && hasBlankRemark(entries[0]);

const needsSingleMasterBoxRemarkBackfill = (entries = []) =>
  Array.isArray(entries) && entries.length === 1 && hasBlankRemark(entries[0]);

module.exports = {
  normalizeKey,
  normalizeSingleItemSizeRemarks,
  normalizeSingleBoxSizeRemarks,
  normalizeSingleMasterItemSizeRemarks,
  normalizeSingleMasterBoxSizeRemarks,
  normalizeSingleMasterSizeRemarks,
  needsSingleMasterItemRemarkBackfill,
  needsSingleMasterBoxRemarkBackfill,
};
