import { BOX_ENTRY_TYPES, BOX_PACKAGING_MODES } from "./measuredSizeForm";

export const PRODUCT_TYPE_TEMPLATE_STATUSES = Object.freeze([
  "draft",
  "active",
  "inactive",
  "archived",
]);

export const PRODUCT_TYPE_TEMPLATE_INPUT_TYPES = Object.freeze([
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

export const PRODUCT_TYPE_TEMPLATE_VALUE_TYPES = Object.freeze([
  "string",
  "number",
  "boolean",
  "date",
  "array",
  "object",
]);

const normalizeText = (value) => String(value ?? "").trim();

export const normalizeTemplateKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

export const isBlankValue = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    return normalizeText(value) === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((entry) => isBlankValue(entry));
  }
  return false;
};

export const sortTemplateGroups = (groups = []) =>
  (Array.isArray(groups) ? groups : [])
    .filter((group) => group?.is_active !== false)
    .map((group) => ({
      ...group,
      fields: (Array.isArray(group?.fields) ? group.fields : [])
        .filter((field) => field?.is_active !== false)
        .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0)),
    }))
    .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0));

export const flattenTemplateFields = (template = {}) =>
  sortTemplateGroups(template?.groups).flatMap((group) =>
    (Array.isArray(group?.fields) ? group.fields : []).map((field) => ({
      ...field,
      group_key: normalizeTemplateKey(group?.key),
      group_label: normalizeText(group?.label),
    })),
  );

export const createEmptyItemSizeEntry = (remark = "") => ({
  L: "",
  B: "",
  H: "",
  net_weight: "",
  gross_weight: "",
  remark: normalizeTemplateKey(remark),
});

export const createEmptyBoxSizeEntry = ({
  remark = "",
  boxType = BOX_ENTRY_TYPES.INDIVIDUAL,
} = {}) => ({
  L: "",
  B: "",
  H: "",
  net_weight: "",
  gross_weight: "",
  remark: normalizeTemplateKey(remark || boxType),
  box_type: normalizeTemplateKey(boxType || BOX_ENTRY_TYPES.INDIVIDUAL) || BOX_ENTRY_TYPES.INDIVIDUAL,
  item_count_in_inner:
    normalizeTemplateKey(boxType) === BOX_ENTRY_TYPES.INNER ? "" : "0",
  box_count_in_master:
    normalizeTemplateKey(boxType) === BOX_ENTRY_TYPES.MASTER ? "" : "0",
});

export const getDefaultValueTypeForInputType = (inputType = "text") => {
  switch (normalizeTemplateKey(inputType)) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "multiselect":
      return "array";
    case "file":
      return "object";
    default:
      return "string";
  }
};

const serializeFileMetadata = (file) => {
  if (!file) return null;
  return {
    name: normalizeText(file?.name),
    size: Number(file?.size || 0),
    type: normalizeText(file?.type),
    last_modified: Number(file?.lastModified || 0),
  };
};

const toInputString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value);
};

const toStoredSizeNumberString = (value) => {
  if (value === undefined || value === null) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  return String(parsed).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

const extractProductSpecFieldValue = (entry = {}) => {
  const valueType = normalizeTemplateKey(entry?.value_type);
  switch (valueType) {
    case "number":
      return entry?.value_number ?? "";
    case "boolean":
      return entry?.value_boolean ?? null;
    case "date":
      return entry?.value_date
        ? new Date(entry.value_date).toISOString().slice(0, 10)
        : "";
    case "array":
      return Array.isArray(entry?.value_array) ? entry.value_array : [];
    case "object":
      return entry?.raw_value ?? null;
    case "string":
    default:
      return entry?.value_text ?? "";
  }
};

const findFieldValueEntry = (fields = [], field = {}) => {
  const safeFields = Array.isArray(fields) ? fields : [];
  return (
    safeFields.find((entry) => {
      if (entry?.field_id && field?._id) {
        return String(entry.field_id) === String(field._id);
      }
      return normalizeTemplateKey(entry?.key) === normalizeTemplateKey(field?.key);
    }) || null
  );
};

const findSizeEntryByRemark = (entries = [], remark = "") => {
  const normalizedRemark = normalizeTemplateKey(remark);
  return (
    (Array.isArray(entries) ? entries : []).find(
      (entry) => normalizeTemplateKey(entry?.remark) === normalizedRemark,
    ) || null
  );
};

export const createProductTypeFormState = ({ item = {}, template = null } = {}) => {
  const specs = item?.product_specs || {};
  const flattenedFields = flattenTemplateFields(template || {});
  const fieldValues = {};
  const itemSizeValues = {};
  const boxSizeValues = {};

  flattenedFields.forEach((field) => {
    const inputType = normalizeTemplateKey(field?.input_type);
    const fieldKey = normalizeTemplateKey(field?.key);
    const valueType = normalizeTemplateKey(
      field?.value_type || getDefaultValueTypeForInputType(inputType),
    );

    if (inputType === "item_size") {
      const matchedEntry = findSizeEntryByRemark(
        specs?.item_sizes,
        field?.size_remark || field?.key,
      );
      itemSizeValues[fieldKey] = matchedEntry
        ? {
            ...createEmptyItemSizeEntry(field?.size_remark || field?.key),
            L: toStoredSizeNumberString(matchedEntry?.L),
            B: toStoredSizeNumberString(matchedEntry?.B),
            H: toStoredSizeNumberString(matchedEntry?.H),
            net_weight: toStoredSizeNumberString(matchedEntry?.net_weight),
            gross_weight: toStoredSizeNumberString(matchedEntry?.gross_weight),
          }
        : createEmptyItemSizeEntry(field?.size_remark || field?.key);
      return;
    }

    if (inputType === "box_size") {
      const matchedEntry = findSizeEntryByRemark(
        specs?.box_sizes,
        field?.size_remark || field?.key,
      );
      boxSizeValues[fieldKey] = matchedEntry
        ? {
            ...createEmptyBoxSizeEntry({
              remark: field?.size_remark || field?.key,
              boxType: matchedEntry?.box_type || field?.box_type,
            }),
            L: toStoredSizeNumberString(matchedEntry?.L),
            B: toStoredSizeNumberString(matchedEntry?.B),
            H: toStoredSizeNumberString(matchedEntry?.H),
            net_weight: toStoredSizeNumberString(matchedEntry?.net_weight),
            gross_weight: toStoredSizeNumberString(matchedEntry?.gross_weight),
            box_type:
              normalizeTemplateKey(matchedEntry?.box_type || field?.box_type) ||
              BOX_ENTRY_TYPES.INDIVIDUAL,
            item_count_in_inner: toStoredSizeNumberString(matchedEntry?.item_count_in_inner || 0),
            box_count_in_master: toStoredSizeNumberString(matchedEntry?.box_count_in_master || 0),
          }
        : createEmptyBoxSizeEntry({
            remark: field?.size_remark || field?.key,
            boxType: field?.box_type || BOX_ENTRY_TYPES.INDIVIDUAL,
          });
      return;
    }

    const existingValueEntry = findFieldValueEntry(specs?.fields, field);
    if (existingValueEntry) {
      fieldValues[fieldKey] = extractProductSpecFieldValue(existingValueEntry);
      return;
    }

    if (valueType === "boolean") {
      fieldValues[fieldKey] =
        field?.default_value === null || field?.default_value === undefined
          ? null
          : Boolean(field.default_value);
      return;
    }

    if (valueType === "array") {
      fieldValues[fieldKey] = Array.isArray(field?.default_value)
        ? field.default_value
        : [];
      return;
    }

    fieldValues[fieldKey] = field?.default_value ?? "";
  });

  return {
    fieldValues,
    itemSizeValues,
    boxSizeValues,
  };
};

const toNonNegativeNumber = (value, label) => {
  if (isBlankValue(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return parsed;
};

const validateSizeEntry = (entry = {}, label = "", { requireCountField = "" } = {}) => {
  const errors = {};
  const hasAnyValue = [
    "L",
    "B",
    "H",
    "net_weight",
    "gross_weight",
    "item_count_in_inner",
    "box_count_in_master",
  ].some((field) => !isBlankValue(entry?.[field]));

  if (!hasAnyValue) {
    return { errors, hasAnyValue: false };
  }

  ["L", "B", "H"].forEach((field) => {
    if (isBlankValue(entry?.[field])) {
      errors[field] = `${label} ${field} is required`;
      return;
    }
    try {
      toNonNegativeNumber(entry?.[field], `${label} ${field}`);
    } catch (error) {
      errors[field] = error.message;
    }
  });

  ["net_weight", "gross_weight"].forEach((field) => {
    if (isBlankValue(entry?.[field])) return;
    try {
      toNonNegativeNumber(entry?.[field], `${label} ${field.replace(/_/g, " ")}`);
    } catch (error) {
      errors[field] = error.message;
    }
  });

  if (requireCountField === "item_count_in_inner") {
    try {
      const parsed = toNonNegativeNumber(entry?.item_count_in_inner, `${label} item count in inner`);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        errors.item_count_in_inner = `${label} item count in inner must be greater than 0`;
      }
    } catch (error) {
      errors.item_count_in_inner = error.message;
    }
  }

  if (requireCountField === "box_count_in_master") {
    try {
      const parsed = toNonNegativeNumber(entry?.box_count_in_master, `${label} box count in master`);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        errors.box_count_in_master = `${label} box count in master must be greater than 0`;
      }
    } catch (error) {
      errors.box_count_in_master = error.message;
    }
  }

  return { errors, hasAnyValue: true };
};

export const validateProductTypeFormState = ({
  template = null,
  selectedProductTypeKey = "",
  formState = {},
} = {}) => {
  const errors = {
    product_type: "",
    fields: {},
    item_sizes: {},
    box_sizes: {},
  };

  const normalizedProductTypeKey = normalizeTemplateKey(selectedProductTypeKey);
  if (!template || !normalizedProductTypeKey) {
    return {
      valid: true,
      errors,
    };
  }

  flattenTemplateFields(template).forEach((field) => {
    const fieldKey = normalizeTemplateKey(field?.key);
    const inputType = normalizeTemplateKey(field?.input_type);
    const valueType = normalizeTemplateKey(
      field?.value_type || getDefaultValueTypeForInputType(inputType),
    );

    if (inputType === "item_size") {
      const entry =
        formState?.itemSizeValues?.[fieldKey] ||
        createEmptyItemSizeEntry(field?.size_remark || field?.key);
      const { errors: entryErrors, hasAnyValue } = validateSizeEntry(entry, field?.label || field?.key);
      if (field?.required && !hasAnyValue) {
        errors.item_sizes[fieldKey] = {
          _error: `${field?.label || field?.key} is required`,
        };
        return;
      }
      if (Object.keys(entryErrors).length > 0) {
        errors.item_sizes[fieldKey] = entryErrors;
      }
      return;
    }

    if (inputType === "box_size") {
      const entry =
        formState?.boxSizeValues?.[fieldKey] ||
        createEmptyBoxSizeEntry({
          remark: field?.size_remark || field?.key,
          boxType: field?.box_type,
        });
      const boxType = normalizeTemplateKey(entry?.box_type || field?.box_type);
      const requiredCountField =
        boxType === BOX_ENTRY_TYPES.INNER
          ? "item_count_in_inner"
          : boxType === BOX_ENTRY_TYPES.MASTER
          ? "box_count_in_master"
          : "";
      const { errors: entryErrors, hasAnyValue } = validateSizeEntry(
        entry,
        field?.label || field?.key,
        { requireCountField: requiredCountField },
      );
      if (field?.required && !hasAnyValue) {
        errors.box_sizes[fieldKey] = {
          _error: `${field?.label || field?.key} is required`,
        };
        return;
      }
      if (
        ![
          BOX_ENTRY_TYPES.INDIVIDUAL,
          BOX_ENTRY_TYPES.INNER,
          BOX_ENTRY_TYPES.MASTER,
        ].includes(boxType)
      ) {
        entryErrors.box_type = `${field?.label || field?.key} box type is invalid`;
      }
      if (Object.keys(entryErrors).length > 0) {
        errors.box_sizes[fieldKey] = entryErrors;
      }
      return;
    }

    const currentValue = formState?.fieldValues?.[fieldKey];
    if (field?.required) {
      const missingBoolean = valueType === "boolean" && currentValue === null;
      if (missingBoolean || isBlankValue(currentValue)) {
        errors.fields[fieldKey] = `${field?.label || field?.key} is required`;
        return;
      }
    }

    if (isBlankValue(currentValue)) return;

    if (valueType === "number") {
      const parsed = Number(currentValue);
      if (!Number.isFinite(parsed)) {
        errors.fields[fieldKey] = `${field?.label || field?.key} must be a valid number`;
      }
      return;
    }

    if (valueType === "date") {
      const parsed = Date.parse(currentValue);
      if (!Number.isFinite(parsed)) {
        errors.fields[fieldKey] = `${field?.label || field?.key} must be a valid date`;
      }
      return;
    }

    if (inputType === "select") {
      const options = Array.isArray(field?.options) ? field.options : [];
      if (options.length > 0 && !options.includes(currentValue)) {
        errors.fields[fieldKey] = `${field?.label || field?.key} must use one of the template options`;
      }
      return;
    }

    if (inputType === "multiselect") {
      const values = Array.isArray(currentValue) ? currentValue : [];
      const options = Array.isArray(field?.options) ? field.options : [];
      if (options.length > 0 && values.some((entry) => !options.includes(entry))) {
        errors.fields[fieldKey] = `${field?.label || field?.key} contains an invalid option`;
      }
    }
  });

  const valid =
    !errors.product_type &&
    Object.keys(errors.fields).length === 0 &&
    Object.keys(errors.item_sizes).length === 0 &&
    Object.keys(errors.box_sizes).length === 0;

  return {
    valid,
    errors,
  };
};

const buildFieldValuePayload = (field = {}, value) => {
  const inputType = normalizeTemplateKey(field?.input_type);
  const valueType = normalizeTemplateKey(
    field?.value_type || getDefaultValueTypeForInputType(inputType),
  );
  const basePayload = {
    field_id: field?._id || null,
    key: normalizeTemplateKey(field?.key),
    label: normalizeText(field?.label),
    group_key: normalizeTemplateKey(field?.group_key),
    group_label: normalizeText(field?.group_label),
    input_type: inputType,
    value_type: valueType,
    unit: normalizeText(field?.unit),
    value_text: "",
    value_number: null,
    value_boolean: null,
    value_date: null,
    value_array: [],
    raw_value: value ?? null,
    source_header: "",
  };

  if (valueType === "number") {
    basePayload.value_number = isBlankValue(value) ? null : Number(value);
    return basePayload;
  }

  if (valueType === "boolean") {
    basePayload.value_boolean =
      value === null || value === undefined ? null : Boolean(value);
    return basePayload;
  }

  if (valueType === "date") {
    basePayload.value_date = isBlankValue(value) ? null : value;
    return basePayload;
  }

  if (valueType === "array") {
    basePayload.value_array = Array.isArray(value) ? value : [];
    return basePayload;
  }

  if (valueType === "object") {
    if (value instanceof File) {
      const metadata = serializeFileMetadata(value);
      basePayload.value_text = metadata?.name || "";
      basePayload.raw_value = metadata;
      return basePayload;
    }

    if (value && typeof value === "object") {
      basePayload.value_text = normalizeText(value?.name || value?.file_name);
      basePayload.raw_value = value;
      return basePayload;
    }

    return basePayload;
  }

  basePayload.value_text = normalizeText(value);
  return basePayload;
};

const toMeaningfulSizePayloadEntry = (entry = {}) => {
  const hasAnyValue = [
    "L",
    "B",
    "H",
    "net_weight",
    "gross_weight",
    "item_count_in_inner",
    "box_count_in_master",
  ].some((field) => !isBlankValue(entry?.[field]));

  if (!hasAnyValue) return null;

  return {
    L: Number(entry?.L || 0),
    B: Number(entry?.B || 0),
    H: Number(entry?.H || 0),
    remark: normalizeTemplateKey(entry?.remark),
    net_weight: Number(entry?.net_weight || 0),
    gross_weight: Number(entry?.gross_weight || 0),
    box_type:
      normalizeTemplateKey(entry?.box_type || BOX_ENTRY_TYPES.INDIVIDUAL) ||
      BOX_ENTRY_TYPES.INDIVIDUAL,
    item_count_in_inner: Number(entry?.item_count_in_inner || 0),
    box_count_in_master: Number(entry?.box_count_in_master || 0),
  };
};

export const buildProductTypePayload = ({
  template = null,
  selectedProductTypeKey = "",
  formState = {},
} = {}) => {
  const normalizedProductTypeKey = normalizeTemplateKey(selectedProductTypeKey);

  if (!template || !normalizedProductTypeKey) {
    return {
      product_type: null,
      product_specs: {
        fields: [],
        item_sizes: [],
        box_sizes: [],
        box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
        raw_values: {},
      },
    };
  }

  const productFields = [];
  const itemSizes = [];
  const boxSizes = [];
  const rawValues = {};

  flattenTemplateFields(template).forEach((field) => {
    const fieldKey = normalizeTemplateKey(field?.key);
    const inputType = normalizeTemplateKey(field?.input_type);

    if (inputType === "item_size") {
      const entry = toMeaningfulSizePayloadEntry(formState?.itemSizeValues?.[fieldKey]);
      if (entry) {
        itemSizes.push({
          ...entry,
          box_type: undefined,
          item_count_in_inner: undefined,
          box_count_in_master: undefined,
        });
        rawValues[fieldKey] = {
          ...entry,
          box_type: undefined,
          item_count_in_inner: undefined,
          box_count_in_master: undefined,
        };
      }
      return;
    }

    if (inputType === "box_size") {
      const entry = toMeaningfulSizePayloadEntry(formState?.boxSizeValues?.[fieldKey]);
      if (entry) {
        boxSizes.push(entry);
        rawValues[fieldKey] = entry;
      }
      return;
    }

    const currentValue = formState?.fieldValues?.[fieldKey];
    if (
      inputType !== "boolean" &&
      inputType !== "multiselect" &&
      inputType !== "file" &&
      isBlankValue(currentValue)
    ) {
      return;
    }

    if (inputType === "multiselect" && (!Array.isArray(currentValue) || currentValue.length === 0)) {
      return;
    }

    if (inputType === "boolean" && currentValue === null) {
      return;
    }

    if (inputType === "file" && !currentValue) {
      return;
    }

    const payloadEntry = buildFieldValuePayload(field, currentValue);
    productFields.push(payloadEntry);
    rawValues[fieldKey] =
      currentValue instanceof File ? serializeFileMetadata(currentValue) : currentValue;
  });

  const productType = {
    template: template?._id || null,
    key: normalizeTemplateKey(template?.key || selectedProductTypeKey),
    label: normalizeText(template?.label),
    version: Number(template?.version || 1),
  };

  const boxMode = boxSizes.some((entry) =>
    [BOX_ENTRY_TYPES.INNER, BOX_ENTRY_TYPES.MASTER].includes(
      normalizeTemplateKey(entry?.box_type),
    ),
  )
    ? BOX_PACKAGING_MODES.CARTON
    : BOX_PACKAGING_MODES.INDIVIDUAL;

  return {
    product_type: productType,
    product_specs: {
      fields: productFields,
      item_sizes: itemSizes.map(({ box_type, item_count_in_inner, box_count_in_master, ...entry }) => entry),
      box_sizes: boxSizes,
      box_mode: boxMode,
      raw_values: rawValues,
    },
  };
};

export const hasProductTypeFormValues = (formState = {}) =>
  Object.values(formState?.fieldValues || {}).some((value) => !isBlankValue(value)) ||
  Object.values(formState?.itemSizeValues || {}).some((entry) =>
    ["L", "B", "H", "net_weight", "gross_weight"].some(
      (field) => !isBlankValue(entry?.[field]),
    ),
  ) ||
  Object.values(formState?.boxSizeValues || {}).some((entry) =>
    [
      "L",
      "B",
      "H",
      "net_weight",
      "gross_weight",
      "item_count_in_inner",
      "box_count_in_master",
    ].some((field) => !isBlankValue(entry?.[field])),
  );

export const createTemplateGroupDraft = () => ({
  key: "",
  label: "",
  description: "",
  order: 0,
  is_active: true,
  fields: [],
});

export const createTemplateFieldDraft = () => ({
  key: "",
  label: "",
  description: "",
  input_type: "text",
  value_type: "string",
  unit: "",
  required: false,
  searchable: false,
  filterable: false,
  show_in_table: false,
  order: 0,
  options: [],
  default_value: null,
  validation: {},
  source_headers: [],
  size_source_headers: {
    L: [],
    B: [],
    H: [],
    net_weight: [],
    gross_weight: [],
    item_count_in_inner: [],
    box_count_in_master: [],
  },
  size_remark: "",
  box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
  is_active: true,
});

export const createTemplateDraft = () => ({
  key: "",
  label: "",
  description: "",
  version: 1,
  status: "draft",
  groups: [],
});
