const {
  BOX_ENTRY_TYPES,
  BOX_INDIVIDUAL_REMARK_OPTIONS,
  BOX_PACKAGING_MODES,
  detectBoxPackagingMode,
} = require("./boxMeasurement");
const {
  normalizeProductSpecsPayload,
  normalizeTemplateKey,
} = require("./productTypeTemplates");

const SIZE_ENTRY_LIMIT = 4;
const PD_STATUSES = Object.freeze({
  CREATED: "created",
  CHECKED: "checked",
  APPROVED: "approved",
});
const PD_STATUS_VALUES = Object.freeze(Object.values(PD_STATUSES));
const NOT_SET_STATUS = "not_set";
const ITEM_REMARK_OPTIONS = Object.freeze([
  "",
  "item",
  "top",
  "base",
  "item1",
  "item2",
  "item3",
  "item4",
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const normalizeRole = (value) => normalizeKey(value);
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

const hasMeaningfulItemEntry = (entry = {}) =>
  ["L", "B", "H", "net_weight", "gross_weight"].some((field) =>
    hasMeaningfulNumber(entry?.[field]),
  ) || Boolean(normalizeKey(entry?.remark));

const hasMeaningfulBoxEntry = (entry = {}) =>
  [
    "L",
    "B",
    "H",
    "net_weight",
    "gross_weight",
    "item_count_in_inner",
    "box_count_in_master",
  ].some((field) => hasMeaningfulNumber(entry?.[field])) ||
  Boolean(normalizeKey(entry?.remark)) ||
  Boolean(normalizeKey(entry?.box_type));

const assertPositiveDimensions = (entry = {}, entryLabel = "Size") => {
  ["L", "B", "H"].forEach((field) => {
    if (toNonNegativeNumber(entry?.[field], `${entryLabel} ${field}`) <= 0) {
      throw new ProductDatabaseError(`${entryLabel} ${field} must be greater than 0`);
    }
  });
};

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
    assertPositiveDimensions(entry, entryLabel);

    const normalizedRemark = normalizeKey(entry?.remark || entry?.type || "");
    const remark = meaningfulEntries.length === 1 ? "" : normalizedRemark;

    if (meaningfulEntries.length > 1) {
      if (!remark) {
        throw new ProductDatabaseError(`${entryLabel} remark is required`);
      }
      if (!ITEM_REMARK_OPTIONS.includes(remark)) {
        throw new ProductDatabaseError(`${entryLabel} remark is invalid`);
      }
      if (seenRemarks.has(remark)) {
        throw new ProductDatabaseError("PD item size remarks must be unique");
      }
      seenRemarks.add(remark);
    }

    return {
      L: toNonNegativeNumber(entry?.L, `${entryLabel} L`),
      B: toNonNegativeNumber(entry?.B, `${entryLabel} B`),
      H: toNonNegativeNumber(entry?.H, `${entryLabel} H`),
      remark,
      net_weight: toNonNegativeNumber(entry?.net_weight ?? entry?.weight, `${entryLabel} net weight`),
      gross_weight: toNonNegativeNumber(entry?.gross_weight, `${entryLabel} gross weight`),
    };
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
    throw new ProductDatabaseError("pd_box_sizes must contain inner and master entries in carton mode");
  }

  const seenRemarks = new Set();
  return meaningfulEntries.map((entry, index) => {
    const entryLabel = `PD box size ${index + 1}`;
    assertPositiveDimensions(entry, entryLabel);

    const baseEntry = {
      L: toNonNegativeNumber(entry?.L, `${entryLabel} L`),
      B: toNonNegativeNumber(entry?.B, `${entryLabel} B`),
      H: toNonNegativeNumber(entry?.H, `${entryLabel} H`),
      net_weight: toNonNegativeNumber(entry?.net_weight, `${entryLabel} net weight`),
      gross_weight: toNonNegativeNumber(entry?.gross_weight ?? entry?.weight, `${entryLabel} gross weight`),
    };

    if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
      const boxType = index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;
      const itemCountInInner =
        boxType === BOX_ENTRY_TYPES.INNER
          ? toNonNegativeNumber(entry?.item_count_in_inner, `${entryLabel} item count in inner`)
          : 0;
      const boxCountInMaster =
        boxType === BOX_ENTRY_TYPES.MASTER
          ? toNonNegativeNumber(entry?.box_count_in_master, `${entryLabel} box count in master`)
          : 0;

      if (boxType === BOX_ENTRY_TYPES.INNER && itemCountInInner <= 0) {
        throw new ProductDatabaseError(`${entryLabel} item count in inner must be greater than 0`);
      }
      if (boxType === BOX_ENTRY_TYPES.MASTER && boxCountInMaster <= 0) {
        throw new ProductDatabaseError(`${entryLabel} box count in master must be greater than 0`);
      }

      return {
        ...baseEntry,
        remark: boxType,
        box_type: boxType,
        item_count_in_inner: itemCountInInner,
        box_count_in_master: boxCountInMaster,
      };
    }

    const normalizedRemark = normalizeKey(entry?.remark || entry?.type || "");
    const remark = meaningfulEntries.length === 1 ? "" : normalizedRemark;
    if (meaningfulEntries.length > 1) {
      if (!remark) {
        throw new ProductDatabaseError(`${entryLabel} remark is required`);
      }
      if (!BOX_INDIVIDUAL_REMARK_OPTIONS.includes(remark)) {
        throw new ProductDatabaseError(`${entryLabel} remark is invalid`);
      }
      if (seenRemarks.has(remark)) {
        throw new ProductDatabaseError("PD box size remarks must be unique");
      }
      seenRemarks.add(remark);
    }

    return {
      ...baseEntry,
      remark,
      box_type: BOX_ENTRY_TYPES.INDIVIDUAL,
      item_count_in_inner: 0,
      box_count_in_master: 0,
    };
  });
};

const extractProductDatabaseFields = (item = {}) => {
  const pdBoxMode = detectBoxPackagingMode(item?.pd_box_mode, item?.pd_box_sizes);
  return {
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
  const hasItemSizes = hasOwn(payload, "pd_item_sizes");
  const hasBoxSizes = hasOwn(payload, "pd_box_sizes");
  const hasBoxMode = hasOwn(payload, "pd_box_mode");
  const hasProductType = hasOwn(payload, "product_type");
  const hasProductSpecs = hasOwn(payload, "product_specs");
  const data = {};

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

    if (!hasSelectedProductType && hasProductSpecs) {
      throw new ProductDatabaseError(
        "Product type selection is required when product specs are provided",
      );
    }

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
      data.product_specs = hasSelectedProductType
        ? normalizeProductSpecsPayload(payload?.product_specs || {})
        : {
            fields: [],
            item_sizes: [],
            box_sizes: [],
            box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
            raw_values: {},
          };
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

  return {
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

const getChangedProductDatabaseFields = (currentState = {}, nextState = {}) =>
  ["pd_item_sizes", "pd_box_sizes", "pd_box_mode", "product_type", "product_specs"].filter(
    (field) => stableStringify(currentState?.[field]) !== stableStringify(nextState?.[field]),
  );

const hasProductDatabaseData = (state = {}) =>
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
  if (!["admin", "manager"].includes(role)) {
    throw new ProductDatabaseError("Only admin or manager can update Product Database data", 403);
  }

  const actor = buildPdAuditActor(user);
  const previousStatus = normalizePdStatus(item?.pd_checked);
  const currentState = extractProductDatabaseFields(item);
  const input = normalizeProductDatabaseInput(payload);
  const nextState = mergeProductDatabaseFields(currentState, input.data);
  const changedFields = getChangedProductDatabaseFields(currentState, nextState);

  if (!input.hasInput) {
    throw new ProductDatabaseError("Product Database measurement data is required");
  }
  if (!hasProductDatabaseData(nextState)) {
    throw new ProductDatabaseError(
      "At least one product item size or box size is required",
    );
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
    message: "No Product Database size changes detected.",
  };
};

const applyProductDatabaseCheck = ({ item, payload = {}, user = {} } = {}) => {
  const role = normalizeRole(user?.role);
  if (role !== "manager") {
    throw new ProductDatabaseError("Only managers can check Product Database data", 403);
  }

  const actor = buildPdAuditActor(user);
  const actorId = normalizeId(actor.user);
  const previousStatus = normalizePdStatus(item?.pd_checked);
  const currentState = extractProductDatabaseFields(item);
  const input = normalizeProductDatabaseInput(payload);
  const nextState = mergeProductDatabaseFields(currentState, input.data);
  const changedFields = getChangedProductDatabaseFields(currentState, nextState);

  if (!hasProductDatabaseData(nextState)) {
    throw new ProductDatabaseError(
      "At least one product item size or box size is required before checking",
    );
  }

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
  if (role !== "admin") {
    throw new ProductDatabaseError("Only admin can approve Product Database data", 403);
  }

  const actor = buildPdAuditActor(user);
  const previousStatus = normalizePdStatus(item?.pd_checked);
  const currentState = extractProductDatabaseFields(item);
  const input = normalizeProductDatabaseInput(payload);
  const nextState = mergeProductDatabaseFields(currentState, input.data);
  const changedFields = getChangedProductDatabaseFields(currentState, nextState);

  if (!hasProductDatabaseData(nextState)) {
    throw new ProductDatabaseError(
      "At least one product item size or box size is required before approving",
    );
  }

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
  const state = extractProductDatabaseFields(item);
  const hasData = hasProductDatabaseData(state);
  const creatorId = normalizeId(item?.pd_created_by?.user);
  const lastChangerId = normalizeId(item?.pd_last_changed_by?.user);
  const isCreator = Boolean(creatorId && actorId === creatorId);
  const isLastChanger = Boolean(lastChangerId && actorId === lastChangerId);
  const canEdit = ["admin", "manager"].includes(role);
  const canCheck =
    role === "manager" &&
    status === PD_STATUSES.CREATED &&
    hasData &&
    !isCreator &&
    !isLastChanger;

  let checkBlockedReason = "";
  if (role === "manager" && status === PD_STATUSES.CREATED && hasData && !canCheck) {
    if (isCreator || isLastChanger) {
      checkBlockedReason =
        "You cannot check this because you created or last changed this PD data.";
    }
  }

  return {
    can_edit: canEdit,
    can_check: canCheck,
    can_approve: role === "admin" && status === PD_STATUSES.CHECKED && hasData,
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
