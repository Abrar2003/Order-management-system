const mongoose = require("mongoose");

const ITEM_UPDATE_HISTORY_LIMIT = 200;
const MAX_STORED_STRING_LENGTH = 800;
const MAX_STORED_JSON_LENGTH = 1200;

const IGNORED_PATHS = new Set([
  "_id",
  "id",
  "__v",
  "createdAt",
  "updatedAt",
  "update_history",
  "pd_history",
  "form_drafts",
]);

const normalizeText = (value) => String(value ?? "").trim();

const isPlainObject = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof mongoose.Types.ObjectId);

const toPlainValue = (value) => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (typeof value?.toObject === "function") {
    return toPlainValue(value.toObject({ depopulate: true }));
  }
  if (Array.isArray(value)) return value.map(toPlainValue);
  if (isPlainObject(value)) {
    return Object.keys(value)
      .filter((key) => key !== "_id")
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = toPlainValue(value[key]);
        return accumulator;
      }, {});
  }
  if (typeof value === "string") return value;
  if (["number", "boolean"].includes(typeof value)) return value;
  return String(value);
};

const stableStringify = (value) => JSON.stringify(toPlainValue(value));

const valuesEqual = (left, right) => stableStringify(left) === stableStringify(right);

const shouldIgnorePath = (path = "") => {
  if (!path) return false;
  if (IGNORED_PATHS.has(path)) return true;
  const [root] = path.split(".");
  return IGNORED_PATHS.has(root);
};

const compactValue = (value) => {
  const plainValue = toPlainValue(value);

  if (typeof plainValue === "string") {
    if (plainValue.length <= MAX_STORED_STRING_LENGTH) return plainValue;
    return `${plainValue.slice(0, MAX_STORED_STRING_LENGTH)}...`;
  }

  if (Array.isArray(plainValue) || isPlainObject(plainValue)) {
    const serialized = JSON.stringify(plainValue);
    if (serialized.length <= MAX_STORED_JSON_LENGTH) return plainValue;
    return {
      summary: Array.isArray(plainValue)
        ? `Array(${plainValue.length})`
        : `Object(${Object.keys(plainValue || {}).length})`,
      truncated: serialized.slice(0, MAX_STORED_JSON_LENGTH),
    };
  }

  return plainValue;
};

const collectChangedPaths = (beforeValue, afterValue, prefix = "") => {
  if (shouldIgnorePath(prefix)) return [];

  const beforePlain = toPlainValue(beforeValue);
  const afterPlain = toPlainValue(afterValue);
  if (valuesEqual(beforePlain, afterPlain)) return [];

  const beforeIsObject = isPlainObject(beforePlain);
  const afterIsObject = isPlainObject(afterPlain);
  if (beforeIsObject && afterIsObject) {
    const keys = new Set([
      ...Object.keys(beforePlain || {}),
      ...Object.keys(afterPlain || {}),
    ]);
    const nestedChanges = [];
    for (const key of keys) {
      const path = prefix ? `${prefix}.${key}` : key;
      nestedChanges.push(
        ...collectChangedPaths(beforePlain?.[key], afterPlain?.[key], path),
      );
    }
    return nestedChanges.length > 0 ? nestedChanges : [prefix].filter(Boolean);
  }

  return [prefix].filter(Boolean);
};

const buildFieldChangeSnapshot = (before = {}, after = {}, changedFields = []) =>
  changedFields.reduce(
    (accumulator, fieldPath) => {
      const pathParts = fieldPath.split(".");
      const beforeValue = pathParts.reduce(
        (current, key) => (current && Object.prototype.hasOwnProperty.call(current, key)
          ? current[key]
          : undefined),
        before,
      );
      const afterValue = pathParts.reduce(
        (current, key) => (current && Object.prototype.hasOwnProperty.call(current, key)
          ? current[key]
          : undefined),
        after,
      );

      accumulator.before[fieldPath] = compactValue(beforeValue);
      accumulator.after[fieldPath] = compactValue(afterValue);
      return accumulator;
    },
    { before: {}, after: {} },
  );

const buildItemHistoryActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name:
    normalizeText(user?.name) ||
    normalizeText(user?.email) ||
    normalizeText(user?.username) ||
    normalizeText(user?.role),
  role: normalizeText(user?.role),
});

const appendItemUpdateHistory = (
  item,
  {
    before = {},
    after = null,
    reqUser = {},
    action = "update",
    source = "",
    route = "",
    metadata = {},
    timestamp = new Date(),
  } = {},
) => {
  if (!item) return null;

  const afterSnapshot = after || (typeof item.toObject === "function" ? item.toObject() : item);
  const changedFields = collectChangedPaths(before || {}, afterSnapshot || {})
    .filter((fieldPath) => !shouldIgnorePath(fieldPath))
    .sort();

  if (changedFields.length === 0 && action !== "create") {
    return null;
  }

  const snapshot = buildFieldChangeSnapshot(before || {}, afterSnapshot || {}, changedFields);
  const entry = {
    action: normalizeText(action) || "update",
    source: normalizeText(source),
    route: normalizeText(route),
    actor: buildItemHistoryActor(reqUser),
    timestamp,
    changed_fields: changedFields,
    before: snapshot.before,
    after: snapshot.after,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };

  const currentHistory = Array.isArray(item.update_history) ? item.update_history : [];
  item.update_history = [...currentHistory, entry].slice(-ITEM_UPDATE_HISTORY_LIMIT);
  if (typeof item.markModified === "function") {
    item.markModified("update_history");
  }

  return entry;
};

module.exports = {
  ITEM_UPDATE_HISTORY_LIMIT,
  appendItemUpdateHistory,
  buildItemHistoryActor,
};
