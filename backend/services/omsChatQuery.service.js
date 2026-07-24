const mongoose = require("mongoose");
const {
  CATALOG,
  DENIED_COLLECTIONS,
  IST_TIMEZONE,
} = require("./omsChatCatalog.service");

const MAX_USER_STAGES = 12;
const MAX_LOOKUP_DEPTH = 2;
const MAX_ROWS = 100;
const MAX_LOOKUP_ROWS = 20;
const MAX_SKIP = 10_000;
const MAX_TOOL_ARGUMENT_BYTES = 32 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;
const QUERY_TIMEOUT_MS = 8_000;

const ALLOWED_STAGES = new Set([
  "$match",
  "$project",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$unwind",
  "$addFields",
  "$set",
  "$unset",
  "$count",
  "$lookup",
  "$replaceRoot",
  "$replaceWith",
]);

const QUERY_OPERATORS = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
  "$regex",
  "$options",
  "$not",
  "$size",
  "$type",
]);

const EXPRESSION_OPERATORS = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$and",
  "$or",
  "$not",
  "$ifNull",
  "$cond",
  "$switch",
  "$type",
  "$isArray",
  "$toString",
  "$toLower",
  "$toUpper",
  "$trim",
  "$convert",
  "$toDate",
  "$dateFromString",
  "$dateToString",
  "$dateTrunc",
  "$dateDiff",
  "$year",
  "$month",
  "$dayOfMonth",
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$first",
  "$last",
  "$add",
  "$subtract",
  "$multiply",
  "$divide",
  "$round",
  "$ceil",
  "$floor",
  "$abs",
  "$size",
  "$arrayElemAt",
  "$concat",
  "$strLenCP",
  "$literal",
  "$regexMatch",
  "$strcasecmp",
]);

const ACCUMULATORS = new Set([
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$first",
  "$last",
]);

const LOGICAL_QUERY_OPERATORS = new Set(["$and", "$or", "$nor"]);
const DANGEROUS_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "$out",
  "$merge",
  "$function",
  "$accumulator",
  "$where",
  "$currentOp",
  "$listSessions",
  "$listLocalSessions",
  "$unionWith",
  "$graphLookup",
  "$facet",
  "mapReduce",
  "eval",
]);

class OmsChatQueryError extends Error {
  constructor(message, { statusCode = 422, category = "unsafe_query" } = {}) {
    super(message);
    this.name = "OmsChatQueryError";
    this.statusCode = statusCode;
    this.category = category;
    this.expose = true;
  }
}

const fail = (message) => {
  throw new OmsChatQueryError(message);
};

const isReadableCollection = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(value)) {
    return false;
  }
  const normalized = value.toLowerCase();
  return !DENIED_COLLECTIONS.some((denied) =>
    denied.endsWith(".*")
      ? normalized.startsWith(denied.slice(0, -1))
      : normalized === denied);
};

const createDatabaseTimeoutError = () =>
  new OmsChatQueryError("The OMS report timed out safely", {
    statusCode: 504,
    category: "database_timeout",
  });

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const scanForDangerousKeys = (value, depth = 0) => {
  if (depth > 40) fail("Query nesting is too deep");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => scanForDangerousKeys(entry, depth + 1));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      fail(`Unsupported or dangerous query operator: ${key}`);
    }
    scanForDangerousKeys(nested, depth + 1);
  }
};

const normalizeExtendedJson = (value, depth = 0) => {
  if (depth > 40) fail("Query nesting is too deep");
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeExtendedJson(entry, depth + 1));
  }
  if (!isPlainObject(value)) return value;

  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$date") {
    if (typeof value.$date !== "string" || value.$date.length > 64) {
      fail("Invalid extended JSON date");
    }
    const date = new Date(value.$date);
    if (Number.isNaN(date.getTime())) fail("Invalid extended JSON date");
    return date;
  }
  if (keys.length === 1 && keys[0] === "$oid") {
    if (
      typeof value.$oid !== "string"
      || !mongoose.Types.ObjectId.isValid(value.$oid)
    ) {
      fail("Invalid extended JSON object id");
    }
    return new mongoose.Types.ObjectId(value.$oid);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      normalizeExtendedJson(nested, depth + 1),
    ]),
  );
};

const parseToolArguments = (rawArguments) => {
  const startedAt = Date.now();
  if (typeof rawArguments !== "string") {
    fail("Tool arguments must be JSON");
  }
  if (Buffer.byteLength(rawArguments, "utf8") > MAX_TOOL_ARGUMENT_BYTES) {
    fail("Tool arguments are too large");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    fail("Tool arguments are not valid JSON");
  }
  try {
    if (!isPlainObject(parsed)) fail("Tool arguments must be an object");
    scanForDangerousKeys(parsed);

    const allowedKeys = new Set(["collection", "pipeline", "purpose"]);
    for (const key of Object.keys(parsed)) {
      if (!allowedKeys.has(key)) fail(`Unknown tool argument: ${key}`);
    }

    const collection = String(parsed.collection || "").trim();
    const purpose = String(parsed.purpose || "").trim();
    if (!isReadableCollection(collection)) fail("That OMS data source is not available");
    if (!purpose || purpose.length > 300) {
      fail("A short query purpose is required");
    }
    if (!Array.isArray(parsed.pipeline)) fail("Pipeline must be an array");

    return {
      collection,
      purpose,
      pipeline: normalizeExtendedJson(parsed.pipeline),
    };
  } catch (error) {
    if (error instanceof OmsChatQueryError && !error.audit) {
      error.audit = {
        collection: typeof parsed?.collection === "string"
          ? parsed.collection.trim().slice(0, 120)
          : "",
        stageCount: countPipelineStages(parsed?.pipeline),
        durationMs: Date.now() - startedAt,
        returnedRows: 0,
        truncated: false,
      };
    }
    throw error;
  }
};

const isSafeOutputName = (value) =>
  typeof value === "string"
  && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)
  && !value.startsWith("__oms")
  && !DANGEROUS_KEYS.has(value);

const validateOutputName = (value) => {
  if (!isSafeOutputName(value)) fail(`Unsafe output field name: ${value}`);
};

const createState = (collection) => ({
  collection,
  rawFields: new Set(CATALOG[collection]?.fields || []),
  derivedFields: new Set(),
  shaped: false,
});

const cloneState = (state) => ({
  collection: state.collection,
  rawFields: new Set(state.rawFields),
  derivedFields: new Set(state.derivedFields),
  shaped: state.shaped,
});

const validateFieldPath = (value) => {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    fail("Invalid field path");
  }
  const path = value.startsWith("$") ? value.slice(1) : value;
  if (
    path.startsWith("$")
    || path.split(".").some((part) => DANGEROUS_KEYS.has(part))
  ) {
    fail(`Unsafe field path: ${path}`);
  }
  return path;
};

const validateLiteral = (value, depth = 0) => {
  if (depth > 30) fail("Expression nesting is too deep");
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Non-finite numbers are not supported");
    return;
  }
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return;
  if (Array.isArray(value)) {
    if (value.length > 500) fail("Literal array is too large");
    value.forEach((entry) => validateLiteral(entry, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (key.startsWith("$")) fail(`Unsupported literal operator: ${key}`);
      validateOutputName(key);
      validateLiteral(nested, depth + 1);
    }
    return;
  }
  fail("Unsupported literal value");
};

const validateExpression = (
  expression,
  state,
  variables = new Set(),
  depth = 0,
) => {
  if (depth > 30) fail("Expression nesting is too deep");
  if (typeof expression === "string") {
    if (expression.startsWith("$$")) {
      const variable = expression.slice(2).split(".")[0];
      if (!variables.has(variable)) fail(`Unknown aggregation variable: ${variable}`);
      return;
    }
    if (expression.startsWith("$")) {
      validateFieldPath(expression, state);
    }
    return;
  }
  if (
    expression === null
    || typeof expression === "boolean"
    || typeof expression === "number"
    || expression instanceof Date
    || expression instanceof mongoose.Types.ObjectId
  ) {
    validateLiteral(expression);
    return;
  }
  if (Array.isArray(expression)) {
    if (expression.length > 500) fail("Expression array is too large");
    expression.forEach((entry) =>
      validateExpression(entry, state, variables, depth + 1));
    return;
  }
  if (!isPlainObject(expression)) fail("Unsupported expression value");

  const entries = Object.entries(expression);
  if (entries.length === 0) return;
  const operatorEntries = entries.filter(([key]) => key.startsWith("$"));
  if (operatorEntries.length > 0) {
    if (entries.length !== 1) fail("An expression operator must be the only key");
    const [[operator, argument]] = operatorEntries;
    if (!EXPRESSION_OPERATORS.has(operator)) {
      fail(`Unsupported expression operator: ${operator}`);
    }
    if (operator === "$literal") {
      validateLiteral(argument, depth + 1);
      return;
    }
    validateExpression(argument, state, variables, depth + 1);
    return;
  }

  for (const [key, nested] of entries) {
    validateOutputName(key);
    validateExpression(nested, state, variables, depth + 1);
  }
};

const validateFieldCondition = (condition, state, variables, depth = 0) => {
  if (depth > 30) fail("Match nesting is too deep");
  if (
    condition === null
    || typeof condition !== "object"
    || condition instanceof Date
    || condition instanceof mongoose.Types.ObjectId
  ) {
    validateLiteral(condition);
    return;
  }
  if (Array.isArray(condition)) {
    validateLiteral(condition);
    return;
  }
  if (!isPlainObject(condition)) fail("Unsupported match value");

  for (const [operator, value] of Object.entries(condition)) {
    if (!operator.startsWith("$")) {
      fail("Use dotted approved field paths for embedded matches");
    }
    if (!QUERY_OPERATORS.has(operator)) {
      fail(`Unsupported match operator: ${operator}`);
    }
    if (operator === "$not") {
      validateFieldCondition(value, state, variables, depth + 1);
      continue;
    }
    if (operator === "$exists") {
      if (typeof value !== "boolean") fail("$exists requires a boolean");
      continue;
    }
    if (operator === "$regex") {
      if (typeof value !== "string" || value.length > 200) {
        fail("$regex must be a short string");
      }
      continue;
    }
    if (operator === "$options") {
      if (typeof value !== "string" || !/^[imsx]{0,4}$/.test(value)) {
        fail("Unsupported regular-expression options");
      }
      continue;
    }
    if (operator === "$in" || operator === "$nin") {
      if (!Array.isArray(value) || value.length > 100) {
        fail(`${operator} requires at most 100 literal values`);
      }
      value.forEach((entry) => validateLiteral(entry));
      continue;
    }
    if (operator === "$size") {
      if (!Number.isInteger(value) || value < 0 || value > 100_000) {
        fail("$size requires a bounded non-negative integer");
      }
      continue;
    }
    if (operator === "$type") {
      const allowedTypes = new Set([
        "array",
        "bool",
        "date",
        "double",
        "int",
        "long",
        "missing",
        "null",
        "object",
        "objectId",
        "string",
      ]);
      if (typeof value !== "string" || !allowedTypes.has(value)) {
        fail("Unsupported $type value");
      }
      continue;
    }
    validateLiteral(value);
  }
};

const validateMatch = (match, state, variables = new Set(), depth = 0) => {
  if (!isPlainObject(match)) fail("$match must be an object");
  if (depth > 30) fail("Match nesting is too deep");

  for (const [key, value] of Object.entries(match)) {
    if (LOGICAL_QUERY_OPERATORS.has(key)) {
      if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
        fail(`${key} requires a bounded non-empty array`);
      }
      value.forEach((entry) => validateMatch(entry, state, variables, depth + 1));
      continue;
    }
    if (key === "$expr") {
      validateExpression(value, state, variables, depth + 1);
      continue;
    }
    if (key.startsWith("$")) fail(`Unsupported match operator: ${key}`);
    validateFieldPath(key, state);
    validateFieldCondition(value, state, variables, depth + 1);
  }
};

const validateProject = (project, state, variables) => {
  if (!isPlainObject(project) || Object.keys(project).length === 0) {
    fail("$project must be a non-empty object");
  }
  const nextFields = new Set();
  for (const [output, expression] of Object.entries(project)) {
    if (expression === false || (typeof expression === "number" && expression === 0)) {
      validateOutputName(output);
      if (output !== "_id") fail("Exclusion projections are not supported");
      continue;
    }
    if (expression === true || typeof expression === "number") {
      validateFieldPath(output, state);
    } else {
      validateOutputName(output);
      if (
        isPlainObject(expression)
        && !Object.keys(expression).some((key) => key.startsWith("$"))
      ) {
        fail("Nested projection objects are not supported; use flat aliases");
      }
      validateExpression(expression, state, variables);
    }
    nextFields.add(output);
  }
  if (nextFields.size === 0) {
    fail("$project must include at least one approved or computed field");
  }
  state.rawFields.clear();
  state.derivedFields = nextFields;
  state.shaped = true;
};

const validateGroup = (group, state, variables) => {
  if (!isPlainObject(group) || !Object.prototype.hasOwnProperty.call(group, "_id")) {
    fail("$group requires an _id expression");
  }
  validateExpression(group._id, state, variables);
  const nextFields = new Set(["_id"]);
  for (const [output, accumulator] of Object.entries(group)) {
    if (output === "_id") continue;
    validateOutputName(output);
    if (!isPlainObject(accumulator) || Object.keys(accumulator).length !== 1) {
      fail(`Group field ${output} requires one approved accumulator`);
    }
    const operator = Object.keys(accumulator)[0];
    if (!ACCUMULATORS.has(operator)) {
      fail(`Unsupported group accumulator: ${operator}`);
    }
    validateExpression(accumulator[operator], state, variables);
    nextFields.add(output);
  }
  state.rawFields.clear();
  state.derivedFields = nextFields;
  state.shaped = true;
};

const validateConstructedRoot = (root, state, variables) => {
  if (!isPlainObject(root) || Object.keys(root).length === 0) {
    fail("Replacement root must be a constructed object");
  }
  const nextFields = new Set();
  for (const [output, expression] of Object.entries(root)) {
    validateOutputName(output);
    validateExpression(expression, state, variables);
    nextFields.add(output);
  }
  state.rawFields.clear();
  state.derivedFields = nextFields;
  state.shaped = true;
};

const validatePipelineInternal = (
  collection,
  pipeline,
  {
    variables = new Set(),
    depth = 0,
    counter = { count: 0 },
  } = {},
) => {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    fail("Pipeline must contain at least one stage");
  }
  if (depth > MAX_LOOKUP_DEPTH) fail("Lookup nesting is too deep");
  const state = createState(collection);

  for (const stage of pipeline) {
    counter.count += 1;
    if (counter.count > MAX_USER_STAGES) {
      fail(`Pipeline exceeds the ${MAX_USER_STAGES}-stage limit`);
    }
    if (!isPlainObject(stage) || Object.keys(stage).length !== 1) {
      fail("Each pipeline stage must contain exactly one operator");
    }
    const [[operator, specification]] = Object.entries(stage);
    if (!ALLOWED_STAGES.has(operator)) {
      fail(`Unsupported pipeline stage: ${operator}`);
    }

    if (operator === "$match") {
      validateMatch(specification, state, variables);
    } else if (operator === "$project") {
      validateProject(specification, state, variables);
    } else if (operator === "$group") {
      validateGroup(specification, state, variables);
    } else if (operator === "$sort") {
      if (!isPlainObject(specification) || Object.keys(specification).length === 0) {
        fail("$sort must be a non-empty object");
      }
      for (const [field, direction] of Object.entries(specification)) {
        validateFieldPath(field, state);
        if (direction !== 1 && direction !== -1) {
          fail("$sort direction must be 1 or -1");
        }
      }
    } else if (operator === "$limit") {
      if (!Number.isInteger(specification) || specification < 1 || specification > MAX_ROWS) {
        fail(`$limit must be between 1 and ${MAX_ROWS}`);
      }
    } else if (operator === "$skip") {
      if (!Number.isInteger(specification) || specification < 0 || specification > MAX_SKIP) {
        fail(`$skip must be between 0 and ${MAX_SKIP}`);
      }
    } else if (operator === "$unwind") {
      const path = typeof specification === "string"
        ? specification
        : specification?.path;
      if (
        typeof specification !== "string"
        && (
          !isPlainObject(specification)
          || Object.keys(specification).some(
            (key) => !["path", "preserveNullAndEmptyArrays"].includes(key),
          )
          || (
            specification.preserveNullAndEmptyArrays !== undefined
            && typeof specification.preserveNullAndEmptyArrays !== "boolean"
          )
        )
      ) {
        fail("Unsupported $unwind options");
      }
      if (typeof path !== "string" || !path.startsWith("$")) {
        fail("$unwind path must be a field reference");
      }
      validateFieldPath(path);
    } else if (operator === "$addFields" || operator === "$set") {
      if (!isPlainObject(specification) || Object.keys(specification).length === 0) {
        fail(`${operator} must be a non-empty object`);
      }
      for (const [output, expression] of Object.entries(specification)) {
        validateOutputName(output);
        validateExpression(expression, state, variables);
        state.derivedFields.add(output);
      }
    } else if (operator === "$unset") {
      const fields = typeof specification === "string" ? [specification] : specification;
      if (!Array.isArray(fields) || fields.length === 0 || fields.length > 50) {
        fail("$unset requires a field name or bounded array");
      }
      fields.forEach((field) => {
        validateFieldPath(field, state);
        state.derivedFields.delete(field);
        state.rawFields.delete(field);
      });
    } else if (operator === "$count") {
      validateOutputName(specification);
      state.rawFields.clear();
      state.derivedFields = new Set([specification]);
      state.shaped = true;
    } else if (operator === "$lookup") {
      if (
        !isPlainObject(specification)
        || Object.keys(specification).some(
          (key) => ![
            "from",
            "let",
            "localField",
            "foreignField",
            "pipeline",
            "as",
          ].includes(key),
        )
      ) {
        fail("Unsupported $lookup option");
      }
      const from = String(specification.from || "");
      if (!isReadableCollection(from)) {
        fail("That lookup data source is not available");
      }
      if (!isSafeOutputName(specification.as)) fail("Unsafe $lookup output name");
      const usesFieldJoin = specification.localField !== undefined
        || specification.foreignField !== undefined;
      if (usesFieldJoin) {
        if (
          typeof specification.localField !== "string"
          || typeof specification.foreignField !== "string"
          || specification.let !== undefined
        ) {
          fail("$lookup field joins require approved localField and foreignField");
        }
        validateFieldPath(specification.localField, state);
        validateFieldPath(specification.foreignField, createState(from));
        specification.pipeline ??= [];
      }
      const lookupVariables = new Set(variables);
      if (specification.let !== undefined) {
        if (!isPlainObject(specification.let)) fail("$lookup let must be an object");
        for (const [name, expression] of Object.entries(specification.let)) {
          validateOutputName(name);
          validateExpression(expression, state, variables);
          lookupVariables.add(name);
        }
      }
      if (!Array.isArray(specification.pipeline)) {
        fail("$lookup requires pipeline form");
      }
      if (specification.pipeline.length > 0) {
        validatePipelineInternal(from, specification.pipeline, {
          variables: lookupVariables,
          depth: depth + 1,
          counter,
        });
      } else if (!usesFieldJoin) {
        fail("$lookup pipeline must contain at least one stage");
      }
      state.derivedFields.add(specification.as);
    } else if (operator === "$replaceRoot") {
      if (
        !isPlainObject(specification)
        || Object.keys(specification).length !== 1
        || !Object.prototype.hasOwnProperty.call(specification, "newRoot")
      ) {
        fail("$replaceRoot requires one constructed newRoot");
      }
      validateConstructedRoot(specification.newRoot, state, variables);
    } else if (operator === "$replaceWith") {
      validateConstructedRoot(specification, state, variables);
    }
  }

  return state;
};

const validatePipeline = (collection, pipeline) => {
  if (!isReadableCollection(collection)) fail("That OMS data source is not available");
  scanForDangerousKeys(pipeline);
  const normalized = normalizeExtendedJson(pipeline);
  const counter = { count: 0 };
  const state = validatePipelineInternal(collection, normalized, { counter });
  if (!state.shaped) {
    fail("The report must end with an explicit safe projection, group, or count");
  }
  return { pipeline: normalized, stageCount: counter.count };
};

const buildNormalizationStages = (collection) => {
  const modelName = CATALOG[collection]?.model.modelName;
  if (modelName === "orders") {
    return [{
      $set: {
        __oms_vendor_name: {
          $trim: {
            input: {
              $cond: [
                { $eq: [{ $type: "$vendor" }, "string"] },
                "$vendor",
                { $ifNull: ["$vendor.name", ""] },
              ],
            },
          },
        },
      },
    }];
  }
  if (modelName === "qc") {
    return [{
      $set: {
        __oms_vendor_name: {
          $trim: {
            input: {
              $cond: [
                { $eq: [{ $type: "$order_meta.vendor" }, "string"] },
                "$order_meta.vendor",
                { $ifNull: ["$order_meta.vendor.name", ""] },
              ],
            },
          },
        },
      },
    }];
  }
  if (modelName === "items" || modelName === "samples") {
    const vendorField = modelName === "items" ? "$vendors" : "$vendor";
    const normalizedFields = {
      __oms_vendor_names: {
        $map: {
          input: {
            $cond: [
              { $isArray: vendorField },
              vendorField,
              [vendorField],
            ],
          },
          as: "vendor_entry",
          in: {
            $trim: {
              input: {
                $cond: [
                  { $eq: [{ $type: "$$vendor_entry" }, "string"] },
                  "$$vendor_entry",
                  { $ifNull: ["$$vendor_entry.name", ""] },
                ],
              },
            },
          },
        },
      },
    };
    if (modelName === "items") {
      normalizedFields.__oms_has_pis_file = {
        $or: [
          { $ne: [{ $trim: { input: { $ifNull: ["$pis_file.key", ""] } } }, ""] },
          { $ne: [{ $trim: { input: { $ifNull: ["$pis_file.link", ""] } } }, ""] },
          { $ne: [{ $trim: { input: { $ifNull: ["$pis_file.url", ""] } } }, ""] },
          { $ne: [{ $trim: { input: { $ifNull: ["$pis_file.public_id", ""] } } }, ""] },
        ],
      };
    }
    return [{
      $set: normalizedFields,
    }];
  }
  return [];
};

const injectAuthorizationScopes = (collection, pipeline, user) => {
  const nested = pipeline.map((stage) => {
    if (!stage.$lookup) return stage;
    return {
      $lookup: {
        ...stage.$lookup,
        pipeline: injectAuthorizationScopes(
          stage.$lookup.from,
          stage.$lookup.pipeline,
          user,
        ).concat({ $limit: MAX_LOOKUP_ROWS + 1 }),
      },
    };
  });
  return [
    ...buildNormalizationStages(collection),
    ...nested,
  ];
};

const injectExecutionAuthorizationScopes = async (
  collection,
  pipeline,
  user,
  connection,
  context = {},
) => {
  const nested = await Promise.all(pipeline.map(async (stage) => {
    if (!stage.$lookup) return stage;
    return {
      $lookup: {
        ...stage.$lookup,
        pipeline: (
          await injectExecutionAuthorizationScopes(
            stage.$lookup.from,
            stage.$lookup.pipeline,
            user,
            connection,
            context,
          )
        ).concat({ $limit: MAX_LOOKUP_ROWS + 1 }),
      },
    };
  }));
  return [
    ...buildNormalizationStages(collection),
    ...nested,
  ];
};

const collectDateBounds = (value, bounds = { starts: [], ends: [] }) => {
  if (!value || typeof value !== "object") return bounds;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectDateBounds(entry, bounds));
    return bounds;
  }
  for (const [key, nested] of Object.entries(value)) {
    if ((key === "$gte" || key === "$gt") && nested instanceof Date) {
      bounds.starts.push(nested);
    } else if ((key === "$lt" || key === "$lte") && nested instanceof Date) {
      bounds.ends.push(nested);
    }
    collectDateBounds(nested, bounds);
  }
  return bounds;
};

const getDateRangeMetadata = (pipeline) => {
  const bounds = collectDateBounds(pipeline);
  if (bounds.starts.length === 0 && bounds.ends.length === 0) return null;
  const start = bounds.starts.length
    ? new Date(Math.min(...bounds.starts.map((date) => date.getTime()))).toISOString()
    : null;
  const end = bounds.ends.length
    ? new Date(Math.max(...bounds.ends.map((date) => date.getTime()))).toISOString()
    : null;
  return { start, end, timezone: IST_TIMEZONE };
};

let chatConnection = null;
let chatConnectionPromise = null;

const getChatMongoUri = () => {
  const uri = String(process.env.OMS_CHAT_MONGO_URI || "").trim();
  if (!uri) {
    throw new OmsChatQueryError("OMS Assistant is not configured", {
      statusCode: 503,
      category: "missing_chat_database_configuration",
    });
  }
  const applicationUri = String(process.env.MONGO_URI || "").trim();
  if (applicationUri && uri === applicationUri) {
    throw new OmsChatQueryError("OMS Assistant database isolation is not configured", {
      statusCode: 503,
      category: "unsafe_chat_database_configuration",
    });
  }
  const schemeMatch = uri.match(/^mongodb(?:\+srv)?:\/\//i);
  const pathStart = schemeMatch
    ? uri.indexOf("/", schemeMatch[0].length)
    : -1;
  const databaseName = pathStart >= 0
    ? uri.slice(pathStart + 1).split("?")[0].trim()
    : "";
  if (!schemeMatch || !databaseName) {
    throw new OmsChatQueryError(
      "OMS Assistant database isolation is not configured",
      {
        statusCode: 503,
        category: "unsafe_chat_database_configuration",
      },
    );
  }
  return uri;
};

const getOmsChatConnection = async () => {
  if (chatConnection?.readyState === 1) return chatConnection;
  if (chatConnectionPromise) return chatConnectionPromise;

  const uri = getChatMongoUri();
  const connection = mongoose.createConnection(uri, {
    autoCreate: false,
    autoIndex: false,
    connectTimeoutMS: QUERY_TIMEOUT_MS,
    maxPoolSize: 5,
    minPoolSize: 0,
    retryWrites: false,
    serverSelectionTimeoutMS: QUERY_TIMEOUT_MS,
    socketTimeoutMS: QUERY_TIMEOUT_MS + 2_000,
  });
  chatConnectionPromise = connection.asPromise()
    .then((connected) => {
      chatConnection = connected;
      chatConnectionPromise = null;
      return connected;
    })
    .catch(async () => {
      chatConnectionPromise = null;
      try {
        await connection.close(false);
      } catch {
        // The initial connection can fail before there is anything to close.
      }
      throw new OmsChatQueryError("OMS Assistant data is temporarily unavailable", {
        statusCode: 503,
        category: "chat_database_unavailable",
      });
    });
  return chatConnectionPromise;
};

const closeOmsChatConnection = async () => {
  const connection = chatConnection;
  chatConnection = null;
  chatConnectionPromise = null;
  if (connection && connection.readyState !== 0) {
    await connection.close(false);
  }
};

const trimNestedArrays = (value, state) => {
  if (Array.isArray(value)) {
    if (value.length > MAX_LOOKUP_ROWS) state.truncated = true;
    return value
      .slice(0, MAX_LOOKUP_ROWS)
      .map((entry) => trimNestedArrays(entry, state));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        trimNestedArrays(entry, state),
      ]),
    );
  }
  return value;
};

const serializeRowsWithinLimit = (rows) => {
  const safeRows = [];
  let bytes = 2;
  let truncated = false;
  for (const row of rows.slice(0, MAX_ROWS)) {
    const nestedState = { truncated: false };
    const safeRow = trimNestedArrays(
      JSON.parse(JSON.stringify(row)),
      nestedState,
    );
    if (nestedState.truncated) truncated = true;
    const json = JSON.stringify(safeRow);
    const rowBytes = Buffer.byteLength(json, "utf8") + 1;
    if (bytes + rowBytes > MAX_RESULT_BYTES) {
      truncated = true;
      break;
    }
    safeRows.push(safeRow);
    bytes += rowBytes;
  }
  return { rows: safeRows, truncated };
};

const countPipelineStages = (pipeline) =>
  (Array.isArray(pipeline) ? pipeline : []).reduce(
    (total, stage) =>
      total
      + 1
      + (
        Array.isArray(stage?.$lookup?.pipeline)
          ? countPipelineStages(stage.$lookup.pipeline)
          : 0
      ),
    0,
  );

const executeOmsQuery = async (
  { collection, pipeline, purpose, user },
  { connectionProvider = getOmsChatConnection } = {},
) => {
  const startedAt = Date.now();
  let validated = null;
  let executedPipeline = null;

  try {
    validated = validatePipeline(collection, pipeline);
    const connection = await connectionProvider();
    const scopedPipeline = await injectExecutionAuthorizationScopes(
      collection,
      validated.pipeline,
      user,
      connection,
      { deadline: startedAt + QUERY_TIMEOUT_MS },
    );
    executedPipeline = [...scopedPipeline, { $limit: MAX_ROWS + 1 }];
    const remainingQueryTime = startedAt + QUERY_TIMEOUT_MS - Date.now();
    if (remainingQueryTime <= 0) throw createDatabaseTimeoutError();
    const rawRows = await connection.db
      .collection(collection)
      .aggregate(executedPipeline, {
        allowDiskUse: false,
        batchSize: MAX_ROWS + 1,
        maxTimeMS: Math.min(QUERY_TIMEOUT_MS, remainingQueryTime),
      })
      .toArray();
    const rowLimited = rawRows.length > MAX_ROWS;
    const serialized = serializeRowsWithinLimit(rawRows);
    const truncated = rowLimited || serialized.truncated;

    return {
      rows: serialized.rows,
      metadata: {
        date_range: getDateRangeMetadata(validated.pipeline),
        filters: { collection, purpose },
        returned_rows: serialized.rows.length,
        truncated,
      },
      audit: {
        collection,
        stageCount: validated.stageCount,
        durationMs: Date.now() - startedAt,
        returnedRows: serialized.rows.length,
        truncated,
      },
      executedPipeline,
    };
  } catch (error) {
    const audit = {
      collection,
      stageCount: validated?.stageCount || countPipelineStages(pipeline),
      durationMs: Date.now() - startedAt,
      returnedRows: 0,
      truncated: false,
    };
    if (error instanceof OmsChatQueryError) {
      error.audit = error.audit || audit;
      throw error;
    }
    if (
      error?.code === 50
      || /time(?:d)?\s*out|maxTimeMS|time limit/i.test(String(error?.message || ""))
    ) {
      const timeoutError = createDatabaseTimeoutError();
      timeoutError.audit = audit;
      throw timeoutError;
    }
    const unavailableError = new OmsChatQueryError(
      "OMS Assistant data is temporarily unavailable",
      {
      statusCode: 503,
      category: "chat_database_unavailable",
      },
    );
    unavailableError.audit = audit;
    throw unavailableError;
  }
};

module.exports = {
  OmsChatQueryError,
  assertChatDatabaseConfiguration: getChatMongoUri,
  closeOmsChatConnection,
  executeOmsQuery,
  getOmsChatConnection,
  parseToolArguments,
  validatePipeline,
  __test__: {
    MAX_ROWS,
    getDateRangeMetadata,
    injectAuthorizationScopes,
    normalizeExtendedJson,
    serializeRowsWithinLimit,
  },
};
