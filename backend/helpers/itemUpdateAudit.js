const mongoose = require("mongoose");
const {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  detectBoxPackagingMode,
} = require("./boxMeasurement");
const { formatEan13BarcodeDisplay } = require("./barcodeFormat");

const AUDIT_SCOPES = Object.freeze({
  PIS: "PIS",
  PD: "PD",
  MASTER: "Master",
  ITEM: "Item",
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const normalizeText = (value) => String(value ?? "").trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const normalizeId = (value) => normalizeText(value?._id || value?.id || value);

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return parsed.toFixed(4).replace(/\.?0+$/, "") || "0";
};

const formatText = (value, fallback = "Not Set") => {
  const normalized = normalizeText(value);
  return normalized || fallback;
};

const getPrimaryBrand = (item = {}) =>
  normalizeText(
    item?.brand_name ||
      item?.brand ||
      (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : ""),
  );

const getVendors = (item = {}) =>
  Array.isArray(item?.vendors)
    ? item.vendors.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

const formatRemark = (entry = {}, fallback = "Entry") => {
  const raw = normalizeKey(entry?.remark || entry?.box_type || entry?.type);
  if (!raw) return fallback;
  if (raw === BOX_ENTRY_TYPES.INNER) return "Inner Carton";
  if (raw === BOX_ENTRY_TYPES.MASTER) return "Master Carton";
  if (raw === "base") return "Base";
  if (raw === "base2") return "Base 2";
  if (raw === "pedestal") return "Pedestal";
  if (raw === "top") return "Top";
  return raw.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const hasAnySizeValue = (entry = {}, weightKey = "") =>
  ["L", "B", "H", weightKey, "item_count_in_inner", "box_count_in_master"].some(
    (key) => key && toSafeNumber(entry?.[key], 0) > 0,
  ) || Boolean(normalizeText(entry?.remark || entry?.box_type || entry?.type));

const formatSizeEntries = (
  entries = [],
  {
    weightKey = "",
    weightLabel = "Weight",
    mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  } = {},
) => {
  const safeEntries = (Array.isArray(entries) ? entries : []).filter((entry) =>
    hasAnySizeValue(entry, weightKey),
  );
  if (safeEntries.length === 0) return "Not Set";

  const resolvedMode = detectBoxPackagingMode(mode, safeEntries);
  return safeEntries
    .map((entry, index) => {
      const label =
        resolvedMode === BOX_PACKAGING_MODES.CARTON
          ? formatRemark(
              {
                ...entry,
                remark: index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER,
              },
              `Entry ${index + 1}`,
            )
          : formatRemark(entry, `Entry ${index + 1}`);
      const size = [
        formatNumber(entry?.L) || "0",
        formatNumber(entry?.B) || "0",
        formatNumber(entry?.H) || "0",
      ].join(" x ");
      const weight = weightKey ? formatNumber(entry?.[weightKey]) || "0" : "";
      const counts = [
        toSafeNumber(entry?.item_count_in_inner, 0) > 0
          ? `inner count ${formatNumber(entry.item_count_in_inner)}`
          : "",
        toSafeNumber(entry?.box_count_in_master, 0) > 0
          ? `master count ${formatNumber(entry.box_count_in_master)}`
          : "",
      ].filter(Boolean);
      return [
        `${label}: ${size}`,
        weightKey ? `${weightLabel}: ${weight}` : "",
        counts.join(", "),
      ].filter(Boolean).join(" | ");
    })
    .join(" || ");
};

const formatBoxMode = (mode = "") =>
  detectBoxPackagingMode(mode) === BOX_PACKAGING_MODES.CARTON
    ? "Inner + Master Carton"
    : "Individual Boxes";

const formatProductType = (productType = {}) =>
  formatText(
    [
      productType?.label || productType?.key,
      productType?.version ? `v${productType.version}` : "",
    ].filter(Boolean).join(" "),
  );

const formatProductSpecs = (productSpecs = {}) => {
  const fields = Array.isArray(productSpecs?.fields) ? productSpecs.fields : [];
  if (fields.length === 0) return "Not Set";

  return fields
    .map((field) => {
      let value = "";
      if (field?.value_number !== null && field?.value_number !== undefined) {
        value = formatNumber(field.value_number);
      } else if (field?.value_boolean !== null && field?.value_boolean !== undefined) {
        value = field.value_boolean ? "Yes" : "No";
      } else if (Array.isArray(field?.value_array) && field.value_array.length > 0) {
        value = field.value_array.join(", ");
      } else if (field?.value_date) {
        value = normalizeText(field.value_date).slice(0, 10);
      } else {
        value = normalizeText(field?.value_text || field?.raw_value);
      }

      return `${field?.label || field?.key || "Field"}: ${value || "Not Set"}`;
    })
    .join(" | ");
};

const buildItemUpdateAuditSnapshot = (item = {}) => {
  const pdBoxMode = detectBoxPackagingMode(item?.pd_box_mode, item?.pd_box_sizes);
  const pisBoxMode = detectBoxPackagingMode(item?.pis_box_mode, item?.pis_box_sizes);
  const masterBoxMode = detectBoxPackagingMode(
    item?.master_box_mode,
    item?.master_box_sizes,
  );

  const fields = {
    [AUDIT_SCOPES.PIS]: [
      {
        key: "country_of_origin",
        label: "Country of Origin",
        value: formatText(item?.country_of_origin),
      },
      {
        key: "pis_master_barcode",
        label: "PIS Master Barcode",
        value: formatEan13BarcodeDisplay(item?.pis_master_barcode || item?.pis_barcode),
      },
      {
        key: "pis_inner_barcode",
        label: "PIS Inner Barcode",
        value: formatEan13BarcodeDisplay(item?.pis_inner_barcode),
      },
      {
        key: "pis_item_sizes",
        label: "PIS Item Sizes",
        value: formatSizeEntries(item?.pis_item_sizes, {
          weightKey: "net_weight",
          weightLabel: "Net Weight",
        }),
      },
      {
        key: "pis_box_mode",
        label: "PIS Box Mode",
        value: formatBoxMode(pisBoxMode),
      },
      {
        key: "pis_box_sizes",
        label: "PIS Box Sizes",
        value: formatSizeEntries(item?.pis_box_sizes, {
          weightKey: "gross_weight",
          weightLabel: "Gross Weight",
          mode: pisBoxMode,
        }),
      },
      {
        key: "pis_cbm",
        label: "PIS CBM",
        value: formatText(item?.cbm?.calculated_pis_total || item?.cbm?.total),
      },
    ],
    [AUDIT_SCOPES.PD]: [
      {
        key: "country_of_origin",
        label: "Country of Origin",
        value: formatText(item?.country_of_origin),
      },
      {
        key: "pd_master_barcode",
        label: "PD Master Barcode",
        value: formatEan13BarcodeDisplay(item?.pd_master_barcode || item?.pd_barcode),
      },
      {
        key: "pd_inner_barcode",
        label: "PD Inner Barcode",
        value: formatEan13BarcodeDisplay(item?.pd_inner_barcode),
      },
      {
        key: "product_type",
        label: "Product Type",
        value: formatProductType(item?.product_type),
      },
      {
        key: "product_specs",
        label: "Product Specs",
        value: formatProductSpecs(item?.product_specs),
      },
      {
        key: "pd_item_sizes",
        label: "PD Item Sizes",
        value: formatSizeEntries(item?.pd_item_sizes, {
          weightKey: "net_weight",
          weightLabel: "Net Weight",
        }),
      },
      {
        key: "pd_box_mode",
        label: "PD Box Mode",
        value: formatBoxMode(pdBoxMode),
      },
      {
        key: "pd_box_sizes",
        label: "PD Box Sizes",
        value: formatSizeEntries(item?.pd_box_sizes, {
          weightKey: "gross_weight",
          weightLabel: "Gross Weight",
          mode: pdBoxMode,
        }),
      },
      {
        key: "pd_checked",
        label: "PD Status",
        value: formatText(item?.pd_checked),
      },
    ],
    [AUDIT_SCOPES.MASTER]: [
      {
        key: "master_item_sizes",
        label: "Master Item Sizes",
        value: formatSizeEntries(item?.master_item_sizes, {
          weightKey: "net_weight",
          weightLabel: "Net Weight",
        }),
      },
      {
        key: "master_box_mode",
        label: "Master Box Mode",
        value: formatBoxMode(masterBoxMode),
      },
      {
        key: "master_box_sizes",
        label: "Master Box Sizes",
        value: formatSizeEntries(item?.master_box_sizes, {
          weightKey: "gross_weight",
          weightLabel: "Gross Weight",
          mode: masterBoxMode,
        }),
      },
      {
        key: "pis_checked_flag",
        label: "PIS Checked Flag",
        value: item?.pis_checked_flag === true ? "Checked" : "Unchecked",
      },
    ],
  };

  return {
    item_id: normalizeId(item),
    item_code: normalizeText(item?.code),
    item_name: normalizeText(item?.name),
    description: normalizeText(item?.description),
    brand: getPrimaryBrand(item),
    vendors: getVendors(item),
    fields,
    raw: item,
  };
};

const normalizeScopes = (scopes = []) => {
  const safeScopes = Array.isArray(scopes) ? scopes : [scopes];
  return [
    ...new Set(
      safeScopes
        .map((scope) => {
          const normalized = normalizeKey(scope);
          if (normalized === "pd") return AUDIT_SCOPES.PD;
          if (normalized === "master") return AUDIT_SCOPES.MASTER;
          if (normalized === "item") return AUDIT_SCOPES.ITEM;
          return AUDIT_SCOPES.PIS;
        })
        .filter(Boolean),
    ),
  ];
};

const buildAuditChanges = (beforeSnapshot = {}, afterSnapshot = {}, scopes = []) =>
  normalizeScopes(scopes).flatMap((scope) => {
    const beforeFields = Array.isArray(beforeSnapshot?.fields?.[scope])
      ? beforeSnapshot.fields[scope]
      : [];
    const afterFields = Array.isArray(afterSnapshot?.fields?.[scope])
      ? afterSnapshot.fields[scope]
      : [];
    const beforeByKey = new Map(beforeFields.map((field) => [field.key, field]));

    return afterFields.reduce((changes, afterField) => {
      const beforeField = beforeByKey.get(afterField.key) || {};
      const beforeValue = formatText(beforeField.value);
      const afterValue = formatText(afterField.value);
      if (beforeValue === afterValue) return changes;
      changes.push({
        scope,
        field: afterField.label || afterField.key,
        before: beforeValue,
        after: afterValue,
      });
      return changes;
    }, []);
  });

const pushMissing = (missingFields, scope, field, label, message = "") => {
  missingFields.push({
    scope,
    field,
    label,
    message: message || `${label} is missing`,
  });
};

const isMissingNumber = (value) => toSafeNumber(value, 0) <= 0;

const collectSizeMissingFields = (
  missingFields,
  scope,
  fieldPrefix,
  labelPrefix,
  entries = [],
  {
    weightKey = "",
    weightLabel = "Weight",
    mode = BOX_PACKAGING_MODES.INDIVIDUAL,
    requireRemarkWhenMultiple = true,
  } = {},
) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const resolvedMode = detectBoxPackagingMode(mode, safeEntries);

  if (safeEntries.length === 0) {
    pushMissing(missingFields, scope, fieldPrefix, labelPrefix);
    return;
  }

  safeEntries.forEach((entry, index) => {
    const entryNumber = index + 1;
    const entryLabel =
      resolvedMode === BOX_PACKAGING_MODES.CARTON
        ? `${labelPrefix} ${index === 0 ? "Inner Carton" : "Master Carton"}`
        : `${labelPrefix} Entry ${entryNumber}`;
    const fieldBase = `${fieldPrefix}.${entryNumber}`;

    if (isMissingNumber(entry?.L)) {
      pushMissing(missingFields, scope, `${fieldBase}.L`, `${entryLabel} L`);
    }
    if (isMissingNumber(entry?.B)) {
      pushMissing(missingFields, scope, `${fieldBase}.B`, `${entryLabel} B`);
    }
    if (isMissingNumber(entry?.H)) {
      pushMissing(missingFields, scope, `${fieldBase}.H`, `${entryLabel} H`);
    }
    if (weightKey && isMissingNumber(entry?.[weightKey])) {
      pushMissing(
        missingFields,
        scope,
        `${fieldBase}.${weightKey}`,
        `${entryLabel} ${weightLabel}`,
      );
    }

    if (
      resolvedMode !== BOX_PACKAGING_MODES.CARTON &&
      requireRemarkWhenMultiple &&
      safeEntries.length > 1 &&
      !normalizeText(entry?.remark || entry?.type)
    ) {
      pushMissing(missingFields, scope, `${fieldBase}.remark`, `${entryLabel} Remark`);
    }

    if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
      const boxType =
        normalizeKey(entry?.box_type || entry?.remark) ||
        (index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER);
      if (boxType === BOX_ENTRY_TYPES.INNER && isMissingNumber(entry?.item_count_in_inner)) {
        pushMissing(
          missingFields,
          scope,
          `${fieldBase}.item_count_in_inner`,
          `${entryLabel} Item Count In Inner`,
        );
      }
      if (boxType === BOX_ENTRY_TYPES.MASTER && isMissingNumber(entry?.box_count_in_master)) {
        pushMissing(
          missingFields,
          scope,
          `${fieldBase}.box_count_in_master`,
          `${entryLabel} Box Count In Master`,
        );
      }
    }
  });
};

const collectMissingFields = (afterSnapshot = {}, scopes = []) => {
  const item = afterSnapshot?.raw || {};
  const missingFields = [];

  normalizeScopes(scopes).forEach((scope) => {
    if (scope === AUDIT_SCOPES.PIS) {
      if (!normalizeText(item?.country_of_origin)) {
        pushMissing(missingFields, scope, "country_of_origin", "Country of Origin");
      }
      if (!normalizeText(item?.pis_master_barcode || item?.pis_barcode)) {
        pushMissing(missingFields, scope, "pis_master_barcode", "PIS Master Barcode");
      }
      if (!normalizeText(item?.pis_inner_barcode)) {
        pushMissing(missingFields, scope, "pis_inner_barcode", "PIS Inner Barcode");
      }
      collectSizeMissingFields(
        missingFields,
        scope,
        "pis_item_sizes",
        "PIS Item Sizes",
        item?.pis_item_sizes,
        {
          weightKey: "net_weight",
          weightLabel: "Net Weight",
        },
      );
      collectSizeMissingFields(
        missingFields,
        scope,
        "pis_box_sizes",
        "PIS Box Sizes",
        item?.pis_box_sizes,
        {
          weightKey: "gross_weight",
          weightLabel: "Gross Weight",
          mode: item?.pis_box_mode,
        },
      );
    }

    if (scope === AUDIT_SCOPES.PD) {
      if (!normalizeText(item?.country_of_origin)) {
        pushMissing(missingFields, scope, "country_of_origin", "Country of Origin");
      }
      if (!normalizeText(item?.pd_master_barcode || item?.pd_barcode)) {
        pushMissing(missingFields, scope, "pd_master_barcode", "PD Master Barcode");
      }
      if (!normalizeText(item?.pd_inner_barcode)) {
        pushMissing(missingFields, scope, "pd_inner_barcode", "PD Inner Barcode");
      }
      if (!normalizeText(item?.product_type?.key || item?.product_type?.label)) {
        pushMissing(missingFields, scope, "product_type", "Product Type");
      }
      collectSizeMissingFields(
        missingFields,
        scope,
        "pd_item_sizes",
        "PD Item Sizes",
        item?.pd_item_sizes,
        {
          weightKey: "net_weight",
          weightLabel: "Net Weight",
          requireRemarkWhenMultiple: false,
        },
      );
      collectSizeMissingFields(
        missingFields,
        scope,
        "pd_box_sizes",
        "PD Box Sizes",
        item?.pd_box_sizes,
        {
          weightKey: "gross_weight",
          weightLabel: "Gross Weight",
          mode: item?.pd_box_mode,
          requireRemarkWhenMultiple: false,
        },
      );
    }

    if (scope === AUDIT_SCOPES.MASTER) {
      collectSizeMissingFields(
        missingFields,
        scope,
        "master_item_sizes",
        "Master Item Sizes",
        item?.master_item_sizes,
        {
          weightKey: "net_weight",
          weightLabel: "Net Weight",
        },
      );
      collectSizeMissingFields(
        missingFields,
        scope,
        "master_box_sizes",
        "Master Box Sizes",
        item?.master_box_sizes,
        {
          weightKey: "gross_weight",
          weightLabel: "Gross Weight",
          mode: item?.master_box_mode,
        },
      );
      if (item?.pis_checked_flag !== true) {
        pushMissing(
          missingFields,
          scope,
          "pis_checked_flag",
          "PIS Checked Flag",
          "PIS is not checked into master data",
        );
      }
    }
  });

  return missingFields;
};

const buildUserDisplayName = (user = {}) =>
  normalizeText(user?.name || user?.username || user?.email || user?.role);

const normalizeObjectId = (value) => {
  const id = normalizeId(value);
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
};

const buildItemUpdateLogPayload = ({
  reqUser = {},
  beforeSnapshot = {},
  afterSnapshot = {},
  operationType = "pis_update",
  pageName = "PIS Update Modal",
  source = "pis_update_modal",
  dataScopes = [AUDIT_SCOPES.PIS],
  extraRemarks = [],
  metadata = {},
} = {}) => {
  const scopes = normalizeScopes(dataScopes);
  const changes = buildAuditChanges(beforeSnapshot, afterSnapshot, scopes);
  const missingFields = collectMissingFields(afterSnapshot, scopes);
  const remarks = [
    changes.length > 0
      ? `Updated fields: ${changes.map((entry) => `${entry.scope} ${entry.field}`).join(", ")}.`
      : "No net changes detected in audited item fields.",
    missingFields.length > 0
      ? `Missing fields after update: ${missingFields.map((entry) => `${entry.scope} ${entry.label}`).join(", ")}.`
      : "No missing fields detected for the audited scope.",
    ...(Array.isArray(extraRemarks) ? extraRemarks : [])
      .map((entry) => normalizeText(entry))
      .filter(Boolean),
  ];

  return {
    edited_by: normalizeObjectId(reqUser),
    edited_by_name: buildUserDisplayName(reqUser),
    item: normalizeObjectId(afterSnapshot?.item_id || beforeSnapshot?.item_id),
    item_code: afterSnapshot?.item_code || beforeSnapshot?.item_code || "",
    item_name: afterSnapshot?.item_name || beforeSnapshot?.item_name || "",
    description: afterSnapshot?.description || beforeSnapshot?.description || "",
    brand: afterSnapshot?.brand || beforeSnapshot?.brand || "",
    vendors:
      afterSnapshot?.vendors?.length > 0
        ? afterSnapshot.vendors
        : beforeSnapshot?.vendors || [],
    page_name: pageName,
    source,
    operation_type: operationType,
    data_scope: scopes,
    changed_fields_count: changes.length,
    changed_fields: changes.map((entry) => `${entry.scope}: ${entry.field}`),
    changes,
    missing_fields_count: missingFields.length,
    missing_fields: missingFields,
    remarks,
    metadata,
  };
};

module.exports = {
  AUDIT_SCOPES,
  buildItemUpdateAuditSnapshot,
  buildItemUpdateLogPayload,
  normalizeScopes,
};
