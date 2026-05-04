const mongoose = require("mongoose");
const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  detectBoxPackagingMode,
} = require("./boxMeasurement");

const PRODUCT_TYPE_TEMPLATE_STATUSES = Object.freeze([
  "draft",
  "active",
  "inactive",
  "archived",
]);

const PRODUCT_TYPE_TEMPLATE_INPUT_TYPES = Object.freeze([
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "multiselect",
  "date",
  "item_size",
  "box_size",
  "file",
]);

const PRODUCT_TYPE_TEMPLATE_VALUE_TYPES = Object.freeze([
  "string",
  "number",
  "boolean",
  "date",
  "array",
  "object",
]);

const DEFAULT_BOOLEAN_TRUE_VALUES = Object.freeze([
  "true",
  "1",
  "yes",
  "y",
  "on",
]);

const DEFAULT_BOOLEAN_FALSE_VALUES = Object.freeze([
  "false",
  "0",
  "no",
  "n",
  "off",
]);

const normalizeText = (value) => String(value ?? "").trim();

const normalizeTemplateKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeHeaderKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeStatus = (value, fallback = "draft") => {
  const normalized = normalizeTemplateKey(value);
  return PRODUCT_TYPE_TEMPLATE_STATUSES.includes(normalized) ? normalized : fallback;
};

const isBlankValue = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized === "" || normalized === "-";
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((entry) => isBlankValue(entry));
  }
  return false;
};

const toBooleanFlag = (value, fallback = false) =>
  value === undefined ? fallback : Boolean(value);

const toPositiveInteger = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const toOrderedInteger = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const normalizeStringArray = (values = []) => {
  const safeValues = Array.isArray(values) ? values : [values];
  return [...new Set(safeValues.map((value) => normalizeText(value)).filter(Boolean))];
};

const normalizeSizeSourceHeaders = (value = {}) => {
  const safeValue = value && typeof value === "object" ? value : {};
  return {
    L: normalizeStringArray(safeValue.L),
    B: normalizeStringArray(safeValue.B),
    H: normalizeStringArray(safeValue.H),
    net_weight: normalizeStringArray(safeValue.net_weight),
    gross_weight: normalizeStringArray(safeValue.gross_weight),
    item_count_in_inner: normalizeStringArray(safeValue.item_count_in_inner),
    box_count_in_master: normalizeStringArray(safeValue.box_count_in_master),
  };
};

const getDefaultValueTypeForInputType = (inputType = "text") => {
  switch (inputType) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "multiselect":
    case "item_size":
    case "box_size":
      return "array";
    case "file":
      return "object";
    default:
      return "string";
  }
};

const getTemplateFieldSourceHeaders = (field = {}) => {
  if (Array.isArray(field?.source_headers) && field.source_headers.length > 0) {
    return normalizeStringArray(field.source_headers);
  }

  if (field?.size_source_headers && typeof field.size_source_headers === "object") {
    return [
      ...new Set(
        Object.values(field.size_source_headers)
          .flatMap((headers) => normalizeStringArray(headers)),
      ),
    ];
  }

  return [];
};

const sortTemplateGroups = (
  groups = [],
  { includeInactiveGroups = true, includeInactiveFields = true } = {},
) =>
  (Array.isArray(groups) ? groups : [])
    .filter((group) => includeInactiveGroups || group?.is_active !== false)
    .map((group) => ({
      ...group,
      fields: (Array.isArray(group?.fields) ? group.fields : [])
        .filter((field) => includeInactiveFields || field?.is_active !== false)
        .sort((left, right) => {
          const leftOrder = toOrderedInteger(left?.order, 0);
          const rightOrder = toOrderedInteger(right?.order, 0);
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
          return normalizeText(left?.label).localeCompare(normalizeText(right?.label));
        }),
    }))
    .sort((left, right) => {
      const leftOrder = toOrderedInteger(left?.order, 0);
      const rightOrder = toOrderedInteger(right?.order, 0);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return normalizeText(left?.label).localeCompare(normalizeText(right?.label));
    });

const flattenTemplateFields = (template = {}, options = {}) =>
  sortTemplateGroups(template?.groups, options).flatMap((group) =>
    (Array.isArray(group?.fields) ? group.fields : []).map((field) => ({
      ...field,
      group_key: normalizeTemplateKey(group?.key),
      group_label: normalizeText(group?.label),
    })),
  );

const normalizeTemplateOptions = (options = []) => {
  const safeOptions = Array.isArray(options) ? options : [options];
  return [...new Set(safeOptions.map((value) => normalizeText(value)).filter(Boolean))];
};

const normalizeTemplateValidation = (validation = null) =>
  validation && typeof validation === "object" && !Array.isArray(validation)
    ? { ...validation }
    : {};

const prepareTemplatePayload = (payload = {}) => {
  const templateKey = normalizeTemplateKey(payload.key || payload.label);
  const label = normalizeText(payload.label);

  if (!templateKey) {
    throw new Error("Template key is required");
  }
  if (!label) {
    throw new Error("Template label is required");
  }

  const seenGroupKeys = new Set();
  const seenFieldKeys = new Set();
  const safeGroups = Array.isArray(payload.groups) ? payload.groups : [];
  const groups = safeGroups.map((group, groupIndex) => {
    const groupKey = normalizeTemplateKey(group?.key || group?.label);
    const groupLabel = normalizeText(group?.label);

    if (!groupKey) {
      throw new Error(`Group ${groupIndex + 1} key is required`);
    }
    if (!groupLabel) {
      throw new Error(`Group ${groupIndex + 1} label is required`);
    }
    if (seenGroupKeys.has(groupKey)) {
      throw new Error(`Duplicate group key: ${groupKey}`);
    }
    seenGroupKeys.add(groupKey);

    const safeFields = Array.isArray(group?.fields) ? group.fields : [];
    const fields = safeFields.map((field, fieldIndex) => {
      const fieldKey = normalizeTemplateKey(field?.key || field?.label);
      const fieldLabel = normalizeText(field?.label);
      const inputType = normalizeTemplateKey(field?.input_type || "text");
      const valueType = normalizeTemplateKey(
        field?.value_type || getDefaultValueTypeForInputType(inputType),
      );
      const fieldOrder = toOrderedInteger(field?.order, fieldIndex);

      if (!fieldKey) {
        throw new Error(`${groupLabel} field ${fieldIndex + 1} key is required`);
      }
      if (!fieldLabel) {
        throw new Error(`${groupLabel} field ${fieldIndex + 1} label is required`);
      }
      if (seenFieldKeys.has(fieldKey)) {
        throw new Error(`Duplicate field key: ${fieldKey}`);
      }
      if (!PRODUCT_TYPE_TEMPLATE_INPUT_TYPES.includes(inputType)) {
        throw new Error(`${fieldLabel} has an invalid input_type`);
      }
      if (!PRODUCT_TYPE_TEMPLATE_VALUE_TYPES.includes(valueType)) {
        throw new Error(`${fieldLabel} has an invalid value_type`);
      }

      seenFieldKeys.add(fieldKey);

      const normalizedField = {
        key: fieldKey,
        label: fieldLabel,
        description: normalizeText(field?.description),
        input_type: inputType,
        value_type: valueType,
        unit: normalizeText(field?.unit),
        required: toBooleanFlag(field?.required, false),
        searchable: toBooleanFlag(field?.searchable, false),
        filterable: toBooleanFlag(field?.filterable, false),
        show_in_table: toBooleanFlag(field?.show_in_table, false),
        order: fieldOrder,
        options: normalizeTemplateOptions(field?.options),
        default_value:
          field?.default_value === undefined ? null : field.default_value,
        validation: normalizeTemplateValidation(field?.validation),
        source_headers: normalizeStringArray(field?.source_headers),
        size_source_headers: normalizeSizeSourceHeaders(field?.size_source_headers),
        size_remark: normalizeTemplateKey(field?.size_remark || ""),
        box_type: normalizeTemplateKey(
          field?.box_type || BOX_ENTRY_TYPES.INDIVIDUAL,
        ),
        is_active: toBooleanFlag(field?.is_active, true),
      };

      if (inputType === "item_size" || inputType === "box_size") {
        normalizedField.value_type = "array";
        normalizedField.source_headers = getTemplateFieldSourceHeaders(normalizedField);
      }

      return normalizedField;
    });

    return {
      key: groupKey,
      label: groupLabel,
      description: normalizeText(group?.description),
      order: toOrderedInteger(group?.order, groupIndex),
      is_active: toBooleanFlag(group?.is_active, true),
      fields,
    };
  });

  return {
    key: templateKey,
    label,
    description: normalizeText(payload.description),
    version: toPositiveInteger(payload.version, 1),
    status: normalizeStatus(payload.status, "draft"),
    groups,
  };
};

const createUploadedRowContext = (row = {}) => {
  if (row?.__productTypeRowContext === true) return row;

  let rawEntries = [];
  if (Array.isArray(row)) {
    rawEntries = row;
  } else if (Array.isArray(row?.entries)) {
    rawEntries = row.entries;
  } else if (Array.isArray(row?.__entries)) {
    rawEntries = row.__entries;
  } else if (Array.isArray(row?.headers) && Array.isArray(row?.values)) {
    rawEntries = row.headers.map((header, index) => ({
      header,
      value: row.values[index],
    }));
  } else if (row && typeof row === "object") {
    rawEntries = Object.entries(row)
      .filter(([header]) => !String(header).startsWith("__"))
      .map(([header, value]) => ({ header, value }));
  }

  const entries = rawEntries
    .map((entry, index) => {
      const header = Array.isArray(entry)
        ? normalizeText(entry[0])
        : normalizeText(entry?.header ?? entry?.key ?? entry?.name);
      const value = Array.isArray(entry) ? entry[1] : entry?.value;
      return {
        header,
        normalized_header: normalizeHeaderKey(header),
        value,
        index,
      };
    })
    .filter((entry) => entry.header);

  const byHeader = new Map();
  entries.forEach((entry) => {
    if (!byHeader.has(entry.normalized_header)) {
      byHeader.set(entry.normalized_header, []);
    }
    byHeader.get(entry.normalized_header).push(entry);
  });

  return {
    __productTypeRowContext: true,
    entries,
    byHeader,
    usedCounts: new Map(),
  };
};

const peekFirstEntryByHeaders = (row = {}, headers = []) => {
  const context = createUploadedRowContext(row);
  for (const header of normalizeStringArray(headers)) {
    const bucket = context.byHeader.get(normalizeHeaderKey(header)) || [];
    if (bucket.length > 0) {
      return bucket[0];
    }
  }
  return null;
};

const takeNextEntryByHeaders = (row = {}, headers = []) => {
  const context = createUploadedRowContext(row);
  for (const header of normalizeStringArray(headers)) {
    const normalizedHeader = normalizeHeaderKey(header);
    const bucket = context.byHeader.get(normalizedHeader) || [];
    const usedCount = Number(context.usedCounts.get(normalizedHeader) || 0);
    const nextEntry = bucket[usedCount];
    if (!nextEntry) continue;
    context.usedCounts.set(normalizedHeader, usedCount + 1);
    return nextEntry;
  }
  return null;
};

const buildRawValuesObject = (row = {}) => {
  const context = createUploadedRowContext(row);
  return context.entries.reduce((accumulator, entry) => {
    if (!Object.prototype.hasOwnProperty.call(accumulator, entry.header)) {
      accumulator[entry.header] = entry.value;
      return accumulator;
    }

    const currentValue = accumulator[entry.header];
    accumulator[entry.header] = Array.isArray(currentValue)
      ? [...currentValue, entry.value]
      : [currentValue, entry.value];
    return accumulator;
  }, {});
};

const toParsedNumber = (value, fieldLabel, { allowBlank = true } = {}) => {
  if (isBlankValue(value)) {
    if (allowBlank) return null;
    throw new Error(`${fieldLabel} is required`);
  }

  const normalized =
    typeof value === "string"
      ? value.replace(/,/g, "").trim()
      : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a valid number`);
  }
  return parsed;
};

const toParsedDate = (value, fieldLabel, { allowBlank = true } = {}) => {
  if (isBlankValue(value)) {
    if (allowBlank) return null;
    throw new Error(`${fieldLabel} is required`);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldLabel} must be a valid date`);
  }
  return parsed;
};

const toParsedBoolean = (value, field = {}) => {
  if (isBlankValue(value)) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const validation = field?.validation || {};
  const trueValues = new Set(
    normalizeStringArray(validation.true_values || DEFAULT_BOOLEAN_TRUE_VALUES).map(
      (entry) => entry.toLowerCase(),
    ),
  );
  const falseValues = new Set(
    normalizeStringArray(validation.false_values || DEFAULT_BOOLEAN_FALSE_VALUES).map(
      (entry) => entry.toLowerCase(),
    ),
  );
  const normalized = normalizeText(value).toLowerCase();
  if (trueValues.has(normalized)) return true;
  if (falseValues.has(normalized)) return false;
  throw new Error(`${field?.label || field?.key || "Field"} must be a boolean value`);
};

const normalizeValueArray = (value, field = {}) => {
  if (isBlankValue(value)) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
  }

  const validation = field?.validation || {};
  const separators = Array.isArray(validation.separators) && validation.separators.length > 0
    ? validation.separators
    : [",", ";", "\n"];
  let tokens = [String(value)];
  separators.forEach((separator) => {
    tokens = tokens.flatMap((entry) => String(entry).split(separator));
  });
  return tokens.map((entry) => normalizeText(entry)).filter(Boolean);
};

const buildProductSpecFieldValue = (
  field = {},
  rawValue,
  { sourceHeader = "", hasSource = false } = {},
) => {
  const effectiveRawValue =
    !hasSource && field?.default_value !== undefined
      ? field.default_value
      : rawValue;
  const hasValue = !isBlankValue(effectiveRawValue);

  if (!hasValue && field?.required) {
    throw new Error(`${field.label || field.key} is required`);
  }

  if (!hasValue && !field?.required) {
    return null;
  }

  const valueType = normalizeTemplateKey(field?.value_type)
    || getDefaultValueTypeForInputType(field?.input_type);
  const normalizedField = {
    field_id: field?._id || field?.field_id || null,
    key: normalizeTemplateKey(field?.key),
    label: normalizeText(field?.label),
    group_key: normalizeTemplateKey(field?.group_key),
    group_label: normalizeText(field?.group_label),
    input_type: normalizeTemplateKey(field?.input_type),
    value_type: valueType,
    unit: normalizeText(field?.unit),
    value_text: "",
    value_number: null,
    value_boolean: null,
    value_date: null,
    value_array: [],
    raw_value: effectiveRawValue,
    source_header: normalizeText(sourceHeader),
  };

  switch (valueType) {
    case "number":
      normalizedField.value_number = toParsedNumber(
        effectiveRawValue,
        normalizedField.label || normalizedField.key,
        { allowBlank: false },
      );
      break;
    case "boolean":
      normalizedField.value_boolean = toParsedBoolean(effectiveRawValue, field);
      break;
    case "date":
      normalizedField.value_date = toParsedDate(
        effectiveRawValue,
        normalizedField.label || normalizedField.key,
        { allowBlank: false },
      );
      break;
    case "array":
      normalizedField.value_array = normalizeValueArray(effectiveRawValue, field);
      break;
    case "object":
      break;
    case "string":
    default:
      normalizedField.value_text = normalizeText(effectiveRawValue);
      break;
  }

  return normalizedField;
};

const buildItemSizeEntry = (field = {}, row = {}) => {
  const label = normalizeText(field?.label || field?.key || "Item size");
  const sizeSourceHeaders = normalizeSizeSourceHeaders(field?.size_source_headers);
  const sizeFields = {
    L: takeNextEntryByHeaders(row, sizeSourceHeaders.L),
    B: takeNextEntryByHeaders(row, sizeSourceHeaders.B),
    H: takeNextEntryByHeaders(row, sizeSourceHeaders.H),
    net_weight: takeNextEntryByHeaders(row, sizeSourceHeaders.net_weight),
    gross_weight: takeNextEntryByHeaders(row, sizeSourceHeaders.gross_weight),
  };

  const hasAnyDimensionValue = ["L", "B", "H"].some(
    (key) => !isBlankValue(sizeFields[key]?.value),
  );
  const hasAnySupplementalValue = ["net_weight", "gross_weight"].some(
    (key) => !isBlankValue(sizeFields[key]?.value),
  );

  if (!hasAnyDimensionValue && !hasAnySupplementalValue) {
    if (field?.required) {
      throw new Error(`${label} is required`);
    }
    return null;
  }

  if (!hasAnyDimensionValue) {
    return null;
  }

  const L = toParsedNumber(sizeFields.L?.value, `${label} L`, {
    allowBlank: false,
  });
  const B = toParsedNumber(sizeFields.B?.value, `${label} B`, {
    allowBlank: false,
  });
  const H = toParsedNumber(sizeFields.H?.value, `${label} H`, {
    allowBlank: false,
  });

  return {
    L,
    B,
    H,
    remark: normalizeTemplateKey(field?.size_remark || field?.key),
    net_weight: Math.max(
      0,
      Number(
        toParsedNumber(sizeFields.net_weight?.value, `${label} net weight`, {
          allowBlank: true,
        }) || 0,
      ),
    ),
    gross_weight: Math.max(
      0,
      Number(
        toParsedNumber(sizeFields.gross_weight?.value, `${label} gross weight`, {
          allowBlank: true,
        }) || 0,
      ),
    ),
  };
};

const buildBoxSizeEntry = (field = {}, row = {}) => {
  const label = normalizeText(field?.label || field?.key || "Box size");
  const sizeSourceHeaders = normalizeSizeSourceHeaders(field?.size_source_headers);
  const sizeFields = {
    L: takeNextEntryByHeaders(row, sizeSourceHeaders.L),
    B: takeNextEntryByHeaders(row, sizeSourceHeaders.B),
    H: takeNextEntryByHeaders(row, sizeSourceHeaders.H),
    net_weight: takeNextEntryByHeaders(row, sizeSourceHeaders.net_weight),
    gross_weight: takeNextEntryByHeaders(row, sizeSourceHeaders.gross_weight),
    item_count_in_inner: takeNextEntryByHeaders(row, sizeSourceHeaders.item_count_in_inner),
    box_count_in_master: takeNextEntryByHeaders(row, sizeSourceHeaders.box_count_in_master),
  };

  const hasAnyDimensionValue = ["L", "B", "H"].some(
    (key) => !isBlankValue(sizeFields[key]?.value),
  );
  const hasAnySupplementalValue = [
    "net_weight",
    "gross_weight",
    "item_count_in_inner",
    "box_count_in_master",
  ].some((key) => !isBlankValue(sizeFields[key]?.value));

  if (!hasAnyDimensionValue && !hasAnySupplementalValue) {
    if (field?.required) {
      throw new Error(`${label} is required`);
    }
    return null;
  }

  if (!hasAnyDimensionValue) {
    return null;
  }

  const boxType = normalizeTemplateKey(field?.box_type || BOX_ENTRY_TYPES.INDIVIDUAL);
  const L = toParsedNumber(sizeFields.L?.value, `${label} L`, {
    allowBlank: false,
  });
  const B = toParsedNumber(sizeFields.B?.value, `${label} B`, {
    allowBlank: false,
  });
  const H = toParsedNumber(sizeFields.H?.value, `${label} H`, {
    allowBlank: false,
  });
  const itemCountInInner = Math.max(
    0,
    Number(
      toParsedNumber(
        sizeFields.item_count_in_inner?.value,
        `${label} item_count_in_inner`,
        { allowBlank: true },
      ) || 0,
    ),
  );
  const boxCountInMaster = Math.max(
    0,
    Number(
      toParsedNumber(
        sizeFields.box_count_in_master?.value,
        `${label} box_count_in_master`,
        { allowBlank: true },
      ) || 0,
    ),
  );

  if (boxType === BOX_ENTRY_TYPES.INNER && itemCountInInner <= 0) {
    throw new Error(`${label} item_count_in_inner must be greater than 0`);
  }
  if (boxType === BOX_ENTRY_TYPES.MASTER && boxCountInMaster <= 0) {
    throw new Error(`${label} box_count_in_master must be greater than 0`);
  }

  return {
    L,
    B,
    H,
    remark: normalizeTemplateKey(field?.size_remark || field?.key),
    net_weight: Math.max(
      0,
      Number(
        toParsedNumber(sizeFields.net_weight?.value, `${label} net weight`, {
          allowBlank: true,
        }) || 0,
      ),
    ),
    gross_weight: Math.max(
      0,
      Number(
        toParsedNumber(sizeFields.gross_weight?.value, `${label} gross weight`, {
          allowBlank: true,
        }) || 0,
      ),
    ),
    box_type: boxType || BOX_ENTRY_TYPES.INDIVIDUAL,
    item_count_in_inner: itemCountInInner,
    box_count_in_master: boxCountInMaster,
  };
};

const buildProductTypeSnapshot = (template = {}) => ({
  template:
    template?._id && mongoose.Types.ObjectId.isValid(String(template._id))
      ? template._id
      : null,
  key: normalizeTemplateKey(template?.key),
  label: normalizeText(template?.label),
  version: toPositiveInteger(template?.version, 1),
});

const normalizeProductSpecFieldEntry = (entry = {}) => {
  const valueType = normalizeTemplateKey(entry?.value_type)
    || getDefaultValueTypeForInputType(entry?.input_type);
  if (!PRODUCT_TYPE_TEMPLATE_VALUE_TYPES.includes(valueType)) {
    throw new Error(`Invalid product spec value_type for ${entry?.key || "field"}`);
  }

  let valueNumber = null;
  if (
    entry?.value_number !== null &&
    entry?.value_number !== undefined &&
    entry?.value_number !== ""
  ) {
    valueNumber = Number(entry.value_number);
    if (!Number.isFinite(valueNumber)) {
      throw new Error(`Invalid number value for ${entry?.key || "field"}`);
    }
  }

  let valueBoolean = null;
  if (entry?.value_boolean !== null && entry?.value_boolean !== undefined) {
    valueBoolean = toParsedBoolean(entry.value_boolean, {
      key: entry?.key,
      label: entry?.label,
      validation: entry?.validation,
    });
  }

  return {
    field_id:
      entry?.field_id && mongoose.Types.ObjectId.isValid(String(entry.field_id))
        ? new mongoose.Types.ObjectId(String(entry.field_id))
        : null,
    key: normalizeTemplateKey(entry?.key),
    label: normalizeText(entry?.label),
    group_key: normalizeTemplateKey(entry?.group_key),
    group_label: normalizeText(entry?.group_label),
    input_type: normalizeTemplateKey(entry?.input_type || "text"),
    value_type: valueType,
    unit: normalizeText(entry?.unit),
    value_text: normalizeText(entry?.value_text),
    value_number: valueNumber,
    value_boolean: valueBoolean,
    value_date:
      entry?.value_date === null || entry?.value_date === undefined || entry?.value_date === ""
        ? null
        : toParsedDate(entry.value_date, `${entry?.label || entry?.key || "Field"} date`, {
            allowBlank: true,
          }),
    value_array: Array.isArray(entry?.value_array) ? entry.value_array : [],
    raw_value:
      entry?.raw_value === undefined
        ? null
        : entry.raw_value,
    source_header: normalizeText(entry?.source_header),
  };
};

const normalizeProductSpecItemSizeEntries = (entries = []) => {
  if (!Array.isArray(entries)) {
    throw new Error("product_specs.item_sizes must be an array");
  }

  return entries
    .filter((entry) =>
      ["L", "B", "H", "net_weight", "gross_weight", "remark"].some(
        (field) => !isBlankValue(entry?.[field]),
      ),
    )
    .map((entry, index) => ({
      L: toParsedNumber(entry?.L, `product_specs.item_sizes.${index + 1}.L`, {
        allowBlank: false,
      }),
      B: toParsedNumber(entry?.B, `product_specs.item_sizes.${index + 1}.B`, {
        allowBlank: false,
      }),
      H: toParsedNumber(entry?.H, `product_specs.item_sizes.${index + 1}.H`, {
        allowBlank: false,
      }),
      remark: normalizeTemplateKey(entry?.remark),
      net_weight: Math.max(
        0,
        Number(
          toParsedNumber(
            entry?.net_weight,
            `product_specs.item_sizes.${index + 1}.net_weight`,
            { allowBlank: true },
          ) || 0,
        ),
      ),
      gross_weight: Math.max(
        0,
        Number(
          toParsedNumber(
            entry?.gross_weight,
            `product_specs.item_sizes.${index + 1}.gross_weight`,
            { allowBlank: true },
          ) || 0,
        ),
      ),
    }));
};

const normalizeProductSpecBoxSizeEntries = (entries = [], mode = "") => {
  if (!Array.isArray(entries)) {
    throw new Error("product_specs.box_sizes must be an array");
  }

  const normalizedEntries = entries
    .filter((entry) =>
      [
        "L",
        "B",
        "H",
        "net_weight",
        "gross_weight",
        "remark",
        "box_type",
        "item_count_in_inner",
        "box_count_in_master",
      ].some((field) => !isBlankValue(entry?.[field])),
    )
    .map((entry, index) => {
      const boxType = normalizeTemplateKey(
        entry?.box_type || BOX_ENTRY_TYPES.INDIVIDUAL,
      );
      const normalizedEntry = {
        L: toParsedNumber(entry?.L, `product_specs.box_sizes.${index + 1}.L`, {
          allowBlank: false,
        }),
        B: toParsedNumber(entry?.B, `product_specs.box_sizes.${index + 1}.B`, {
          allowBlank: false,
        }),
        H: toParsedNumber(entry?.H, `product_specs.box_sizes.${index + 1}.H`, {
          allowBlank: false,
        }),
        remark: normalizeTemplateKey(entry?.remark || entry?.box_type || ""),
        net_weight: Math.max(
          0,
          Number(
            toParsedNumber(
              entry?.net_weight,
              `product_specs.box_sizes.${index + 1}.net_weight`,
              { allowBlank: true },
            ) || 0,
          ),
        ),
        gross_weight: Math.max(
          0,
          Number(
            toParsedNumber(
              entry?.gross_weight,
              `product_specs.box_sizes.${index + 1}.gross_weight`,
              { allowBlank: true },
            ) || 0,
          ),
        ),
        box_type: boxType || BOX_ENTRY_TYPES.INDIVIDUAL,
        item_count_in_inner: Math.max(
          0,
          Number(
            toParsedNumber(
              entry?.item_count_in_inner,
              `product_specs.box_sizes.${index + 1}.item_count_in_inner`,
              { allowBlank: true },
            ) || 0,
          ),
        ),
        box_count_in_master: Math.max(
          0,
          Number(
            toParsedNumber(
              entry?.box_count_in_master,
              `product_specs.box_sizes.${index + 1}.box_count_in_master`,
              { allowBlank: true },
            ) || 0,
          ),
        ),
      };

      if (
        normalizedEntry.box_type === BOX_ENTRY_TYPES.INNER &&
        normalizedEntry.item_count_in_inner <= 0
      ) {
        throw new Error(
          `product_specs.box_sizes.${index + 1}.item_count_in_inner must be greater than 0`,
        );
      }
      if (
        normalizedEntry.box_type === BOX_ENTRY_TYPES.MASTER &&
        normalizedEntry.box_count_in_master <= 0
      ) {
        throw new Error(
          `product_specs.box_sizes.${index + 1}.box_count_in_master must be greater than 0`,
        );
      }

      return normalizedEntry;
    });

  const resolvedMode = detectBoxPackagingMode(mode, normalizedEntries);
  return {
    box_sizes: normalizedEntries,
    box_mode: resolvedMode,
  };
};

const normalizeProductSpecsPayload = (productSpecs = {}) => {
  if (!productSpecs || typeof productSpecs !== "object" || Array.isArray(productSpecs)) {
    throw new Error("product_specs must be an object");
  }

  const normalizedFields = Array.isArray(productSpecs.fields)
    ? productSpecs.fields
        .map((entry) => normalizeProductSpecFieldEntry(entry))
        .filter((entry) => entry.key)
    : [];
  const normalizedItemSizes = normalizeProductSpecItemSizeEntries(
    productSpecs.item_sizes || [],
  );
  const normalizedBoxPayload = normalizeProductSpecBoxSizeEntries(
    productSpecs.box_sizes || [],
    productSpecs.box_mode || BOX_PACKAGING_MODES.INDIVIDUAL,
  );
  const rawValues =
    productSpecs.raw_values instanceof Map
      ? Object.fromEntries(productSpecs.raw_values.entries())
      : productSpecs.raw_values && typeof productSpecs.raw_values === "object"
      ? { ...productSpecs.raw_values }
      : {};

  return {
    fields: normalizedFields,
    item_sizes: normalizedItemSizes,
    box_sizes: normalizedBoxPayload.box_sizes,
    box_mode: normalizedBoxPayload.box_mode,
    raw_values: rawValues,
  };
};

const mapUploadedRowToProductSpecs = (row = {}, template = {}) => {
  const rowContext = createUploadedRowContext(row);
  const fields = [];
  const itemSizes = [];
  const boxSizes = [];

  flattenTemplateFields(template, {
    includeInactiveGroups: false,
    includeInactiveFields: false,
  }).forEach((field) => {
    if (field.input_type === "item_size") {
      const sizeEntry = buildItemSizeEntry(field, rowContext);
      if (sizeEntry) {
        itemSizes.push(sizeEntry);
      }
      return;
    }

    if (field.input_type === "box_size") {
      const boxEntry = buildBoxSizeEntry(field, rowContext);
      if (boxEntry) {
        boxSizes.push(boxEntry);
      }
      return;
    }

    const matchedEntry = takeNextEntryByHeaders(rowContext, field.source_headers);
    const fieldValue = buildProductSpecFieldValue(field, matchedEntry?.value, {
      sourceHeader: matchedEntry?.header || "",
      hasSource: Boolean(matchedEntry),
    });
    if (fieldValue) {
      fields.push(fieldValue);
    }
  });

  const rawValues = buildRawValuesObject(rowContext);
  const itemNumberEntry = peekFirstEntryByHeaders(rowContext, ["Item number"]);
  const descriptionEntry = peekFirstEntryByHeaders(rowContext, ["Description"]);
  const barcodeEntry = peekFirstEntryByHeaders(rowContext, ["BARCODE NO."]);

  return {
    fields,
    item_sizes: itemSizes,
    box_sizes: boxSizes,
    box_mode: detectBoxPackagingMode("", boxSizes),
    raw_values: rawValues,
    common_fields: {
      code: normalizeText(itemNumberEntry?.value),
      description: normalizeText(descriptionEntry?.value),
      name: normalizeText(descriptionEntry?.value),
      pis_master_barcode: normalizeText(barcodeEntry?.value),
      pis_barcode: normalizeText(barcodeEntry?.value),
    },
  };
};

module.exports = {
  PRODUCT_TYPE_TEMPLATE_INPUT_TYPES,
  PRODUCT_TYPE_TEMPLATE_STATUSES,
  PRODUCT_TYPE_TEMPLATE_VALUE_TYPES,
  buildBoxSizeEntry,
  buildItemSizeEntry,
  buildProductSpecFieldValue,
  buildProductTypeSnapshot,
  createUploadedRowContext,
  flattenTemplateFields,
  mapUploadedRowToProductSpecs,
  normalizeProductSpecsPayload,
  normalizeStatus,
  normalizeTemplateKey,
  prepareTemplatePayload,
  sortTemplateGroups,
};
