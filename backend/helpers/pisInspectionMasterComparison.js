const BLANK_REMARK_KEY = "__blank__";
const MISSING_VALUE = "";
const NUMBER_TOLERANCE = 0.000001;

const normalizeRemark = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalized || BLANK_REMARK_KEY;
};

const getDisplayRemark = (entry = {}, fallbackKey = BLANK_REMARK_KEY) => {
  const raw = String(entry?.remark || entry?.type || entry?.box_type || "").trim();
  if (raw) return raw;
  return fallbackKey === BLANK_REMARK_KEY ? "" : fallbackKey;
};

const indexSizeArrayByRemark = (entries = []) => {
  const index = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry = {}, entryIndex) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const key = normalizeRemark(entry?.remark || entry?.type || entry?.box_type);
    if (!index.has(key)) {
      index.set(key, {
        entry,
        label: getDisplayRemark(entry, key),
        firstIndex: entryIndex,
      });
    }
  });
  return index;
};

const hasOwn = (source = {}, key = "") =>
  Object.prototype.hasOwnProperty.call(source || {}, key);

const hasAvailableValue = (entry = {}, key = "") => {
  if (!entry || typeof entry !== "object" || !hasOwn(entry, key)) return false;
  const value = entry[key];
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
};

const readCellValue = (entry = {}, key = "") =>
  hasAvailableValue(entry, key) ? entry[key] : MISSING_VALUE;

const compareAvailableValues = (left, right) => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumeric =
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    String(left).trim() !== "" &&
    String(right).trim() !== "";

  if (bothNumeric) {
    return Math.abs(leftNumber - rightNumber) <= NUMBER_TOLERANCE;
  }

  return String(left ?? "").trim().toLowerCase() ===
    String(right ?? "").trim().toLowerCase();
};

const getCellStatus = (value, referenceValues = []) => {
  if (value === MISSING_VALUE) return "missing";
  const availableReferences = referenceValues.filter(
    (referenceValue) => referenceValue !== MISSING_VALUE,
  );
  if (availableReferences.length === 0) return "match";
  return availableReferences.every((referenceValue) =>
    compareAvailableValues(value, referenceValue)
  )
    ? "match"
    : "mismatch";
};

const buildComparisonRows = ({
  pisEntries = [],
  inspectionEntries = [],
  masterEntries = [],
  fields = [],
} = {}) => {
  const pisIndex = indexSizeArrayByRemark(pisEntries);
  const masterIndex = indexSizeArrayByRemark(masterEntries);
  const inspectionIndexes = (Array.isArray(inspectionEntries)
    ? inspectionEntries
    : []
  ).map((entries) => indexSizeArrayByRemark(entries));

  const remarkKeys = [];
  const pushRemarkKey = (key) => {
    if (key && !remarkKeys.includes(key)) remarkKeys.push(key);
  };

  pisIndex.forEach((_, key) => pushRemarkKey(key));
  inspectionIndexes.forEach((inspectionIndex) =>
    inspectionIndex.forEach((_, key) => pushRemarkKey(key))
  );
  masterIndex.forEach((_, key) => pushRemarkKey(key));

  return remarkKeys.flatMap((remarkKey) => {
    const pisEntry = pisIndex.get(remarkKey)?.entry || {};
    const masterEntry = masterIndex.get(remarkKey)?.entry || {};
    const inspectionEntryList = inspectionIndexes.map(
      (inspectionIndex) => inspectionIndex.get(remarkKey)?.entry || {},
    );
    const displayRemark =
      pisIndex.get(remarkKey)?.label ||
      inspectionIndexes.map((inspectionIndex) => inspectionIndex.get(remarkKey)?.label).find(Boolean) ||
      masterIndex.get(remarkKey)?.label ||
      "";

    return fields.map((field) => {
      const fieldKey = String(field?.key || "").trim();
      const pis = readCellValue(pisEntry, fieldKey);
      const master = readCellValue(masterEntry, fieldKey);
      const inspectionValues = inspectionEntryList.map((entry) =>
        readCellValue(entry, fieldKey)
      );
      const references = [pis, master].filter((value) => value !== MISSING_VALUE);
      const cell_status = {
        pis: pis === MISSING_VALUE ? "missing" : "match",
        master: getCellStatus(master, [pis]),
      };
      inspectionValues.forEach((value, index) => {
        cell_status[`inspection_${index + 1}`] = getCellStatus(value, references);
      });

      const availableValues = [pis, ...inspectionValues, master].filter(
        (value) => value !== MISSING_VALUE,
      );
      const mismatch =
        availableValues.length > 1 &&
        (
          references.length > 0
            ? availableValues.some((value) =>
                references.some((reference) => !compareAvailableValues(value, reference))
              )
            : !availableValues.every((value) => compareAvailableValues(value, availableValues[0]))
        );

      return {
        remark: displayRemark,
        remark_key: remarkKey,
        field: fieldKey,
        label: field?.label || fieldKey,
        pis,
        inspection_1: inspectionValues[0] ?? MISSING_VALUE,
        inspection_2: inspectionValues[1] ?? MISSING_VALUE,
        inspection_3: inspectionValues[2] ?? MISSING_VALUE,
        master,
        cell_status,
        mismatch,
      };
    });
  });
};

module.exports = {
  BLANK_REMARK_KEY,
  buildComparisonRows,
  indexSizeArrayByRemark,
  normalizeRemark,
};
