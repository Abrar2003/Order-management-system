const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  detectBoxPackagingMode,
} = require("./boxMeasurement");
const {
  normalizeProductSpecsPayload,
  normalizeTemplateKey,
} = require("./productTypeTemplates");
const {
  isAdminLikeRole,
  isManagerLikeRole,
  normalizeUserRoleKey,
} = require("./userRole");

const SIZE_ENTRY_LIMIT = 4;
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  "item",
  "top",
  "base",
  "item1",
  "item2",
  "item3",
]);
const BOX_SIZE_REMARK_OPTIONS = Object.freeze([
  "top",
  "base",
  "box1",
  "box2",
  "box3",
]);
const BOX_CARTON_REMARK_OPTIONS = Object.freeze(["inner", "master"]);
const PD_STATUSES = Object.freeze({
  CREATED: "created",
  CHECKED: "checked",
  APPROVED: "approved",
});
const PD_STATUS_VALUES = Object.freeze(Object.values(PD_STATUSES));
const NOT_SET_STATUS = "not_set";
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const formatRemarkOptions = (options = []) => options.join(", ");
const validateRemarkOption = (remark = "", options = [], fieldLabel = "Remark") => {
  if (!remark) return;
  if (!options.includes(remark)) {
    throw new ProductDatabaseError(
      `${fieldLabel} must be one of: ${formatRemarkOptions(options)}`,
    );
  }
};
const normalizeRole = (value) => normalizeUserRoleKey(value);
const normalizeId = (value) =>
  String(value?._id || value?.user || value || "").trim();
const normalizeVersion = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return parsed;
};

class ProductDatabaseError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ProductDatabaseError";
    this.statusCode = statusCode;
  }
}

const normalizePdStatus = (value) => {
  const normalized = normalizeKey(value).replace(/\s+/g, "_");
  if (PD_STATUS_VALUES.includes(normalized)) return normalized;
  return "";
};

const normalizePdStatusKey = (value) => normalizePdStatus(value) || NOT_SET_STATUS;

const buildPdAuditActor = (user = {}) => ({
  user: user?._id || user?.id || null,
  name:
    normalizeText(user?.name) ||
    normalizeText(user?.email) ||
    normalizeText(user?.username) ||
    normalizeText(user?.role) ||
    "Unknown",
});

const toNonNegativeNumber = (value, fieldLabel = "Value") => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ProductDatabaseError(`${fieldLabel} must be a non-negative number`);
  }
  return parsed;
};

const hasMeaningfulNumber = (value) => toNonNegativeNumber(value) > 0;
const assignPositiveNumber = (target = {}, key = "", value, fieldLabel = "Value") => {
  if (value === undefined || value === null || value === "") return;
  const parsed = toNonNegativeNumber(value, fieldLabel);
  if (parsed > 0) {
    target[key] = parsed;
  }
};

const hasMeaningfulItemEntry = (entry = {}) =>
  ["L", "B", "H", "net_weight", "gross_weight", "weight"].some((field) =>
    hasMeaningfulNumber(entry?.[field]),
  );

const hasMeaningfulBoxEntry = (entry = {}) =>
  [
    "L",
    "B",
    "H",
    "net_weight",
    "gross_weight",
    "weight",
    "item_count_in_inner",
    "box_count_in_master",
  ].some((field) => hasMeaningfulNumber(entry?.[field]));

const normalizeItemSizeEntries = (entries = []) => {
  if (!Array.isArray(entries)) {
    throw new ProductDatabaseError("pd_item_sizes must be an array");
  }

  const meaningfulEntries = entries.filter((entry) => hasMeaningfulItemEntry(entry));
  if (meaningfulEntries.length > SIZE_ENTRY_LIMIT) {
    throw new ProductDatabaseError(
      `pd_item_sizes cannot exceed ${SIZE_ENTRY_LIMIT} entries`,
    );
  }

  const seenRemarks = new Set();
  return meaningfulEntries.map((entry, index) => {
    const entryLabel = `PD item size ${index + 1}`;

    const normalizedRemark = normalizeKey(entry?.remark || entry?.type || "");
    if (meaningfulEntries.length > 1 && !normalizedRemark) {
      throw new ProductDatabaseError(`${entryLabel} remark is required`);
    }
    validateRemarkOption(
      normalizedRemark,
      ITEM_SIZE_REMARK_OPTIONS,
      `${entryLabel} remark`,
    );
    if (normalizedRemark) {
      if (seenRemarks.has(normalizedRemark)) {
        throw new ProductDatabaseError("PD item size remarks must be unique");
      }
      seenRemarks.add(normalizedRemark);
    }

    const payload = {};
    assignPositiveNumber(payload, "L", entry?.L, `${entryLabel} L`);
    assignPositiveNumber(payload, "B", entry?.B, `${entryLabel} B`);
    assignPositiveNumber(payload, "H", entry?.H, `${entryLabel} H`);
    if (normalizedRemark) payload.remark = normalizedRemark;
    assignPositiveNumber(
      payload,
      "net_weight",
      entry?.net_weight ?? entry?.weight,
      `${entryLabel} net weight`,
    );
    assignPositiveNumber(payload, "gross_weight", entry?.gross_weight, `${entryLabel} gross weight`);
    return payload;
  });
};

const normalizeBoxSizeEntries = (
  entries = [],
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
) => {
  if (!Array.isArray(entries)) {
    throw new ProductDatabaseError("pd_box_sizes must be an array");
  }

  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const meaningfulEntries = entries.filter((entry) => hasMeaningfulBoxEntry(entry));
  const limit = resolvedMode === BOX_PACKAGING_MODES.CARTON ? 2 : SIZE_ENTRY_LIMIT;

  if (meaningfulEntries.length > limit) {
    throw new ProductDatabaseError(`pd_box_sizes cannot exceed ${limit} entries`);
  }

  if (
    resolvedMode === BOX_PACKAGING_MODES.CARTON &&
    meaningfulEntries.length > 0 &&
    meaningfulEntries.length !== 2
  ) {
    return meaningfulEntries.map((entry, index) => {
      const entryLabel = `PD box size ${index + 1}`;
      const payload = {};
      assignPositiveNumber(payload, "L", entry?.L, `${entryLabel} L`);
      assignPositiveNumber(payload, "B", entry?.B, `${entryLabel} B`);
      assignPositiveNumber(payload, "H", entry?.H, `${entryLabel} H`);
      const normalizedRemark = normalizeKey(
        entry?.box_type ||
          entry?.remark ||
          entry?.type ||
          (index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER),
      );
      validateRemarkOption(
        normalizedRemark,
        BOX_CARTON_REMARK_OPTIONS,
        `${entryLabel} remark`,
      );
      payload.remark = normalizedRemark;
      payload.box_type = normalizedRemark;
      assignPositiveNumber(payload, "net_weight", entry?.net_weight, `${entryLabel} net weight`);
      assignPositiveNumber(
        payload,
        "gross_weight",
        entry?.gross_weight ?? entry?.weight,
        `${entryLabel} gross weight`,
      );
      assignPositiveNumber(
        payload,
        "item_count_in_inner",
        entry?.item_count_in_inner,
        `${entryLabel} item count in inner`,
      );
      assignPositiveNumber(
        payload,
        "box_count_in_master",
        entry?.box_count_in_master,
        `${entryLabel} box count in master`,
      );
      return payload;
    });
  }

  const seenRemarks = new Set();
  return meaningfulEntries.map((entry, index) => {
    const entryLabel = `PD box size ${index + 1}`;

    const baseEntry = {};
    assignPositiveNumber(baseEntry, "L", entry?.L, `${entryLabel} L`);
    assignPositiveNumber(baseEntry, "B", entry?.B, `${entryLabel} B`);
    assignPositiveNumber(baseEntry, "H", entry?.H, `${entryLabel} H`);
    assignPositiveNumber(baseEntry, "net_weight", entry?.net_weight, `${entryLabel} net weight`);
    assignPositiveNumber(
      baseEntry,
      "gross_weight",
      entry?.gross_weight ?? entry?.weight,
      `${entryLabel} gross weight`,
    );

    if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
      const boxType = index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;
      const cartonEntry = {
        ...baseEntry,
        remark: boxType,
        box_type: boxType,
      };
      if (boxType === BOX_ENTRY_TYPES.INNER) {
        assignPositiveNumber(
          cartonEntry,
          "item_count_in_inner",
          entry?.item_count_in_inner,
          `${entryLabel} item count in inner`,
        );
      }
      if (boxType === BOX_ENTRY_TYPES.MASTER) {
        assignPositiveNumber(
          cartonEntry,
          "box_count_in_master",
          entry?.box_count_in_master,
          `${entryLabel} box count in master`,
        );
      }

      return cartonEntry;
    }

    const normalizedRemark = normalizeKey(entry?.remark || entry?.type || "");
    if (meaningfulEntries.length > 1 && !normalizedRemark) {
      throw new ProductDatabaseError(`${entryLabel} remark is required`);
    }
    validateRemarkOption(
      normalizedRemark,
      BOX_SIZE_REMARK_OPTIONS,
      `${entryLabel} remark`,
    );
    if (normalizedRemark) {
      if (seenRemarks.has(normalizedRemark)) {
        throw new ProductDatabaseError("PD box size remarks must be unique");
      }
      seenRemarks.add(normalizedRemark);
    }

    const individualEntry = {
      ...baseEntry,
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
    };
    if (normalizedRemark) individualEntry.remark = normalizedRemark;
    return individualEntry;
  });
};

const extractProductDatabaseFields = (item = {}) => {
  const pdBoxMode = detectBoxPackagingMode(item?.pd_box_mode, item?.pd_box_sizes);
  const pdMasterBarcode = normalizeText(item?.pd_master_barcode || item?.pd_barcode);
  return {
    country_of_origin: normalizeText(item?.country_of_origin),
    pd_barcode: pdMasterBarcode,
    pd_master_barcode: pdMasterBarcode,
    pd_inner_barcode: normalizeText(item?.pd_inner_barcode),
    pd_item_sizes: normalizeItemSizeEntries(item?.pd_item_sizes || []),
    pd_box_sizes: normalizeBoxSizeEntries(item?.pd_box_sizes || [], pdBoxMode),
    pd_box_mode: pdBoxMode,
    product_type:
      item?.product_type && typeof item.product_type === "object"
        ? {
            template: item.product_type.template || null,
            key: normalizeTemplateKey(item.product_type.key),
            label: normalizeText(item.product_type.label),
            version: normalizeVersion(item.product_type.version),
          }
        : null,
    product_specs:
      item?.product_specs && typeof item.product_specs === "object"
        ? normalizeProductSpecsPayload(item.product_specs)
        : {
            fields: [],
            item_sizes: [],
            box_sizes: [],
            box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
            raw_values: {},
          },
  };
};

const normalizeProductDatabaseInput = (payload = {}) => {
  const hasCountryOfOrigin = hasOwn(payload, "country_of_origin");
  const hasPdBarcode = hasOwn(payload, "pd_barcode");
  const hasPdMasterBarcode = hasOwn(payload, "pd_master_barcode");
  const hasPdInnerBarcode = hasOwn(payload, "pd_inner_barcode");
  const hasItemSizes = hasOwn(payload, "pd_item_sizes");
  const hasBoxSizes = hasOwn(payload, "pd_box_sizes");
  const hasBoxMode = hasOwn(payload, "pd_box_mode");
  const hasProductType = hasOwn(payload, "product_type");
  const hasProductSpecs = hasOwn(payload, "product_specs");
  const data = {};

  if (hasCountryOfOrigin) {
    data.country_of_origin = normalizeText(payload.country_of_origin);
  }

  if (hasPdBarcode || hasPdMasterBarcode) {
    const nextMasterBarcode = normalizeText(
      hasPdMasterBarcode ? payload.pd_master_barcode : payload.pd_barcode,
    );
    data.pd_barcode = nextMasterBarcode;
    data.pd_master_barcode = nextMasterBarcode;
  }

  if (hasPdInnerBarcode) {
    data.pd_inner_barcode = normalizeText(payload.pd_inner_barcode);
  }

  if (hasItemSizes) {
    data.pd_item_sizes = normalizeItemSizeEntries(payload.pd_item_sizes || []);
  }

  if (hasBoxMode || hasBoxSizes) {
    const nextMode = detectBoxPackagingMode(payload.pd_box_mode, payload.pd_box_sizes || []);
    data.pd_box_mode = nextMode;
    if (hasBoxSizes) {
      data.pd_box_sizes = normalizeBoxSizeEntries(payload.pd_box_sizes || [], nextMode);
      data.pd_box_mode = detectBoxPackagingMode(nextMode, data.pd_box_sizes);
    }
  }

  if (hasProductType || hasProductSpecs) {
    const productType = payload?.product_type;
    const hasSelectedProductType =
      productType &&
      typeof productType === "object" &&
      (normalizeTemplateKey(productType?.key) || normalizeId(productType?.template));

    if (hasSelectedProductType) {
      data.product_type = {
        template: normalizeId(productType?.template) || null,
        key: normalizeTemplateKey(productType?.key),
        label: normalizeText(productType?.label),
        version: normalizeVersion(productType?.version),
      };
    } else if (hasProductType) {
      data.product_type = null;
    }

    if (hasProductSpecs) {
      data.product_specs = hasProductType && !hasSelectedProductType
        ? {
            fields: [],
            item_sizes: [],
            box_sizes: [],
            box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
            raw_values: {},
          }
        : normalizeProductSpecsPayload(payload?.product_specs || {});
    } else if (hasProductType && data.product_type === null) {
      data.product_specs = {
        fields: [],
        item_sizes: [],
        box_sizes: [],
        box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
        raw_values: {},
      };
    }
  }

  return {
    hasInput:
      hasCountryOfOrigin ||
      hasPdBarcode ||
      hasPdMasterBarcode ||
      hasPdInnerBarcode ||
      hasItemSizes ||
      hasBoxSizes ||
      hasBoxMode ||
      hasProductType ||
      hasProductSpecs,
    data,
  };
};

const mergeProductDatabaseFields = (currentState = {}, inputData = {}) => {
  const nextBoxMode = inputData.pd_box_mode || currentState.pd_box_mode;
  const nextBoxSizes = hasOwn(inputData, "pd_box_sizes")
    ? normalizeBoxSizeEntries(inputData.pd_box_sizes, nextBoxMode)
    : normalizeBoxSizeEntries(currentState.pd_box_sizes || [], nextBoxMode);
  const nextMasterBarcode =
    hasOwn(inputData, "pd_master_barcode") || hasOwn(inputData, "pd_barcode")
      ? normalizeText(inputData.pd_master_barcode || inputData.pd_barcode)
      : normalizeText(currentState.pd_master_barcode || currentState.pd_barcode);

  return {
    country_of_origin: hasOwn(inputData, "country_of_origin")
      ? normalizeText(inputData.country_of_origin)
      : normalizeText(currentState.country_of_origin),
    pd_barcode: nextMasterBarcode,
    pd_master_barcode: nextMasterBarcode,
    pd_inner_barcode: hasOwn(inputData, "pd_inner_barcode")
      ? normalizeText(inputData.pd_inner_barcode)
      : normalizeText(currentState.pd_inner_barcode),
    pd_item_sizes: hasOwn(inputData, "pd_item_sizes")
      ? normalizeItemSizeEntries(inputData.pd_item_sizes)
      : normalizeItemSizeEntries(currentState.pd_item_sizes || []),
    pd_box_sizes: nextBoxSizes,
    pd_box_mode: detectBoxPackagingMode(nextBoxMode, nextBoxSizes),
    product_type: hasOwn(inputData, "product_type")
      ? inputData.product_type
      : currentState.product_type || null,
    product_specs: hasOwn(inputData, "product_specs")
      ? normalizeProductSpecsPayload(inputData.product_specs || {})
      : normalizeProductSpecsPayload(currentState.product_specs || {}),
  };
};

const stableStringify = (value) => JSON.stringify(value || null);

const PRODUCT_DATABASE_SIZE_DIFF_TOLERANCE = 0.5;
const PRODUCT_DATABASE_CBM_DECIMALS = 2;
const PRODUCT_DATABASE_SIZE_DIMENSIONS = Object.freeze(["L", "B", "H"]);

const toCompareNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundForCompare = (value, decimals = PRODUCT_DATABASE_CBM_DECIMALS) =>
  Number(toCompareNumber(value, 0).toFixed(decimals));

const areNumbersWithinTolerance = (left, right, tolerance = 0) =>
  Math.abs(toCompareNumber(left, 0) - toCompareNumber(right, 0)) <= tolerance;

const isCbmProductSpecField = (field = {}) => {
  const descriptor = [
    field?.key,
    field?.label,
    field?.unit,
    field?.source_header,
  ]
    .map((value) => normalizeKey(value))
    .join(" ");
  return descriptor.includes("cbm") || descriptor.includes("cubic meter");
};

const normalizeCbmRawValuesForCompare = (value, key = "") => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCbmRawValuesForCompare(entry, key));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, rawKey) => {
        accumulator[rawKey] = normalizeCbmRawValuesForCompare(value[rawKey], rawKey);
        return accumulator;
      }, {});
  }
  if (
    normalizeKey(key).includes("cbm") &&
    value !== null &&
    value !== "" &&
    Number.isFinite(Number(value))
  ) {
    return roundForCompare(value);
  }
  return value;
};

const normalizeProductSpecFieldsForCompare = (fields = []) =>
  (Array.isArray(fields) ? fields : []).map((field) => ({
    ...field,
    value_number:
      isCbmProductSpecField(field) && field?.value_number !== null && field?.value_number !== undefined
        ? roundForCompare(field.value_number)
        : field?.value_number,
  }));

const areSizeEntriesEqualForCompare = (currentEntry = {}, nextEntry = {}) => {
  const currentKeys = Object.keys(currentEntry || {});
  const nextKeys = Object.keys(nextEntry || {});
  const keys = [...new Set([...currentKeys, ...nextKeys])];

  return keys.every((key) => {
    if (PRODUCT_DATABASE_SIZE_DIMENSIONS.includes(key)) {
      return areNumbersWithinTolerance(
        currentEntry?.[key],
        nextEntry?.[key],
        PRODUCT_DATABASE_SIZE_DIFF_TOLERANCE,
      );
    }

    const currentValue = currentEntry?.[key];
    const nextValue = nextEntry?.[key];
    if (typeof currentValue === "number" || typeof nextValue === "number") {
      return areNumbersWithinTolerance(currentValue, nextValue, 0);
    }

    return stableStringify(currentValue) === stableStringify(nextValue);
  });
};

const areSizeEntryArraysEqualForCompare = (currentEntries = [], nextEntries = []) => {
  const current = Array.isArray(currentEntries) ? currentEntries : [];
  const next = Array.isArray(nextEntries) ? nextEntries : [];
  if (current.length !== next.length) return false;
  return current.every((entry, index) => areSizeEntriesEqualForCompare(entry, next[index]));
};

const areProductSpecsEqualForCompare = (currentSpecs = {}, nextSpecs = {}) => {
  const current = currentSpecs || {};
  const next = nextSpecs || {};

  if (
    stableStringify(normalizeProductSpecFieldsForCompare(current.fields)) !==
    stableStringify(normalizeProductSpecFieldsForCompare(next.fields))
  ) {
    return false;
  }
  if (!areSizeEntryArraysEqualForCompare(current.item_sizes, next.item_sizes)) {
    return false;
  }
  if (!areSizeEntryArraysEqualForCompare(current.box_sizes, next.box_sizes)) {
    return false;
  }
  if (stableStringify(current.box_mode) !== stableStringify(next.box_mode)) {
    return false;
  }

  return (
    stableStringify(normalizeCbmRawValuesForCompare(current.raw_values)) ===
    stableStringify(normalizeCbmRawValuesForCompare(next.raw_values))
  );
};

const areProductDatabaseFieldValuesEqual = (field, currentValue, nextValue) => {
  if (field === "pd_item_sizes" || field === "pd_box_sizes") {
    return areSizeEntryArraysEqualForCompare(currentValue, nextValue);
  }
  if (field === "product_specs") {
    return areProductSpecsEqualForCompare(currentValue, nextValue);
  }
  return stableStringify(currentValue) === stableStringify(nextValue);
};

const getChangedProductDatabaseFields = (currentState = {}, nextState = {}) =>
  [
    "country_of_origin",
    "pd_barcode",
    "pd_master_barcode",
    "pd_inner_barcode",
    "pd_item_sizes",
    "pd_box_sizes",
    "pd_box_mode",
    "product_type",
    "product_specs",
  ].filter(
    (field) => !areProductDatabaseFieldValuesEqual(
      field,
      currentState?.[field],
      nextState?.[field],
    ),
  );

const hasProductDatabaseData = (state = {}) =>
  Boolean(
    normalizeText(state?.pd_master_barcode || state?.pd_barcode) ||
      normalizeText(state?.pd_inner_barcode),
  ) ||
  (Array.isArray(state?.pd_item_sizes) && state.pd_item_sizes.length > 0) ||
  (Array.isArray(state?.pd_box_sizes) && state.pd_box_sizes.length > 0) ||
  (Array.isArray(state?.product_specs?.item_sizes) && state.product_specs.item_sizes.length > 0) ||
  (Array.isArray(state?.product_specs?.box_sizes) && state.product_specs.box_sizes.length > 0);

const appendPdHistory = (
  item,
  {
    action = "update",
    previousStatus = "",
    nextStatus = "",
    actor = {},
    changedFields = [],
  } = {},
) => {
  item.pd_history = Array.isArray(item.pd_history) ? item.pd_history : [];
  item.pd_history.push({
    action,
    previous_status: normalizePdStatusKey(previousStatus),
    next_status: normalizePdStatusKey(nextStatus),
    actor,
    changed_fields: changedFields,
    timestamp: new Date(),
  });
};

const setProductDatabaseFields = (item, state = {}) => {
  const pdMasterBarcode = normalizeText(state.pd_master_barcode || state.pd_barcode);
  item.country_of_origin = normalizeText(state.country_of_origin);
  item.pd_barcode = pdMasterBarcode;
  item.pd_master_barcode = pdMasterBarcode;
  item.pd_inner_barcode = normalizeText(state.pd_inner_barcode);
  item.pd_item_sizes = state.pd_item_sizes || [];
  item.pd_box_sizes = state.pd_box_sizes || [];
  item.pd_box_mode = state.pd_box_mode || BOX_PACKAGING_MODES.INDIVIDUAL;
  item.product_type = state.product_type || undefined;
  item.product_specs = state.product_specs || {
    fields: [],
    item_sizes: [],
    box_sizes: [],
    box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
    raw_values: {},
  };
};

const clearReviewActors = (item) => {
  item.pd_checked_by = undefined;
  item.pd_approved_by = undefined;
};

const ensureCreatedActor = (item, actor = {}, now = new Date()) => {
  if (!normalizeId(item?.pd_created_by?.user)) {
    item.pd_created_by = {
      ...actor,
      created_at: now,
      updated_at: now,
    };
  } else if (item.pd_created_by) {
    item.pd_created_by.updated_at = now;
  }
};

const markProductDatabaseCreated = ({
  item,
  nextState,
  actor,
  previousStatus,
  changedFields,
  action = "",
} = {}) => {
  const now = new Date();
  setProductDatabaseFields(item, nextState);
  ensureCreatedActor(item, actor, now);
  item.pd_checked = PD_STATUSES.CREATED;
  item.pd_last_changed_by = {
    ...actor,
    changed_at: now,
  };
  clearReviewActors(item);
  appendPdHistory(item, {
    action:
      action ||
      (!previousStatus
        ? "create"
        : previousStatus === PD_STATUSES.CHECKED || previousStatus === PD_STATUSES.APPROVED
          ? "reset_to_created"
          : "update"),
    previousStatus,
    nextStatus: PD_STATUSES.CREATED,
    actor,
    changedFields,
  });
};

const applyProductDatabaseSave = ({ item, payload = {}, user = {} } = {}) => {
  const role = normalizeRole(user?.role);
  if (!isManagerLikeRole(role)) {
    throw new ProductDatabaseError("Only admin or manager can update Product Database data", 403);
  }

  const actor = buildPdAuditActor(user);
  const previousStatus = normalizePdStatus(item?.pd_checked);
  const currentState = extractProductDatabaseFields(item);
  const input = normalizeProductDatabaseInput(payload);
  const nextState = mergeProductDatabaseFields(currentState, input.data);
  const changedFields = getChangedProductDatabaseFields(currentState, nextState);

  if (!input.hasInput) {
    throw new ProductDatabaseError("Product Database data is required");
  }

  if (changedFields.length > 0 || !previousStatus) {
    markProductDatabaseCreated({
      item,
      nextState,
      actor,
      previousStatus,
      changedFields,
      action: previousStatus ? "" : "create",
    });
    return {
      changed: changedFields.length > 0,
      status: PD_STATUSES.CREATED,
      message: "Product Database data saved and marked as created.",
    };
  }

  return {
    changed: false,
    status: previousStatus,
    message: "No Product Database changes detected.",
  };
};

const applyProductDatabaseCheck = ({ item, payload = {}, user = {} } = {}) => {
  const role = normalizeRole(user?.role);
  if (isAdminLikeRole(role) || !isManagerLikeRole(role)) {
    throw new ProductDatabaseError("Only managers can check Product Database data", 403);
  }

  const actor = buildPdAuditActor(user);
  const actorId = normalizeId(actor.user);
  const previousStatus = normalizePdStatus(item?.pd_checked);
  const currentState = extractProductDatabaseFields(item);
  const input = normalizeProductDatabaseInput(payload);
  const nextState = mergeProductDatabaseFields(currentState, input.data);
  const changedFields = getChangedProductDatabaseFields(currentState, nextState);

  if (changedFields.length > 0) {
    markProductDatabaseCreated({
      item,
      nextState,
      actor,
      previousStatus,
      changedFields,
    });
    return {
      changed: true,
      checked: false,
      status: PD_STATUSES.CREATED,
      message:
        "Product Database data changed and remains created. Another eligible manager must check it.",
    };
  }

  if (previousStatus !== PD_STATUSES.CREATED) {
    throw new ProductDatabaseError("Only created Product Database records can be checked");
  }

  const creatorId = normalizeId(item?.pd_created_by?.user);
  const lastChangerId = normalizeId(item?.pd_last_changed_by?.user);
  if (creatorId && actorId === creatorId) {
    throw new ProductDatabaseError("You cannot check Product Database data that you created", 403);
  }
  if (lastChangerId && actorId === lastChangerId) {
    throw new ProductDatabaseError("You cannot check Product Database data that you last changed", 403);
  }

  item.pd_checked = PD_STATUSES.CHECKED;
  item.pd_checked_by = {
    ...actor,
    checked_at: new Date(),
  };
  item.pd_approved_by = undefined;
  appendPdHistory(item, {
    action: "check",
    previousStatus,
    nextStatus: PD_STATUSES.CHECKED,
    actor,
    changedFields: [],
  });

  return {
    changed: false,
    checked: true,
    status: PD_STATUSES.CHECKED,
    message: "Product Database data checked successfully.",
  };
};

const applyProductDatabaseApprove = ({ item, payload = {}, user = {} } = {}) => {
  const role = normalizeRole(user?.role);
  if (!isAdminLikeRole(role)) {
    throw new ProductDatabaseError("Only admin can approve Product Database data", 403);
  }

  const actor = buildPdAuditActor(user);
  const previousStatus = normalizePdStatus(item?.pd_checked);
  const currentState = extractProductDatabaseFields(item);
  const input = normalizeProductDatabaseInput(payload);
  const nextState = mergeProductDatabaseFields(currentState, input.data);
  const changedFields = getChangedProductDatabaseFields(currentState, nextState);

  if (changedFields.length === 0 && previousStatus !== PD_STATUSES.CHECKED) {
    throw new ProductDatabaseError("Only checked Product Database records can be approved");
  }

  const now = new Date();
  if (changedFields.length > 0) {
    setProductDatabaseFields(item, nextState);
    ensureCreatedActor(item, actor, now);
    item.pd_last_changed_by = {
      ...actor,
      changed_at: now,
    };
  }

  item.pd_checked = PD_STATUSES.APPROVED;
  item.pd_approved_by = {
    ...actor,
    approved_at: now,
  };
  appendPdHistory(item, {
    action: "approve",
    previousStatus,
    nextStatus: PD_STATUSES.APPROVED,
    actor,
    changedFields,
  });

  return {
    changed: changedFields.length > 0,
    approved: true,
    status: PD_STATUSES.APPROVED,
    message: "Product Database data approved successfully.",
  };
};

const buildProductDatabasePermissions = (item = {}, user = {}) => {
  const role = normalizeRole(user?.role);
  const actorId = normalizeId(user?._id || user?.id);
  const status = normalizePdStatus(item?.pd_checked);
  const creatorId = normalizeId(item?.pd_created_by?.user);
  const lastChangerId = normalizeId(item?.pd_last_changed_by?.user);
  const isCreator = Boolean(creatorId && actorId === creatorId);
  const isLastChanger = Boolean(lastChangerId && actorId === lastChangerId);
  const canEdit = isManagerLikeRole(role);
  const canCheck =
    !isAdminLikeRole(role) &&
    isManagerLikeRole(role) &&
    status === PD_STATUSES.CREATED &&
    !isCreator &&
    !isLastChanger;

  let checkBlockedReason = "";
  if (
    !isAdminLikeRole(role) &&
    isManagerLikeRole(role) &&
    status === PD_STATUSES.CREATED &&
    !canCheck
  ) {
    if (isCreator || isLastChanger) {
      checkBlockedReason =
        "You cannot check this because you created or last changed this PD data.";
    }
  }

  return {
    can_edit: canEdit,
    can_check: canCheck,
    can_approve: isAdminLikeRole(role) && status === PD_STATUSES.CHECKED,
    check_blocked_reason: checkBlockedReason,
  };
};

const buildProductDatabaseRow = (item = {}, user = {}) => {
  const state = extractProductDatabaseFields(item);
  const status = normalizePdStatusKey(item?.pd_checked);

  return {
    id: String(item?._id || ""),
    code: item?.code || "",
    name: item?.name || "",
    description: item?.description || "",
    brand: item?.brand || "",
    brand_name: item?.brand_name || "",
    brands: Array.isArray(item?.brands) ? item.brands : [],
    vendors: Array.isArray(item?.vendors) ? item.vendors : [],
    country_of_origin: state.country_of_origin,
    pd_barcode: state.pd_barcode,
    pd_master_barcode: state.pd_master_barcode,
    pd_inner_barcode: state.pd_inner_barcode,
    pd_item_sizes: state.pd_item_sizes,
    pd_box_sizes: state.pd_box_sizes,
    pd_box_mode: state.pd_box_mode,
    product_type: state.product_type,
    product_specs: state.product_specs,
    pd_checked: status,
    pd_created_by: item?.pd_created_by || null,
    pd_checked_by: item?.pd_checked_by || null,
    pd_approved_by: item?.pd_approved_by || null,
    pd_last_changed_by: item?.pd_last_changed_by || null,
    permissions: buildProductDatabasePermissions(item, user),
    updated_at: item?.updatedAt || null,
  };
};

module.exports = {
  NOT_SET_STATUS,
  PD_STATUSES,
  PD_STATUS_VALUES,
  ProductDatabaseError,
  normalizePdStatus,
  normalizePdStatusKey,
  buildPdAuditActor,
  extractProductDatabaseFields,
  normalizeProductDatabaseInput,
  mergeProductDatabaseFields,
  getChangedProductDatabaseFields,
  hasProductDatabaseData,
  applyProductDatabaseSave,
  applyProductDatabaseCheck,
  applyProductDatabaseApprove,
  buildProductDatabaseRow,
};
