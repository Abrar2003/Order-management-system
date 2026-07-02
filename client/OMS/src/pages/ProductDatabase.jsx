import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import { getUserFromToken } from "../auth/auth.service";
import {
  isAdminLikeRole,
  isManagerLikeRole,
  normalizeUserRole,
} from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";
import Navbar from "../components/Navbar";
import ProductImageThumbnail from "../components/ProductImageThumbnail";
import ProductTypeDynamicForm from "../components/ProductTypeDynamicForm";
import {
  getProductTypeTemplateByKey,
  getProductTypeTemplates,
} from "../services/productTypeTemplates.service";
import { getCountryOfOriginOptions } from "../constants/countryOfOrigin";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import {
  BOX_CARTON_REMARK_OPTIONS,
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  BOX_SIZE_ENTRY_LIMIT,
  BOX_SIZE_REMARK_OPTIONS,
  convertMeasuredBoxEntriesMode,
  createEmptyMeasuredSizeEntry,
  detectBoxPackagingMode,
  ensureMeasuredSizeEntryCount,
  getFixedBoxEntryCount,
  getRemarkLabel,
  ITEM_SIZE_ENTRY_LIMIT,
  normalizeSizeCount,
  toDimensionInputValue,
} from "../utils/measuredSizeForm";
import {
  buildProductTypePayload,
  createProductTypeFormState,
  hasProductTypeFormValues,
  normalizeTemplateKey,
} from "../utils/productTypeTemplates";
import "../App.css";

const DEFAULT_FILTER = "all";
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [20, 50, 100];
const ITEM_SIZE_COUNT_OPTIONS = Array.from({ length: ITEM_SIZE_ENTRY_LIMIT }, (_, index) =>
  String(index + 1),
);
const BOX_SIZE_COUNT_OPTIONS = Array.from({ length: BOX_SIZE_ENTRY_LIMIT }, (_, index) =>
  String(index + 1),
);
const ITEM_SIZE_REMARK_OPTIONS = Object.freeze([
  { value: "item", label: "Item" },
  { value: "top", label: "Top" },
  { value: "base", label: "Base" },
  { value: "base2", label: "Base 2" },
  { value: "pedestal", label: "Pedestal" },
  { value: "stretcher", label: "Stretcher" },
  { value: "item1", label: "Item 1" },
  { value: "item2", label: "Item 2" },
  { value: "item3", label: "Item 3" },
]);
const STATUS_OPTIONS = Object.freeze([
  { value: DEFAULT_FILTER, label: "All Statuses" },
  { value: "not_set", label: "Not Set" },
  { value: "created", label: "Created" },
  { value: "checked", label: "Checked" },
  { value: "approved", label: "Approved" },
]);
const BARCODE_MODES = Object.freeze({
  SINGLE: "single",
  INNER_MASTER: "inner_master",
});
const PRODUCT_DATABASE_TABLE_TEMPLATE_KEY = "table";
const PRODUCT_DATABASE_TABLE_TEMPLATE_VERSION = 1;
const PRODUCT_DATABASE_TABLE_DETAILS_GROUP_KEY = "table_details";
const PRODUCT_DATABASE_TABLE_DETAILS_GROUP_LABEL = "Table Details";
const PRODUCT_DATABASE_TABLE_V1_FIELDS = Object.freeze([
  {
    key: "table_top_thickness",
    label: "Table Top Thickness",
    input_type: "number",
    value_type: "number",
    order: 45,
    source_headers: ["Table Top Thickness", "Table Top Thikness"],
  },
  {
    key: "distances_between_legs",
    label: "Distances Between Legs",
    input_type: "number_list",
    value_type: "array",
    unit: "cm",
    order: 75,
    validation: { max_entries: 4 },
    source_headers: [
      "Distances Between Legs",
      "Distance Between Legs",
      "Distance Between Table Legs",
    ],
  },
]);

const normalizeTextValue = (value) => String(value || "").trim();

const normalizeFilterValue = (value, fallback = DEFAULT_FILTER) => {
  const normalized = normalizeTextValue(value);
  if (!normalized) return fallback;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return fallback;
  }
  return normalized;
};

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const downloadProductDatabaseExport = (response) => {
  const disposition = String(response?.headers?.["content-disposition"] || "");
  const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  const fileName = match?.[1]
    ? decodeURIComponent(match[1].trim())
    : `product-database-${new Date().toISOString().slice(0, 10)}.xls`;
  const blob = new Blob([response.data], {
    type: response?.headers?.["content-type"] || "application/vnd.ms-excel",
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

const normalizeStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["created", "checked", "approved", "not_set"].includes(normalized)) {
    return normalized;
  }
  return "not_set";
};

const getStatusLabel = (value) => {
  const status = normalizeStatus(value);
  if (status === "created") return "Created";
  if (status === "checked") return "Checked";
  if (status === "approved") return "Approved";
  return "Not Set";
};

const getStatusBadgeClass = (value) => {
  const status = normalizeStatus(value);
  if (status === "approved") return "text-bg-success";
  if (status === "checked") return "text-bg-info";
  if (status === "created") return "text-bg-warning";
  return "text-bg-secondary";
};

const formatNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Not Set";
  return parsed.toFixed(2).replace(/\.?0+$/, "");
};

const formatRemark = (value) => {
  const normalized = normalizeTextValue(value);
  if (!normalized) return "Single";
  return normalized
    .replace(/_/g, " ")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const formatBoxMode = (value) => {
  const mode = normalizeTextValue(value).toLowerCase();
  if (mode === BOX_PACKAGING_MODES.CARTON) return "Carton";
  if (mode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER) {
    return "Individual packing + master";
  }
  return "Individual";
};

const formatActor = (actor = null, dateKey = "") => {
  if (!actor?.name && !actor?.[dateKey]) return "N/A";
  const name = actor?.name || "Unknown";
  const date = actor?.[dateKey] ? formatDateDDMMYYYY(actor[dateKey]) : "";
  return date ? `${name} (${date})` : name;
};

const normalizeBarcodeMode = (value) =>
  value === BARCODE_MODES.INNER_MASTER
    ? BARCODE_MODES.INNER_MASTER
    : BARCODE_MODES.SINGLE;

const getProductDatabaseMasterBarcode = (item = {}) =>
  normalizeTextValue(item?.pd_master_barcode || item?.pd_barcode);

const getProductDatabaseBarcodeMode = (item = {}) =>
  normalizeTextValue(item?.pd_inner_barcode)
    ? BARCODE_MODES.INNER_MASTER
    : BARCODE_MODES.SINGLE;

const isProductDatabaseTableV1Template = (template = {}) =>
  normalizeTemplateKey(template?.key) === PRODUCT_DATABASE_TABLE_TEMPLATE_KEY &&
  Number(template?.version || 0) === PRODUCT_DATABASE_TABLE_TEMPLATE_VERSION;

const mergeProductDatabaseTableV1Fields = (template = null) => {
  if (!template || !isProductDatabaseTableV1Template(template)) return template;

  const groups = Array.isArray(template?.groups)
    ? template.groups.map((group) => ({
        ...group,
        fields: Array.isArray(group?.fields) ? [...group.fields] : [],
      }))
    : [];
  let tableDetailsGroup = groups.find(
    (group) =>
      normalizeTemplateKey(group?.key) === PRODUCT_DATABASE_TABLE_DETAILS_GROUP_KEY,
  );

  if (!tableDetailsGroup) {
    tableDetailsGroup = {
      key: PRODUCT_DATABASE_TABLE_DETAILS_GROUP_KEY,
      label: PRODUCT_DATABASE_TABLE_DETAILS_GROUP_LABEL,
      order: 40,
      is_active: true,
      fields: [],
    };
    groups.push(tableDetailsGroup);
  }

  let changed = groups.length !== (Array.isArray(template?.groups) ? template.groups.length : 0);
  PRODUCT_DATABASE_TABLE_V1_FIELDS.forEach((fallbackField) => {
    const fieldIndex = tableDetailsGroup.fields.findIndex(
      (field) => normalizeTemplateKey(field?.key) === fallbackField.key,
    );

    if (fieldIndex === -1) {
      tableDetailsGroup.fields.push({
        ...fallbackField,
        required: false,
        searchable: false,
        filterable: false,
        show_in_table: false,
        options: [],
        default_value: fallbackField.input_type === "number_list" ? [] : null,
        is_active: true,
      });
      changed = true;
      return;
    }

    const existingField = tableDetailsGroup.fields[fieldIndex];
    const nextField = {
      ...fallbackField,
      ...existingField,
      key: fallbackField.key,
      input_type: fallbackField.input_type,
      value_type: fallbackField.value_type,
      validation:
        fallbackField.input_type === "number_list"
          ? {
              ...fallbackField.validation,
              ...(existingField?.validation || {}),
              max_entries: 4,
            }
          : existingField?.validation || fallbackField.validation || {},
    };

    if (stableStringify(existingField) !== stableStringify(nextField)) {
      tableDetailsGroup.fields[fieldIndex] = nextField;
      changed = true;
    }
  });

  if (!changed) return template;

  return {
    ...template,
    groups: groups
      .map((group) => ({
        ...group,
        fields: [...(Array.isArray(group?.fields) ? group.fields : [])].sort(
          (left, right) => Number(left?.order || 0) - Number(right?.order || 0),
        ),
      }))
      .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0)),
  };
};

const buildPayloadFromForm = (form = {}, boxMode = null) => {
  const effectiveBarcodeMode = boxMode
    ? detectBoxPackagingMode(boxMode) === BOX_PACKAGING_MODES.CARTON
      ? BARCODE_MODES.INNER_MASTER
      : BARCODE_MODES.SINGLE
    : normalizeBarcodeMode(form.barcodeMode);
  const primaryBarcode =
    effectiveBarcodeMode === BARCODE_MODES.INNER_MASTER
      ? form.masterBarcode
      : form.singleBarcode;

  return {
    country_of_origin: normalizeTextValue(form.countryOfOrigin),
    pd_barcode: normalizeTextValue(primaryBarcode),
    pd_master_barcode: normalizeTextValue(primaryBarcode),
    pd_inner_barcode:
      effectiveBarcodeMode === BARCODE_MODES.INNER_MASTER
        ? normalizeTextValue(form.innerBarcode)
        : "",
    kd: form.kd === true,
    mounting_file_needed: form.mountingFileNeeded === true,
  };
};

const PRODUCT_DATABASE_SIZE_DIFF_TOLERANCE = 0.5;
const PRODUCT_DATABASE_CBM_DECIMALS = 2;
const PRODUCT_DATABASE_SIZE_DIMENSIONS = Object.freeze(["L", "B", "H"]);
const stableStringify = (value) => JSON.stringify(value ?? null);

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
    .map((value) => normalizeTextValue(value).toLowerCase())
    .join(" ");
  return descriptor.includes("cbm") || descriptor.includes("cubic meter");
};

const getDisplayItemSizes = (row = {}) => {
  const pdItemSizes = Array.isArray(row?.pd_item_sizes) ? row.pd_item_sizes : [];
  if (pdItemSizes.length > 0) return pdItemSizes;
  const productItemSizes = Array.isArray(row?.product_specs?.item_sizes)
    ? row.product_specs.item_sizes
    : [];
  return productItemSizes;
};

const getDisplayBoxSizes = (row = {}) => {
  const pdBoxSizes = Array.isArray(row?.pd_box_sizes) ? row.pd_box_sizes : [];
  if (pdBoxSizes.length > 0) return pdBoxSizes;
  const productBoxSizes = Array.isArray(row?.product_specs?.box_sizes)
    ? row.product_specs.box_sizes
    : [];
  return productBoxSizes;
};

const getDisplayBoxMode = (row = {}) => {
  const pdBoxSizes = Array.isArray(row?.pd_box_sizes) ? row.pd_box_sizes : [];
  if (pdBoxSizes.length > 0) {
    return detectBoxPackagingMode(row?.pd_box_mode, pdBoxSizes);
  }

  const productBoxSizes = Array.isArray(row?.product_specs?.box_sizes)
    ? row.product_specs.box_sizes
    : [];
  if (productBoxSizes.length > 0) {
    return detectBoxPackagingMode(row?.product_specs?.box_mode, productBoxSizes);
  }

  return detectBoxPackagingMode(row?.pd_box_mode, []);
};

const normalizeProductSpecsForCompare = (productSpecs = {}) => ({
  fields: (Array.isArray(productSpecs?.fields) ? productSpecs.fields : []).map((field) => ({
    field_id: field?.field_id || null,
    key: field?.key || "",
    label: field?.label || "",
    group_key: field?.group_key || "",
    group_label: field?.group_label || "",
    input_type: field?.input_type || "",
    value_type: field?.value_type || "",
    unit: field?.unit || "",
    value_text: field?.value_text || "",
    value_number: field?.value_number ?? null,
    value_boolean: field?.value_boolean ?? null,
    value_date: field?.value_date || null,
    value_array: Array.isArray(field?.value_array) ? field.value_array : [],
    raw_value:
      field?.value_type === "object" || field?.input_type === "file"
        ? field?.raw_value ?? null
        : null,
  })),
  item_sizes: Array.isArray(productSpecs?.item_sizes) ? productSpecs.item_sizes : [],
  box_sizes: Array.isArray(productSpecs?.box_sizes) ? productSpecs.box_sizes : [],
  box_mode: productSpecs?.box_mode || BOX_PACKAGING_MODES.INDIVIDUAL,
  raw_values:
    productSpecs?.raw_values && typeof productSpecs.raw_values === "object"
      ? productSpecs.raw_values
      : {},
});

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
    normalizeTextValue(key).toLowerCase().includes("cbm") &&
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
  const keys = [
    ...new Set([
      ...Object.keys(currentEntry || {}),
      ...Object.keys(nextEntry || {}),
    ]),
  ];

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
  const current = normalizeProductSpecsForCompare(currentSpecs);
  const next = normalizeProductSpecsForCompare(nextSpecs);

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

const arePayloadsEqualForCompare = (currentPayload = {}, initialPayload = {}) =>
  normalizeTextValue(currentPayload.country_of_origin) ===
    normalizeTextValue(initialPayload.country_of_origin) &&
  normalizeTextValue(currentPayload.pd_master_barcode || currentPayload.pd_barcode) ===
    normalizeTextValue(initialPayload.pd_master_barcode || initialPayload.pd_barcode) &&
  normalizeTextValue(currentPayload.pd_inner_barcode) ===
    normalizeTextValue(initialPayload.pd_inner_barcode) &&
  stableStringify(currentPayload.product_type || null) ===
    stableStringify(initialPayload.product_type || null) &&
  (currentPayload.pd_box_mode || BOX_PACKAGING_MODES.INDIVIDUAL) ===
    (initialPayload.pd_box_mode || BOX_PACKAGING_MODES.INDIVIDUAL) &&
  areSizeEntryArraysEqualForCompare(
    currentPayload.pd_item_sizes || [],
    initialPayload.pd_item_sizes || [],
  ) &&
  areSizeEntryArraysEqualForCompare(
    currentPayload.pd_box_sizes || [],
    initialPayload.pd_box_sizes || [],
  ) &&
  areProductSpecsEqualForCompare(currentPayload.product_specs, initialPayload.product_specs);

const SizeSummary = ({ entries = [], type = "item" }) => {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) {
    return <span className="text-secondary">Not Set</span>;
  }

  return (
    <div className="small d-flex flex-column gap-1">
      {rows.map((entry, index) => (
        <div key={`${type}-${index}-${entry?.remark || entry?.box_type || "single"}`}>
          <strong>{formatRemark(entry?.remark || entry?.box_type)}:</strong>{" "}
          {formatNumber(entry?.L)} x {formatNumber(entry?.B)} x {formatNumber(entry?.H)}
          {type === "item" ? (
            <span> | Net {formatNumber(entry?.net_weight)}</span>
          ) : (
            <span> | Gross {formatNumber(entry?.gross_weight)}</span>
          )}
        </div>
      ))}
    </div>
  );
};

const SummaryCard = ({ label, value }) => (
  <div className="col-md-6 col-xl-3">
    <div className="card om-card h-100">
      <div className="card-body">
        <div className="small text-secondary">{label}</div>
        <div className="h4 mb-0 mt-2">{value}</div>
      </div>
    </div>
  </div>
);

const ProductDatabaseMeasuredSizeSection = ({
  title,
  countName,
  countValue,
  entriesKey,
  entries,
  remarkOptions,
  weightLabel,
  countLabel,
  disabled = false,
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  modeName = "",
  showModeSelector = false,
  onControlChange,
  onEntryChange,
}) => {
  const isCartonMode = mode === BOX_PACKAGING_MODES.CARTON;
  const isIndividualMasterMode =
    mode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER;
  const fixedBoxCount = getFixedBoxEntryCount(mode);
  const singleEntryLabel = String(countLabel || "").toLowerCase().includes("box")
    ? "Box"
    : "Item";
  const sizeEntryLimit =
    singleEntryLabel === "Box" ? BOX_SIZE_ENTRY_LIMIT : ITEM_SIZE_ENTRY_LIMIT;
  const sizeCountOptions =
    singleEntryLabel === "Box" ? BOX_SIZE_COUNT_OPTIONS : ITEM_SIZE_COUNT_OPTIONS;
  const safeCount = fixedBoxCount ?? normalizeSizeCount(countValue, 1, sizeEntryLimit);
  const entryColumnClass = safeCount > 1 ? "col-md-2" : "col-md-3";
  const getCartonRemark = (index) =>
    index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;

  return (
    <>
      <div className="col-md-2">
        {showModeSelector ? (
          <>
            <label className="form-label">Packaging Mode</label>
            <select
              className="form-select"
              name={modeName}
              value={mode}
              onChange={onControlChange}
              disabled={disabled}
            >
              <option value={BOX_PACKAGING_MODES.INDIVIDUAL}>Individual Boxes</option>
              <option value={BOX_PACKAGING_MODES.CARTON}>Inner + Master Carton</option>
              <option value={BOX_PACKAGING_MODES.INDIVIDUAL_MASTER}>
                Individual packing + master
              </option>
            </select>
          </>
        ) : (
          <>
            <label className="form-label">{countLabel}</label>
            <select
              className="form-select"
              name={countName}
              value={String(safeCount)}
              onChange={onControlChange}
              disabled={disabled}
            >
              {sizeCountOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </>
        )}

        {showModeSelector && countName && (
          <>
            <label className="form-label mt-3">{countLabel}</label>
            {fixedBoxCount ? (
              <input
                type="text"
                className="form-control"
                value={String(fixedBoxCount)}
                disabled
                readOnly
              />
            ) : (
              <select
                className="form-select"
                name={countName}
                value={String(safeCount)}
                onChange={onControlChange}
                disabled={disabled}
              >
                {sizeCountOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      <div className="col-md-10">
        <label className="form-label">{title}</label>
        <div className="d-grid gap-2">
          {entries.slice(0, safeCount).map((entry, index) => (
            <div key={`${entriesKey}-${index}`} className="border rounded p-3">
              {(() => {
                const displayedRemarkOptions = isCartonMode
                  ? BOX_CARTON_REMARK_OPTIONS
                  : remarkOptions;
                const displayedRemark = isCartonMode
                  ? getCartonRemark(index)
                  : isIndividualMasterMode
                    ? BOX_ENTRY_TYPES.MASTER
                  : entry.remark;
                return (
                  <>
              <div className="small text-secondary mb-2">
                {isCartonMode
                  ? index === 0
                    ? "Inner carton"
                    : "Master carton"
                  : isIndividualMasterMode
                    ? "Master carton"
                  : safeCount === 1
                  ? singleEntryLabel
                  : `Entry ${index + 1}${displayedRemark ? ` | ${getRemarkLabel(displayedRemarkOptions, displayedRemark)}` : ""}`}
              </div>

              <div className="row g-2">
                {safeCount > 1 && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Remark</label>
                    <select
                      className="form-select"
                      value={displayedRemark}
                      onChange={(event) =>
                        onEntryChange?.(
                          entriesKey,
                          index,
                          "remark",
                          event.target.value,
                        )
                      }
                      disabled={disabled || isCartonMode}
                    >
                      <option value="">Select Remark</option>
                      {displayedRemarkOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={entryColumnClass}>
                  <label className="form-label small text-secondary">L</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.L}
                    onChange={(event) =>
                      onEntryChange?.(entriesKey, index, "L", event.target.value)
                    }
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>
                <div className={entryColumnClass}>
                  <label className="form-label small text-secondary">B</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.B}
                    onChange={(event) =>
                      onEntryChange?.(entriesKey, index, "B", event.target.value)
                    }
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>
                <div className={entryColumnClass}>
                  <label className="form-label small text-secondary">H</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.H}
                    onChange={(event) =>
                      onEntryChange?.(entriesKey, index, "H", event.target.value)
                    }
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>
                <div className={safeCount > 1 ? "col-md-3" : "col-md-3"}>
                  <label className="form-label small text-secondary">{weightLabel}</label>
                  <input
                    type="number"
                    className="form-control"
                    value={entry.weight}
                    onChange={(event) =>
                      onEntryChange?.(entriesKey, index, "weight", event.target.value)
                    }
                    min="0"
                    step="any"
                    disabled={disabled}
                  />
                </div>

                {isCartonMode && index === 0 && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Item Count In Inner</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.item_count_in_inner}
                      onChange={(event) =>
                        onEntryChange?.(
                          entriesKey,
                          index,
                          "item_count_in_inner",
                          event.target.value,
                        )
                      }
                      min="0"
                      step="1"
                      disabled={disabled}
                    />
                  </div>
                )}

                {isCartonMode && index === 1 && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Box Count In Master</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.box_count_in_master}
                      onChange={(event) =>
                        onEntryChange?.(
                          entriesKey,
                          index,
                          "box_count_in_master",
                          event.target.value,
                        )
                      }
                      min="0"
                      step="1"
                      disabled={disabled}
                    />
                  </div>
                )}
                {isIndividualMasterMode && (
                  <div className="col-md-3">
                    <label className="form-label small text-secondary">Pcs in Master</label>
                    <input
                      type="number"
                      className="form-control"
                      value={entry.box_count_in_master}
                      onChange={(event) =>
                        onEntryChange(entriesKey, index, "box_count_in_master", event.target.value)
                      }
                      min="0"
                      step="1"
                      disabled={disabled}
                    />
                  </div>
                )}
              </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>

        {safeCount === 1 && !isCartonMode && !isIndividualMasterMode && (
          <div className="small text-secondary mt-2">
            Single-entry measurements use {singleEntryLabel.toLowerCase()} as the remark.
          </div>
        )}
        {isCartonMode && (
          <div className="small text-secondary mt-2">
            Master carton CBM is divided by item count in inner and box count in master.
          </div>
        )}
        {isIndividualMasterMode && (
          <div className="small text-secondary mt-2">
            Master carton CBM is divided by pcs in master.
          </div>
        )}
      </div>
    </>
  );
};

const cloneProductTypeValidation = () => ({
  product_type: "",
  fields: {},
  item_sizes: {},
  box_sizes: {},
});

const buildExistingProductTypePayload = (item = {}) => ({
  product_type: item?.product_type || null,
  product_specs: item?.product_specs || {
    fields: [],
    item_sizes: [],
    box_sizes: [],
    box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
    raw_values: {},
  },
});

const hasObjectKey = (value = {}, key = "") =>
  Object.prototype.hasOwnProperty.call(value || {}, key);

const isProductSpecSizeRawValue = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasDimension = ["L", "B", "H"].some((key) => hasObjectKey(value, key));
  const hasSizeMetadata = [
    "remark",
    "net_weight",
    "gross_weight",
    "box_type",
    "item_count_in_inner",
    "box_count_in_master",
  ].some((key) => hasObjectKey(value, key));
  return hasDimension && hasSizeMetadata;
};

const stripProductSpecSizeRawValues = (rawValues = {}) =>
  Object.entries(rawValues && typeof rawValues === "object" ? rawValues : {}).reduce(
    (accumulator, [key, value]) => {
      if (!isProductSpecSizeRawValue(value)) {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {},
  );

const buildProductTypePayloadWithoutSizeSections = (payload = {}) => ({
  ...payload,
  product_specs: {
    fields: Array.isArray(payload?.product_specs?.fields) ? payload.product_specs.fields : [],
    item_sizes: [],
    box_sizes: [],
    box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
    raw_values: stripProductSpecSizeRawValues(payload?.product_specs?.raw_values),
  },
});

const buildExistingProductDatabaseSizePayload = (item = {}) => ({
  pd_item_sizes: Array.isArray(item?.pd_item_sizes) ? item.pd_item_sizes : [],
  pd_box_sizes: Array.isArray(item?.pd_box_sizes) ? item.pd_box_sizes : [],
  pd_box_mode: detectBoxPackagingMode(item?.pd_box_mode, item?.pd_box_sizes || []),
});

const normalizeMeasuredKey = (value) => normalizeTextValue(value).toLowerCase();
const getCartonRemarkForIndex = (index = 0) =>
  index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;

const getPositivePayloadNumber = (value) => {
  const normalized = normalizeTextValue(value);
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const addPositivePayloadNumber = (payload = {}, key = "", value) => {
  const parsed = getPositivePayloadNumber(value);
  if (parsed !== null) {
    payload[key] = parsed;
  }
};

const hasMeaningfulMeasuredPayloadInput = (entry = {}, includeCartonCounts = false) => {
  const fields = ["L", "B", "H", "weight"];
  if (includeCartonCounts) {
    fields.push("item_count_in_inner", "box_count_in_master");
  }
  return fields.some((field) => getPositivePayloadNumber(entry?.[field]) !== null);
};

const toMeasuredSizeEntryFormValue = (
  entry = {},
  {
    weightKey = "",
    mode = BOX_PACKAGING_MODES.INDIVIDUAL,
    boxType = BOX_ENTRY_TYPES.INDIVIDUAL,
  } = {},
) => {
  const normalizedRemark = normalizeMeasuredKey(entry?.remark || entry?.type || "");
  const normalizedBoxType = normalizeMeasuredKey(entry?.box_type || boxType);
  const resolvedMode = detectBoxPackagingMode(mode, [
    { ...entry, remark: normalizedRemark, box_type: normalizedBoxType },
  ]);
  const resolvedBoxType =
    resolvedMode === BOX_PACKAGING_MODES.CARTON
      ? normalizedBoxType === BOX_ENTRY_TYPES.MASTER ||
        normalizedRemark === BOX_ENTRY_TYPES.MASTER
        ? BOX_ENTRY_TYPES.MASTER
        : BOX_ENTRY_TYPES.INNER
      : resolvedMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
        ? BOX_ENTRY_TYPES.MASTER
      : BOX_ENTRY_TYPES.INDIVIDUAL;
  const cartonRemarkIndex = resolvedBoxType === BOX_ENTRY_TYPES.MASTER ? 1 : 0;

  return {
    ...createEmptyMeasuredSizeEntry({
      mode: resolvedMode,
      boxType: resolvedBoxType,
    }),
    remark:
      resolvedMode === BOX_PACKAGING_MODES.CARTON ||
      resolvedMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER
        ? getCartonRemarkForIndex(cartonRemarkIndex)
        : normalizedRemark,
    box_type: resolvedBoxType,
    L: toDimensionInputValue(entry?.L),
    B: toDimensionInputValue(entry?.B),
    H: toDimensionInputValue(entry?.H),
    weight: toDimensionInputValue(entry?.[weightKey] ?? entry?.weight),
    item_count_in_inner: toDimensionInputValue(entry?.item_count_in_inner),
    box_count_in_master: toDimensionInputValue(entry?.box_count_in_master),
  };
};

const createProductDatabaseMeasuredSizeFormState = (item = {}) => {
  const itemEntries = getDisplayItemSizes(item).map((entry) =>
    toMeasuredSizeEntryFormValue(entry, { weightKey: "net_weight" }),
  );
  const itemCount = String(
    normalizeSizeCount(Math.max(itemEntries.length, 1), 1, ITEM_SIZE_ENTRY_LIMIT),
  );
  const boxMode = getDisplayBoxMode(item);
  const boxEntries = getDisplayBoxSizes(item).map((entry) =>
    toMeasuredSizeEntryFormValue(entry, {
      weightKey: "gross_weight",
      mode: boxMode,
      boxType: entry?.box_type,
    }),
  );
  const resolvedBoxMode = detectBoxPackagingMode(boxMode, boxEntries);
  const fixedBoxCount = getFixedBoxEntryCount(resolvedBoxMode);
  const boxCount =
    fixedBoxCount
      ? String(fixedBoxCount)
      : String(normalizeSizeCount(Math.max(boxEntries.length, 1), 1, BOX_SIZE_ENTRY_LIMIT));

  return {
    itemCount,
    itemEntries: ensureMeasuredSizeEntryCount(itemEntries, itemCount, {
      singleRemark: "item",
    }),
    boxMode: resolvedBoxMode,
    boxCount,
    boxEntries: ensureMeasuredSizeEntryCount(boxEntries, boxCount, {
      mode: resolvedBoxMode,
      singleRemark: "box",
      limit: BOX_SIZE_ENTRY_LIMIT,
    }),
  };
};

const cloneMeasuredSizeEntries = (entries = []) =>
  (Array.isArray(entries) ? entries : []).map((entry) => ({ ...entry }));

const cloneMeasuredSizeFormState = (formState = {}) => ({
  itemCount: String(normalizeSizeCount(formState?.itemCount, 1, ITEM_SIZE_ENTRY_LIMIT)),
  itemEntries: cloneMeasuredSizeEntries(formState?.itemEntries),
  boxMode: detectBoxPackagingMode(formState?.boxMode, formState?.boxEntries || []),
  boxCount: String(
    getFixedBoxEntryCount(
      detectBoxPackagingMode(formState?.boxMode, formState?.boxEntries || []),
    ) ?? normalizeSizeCount(formState?.boxCount, 1, BOX_SIZE_ENTRY_LIMIT),
  ),
  boxEntries: cloneMeasuredSizeEntries(formState?.boxEntries),
});

const getProductDatabaseMeasuredSizeFormState = ({ draft = null, item = {} } = {}) =>
  draft?.measuredSizeForm
    ? cloneMeasuredSizeFormState(draft.measuredSizeForm)
    : createProductDatabaseMeasuredSizeFormState(item);

const buildMeasuredSizeEntriesPayload = ({
  entries = [],
  count = 1,
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  weightPayloadKey = "",
  isBox = false,
} = {}) => {
  const resolvedMode = isBox ? detectBoxPackagingMode(mode, entries) : BOX_PACKAGING_MODES.INDIVIDUAL;
  const fixedBoxCount = isBox ? getFixedBoxEntryCount(resolvedMode) : null;
  const sizeEntryLimit = isBox ? BOX_SIZE_ENTRY_LIMIT : ITEM_SIZE_ENTRY_LIMIT;
  const safeCount =
    fixedBoxCount ?? normalizeSizeCount(count, 1, sizeEntryLimit);
  const scopedEntries = ensureMeasuredSizeEntryCount(entries, safeCount, {
    mode: resolvedMode,
    singleRemark: isBox ? "box" : "item",
    limit: sizeEntryLimit,
  }).slice(0, safeCount);

  return scopedEntries.reduce((payloadEntries, entry, index) => {
    const isCartonMode = isBox && resolvedMode === BOX_PACKAGING_MODES.CARTON;
    const isIndividualMasterMode =
      isBox && resolvedMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER;
    if (!hasMeaningfulMeasuredPayloadInput(entry, isCartonMode || isIndividualMasterMode)) {
      return payloadEntries;
    }

    const payload = {};
    ["L", "B", "H"].forEach((dimensionKey) => {
      addPositivePayloadNumber(payload, dimensionKey, entry?.[dimensionKey]);
    });
    if (weightPayloadKey) {
      addPositivePayloadNumber(payload, weightPayloadKey, entry?.weight);
    }

    if (isBox) {
      if (isCartonMode) {
        const boxType = index === 0 ? BOX_ENTRY_TYPES.INNER : BOX_ENTRY_TYPES.MASTER;
        payload.remark = getCartonRemarkForIndex(index);
        payload.box_type = boxType;
        if (boxType === BOX_ENTRY_TYPES.INNER) {
          addPositivePayloadNumber(payload, "item_count_in_inner", entry?.item_count_in_inner);
        }
        if (boxType === BOX_ENTRY_TYPES.MASTER) {
          addPositivePayloadNumber(payload, "box_count_in_master", entry?.box_count_in_master);
        }
      } else if (isIndividualMasterMode) {
        payload.remark = BOX_ENTRY_TYPES.MASTER;
        payload.box_type = BOX_ENTRY_TYPES.MASTER;
        addPositivePayloadNumber(payload, "box_count_in_master", entry?.box_count_in_master);
      } else {
        payload.box_type = BOX_ENTRY_TYPES.INDIVIDUAL;
        const remark = normalizeMeasuredKey(entry?.remark) || (safeCount === 1 ? "box" : "");
        if (remark) payload.remark = remark;
      }
    } else {
      const remark = normalizeMeasuredKey(entry?.remark) || (safeCount === 1 ? "item" : "");
      if (remark) payload.remark = remark;
    }

    payloadEntries.push(payload);
    return payloadEntries;
  }, []);
};

const buildProductDatabaseMeasuredSizePayload = (formState = {}) => {
  const boxMode = detectBoxPackagingMode(formState?.boxMode, formState?.boxEntries || []);
  return {
    pd_item_sizes: buildMeasuredSizeEntriesPayload({
      entries: formState?.itemEntries,
      count: formState?.itemCount,
      weightPayloadKey: "net_weight",
    }),
    pd_box_sizes: buildMeasuredSizeEntriesPayload({
      entries: formState?.boxEntries,
      count: formState?.boxCount,
      mode: boxMode,
      weightPayloadKey: "gross_weight",
      isBox: true,
    }),
    pd_box_mode: boxMode,
  };
};

const cloneDraftValue = (value) => {
  if (Array.isArray(value)) return [...value];
  if (typeof File !== "undefined" && value instanceof File) return value;
  if (value && typeof value === "object") return { ...value };
  return value;
};

const cloneDraftRecord = (record = {}) =>
  Object.entries(record || {}).reduce((accumulator, [key, value]) => {
    accumulator[key] = cloneDraftValue(value);
    return accumulator;
  }, {});

const cloneDraftNestedRecord = (record = {}) =>
  Object.entries(record || {}).reduce((accumulator, [key, value]) => {
    accumulator[key] = cloneDraftRecord(value);
    return accumulator;
  }, {});

const cloneProductTypeFormState = (formState = {}) => ({
  fieldValues: cloneDraftRecord(formState?.fieldValues),
  itemSizeValues: cloneDraftNestedRecord(formState?.itemSizeValues),
  boxSizeValues: cloneDraftNestedRecord(formState?.boxSizeValues),
});

const getProductDatabaseDraftKey = (item = {}) =>
  normalizeTextValue(item?.id || item?._id);

const hasDraftProductTypeFormForSelection = (draft = {}, form = {}) =>
  Boolean(draft?.productTypeForm) &&
  normalizeTemplateKey(draft?.form?.productTypeKey) ===
    normalizeTemplateKey(form?.productTypeKey) &&
  Number(draft?.form?.productTypeVersion || 0) ===
    Number(form?.productTypeVersion || 0);

const getProductTypeFormState = ({ draft = null, form = {}, item = {}, template = null } = {}) =>
  hasDraftProductTypeFormForSelection(draft, form)
    ? cloneProductTypeFormState(draft.productTypeForm)
    : createProductTypeFormState({ item, template });

const createProductDatabaseDraft = ({
  form = {},
  productTypeForm = {},
  measuredSizeForm = {},
  payload = {},
} = {}) => ({
  form: {
    countryOfOrigin: form?.countryOfOrigin || "",
    barcodeMode: normalizeBarcodeMode(form?.barcodeMode),
    singleBarcode: form?.singleBarcode || "",
    masterBarcode: form?.masterBarcode || "",
    innerBarcode: form?.innerBarcode || "",
    productTypeKey: normalizeTemplateKey(form?.productTypeKey),
    productTypeVersion: Number(form?.productTypeVersion || 0),
  },
  productTypeForm: cloneProductTypeFormState(productTypeForm),
  measuredSizeForm: cloneMeasuredSizeFormState(measuredSizeForm),
  payload,
  savedAt: new Date().toISOString(),
});

const buildTemplateOptionValue = (key = "", version = "") =>
  normalizeTemplateKey(key) && Number(version) > 0
    ? `${normalizeTemplateKey(key)}::${Number(version)}`
    : "";

const formatProductTypeDisplayLabel = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\s+v\d+\s*$/i, "");

const parseTemplateOptionValue = (value = "") => {
  const [keyPart = "", versionPart = ""] = String(value || "").split("::");
  const version = Number.parseInt(versionPart, 10);
  return {
    key: normalizeTemplateKey(keyPart),
    version: Number.isFinite(version) && version > 0 ? version : 0,
  };
};

export const ProductDatabaseModal = ({ item, draft = null, onClose, onSaved, onSaveDraft }) => {
  const { hasPermission } = usePermissions();
  const user = getUserFromToken();
  const normalizedRole = normalizeUserRole(user?.role);
  const isAdmin = isAdminLikeRole(normalizedRole);
  const isManager = isManagerLikeRole(normalizedRole) && !isAdmin;
  const canViewProductTypeTemplates = hasPermission("product_type_templates", "view");
  const canEdit = Boolean(item?.permissions?.can_edit);
  const draftPayload = draft?.payload || null;
  const draftItem = useMemo(
    () =>
      draftPayload
        ? {
            ...item,
            country_of_origin: draftPayload.country_of_origin ?? item?.country_of_origin,
            pd_barcode: draftPayload.pd_barcode ?? item?.pd_barcode,
            pd_master_barcode:
              draftPayload.pd_master_barcode ??
              draftPayload.pd_barcode ??
              item?.pd_master_barcode,
            pd_inner_barcode: draftPayload.pd_inner_barcode ?? item?.pd_inner_barcode,
            product_type: draftPayload.product_type || null,
            product_specs:
              draftPayload.product_specs || buildExistingProductTypePayload({}).product_specs,
            pd_item_sizes: Array.isArray(draftPayload.pd_item_sizes)
              ? draftPayload.pd_item_sizes
              : item?.pd_item_sizes,
            pd_box_sizes: Array.isArray(draftPayload.pd_box_sizes)
              ? draftPayload.pd_box_sizes
              : item?.pd_box_sizes,
            pd_box_mode: draftPayload.pd_box_mode || item?.pd_box_mode,
          }
        : item,
    [draftPayload, item],
  );
  const initialForm = useMemo(
    () =>
      draft?.form
        ? {
            countryOfOrigin: draft.form.countryOfOrigin || "",
            barcodeMode: normalizeBarcodeMode(
              draft.form.barcodeMode || getProductDatabaseBarcodeMode(draftItem),
            ),
            singleBarcode:
              draft.form.singleBarcode ?? getProductDatabaseMasterBarcode(draftItem),
            masterBarcode:
              draft.form.masterBarcode ?? getProductDatabaseMasterBarcode(draftItem),
            innerBarcode:
              draft.form.innerBarcode ?? normalizeTextValue(draftItem?.pd_inner_barcode),
            kd: draft.form.kd === true,
            mountingFileNeeded: draft.form.mountingFileNeeded === true,
            productTypeKey: normalizeTemplateKey(draft.form.productTypeKey),
            productTypeVersion: Number(draft.form.productTypeVersion || 0),
          }
        : {
            countryOfOrigin: normalizeTextValue(draftItem?.country_of_origin),
            barcodeMode: getProductDatabaseBarcodeMode(draftItem),
            singleBarcode: getProductDatabaseMasterBarcode(draftItem),
            masterBarcode: getProductDatabaseMasterBarcode(draftItem),
            innerBarcode: normalizeTextValue(draftItem?.pd_inner_barcode),
            kd: draftItem?.kd === true,
            mountingFileNeeded: draftItem?.mounting_file_needed === true,
            productTypeKey: normalizeTemplateKey(draftItem?.product_type?.key),
            productTypeVersion: Number(draftItem?.product_type?.version || 0),
          },
    [draft, draftItem],
  );
  const [form, setForm] = useState(initialForm);
  const [templateOptions, setTemplateOptions] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [productTypeForm, setProductTypeForm] = useState(() =>
    getProductTypeFormState({ draft, form: initialForm, item: draftItem, template: null }),
  );
  const [measuredSizeForm, setMeasuredSizeForm] = useState(() =>
    getProductDatabaseMeasuredSizeFormState({ draft, item: draftItem }),
  );
  const [productTypeErrors, setProductTypeErrors] = useState(
    cloneProductTypeValidation(),
  );
  const [savingAction, setSavingAction] = useState("");
  const [error, setError] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const countryOfOriginOptions = useMemo(
    () => getCountryOfOriginOptions(form.countryOfOrigin),
    [form.countryOfOrigin],
  );

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  useEffect(() => {
    setMeasuredSizeForm(getProductDatabaseMeasuredSizeFormState({ draft, item: draftItem }));
  }, [draft, draftItem]);

  const loadTemplateOptions = useCallback(async () => {
    if (!canViewProductTypeTemplates) {
      setTemplateOptions([]);
      setTemplatesError("");
      setTemplatesLoading(false);
      return;
    }

    try {
      setTemplatesLoading(true);
      setTemplatesError("");
      const response = await getProductTypeTemplates();
      const currentSelectionRef = buildTemplateOptionValue(
        draftItem?.product_type?.key,
        draftItem?.product_type?.version,
      );
      const options = (Array.isArray(response?.data) ? response.data : []).filter(
        (templateOption) =>
          templateOption?.status === "active" ||
          buildTemplateOptionValue(
            templateOption?.key,
            templateOption?.version,
          ) === currentSelectionRef,
      );
      setTemplateOptions(options);
    } catch (loadError) {
      setTemplateOptions([]);
      setTemplatesError(
        loadError?.response?.data?.message ||
          loadError?.message ||
          "Failed to load product type templates.",
      );
    } finally {
      setTemplatesLoading(false);
    }
  }, [canViewProductTypeTemplates, draftItem]);

  useEffect(() => {
    loadTemplateOptions();
  }, [loadTemplateOptions]);

  const loadSelectedTemplate = useCallback(
    async (templateKey, templateVersion = 0) => {
      const normalizedTemplateKey = normalizeTemplateKey(templateKey);
      if (!canViewProductTypeTemplates || !normalizedTemplateKey) {
        setSelectedTemplate(null);
        setTemplateError("");
        setTemplateLoading(false);
        return;
      }

      try {
        setTemplateLoading(true);
        setTemplateError("");
        const response = await getProductTypeTemplateByKey(normalizedTemplateKey, {
          ...(templateVersion > 0 ? { version: templateVersion } : {}),
        });
        setSelectedTemplate(response?.data || null);
      } catch (loadError) {
        setSelectedTemplate(null);
        setTemplateError(
          loadError?.response?.data?.message ||
            loadError?.message ||
            "Failed to load the selected product type template.",
        );
      } finally {
        setTemplateLoading(false);
      }
    },
    [canViewProductTypeTemplates],
  );
  const selectedProductTypeTemplate = useMemo(
    () => mergeProductDatabaseTableV1Fields(selectedTemplate),
    [selectedTemplate],
  );

  useEffect(() => {
    const selectedKey = normalizeTemplateKey(form.productTypeKey);
    if (!selectedKey) {
      setSelectedTemplate(null);
      setTemplateError("");
      setProductTypeForm(
        getProductTypeFormState({ draft, form, item: draftItem, template: null }),
      );
      setProductTypeErrors(cloneProductTypeValidation());
      return;
    }

    loadSelectedTemplate(selectedKey, Number(form.productTypeVersion || 0));
  }, [
    draft,
    draftItem,
    form.productTypeKey,
    form.productTypeVersion,
    loadSelectedTemplate,
  ]);

  useEffect(() => {
    if (!selectedProductTypeTemplate) {
      return;
    }

    setProductTypeForm(
      getProductTypeFormState({
        draft,
        form,
        item: draftItem,
        template: selectedProductTypeTemplate,
      }),
    );
    setProductTypeErrors(cloneProductTypeValidation());
  }, [
    draft,
    draftItem,
    form.productTypeKey,
    form.productTypeVersion,
    selectedProductTypeTemplate,
  ]);

  const templateReady =
    !normalizeTemplateKey(form.productTypeKey) ||
    (!templateLoading && Boolean(selectedProductTypeTemplate));

  const currentProductTypePayload = useMemo(() => {
    if (!normalizeTemplateKey(form.productTypeKey)) {
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

    if (selectedProductTypeTemplate) {
      return buildProductTypePayload({
        template: selectedProductTypeTemplate,
        selectedProductTypeKey: form.productTypeKey,
        formState: productTypeForm,
        includeSizeFields: false,
      });
    }

    if (
      normalizeTemplateKey(draftItem?.product_type?.key) ===
        normalizeTemplateKey(form.productTypeKey) &&
      Number(draftItem?.product_type?.version || 0) ===
        Number(form.productTypeVersion || 0)
    ) {
      return buildProductTypePayloadWithoutSizeSections(
        buildExistingProductTypePayload(draftItem),
      );
    }

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
  }, [
    draftItem,
    form.productTypeKey,
    form.productTypeVersion,
    productTypeForm,
    selectedProductTypeTemplate,
  ]);

  const currentMeasuredSizePayload = useMemo(
    () => buildProductDatabaseMeasuredSizePayload(measuredSizeForm),
    [measuredSizeForm],
  );

  const currentPayload = useMemo(
    () => ({
      ...buildPayloadFromForm(form, currentMeasuredSizePayload.pd_box_mode),
      ...currentProductTypePayload,
      ...currentMeasuredSizePayload,
    }),
    [currentMeasuredSizePayload, currentProductTypePayload, form],
  );

  const initialPayload = useMemo(
    () => {
      const initialMeasuredSizePayload = buildExistingProductDatabaseSizePayload(item);
      return {
        ...buildPayloadFromForm({
          countryOfOrigin: normalizeTextValue(item?.country_of_origin),
          barcodeMode: getProductDatabaseBarcodeMode(item),
          singleBarcode: getProductDatabaseMasterBarcode(item),
          masterBarcode: getProductDatabaseMasterBarcode(item),
          innerBarcode: normalizeTextValue(item?.pd_inner_barcode),
        }, initialMeasuredSizePayload.pd_box_mode),
        ...buildExistingProductTypePayload(item),
        ...initialMeasuredSizePayload,
      };
    },
    [item],
  );
  const hasChanges = !arePayloadsEqualForCompare(currentPayload, initialPayload);
  const canCheck = Boolean(item?.permissions?.can_check) && !hasChanges;
  const canApprove = isAdmin && (item?.pd_checked === "checked" || hasChanges);

  const clearDraftMessage = () => {
    if (draftMessage) setDraftMessage("");
  };

  const handleBarcodeFieldChange = (fieldName, value) => {
    clearDraftMessage();
    setForm((prev) => {
      if (fieldName === "singleBarcode") {
        return {
          ...prev,
          singleBarcode: value,
          masterBarcode: value,
        };
      }

      return {
        ...prev,
        [fieldName]: value,
        ...(fieldName === "masterBarcode" ? { singleBarcode: value } : {}),
      };
    });
  };

  const handleProductTypeChange = (nextValue) => {
    clearDraftMessage();
    const { key: nextKey, version: nextVersion } = parseTemplateOptionValue(nextValue);
    const currentKey = normalizeTemplateKey(form.productTypeKey);
    const currentVersion = Number(form.productTypeVersion || 0);
    if (nextKey === currentKey && nextVersion === currentVersion) return;

    const hasDynamicValues = hasProductTypeFormValues(productTypeForm);
    const hasExistingSelection = Boolean(currentKey);
    if (hasExistingSelection || hasDynamicValues) {
      const confirmed = window.confirm(
        "Changing the product type will reset the current product spec fields. Continue?",
      );
      if (!confirmed) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      productTypeKey: nextKey,
      productTypeVersion: nextVersion,
    }));
    setSelectedTemplate(null);
    setTemplateError("");
    setProductTypeForm(createProductTypeFormState({ item: {}, template: null }));
    setProductTypeErrors(cloneProductTypeValidation());
  };

  const handleProductTypeFieldChange = (fieldKey, value) => {
    clearDraftMessage();
    setProductTypeErrors(cloneProductTypeValidation());
    setProductTypeForm((prev) => ({
      ...prev,
      fieldValues: {
        ...prev.fieldValues,
        [fieldKey]: value,
      },
    }));
  };

  const handleItemSizeChange = (fieldKey, fieldName, value) => {
    clearDraftMessage();
    setProductTypeErrors(cloneProductTypeValidation());
    setProductTypeForm((prev) => ({
      ...prev,
      itemSizeValues: {
        ...prev.itemSizeValues,
        [fieldKey]: {
          ...(prev.itemSizeValues?.[fieldKey] || {}),
          [fieldName]: value,
        },
      },
    }));
  };

  const handleBoxSizeChange = (fieldKey, fieldName, value) => {
    clearDraftMessage();
    setProductTypeErrors(cloneProductTypeValidation());
    setProductTypeForm((prev) => {
      const nextEntry = {
        ...(prev.boxSizeValues?.[fieldKey] || {}),
        [fieldName]: value,
      };

      const normalizedBoxType =
        fieldName === "box_type"
          ? normalizeTemplateKey(value)
          : normalizeTemplateKey(nextEntry?.box_type);

      if (normalizedBoxType !== BOX_ENTRY_TYPES.INNER) {
        nextEntry.item_count_in_inner = "0";
      }
      if (normalizedBoxType !== BOX_ENTRY_TYPES.MASTER) {
        nextEntry.box_count_in_master = "0";
      }

      return {
        ...prev,
        boxSizeValues: {
          ...prev.boxSizeValues,
          [fieldKey]: nextEntry,
        },
      };
    });
  };

  const handleMeasuredSizeControlChange = (event) => {
    const { name, value } = event.target;
    clearDraftMessage();
    const nextBoxModeForBarcode =
      name === "pd_box_mode"
        ? detectBoxPackagingMode(value, measuredSizeForm.boxEntries)
        : null;

    if (nextBoxModeForBarcode) {
      setForm((currentForm) => {
        const currentMasterBarcode = normalizeTextValue(
          currentForm.masterBarcode || currentForm.singleBarcode,
        );

        return {
          ...currentForm,
          barcodeMode:
            nextBoxModeForBarcode === BOX_PACKAGING_MODES.CARTON
              ? BARCODE_MODES.INNER_MASTER
              : BARCODE_MODES.SINGLE,
          singleBarcode: currentMasterBarcode,
          masterBarcode: currentMasterBarcode,
          innerBarcode:
            nextBoxModeForBarcode === BOX_PACKAGING_MODES.CARTON
              ? currentForm.innerBarcode
              : "",
        };
      });
    }

    setMeasuredSizeForm((prev) => {
      if (name === "pd_box_mode") {
        const nextMode = detectBoxPackagingMode(value, prev.boxEntries);
        return {
          ...prev,
          boxMode: nextMode,
          boxCount:
            String(
              getFixedBoxEntryCount(nextMode) ??
                normalizeSizeCount(prev.boxCount, 1, BOX_SIZE_ENTRY_LIMIT),
            ),
          boxEntries: ensureMeasuredSizeEntryCount(
            convertMeasuredBoxEntriesMode(prev.boxEntries, nextMode),
            getFixedBoxEntryCount(nextMode) ?? prev.boxCount,
            { mode: nextMode, singleRemark: "box", limit: BOX_SIZE_ENTRY_LIMIT },
          ),
        };
      }

      if (name === "pd_item_count" || name === "pd_box_count") {
        if (name === "pd_item_count") {
          const safeCount = String(
            normalizeSizeCount(value, 1, ITEM_SIZE_ENTRY_LIMIT),
          );
          return {
            ...prev,
            itemCount: safeCount,
            itemEntries: ensureMeasuredSizeEntryCount(prev.itemEntries, safeCount, {
              singleRemark: "item",
            }),
          };
        }

        const safeCount = String(normalizeSizeCount(value, 1, BOX_SIZE_ENTRY_LIMIT));
        return {
          ...prev,
          boxCount: safeCount,
          boxEntries: ensureMeasuredSizeEntryCount(prev.boxEntries, safeCount, {
            mode: prev.boxMode,
            singleRemark: "box",
            limit: BOX_SIZE_ENTRY_LIMIT,
          }),
        };
      }

      return prev;
    });
  };

  const handleMeasuredSizeEntryChange = (entriesKey, index, field, value) => {
    if (field !== "remark" && value !== "") {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return;
      }
    }

    clearDraftMessage();
    setMeasuredSizeForm((prev) => {
      const currentEntries = Array.isArray(prev?.[entriesKey]) ? prev[entriesKey] : [];
      const nextEntries = currentEntries.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              [field]:
                field === "remark"
                  ? normalizeMeasuredKey(value)
                  : value,
            }
          : entry,
      );

      if (entriesKey === "boxEntries") {
        return {
          ...prev,
          boxEntries: ensureMeasuredSizeEntryCount(
            nextEntries,
            prev.boxCount,
            { mode: prev.boxMode, singleRemark: "box", limit: BOX_SIZE_ENTRY_LIMIT },
          ),
        };
      }

      return {
        ...prev,
        itemEntries: ensureMeasuredSizeEntryCount(nextEntries, prev.itemCount, {
          singleRemark: "item",
        }),
      };
    });
  };

  const handleSaveDraft = () => {
    setError("");
    setProductTypeErrors(cloneProductTypeValidation());

    if (normalizeTemplateKey(form.productTypeKey) && !templateReady) {
      setError("Please wait for the selected product type template to finish loading.");
      return;
    }

    onSaveDraft?.({
      itemId: getProductDatabaseDraftKey(item),
      draft: createProductDatabaseDraft({
        form,
        productTypeForm,
        measuredSizeForm,
        payload: currentPayload,
      }),
    });
    setDraftMessage("Draft saved on this page only. Nothing was sent to the backend.");
  };

  const runMutation = async (action) => {
    try {
      setSavingAction(action);
      setError("");
      setProductTypeErrors(cloneProductTypeValidation());

      if (normalizeTemplateKey(form.productTypeKey) && !templateReady) {
        setError("Please wait for the selected product type template to finish loading.");
        return;
      }

      let response;
      if (action === "check") {
        response = await api.post(`/items/${item.id}/product-database/check`, currentPayload);
      } else if (action === "approve") {
        const confirmed = window.confirm("Approve this Product Database record?");
        if (!confirmed) return;
        response = await api.post(`/items/${item.id}/product-database/approve`, currentPayload);
      } else {
        response = await api.patch(`/items/${item.id}/product-database`, currentPayload);
      }

      onSaved?.(
        response?.data?.message || "Product Database record updated.",
        getProductDatabaseDraftKey(item),
      );
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update Product Database record.");
    } finally {
      setSavingAction("");
    }
  };

  const displayedItemEntries = ensureMeasuredSizeEntryCount(
    measuredSizeForm.itemEntries,
    measuredSizeForm.itemCount,
    { singleRemark: "item", limit: ITEM_SIZE_ENTRY_LIMIT },
  );
  const displayedBoxEntries = ensureMeasuredSizeEntryCount(
    measuredSizeForm.boxEntries,
    measuredSizeForm.boxCount,
    {
      mode: measuredSizeForm.boxMode,
      singleRemark: "box",
      limit: BOX_SIZE_ENTRY_LIMIT,
    },
  );
  const isProductDatabaseCartonMode =
    detectBoxPackagingMode(measuredSizeForm.boxMode, measuredSizeForm.boxEntries) ===
    BOX_PACKAGING_MODES.CARTON;

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
    >
          <div
            className="modal-dialog modal-dialog-centered modal-xl product-database-modal-dialog"
            role="document"
            onClick={(event) => event.stopPropagation()}
          >
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">Product Database</h5>
              <div className="small text-muted">
                {item?.code || "N/A"} | {item?.description || item?.name || "N/A"}
              </div>
            </div>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
          </div>

          <div className="modal-body">
            {error && <div className="alert alert-danger mb-3">{error}</div>}
            {draftMessage && <div className="alert alert-success mb-3">{draftMessage}</div>}
            {!draftMessage && draft && (
              <div className="alert alert-info mb-3">
                A frontend-only draft is loaded for this item. Use Save Changes, Check, or Approve
                when you want to store it on the backend.
              </div>
            )}

            <div className="d-flex flex-wrap gap-2 mb-3">
              <span className={`badge product-database-status-badge ${getStatusBadgeClass(item?.pd_checked)}`}>
                {getStatusLabel(item?.pd_checked)}
              </span>
              <span className="om-summary-chip">
                Created: {formatActor(item?.pd_created_by, "created_at")}
              </span>
              <span className="om-summary-chip">
                Checked: {formatActor(item?.pd_checked_by, "checked_at")}
              </span>
              <span className="om-summary-chip">
                Approved: {formatActor(item?.pd_approved_by, "approved_at")}
              </span>
              <span className="om-summary-chip">
                Last Changed: {formatActor(item?.pd_last_changed_by, "changed_at")}
              </span>
            </div>

            <section className="mb-4">
              <div className="card om-card">
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-lg-4">
                      <label className="form-label">Country of Origin</label>
                      <select
                        className="form-select"
                        value={form.countryOfOrigin}
                        disabled={!canEdit}
                        onChange={(event) => {
                          clearDraftMessage();
                          setForm((prev) => ({
                            ...prev,
                            countryOfOrigin: event.target.value,
                          }));
                        }}
                      >
                        <option value="">Select country</option>
                        {countryOfOriginOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {isProductDatabaseCartonMode ? (
                      <>
                        <div className="col-lg-4">
                          <label className="form-label">Master Carton Barcode</label>
                          <input
                            type="text"
                            className="form-control"
                            value={form.masterBarcode}
                            disabled={!canEdit}
                            onChange={(event) =>
                              handleBarcodeFieldChange("masterBarcode", event.target.value)
                            }
                          />
                        </div>
                        <div className="col-lg-4">
                          <label className="form-label">Inner Carton Barcode</label>
                          <input
                            type="text"
                            className="form-control"
                            value={form.innerBarcode}
                            disabled={!canEdit}
                            onChange={(event) =>
                              handleBarcodeFieldChange("innerBarcode", event.target.value)
                            }
                          />
                        </div>
                      </>
                    ) : (
                      <div className="col-lg-8">
                        <label className="form-label">Barcode</label>
                        <input
                          type="text"
                          className="form-control"
                          value={form.singleBarcode}
                          disabled={!canEdit}
                          onChange={(event) =>
                            handleBarcodeFieldChange("singleBarcode", event.target.value)
                          }
                        />
                      </div>
                    )}
                    <div className="col-lg-4">
                      <label className="form-label">K/D</label>
                      <div className="btn-group w-100" role="group" aria-label="K/D">
                        <button
                          type="button"
                          className={`btn ${form.kd ? "btn-primary" : "btn-outline-secondary"}`}
                          disabled={!canEdit}
                          onClick={() => {
                            clearDraftMessage();
                            setForm((prev) => ({ ...prev, kd: true }));
                          }}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`btn ${!form.kd ? "btn-primary" : "btn-outline-secondary"}`}
                          disabled={!canEdit}
                          onClick={() => {
                            clearDraftMessage();
                            setForm((prev) => ({ ...prev, kd: false }));
                          }}
                        >
                          No
                        </button>
                      </div>
                    </div>
                    <div className="col-lg-4">
                      <label className="form-label">Mounting File Needed</label>
                      <div className="btn-group w-100" role="group" aria-label="Mounting File Needed">
                        <button
                          type="button"
                          className={`btn ${form.mountingFileNeeded ? "btn-primary" : "btn-outline-secondary"}`}
                          disabled={!canEdit}
                          onClick={() => {
                            clearDraftMessage();
                            setForm((prev) => ({ ...prev, mountingFileNeeded: true }));
                          }}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`btn ${!form.mountingFileNeeded ? "btn-primary" : "btn-outline-secondary"}`}
                          disabled={!canEdit}
                          onClick={() => {
                            clearDraftMessage();
                            setForm((prev) => ({ ...prev, mountingFileNeeded: false }));
                          }}
                        >
                          No
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="mb-4">
              <div className="card om-card product-database-product-type-card">
                <div className="card-body">
                  <div className="row g-3 align-items-end">
                    <div className="col-lg-4">
                      <label className="form-label">Product Type</label>
                      <select
                        className={`form-select ${productTypeErrors.product_type ? "is-invalid" : ""}`}
                        value={buildTemplateOptionValue(form.productTypeKey, form.productTypeVersion)}
                        disabled={!canEdit || templatesLoading}
                        onChange={(event) => handleProductTypeChange(event.target.value)}
                      >
                        <option value="">Select product type</option>
                        {templateOptions.map((templateOption) => (
                          <option
                            key={templateOption._id || `${templateOption.key}-${templateOption.version}`}
                            value={buildTemplateOptionValue(
                              templateOption.key,
                              templateOption.version,
                            )}
                          >
                            {formatProductTypeDisplayLabel(templateOption.label || templateOption.key)}
                            {templateOption.status && templateOption.status !== "active"
                              ? ` (${templateOption.status})`
                              : ""}
                          </option>
                        ))}
                      </select>
                      {productTypeErrors.product_type && (
                        <div className="invalid-feedback d-block">
                          {productTypeErrors.product_type}
                        </div>
                      )}
                    </div>

                    <div className="col-lg-8">
                      <div className="d-flex flex-wrap gap-2 justify-content-lg-end">
                        {templatesLoading && (
                          <span className="om-summary-chip">Loading product types...</span>
                        )}
                        {templateLoading && normalizeTemplateKey(form.productTypeKey) && (
                          <span className="om-summary-chip">Loading selected template...</span>
                        )}
                        {selectedProductTypeTemplate && (
                          <>
                            <span className="om-summary-chip">
                              {formatProductTypeDisplayLabel(
                                selectedProductTypeTemplate.label ||
                                  selectedProductTypeTemplate.key,
                              )}
                            </span>
                            <span className="om-summary-chip">
                              Status: {selectedProductTypeTemplate.status}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {templatesError && (
                    <div className="alert alert-danger mt-3 mb-0">
                      {templatesError}
                    </div>
                  )}
                  {templateError && (
                    <div className="alert alert-danger mt-3 mb-0">
                      {templateError}
                    </div>
                  )}
                  {!templatesLoading &&
                    !templatesError &&
                    templateOptions.length === 0 && (
                      <div className="alert alert-warning mt-3 mb-0">
                        No product type templates are available yet.
                      </div>
                    )}
                  {!normalizeTemplateKey(form.productTypeKey) &&
                    !templatesLoading &&
                    !templatesError && (
                      <div className="alert alert-light border mt-3 mb-0">
                        Select a product type to load its template-driven product spec fields.
                      </div>
                    )}
                </div>
              </div>
            </section>

            {selectedProductTypeTemplate && (
              <section className="mb-4">
                <ProductTypeDynamicForm
                  template={selectedProductTypeTemplate}
                  fieldValues={productTypeForm.fieldValues}
                  itemSizeValues={productTypeForm.itemSizeValues}
                  boxSizeValues={productTypeForm.boxSizeValues}
                  errors={productTypeErrors}
                  disabled={!canEdit}
                  hideSizeFields
                  onFieldChange={handleProductTypeFieldChange}
                  onItemSizeChange={handleItemSizeChange}
                  onBoxSizeChange={handleBoxSizeChange}
                />
              </section>
            )}

            <section className="mb-4">
              <div className="card om-card">
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <h6 className="mb-0">Product Database Measurements</h6>
                      <div className="small text-secondary">
                        Item weight is saved as net weight. Box weight is saved as gross weight.
                      </div>
                    </div>

                    <ProductDatabaseMeasuredSizeSection
                      title="Item Sizes (cm) and Net Weight"
                      countName="pd_item_count"
                      countValue={measuredSizeForm.itemCount}
                      entriesKey="itemEntries"
                      entries={displayedItemEntries}
                      remarkOptions={ITEM_SIZE_REMARK_OPTIONS}
                      weightLabel="Net Weight"
                      countLabel="Item Sets"
                      disabled={!canEdit}
                      onControlChange={handleMeasuredSizeControlChange}
                      onEntryChange={handleMeasuredSizeEntryChange}
                    />

                    <ProductDatabaseMeasuredSizeSection
                      title="Box Sizes (cm) and Gross Weight"
                      countName="pd_box_count"
                      countValue={measuredSizeForm.boxCount}
                      entriesKey="boxEntries"
                      entries={displayedBoxEntries}
                      remarkOptions={BOX_SIZE_REMARK_OPTIONS}
                      weightLabel="Gross Weight"
                      countLabel="Box Sets"
                      disabled={!canEdit}
                      mode={measuredSizeForm.boxMode}
                      modeName="pd_box_mode"
                      showModeSelector
                      onControlChange={handleMeasuredSizeControlChange}
                      onEntryChange={handleMeasuredSizeEntryChange}
                    />
                  </div>
                </div>
              </div>
            </section>

            {isManager && item?.permissions?.check_blocked_reason && !hasChanges && (
              <div className="alert alert-warning mt-3 mb-0">
                {item.permissions.check_blocked_reason}
              </div>
            )}
            {isManager && hasChanges && (
              <div className="alert alert-info mt-3 mb-0">
                Saving changes will keep this record in Created status. Another eligible manager must check it.
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Close
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn btn-outline-dark"
                disabled={savingAction !== "" || !templateReady}
                onClick={handleSaveDraft}
              >
                Save Draft
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn btn-outline-primary"
                disabled={savingAction !== "" || !templateReady}
                onClick={() => runMutation("save")}
              >
                {savingAction === "save" ? "Saving..." : "Save Changes"}
              </button>
            )}
            {isManager && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canCheck || savingAction !== "" || !templateReady}
                onClick={() => runMutation("check")}
              >
                {savingAction === "check" ? "Checking..." : "Check"}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn btn-success"
                disabled={!canApprove || savingAction !== "" || !templateReady}
                onClick={() => runMutation("approve")}
              >
                {savingAction === "approve" ? "Approving..." : "Approve"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProductDatabase = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "product-database");
  const [search, setSearch] = useState(() => normalizeTextValue(searchParams.get("search")));
  const [draftSearch, setDraftSearch] = useState(() => normalizeTextValue(searchParams.get("search")));
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("brand")),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("vendor")),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("vendor")),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("status")),
  );
  const [draftStatusFilter, setDraftStatusFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("status")),
  );
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({
    not_set: 0,
    created: 0,
    checked: 0,
    approved: 0,
  });
  const [filters, setFilters] = useState({
    brand_options: [],
    vendor_options: [],
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [productDatabaseDrafts, setProductDatabaseDrafts] = useState({});
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = { page, limit };
      if (search) params.search = search;
      if (brandFilter !== DEFAULT_FILTER) params.brand = brandFilter;
      if (vendorFilter !== DEFAULT_FILTER) params.vendor = vendorFilter;
      if (statusFilter !== DEFAULT_FILTER) params.status = statusFilter;
      params.include_product_image_thumbnail = true;

      const response = await api.get("/items/product-database", { params });
      const data = response?.data || {};
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setSummary(data?.summary || {});
      setFilters(data?.filters || {});
      setPagination(data?.pagination || {});
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.message || "Failed to load Product Database.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, limit, page, search, statusFilter, vendorFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSearch = normalizeTextValue(searchParams.get("search"));
    const nextBrand = normalizeFilterValue(searchParams.get("brand"));
    const nextVendor = normalizeFilterValue(searchParams.get("vendor"));
    const nextStatus = normalizeFilterValue(searchParams.get("status"));
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    setDraftSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    setBrandFilter((prev) => (prev === nextBrand ? prev : nextBrand));
    setDraftBrandFilter((prev) => (prev === nextBrand ? prev : nextBrand));
    setVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setDraftVendorFilter((prev) => (prev === nextVendor ? prev : nextVendor));
    setStatusFilter((prev) => (prev === nextStatus ? prev : nextStatus));
    setDraftStatusFilter((prev) => (prev === nextStatus ? prev : nextStatus));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (brandFilter !== DEFAULT_FILTER) next.set("brand", brandFilter);
    if (vendorFilter !== DEFAULT_FILTER) next.set("vendor", vendorFilter);
    if (statusFilter !== DEFAULT_FILTER) next.set("status", statusFilter);
    if (page !== 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    page,
    search,
    searchParams,
    setSearchParams,
    statusFilter,
    syncedQuery,
    vendorFilter,
  ]);

  const applyFilters = (event) => {
    event?.preventDefault();
    setSearch(normalizeTextValue(draftSearch));
    setBrandFilter(normalizeFilterValue(draftBrandFilter));
    setVendorFilter(normalizeFilterValue(draftVendorFilter));
    setStatusFilter(normalizeFilterValue(draftStatusFilter));
    setPage(1);
  };

  const clearFilters = () => {
    setDraftSearch("");
    setDraftBrandFilter(DEFAULT_FILTER);
    setDraftVendorFilter(DEFAULT_FILTER);
    setDraftStatusFilter(DEFAULT_FILTER);
    setSearch("");
    setBrandFilter(DEFAULT_FILTER);
    setVendorFilter(DEFAULT_FILTER);
    setStatusFilter(DEFAULT_FILTER);
    setPage(1);
    setLimit(DEFAULT_LIMIT);
  };

  const handleExportXls = useCallback(async () => {
    try {
      setExporting(true);
      const params = {};
      if (search) params.search = search;
      if (brandFilter !== DEFAULT_FILTER) params.brand = brandFilter;
      if (vendorFilter !== DEFAULT_FILTER) params.vendor = vendorFilter;
      if (statusFilter !== DEFAULT_FILTER) params.status = statusFilter;

      const response = await api.get("/items/product-database/export", {
        params,
        responseType: "blob",
      });
      downloadProductDatabaseExport(response);
    } catch (exportError) {
      console.error(exportError);
      let message = "Failed to export Product Database as XLS.";
      const responseData = exportError?.response?.data;
      if (responseData instanceof Blob) {
        try {
          const payload = JSON.parse(await responseData.text());
          message = payload?.message || message;
        } catch {
          // Keep the fallback when the response body is not JSON.
        }
      } else if (responseData?.message) {
        message = responseData.message;
      }
      alert(message);
    } finally {
      setExporting(false);
    }
  }, [brandFilter, search, statusFilter, vendorFilter]);

  const handleDraftSaved = useCallback(({ itemId, draft: nextDraft }) => {
    const draftKey = normalizeTextValue(itemId);
    if (!draftKey) return;

    setProductDatabaseDrafts((prev) => ({
      ...prev,
      [draftKey]: nextDraft,
    }));
  }, []);

  const clearProductDatabaseDraft = useCallback((itemId) => {
    const draftKey = normalizeTextValue(itemId);
    if (!draftKey) return;

    setProductDatabaseDrafts((prev) => {
      if (!prev[draftKey]) return prev;
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
  }, []);

  const handleSaved = (message, itemId = getProductDatabaseDraftKey(selectedItem)) => {
    setSuccess(message);
    setSelectedItem(null);
    clearProductDatabaseDraft(itemId);
    fetchRows();
    window.setTimeout(() => setSuccess(""), 4000);
  };

  const selectedDraftKey = getProductDatabaseDraftKey(selectedItem);
  const selectedDraft = selectedDraftKey ? productDatabaseDrafts[selectedDraftKey] : null;

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <h2 className="h4 mb-0">Product Database</h2>
          <div className="d-flex flex-wrap align-items-center justify-content-end gap-2">
            <span className="small text-secondary">PD size data approval workflow</span>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={handleExportXls}
              disabled={loading || exporting || Number(pagination.total || 0) === 0}
            >
              {exporting ? "Exporting..." : "Export XLS"}
            </button>
          </div>
        </div>

        <div className="card om-card mb-3">
          <form className="card-body row g-2 align-items-end" onSubmit={applyFilters}>
            <div className="col-lg-3 col-md-6">
              <label className="form-label mb-1">Search</label>
              <input
                type="text"
                className="form-control"
                value={draftSearch}
                placeholder="Code, name, description"
                onChange={(event) => setDraftSearch(event.target.value)}
              />
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={draftBrandFilter}
                onChange={(event) => setDraftBrandFilter(event.target.value)}
              >
                <option value={DEFAULT_FILTER}>All Brands</option>
                {(Array.isArray(filters.brand_options) ? filters.brand_options : []).map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={draftVendorFilter}
                onChange={(event) => setDraftVendorFilter(event.target.value)}
              >
                <option value={DEFAULT_FILTER}>All Vendors</option>
                {(Array.isArray(filters.vendor_options) ? filters.vendor_options : []).map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label mb-1">Approval Status</label>
              <select
                className="form-select"
                value={draftStatusFilter}
                onChange={(event) => setDraftStatusFilter(event.target.value)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-lg-3 col-md-12 d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={clearFilters}
                disabled={loading}
              >
                Clear
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? "Loading..." : "Apply"}
              </button>
            </div>
          </form>
        </div>

        <div className="row g-3 mb-3">
          <SummaryCard label="Not Set" value={summary.not_set ?? 0} />
          <SummaryCard label="Created" value={summary.created ?? 0} />
          <SummaryCard label="Checked" value={summary.checked ?? 0} />
          <SummaryCard label="Approved" value={summary.approved ?? 0} />
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5">Loading Product Database...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-5 text-secondary">
                No Product Database records found.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>Item Code</th>
                      <th>Image</th>
                      <th>Name / Description</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Product Sizes</th>
                      <th>Box Sizes</th>
                      <th>Status</th>
                      <th>Audit</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="fw-semibold">{row.code || "N/A"}</td>
                        <td>
                          <ProductImageThumbnail
                            src={row.product_image_url}
                            originalName={row.product_image?.originalName}
                            alt={`${row.code || "Item"} product image`}
                            size="sm"
                          />
                        </td>
                        <td>
                          <div>{row.name || "N/A"}</div>
                          <div className="small text-secondary">{row.description || "N/A"}</div>
                        </td>
                        <td>{row.brand_name || row.brand || row.brands?.join(", ") || "N/A"}</td>
                        <td>{Array.isArray(row.vendors) && row.vendors.length > 0 ? row.vendors.join(", ") : "N/A"}</td>
                        <td><SizeSummary entries={getDisplayItemSizes(row)} type="item" /></td>
                        <td>
                          <div className="small text-secondary mb-1">
                            Mode: {formatBoxMode(getDisplayBoxMode(row))}
                          </div>
                          <SizeSummary entries={getDisplayBoxSizes(row)} type="box" />
                        </td>
                        <td>
                          <span className={`badge ${getStatusBadgeClass(row.pd_checked)}`}>
                            {getStatusLabel(row.pd_checked)}
                          </span>
                        </td>
                        <td>
                          <div className="small">
                            <div>Created: {formatActor(row.pd_created_by, "created_at")}</div>
                            <div>Checked: {formatActor(row.pd_checked_by, "checked_at")}</div>
                            <div>Approved: {formatActor(row.pd_approved_by, "approved_at")}</div>
                            <div>Changed: {formatActor(row.pd_last_changed_by, "changed_at")}</div>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            onClick={() => setSelectedItem(row)}
                          >
                            {row?.permissions?.can_edit ? "Edit / Review" : "View"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mt-3">
          <div className="input-group om-limit-control">
            <span className="input-group-text">Limit</span>
            <select
              className="form-select"
              value={limit}
              onChange={(event) => {
                setPage(1);
                setLimit(Number(event.target.value));
              }}
            >
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="d-flex justify-content-center align-items-center gap-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={(pagination.page ?? 1) <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Prev
            </button>
            <span className="small fw-semibold">
              Page {pagination.page ?? 1} of {pagination.totalPages ?? 1}
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={(pagination.page ?? 1) >= (pagination.totalPages ?? 1) || loading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedItem && (
        <ProductDatabaseModal
          item={selectedItem}
          draft={selectedDraft}
          onClose={() => setSelectedItem(null)}
          onSaved={handleSaved}
          onSaveDraft={handleDraftSaved}
        />
      )}
    </>
  );
};

export default ProductDatabase;
