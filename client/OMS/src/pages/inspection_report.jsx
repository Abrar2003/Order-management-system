import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Barcode from "react-barcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import FilePreviewModal from "../components/FilePreviewModal";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getStoredItemFileUrl,
  hasStoredItemFile,
  ITEM_FILE_OPTIONS as ITEM_MASTER_FILE_OPTIONS,
  shouldOpenFilePreviewExternally,
} from "../constants/itemFiles";
import { toEan13BarcodeValue } from "../utils/barcode";
import { formatDateDDMMYYYY } from "../utils/date";
import { getDerivedOrderStatus } from "../utils/orderStatus";
import { formatPositiveCbm } from "../utils/cbm";
import { formatFixedNumber, formatLbhValue } from "../utils/measurementDisplay";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import "../App.css";

const SIZE_UNIT = "cm";
const WEIGHT_UNIT = "kg";
const MEASUREMENT_ENTRY_DISPLAY_LIMIT = 4;
const normalizeBarcodeDigits = (value) => String(value ?? "").replace(/\D/g, "");
const isDefaultBarcodeDigits = (value) => {
  const digits = normalizeBarcodeDigits(value);
  return digits.length > 0 && /^0+$/.test(digits);
};
const formatStoredBarcodeDisplay = (value, fallback = "Not Set") => {
  const normalized = String(value ?? "").trim();
  if (!normalized || isDefaultBarcodeDigits(normalized)) return fallback;
  return normalized;
};
const getBarcodeRenderProps = (value) => {
  const displayValue = formatStoredBarcodeDisplay(value, "");
  if (!displayValue) return null;
  const eanValue = toEan13BarcodeValue(displayValue);
  if (eanValue && eanValue === normalizeBarcodeDigits(displayValue)) {
    return { value: eanValue, format: "EAN13" };
  }
  return { value: displayValue, format: "CODE128" };
};

const toTimestamp = (value) => {
  if (!value) return 0;
  const asString = String(value).trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const [day, month, year] = asString.split(/[/-]/).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getInspectionRecordSortTime = (record = {}) =>
  toTimestamp(record?.inspection_date) ||
  toTimestamp(record?.createdAt) ||
  toTimestamp(record?.requested_date) ||
  0;

const formatDisplayLbhValue = (value) =>
  formatLbhValue(value, { fallback: "Not Set", suffix: SIZE_UNIT });

const ITEM_INDEXED_REMARKS = ["top", "base", "item", "item1", "item2", "item3", "item4"];
const BOX_INDEXED_REMARKS = ["top", "base", "box", "inner", "master", "box1", "box2", "box3", "box4"];

const formatMeasurementRemark = (remark = "") => {
  const normalized = String(remark || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const buildMeasurementEntryKey = (entry = {}, index = 0) => {
  const normalizedRemark = String(entry?.remark || "").trim().toLowerCase();
  return normalizedRemark || `entry${index + 1}`;
};

const sortMeasurementEntries = (entries = [], remarkOrder = []) =>
  [...entries].sort((left, right) => {
    const leftKey = buildMeasurementEntryKey(left);
    const rightKey = buildMeasurementEntryKey(right);
    const safeOrder = Array.isArray(remarkOrder) ? remarkOrder : [];
    const leftIndex = safeOrder.indexOf(leftKey);
    const rightIndex = safeOrder.indexOf(rightKey);
    const safeLeftIndex = leftIndex >= 0 ? leftIndex : safeOrder.length + 1;
    const safeRightIndex = rightIndex >= 0 ? rightIndex : safeOrder.length + 1;
    if (safeLeftIndex !== safeRightIndex) {
      return safeLeftIndex - safeRightIndex;
    }
    return leftKey.localeCompare(rightKey);
  });

const hasIndexedMeasurementEntries = (entries = [], indexedRemarks = []) =>
  entries.some((entry) =>
    (Array.isArray(indexedRemarks) ? indexedRemarks : []).includes(
      String(entry?.remark || "").trim().toLowerCase(),
    ));

const hasMeasurementEntryData = (entry = {}) =>
  hasAnyPositiveLbh(entry) ||
  toPositiveWeightOrNull(entry?.net_weight) !== null ||
  toPositiveWeightOrNull(entry?.gross_weight) !== null;

const hasMeasurementEntriesData = (entries = []) =>
  Array.isArray(entries) && entries.some((entry) => hasMeasurementEntryData(entry));

const toPositiveWeightOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const hasAnyPositiveLbh = (value = {}) => {
  const length = Number(value?.L || 0);
  const breadth = Number(value?.B || 0);
  const height = Number(value?.H || 0);
  return (
    (Number.isFinite(length) && length > 0)
    || (Number.isFinite(breadth) && breadth > 0)
    || (Number.isFinite(height) && height > 0)
  );
};

const pickDisplayableLbh = (...values) =>
  values.find((value) => hasAnyPositiveLbh(value)) || null;

const formatStructuredLbhValue = ({
  top = null,
  bottom = null,
  single = null,
  fallback = null,
  topLabel = "Top",
  bottomLabel = "Base",
} = {}) => {
  const resolvedTop = pickDisplayableLbh(top);
  const resolvedBottom = pickDisplayableLbh(bottom);
  const resolvedSingle = pickDisplayableLbh(single, fallback);

  if (resolvedTop || resolvedBottom) {
    return {
      mode: "split",
      top: resolvedTop,
      bottom: resolvedBottom,
      topLabel,
      bottomLabel,
      display: [
        resolvedTop ? `${topLabel}: ${formatDisplayLbhValue(resolvedTop)}` : "",
        resolvedBottom ? `${bottomLabel}: ${formatDisplayLbhValue(resolvedBottom)}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    };
  }

  return {
    mode: "single",
    value: resolvedSingle,
    display: formatDisplayLbhValue(resolvedSingle || {}),
  };
};

const toDisplayValue = (value, fallback = "N/A") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const toFilenameSegment = (value, fallback = "unknown") => {
  const normalized = String(value ?? "").trim();
  return (normalized || fallback).replace(/[^a-zA-Z0-9_-]+/g, "_");
};

const toOptionalArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.rows)) return value.rows;
    if (Array.isArray(value.items)) return value.items;
    return [value];
  }
  return [];
};

const getFinishImageUrl = (entry = {}) =>
  String(
    entry?.image?.url
      || entry?.image?.link
      || entry?.imageUrl
      || entry?.image_url
      || "",
  ).trim();

const hasFinishContent = (entry = {}) =>
  [
    entry?.finish_id,
    entry?._id,
    entry?.unique_code,
    entry?.uniqueCode,
    entry?.vendor,
    entry?.vendor_code,
    entry?.vendorCode,
    entry?.color,
    entry?.color_code,
    entry?.colorCode,
    getFinishImageUrl(entry),
  ].some((value) => String(value ?? "").trim());

const getWeightValue = (weight = {}, key = "") => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return 0;

  const legacyFallbackByKey = {
    total_net: "net",
    total_gross: "gross",
  };
  const rawValue =
    weight?.[normalizedKey]
    ?? (legacyFallbackByKey[normalizedKey] ? weight?.[legacyFallbackByKey[normalizedKey]] : undefined)
    ?? 0;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasPositiveWeightValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const pickFiniteWeightValue = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const formatWeightValue = (value, fallback = "Not Set") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const formatted = formatFixedNumber(parsed);
  return `${formatted} ${WEIGHT_UNIT}`;
};

const formatStructuredWeightValue = ({
  top = null,
  bottom = null,
  single = null,
  fallback = null,
  topLabel = "Top",
  bottomLabel = "Base",
} = {}) => {
  const resolvedTop = hasPositiveWeightValue(top) ? Number(top) : null;
  const resolvedBottom = hasPositiveWeightValue(bottom) ? Number(bottom) : null;
  const resolvedSingle = pickFiniteWeightValue(single, fallback);

  if (resolvedTop !== null || resolvedBottom !== null) {
    return {
      mode: "split",
      top: resolvedTop,
      bottom: resolvedBottom,
      topLabel,
      bottomLabel,
      display: [
        resolvedTop !== null ? `${topLabel}: ${formatWeightValue(resolvedTop)}` : "",
        resolvedBottom !== null ? `${bottomLabel}: ${formatWeightValue(resolvedBottom)}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    };
  }

  return {
    mode: "single",
    value: resolvedSingle,
    display: formatWeightValue(resolvedSingle, "Not Set"),
  };
};
const normalizeMeasurementEntries = (
  entries = [],
  weightKey = "",
  remarkOrder = [],
) =>
  sortMeasurementEntries(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const L = Number(entry?.L || 0);
        const B = Number(entry?.B || 0);
        const H = Number(entry?.H || 0);
        const weight = Number(weightKey ? entry?.[weightKey] : 0);
        return {
          remark: String(entry?.remark || entry?.type || "").trim().toLowerCase(),
          L: Number.isFinite(L) ? L : 0,
          B: Number.isFinite(B) ? B : 0,
          H: Number.isFinite(H) ? H : 0,
          weight: Number.isFinite(weight) ? weight : 0,
        };
      })
      .filter((entry) => entry.L > 0 && entry.B > 0 && entry.H > 0)
      .slice(0, MEASUREMENT_ENTRY_DISPLAY_LIMIT),
    remarkOrder,
  );

const toLegacyMeasurementEntry = (remark = "", value = null) => {
  if (!hasAnyPositiveLbh(value || {})) return null;
  return {
    remark,
    L: Number(value?.L || 0),
    B: Number(value?.B || 0),
    H: Number(value?.H || 0),
    weight: 0,
  };
};

const buildLegacyLbhEntries = ({
  top = null,
  bottom = null,
  single = null,
  fallback = null,
  singleRemark = "item",
  remarkOrder = [],
} = {}) =>
  sortMeasurementEntries(
    [
      toLegacyMeasurementEntry("top", top),
      toLegacyMeasurementEntry("base", bottom),
      toLegacyMeasurementEntry(singleRemark, pickDisplayableLbh(single, fallback)),
    ].filter(Boolean),
    remarkOrder,
  ).slice(0, MEASUREMENT_ENTRY_DISPLAY_LIMIT);

const toMeasurementRowEntry = (entry = {}, index = 0, value, display = "") => ({
  key: buildMeasurementEntryKey(entry, index),
  label: formatMeasurementRemark(entry?.remark) || `Entry ${index + 1}`,
  value,
  display,
});

const toStructuredLbhFromEntries = (
  entries = [],
  fallback = null,
  { indexedRemarks = [] } = {},
) => {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (normalizedEntries.length === 0) {
    return formatStructuredLbhValue({ single: fallback, fallback });
  }
  if (normalizedEntries.length > 1 || hasIndexedMeasurementEntries(normalizedEntries, indexedRemarks)) {
    return {
      mode: "indexed",
      entries: normalizedEntries.map((entry, index) =>
        toMeasurementRowEntry(
          entry,
          index,
          { L: entry.L, B: entry.B, H: entry.H },
          formatDisplayLbhValue(entry),
        )),
    };
  }
  if (normalizedEntries.length === 1) {
    const [firstEntry] = normalizedEntries;
    if (firstEntry?.remark === "top" || firstEntry?.remark === "base") {
      return formatStructuredLbhValue({
        top: firstEntry?.remark === "top" ? firstEntry : null,
        bottom: firstEntry?.remark === "base" ? firstEntry : null,
        topLabel: "Top",
        bottomLabel: "Base",
      });
    }
    return formatStructuredLbhValue({ single: firstEntry });
  }
  const [firstEntry, secondEntry] = normalizedEntries;
  return formatStructuredLbhValue({
    top: firstEntry,
    bottom: secondEntry,
    topLabel: formatMeasurementRemark(firstEntry?.remark) || "Top",
    bottomLabel: formatMeasurementRemark(secondEntry?.remark) || "Base",
  });
};
const toStructuredWeightFromEntries = (
  entries = [],
  fallback = null,
  { indexedRemarks = [] } = {},
) => {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (normalizedEntries.length === 0) {
    return formatStructuredWeightValue({ single: fallback, fallback });
  }
  if (normalizedEntries.length > 1 || hasIndexedMeasurementEntries(normalizedEntries, indexedRemarks)) {
    const indexedEntries = normalizedEntries.map((entry, index) =>
      toMeasurementRowEntry(
        entry,
        index,
        toPositiveWeightOrNull(entry?.weight),
        formatWeightValue(toPositiveWeightOrNull(entry?.weight), "Not Set"),
      ));
    return {
      mode: "indexed",
      entries: indexedEntries,
      display: indexedEntries
        .map((entry) => `${entry.label}: ${entry.display}`)
        .join(" | "),
    };
  }
  if (normalizedEntries.length === 1) {
    const [firstEntry] = normalizedEntries;
    const firstWeight = toPositiveWeightOrNull(firstEntry?.weight);
    if (firstEntry?.remark === "top" || firstEntry?.remark === "base") {
      return formatStructuredWeightValue({
        top: firstEntry?.remark === "top" ? firstWeight : null,
        bottom: firstEntry?.remark === "base" ? firstWeight : null,
        topLabel: "Top",
        bottomLabel: "Base",
      });
    }
    return formatStructuredWeightValue({ single: firstWeight });
  }
  const [firstEntry, secondEntry] = normalizedEntries;
  return formatStructuredWeightValue({
    top: toPositiveWeightOrNull(firstEntry?.weight),
    bottom: toPositiveWeightOrNull(secondEntry?.weight),
    topLabel: formatMeasurementRemark(firstEntry?.remark) || "Top",
    bottomLabel: formatMeasurementRemark(secondEntry?.remark) || "Base",
  });
};

const buildMeasurementComparisonRows = ({
  attribute = "",
  comparisonType = "",
  pisMeta = null,
  checkedMeta = null,
  indexedRemarkOrder = [],
} = {}) => {
  const normalizedAttribute = String(attribute || "").trim();
  if (!normalizedAttribute) return [];

  const pisEntries = Array.isArray(pisMeta?.entries) ? pisMeta.entries : [];
  const checkedEntries = Array.isArray(checkedMeta?.entries) ? checkedMeta.entries : [];
  const hasIndexedRows =
    pisMeta?.mode === "indexed" || checkedMeta?.mode === "indexed";

  if (hasIndexedRows && comparisonType === "weight") {
    return [
      {
        key: normalizedAttribute,
        attribute: normalizedAttribute,
        pis: pisMeta?.display || "Not Set",
        checked: checkedMeta?.display || "Not Set",
        comparison_type: comparisonType,
        pis_meta: pisMeta,
        checked_meta: checkedMeta,
      },
    ];
  }

  if (!hasIndexedRows) {
    return [
      {
        key: normalizedAttribute,
        attribute: normalizedAttribute,
        pis: pisMeta?.display || "Not Set",
        checked: checkedMeta?.display || "Not Set",
        comparison_type: comparisonType,
        pis_meta: pisMeta,
        checked_meta: checkedMeta,
      },
    ];
  }

  const pisEntryMap = new Map(pisEntries.map((entry) => [entry.key, entry]));
  const checkedEntryMap = new Map(
    checkedEntries.map((entry) => [entry.key, entry]),
  );
  const preferredOrder =
    Array.isArray(indexedRemarkOrder) && indexedRemarkOrder.length > 0
      ? indexedRemarkOrder
      : [...new Set([...pisEntries.map((entry) => entry.key), ...checkedEntries.map((entry) => entry.key)])];
  const trailingKeys = [
    ...new Set([
      ...pisEntries.map((entry) => entry.key),
      ...checkedEntries.map((entry) => entry.key),
    ]),
  ].filter((key) => !preferredOrder.includes(key));
  const orderedKeys = [...preferredOrder, ...trailingKeys];

  const expandedRows = orderedKeys
    .filter((key) => pisEntryMap.has(key) || checkedEntryMap.has(key))
    .map((key, index) => {
      const pisEntry = pisEntryMap.get(key) || null;
      const checkedEntry = checkedEntryMap.get(key) || null;
      const label =
        pisEntry?.label
        || checkedEntry?.label
        || formatMeasurementRemark(key)
        || `Entry ${index + 1}`;
      return {
        key: `${normalizedAttribute}-${key}`,
        attribute: `${normalizedAttribute} - ${label}`,
        pis: pisEntry?.display || "Not Set",
        checked: checkedEntry?.display || "Not Set",
        comparison_type: comparisonType,
        pis_meta:
          comparisonType === "lbh"
            ? { mode: "single", value: pisEntry?.value || null }
            : { mode: "single", value: pisEntry?.value ?? null },
        checked_meta:
          comparisonType === "lbh"
            ? { mode: "single", value: checkedEntry?.value || null }
            : { mode: "single", value: checkedEntry?.value ?? null },
      };
    });

  return expandedRows.length > 0
    ? expandedRows
    : [
        {
          key: normalizedAttribute,
          attribute: normalizedAttribute,
          pis: pisMeta?.display || "Not Set",
          checked: checkedMeta?.display || "Not Set",
          comparison_type: comparisonType,
          pis_meta: pisMeta,
          checked_meta: checkedMeta,
        },
      ];
};

const getBrandKey = (value) => String(value || "").trim().toLowerCase();

const toBrandLogoDataUrl = (logoObj) => {
  if (typeof logoObj?.url === "string" && logoObj.url.trim()) {
    return logoObj.url.trim();
  }

  const raw = logoObj?.data?.data || logoObj?.data;
  if (!Array.isArray(raw) || raw.length === 0) return "";

  let binary = "";
  raw.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return `data:${logoObj?.contentType || "image/webp"};base64,${window.btoa(binary)}`;
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    if (!(blob instanceof Blob)) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read image blob"));
    reader.readAsDataURL(blob);
  });

const waitForImageLoad = (image) =>
  new Promise((resolve) => {
    if (!image || image.complete) {
      resolve();
      return;
    }

    const handleDone = () => resolve();
    image.addEventListener("load", handleDone, { once: true });
    image.addEventListener("error", handleDone, { once: true });
  });

const waitForImagesToLoad = async (container) => {
  if (!container) return;
  const images = Array.from(container.querySelectorAll("img"));
  await Promise.all(images.map((image) => waitForImageLoad(image)));
};

const fetchRemoteImageAsDataUrl = async (url) => {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return "";

  // Handle relative API URLs by constructing proper URL
  let finalUrl = normalizedUrl;
  if (normalizedUrl.startsWith("/finishes/")) {
    // For API relative URLs like /finishes/public/image, construct full URL
    const apiBase = import.meta.env.VITE_API_BASE_URL || "";
    if (apiBase && !normalizedUrl.startsWith(apiBase)) {
      finalUrl = apiBase + normalizedUrl;
    }
  }

  try {
    const response = await fetch(finalUrl, { 
      mode: "cors",
      credentials: "omit"
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    return blobToDataUrl(await response.blob());
  } catch (error) {
    // If fetch fails, rethrow to allow calling code to handle gracefully
    throw error;
  }
};

const toComparableValue = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const formatDifferenceNumber = (value) => {
  const numeric = Math.abs(Number(value));
  if (!Number.isFinite(numeric)) return "0.00";
  return formatFixedNumber(numeric);
};

const collectLbhDifferenceLogs = ({
  attribute = "",
  pisMeta = null,
  checkedMeta = null,
} = {}) => {
  const logs = [];
  const dimensionNames = {
    L: "length",
    B: "breadth",
    H: "height",
  };

  const compareLbhSegment = (segmentLabel, pisLbh, checkedLbh) => {
    const hasPis = hasAnyPositiveLbh(pisLbh || {});
    const hasChecked = hasAnyPositiveLbh(checkedLbh || {});
    if (!hasPis && !hasChecked) return;

    const labelPrefix = segmentLabel ? `${attribute} ${segmentLabel}` : attribute;

    if (!hasPis && hasChecked) {
      logs.push(
        `For ${labelPrefix}, inspected value is ${formatDisplayLbhValue(checkedLbh)} while PIS value is not set.`,
      );
      return;
    }

    if (hasPis && !hasChecked) {
      logs.push(
        `For ${labelPrefix}, PIS value is ${formatDisplayLbhValue(pisLbh)} while inspected value is not set.`,
      );
      return;
    }

    ["L", "B", "H"].forEach((axis) => {
      const pisAxisValue = Number(pisLbh?.[axis] || 0);
      const checkedAxisValue = Number(checkedLbh?.[axis] || 0);
      const delta = checkedAxisValue - pisAxisValue;
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return;

      const direction = delta > 0 ? "greater" : "smaller";
      logs.push(
        `For ${labelPrefix}, inspected ${dimensionNames[axis]} is ${formatDifferenceNumber(delta)} ${SIZE_UNIT} ${direction} than PIS size.`,
      );
    });
  };

  if (pisMeta?.mode === "split" || checkedMeta?.mode === "split") {
    compareLbhSegment(pisMeta?.topLabel || checkedMeta?.topLabel || "Top", pisMeta?.top, checkedMeta?.top);
    compareLbhSegment(pisMeta?.bottomLabel || checkedMeta?.bottomLabel || "Base", pisMeta?.bottom, checkedMeta?.bottom);
    return logs;
  }

  compareLbhSegment("", pisMeta?.value, checkedMeta?.value);
  return logs;
};

const collectWeightDifferenceLogs = ({
  attribute = "",
  pisMeta = null,
  checkedMeta = null,
} = {}) => {
  const logs = [];

  const compareWeightSegment = (segmentLabel, pisWeight, checkedWeight) => {
    const hasPis = pisWeight !== null && pisWeight !== undefined;
    const hasChecked = checkedWeight !== null && checkedWeight !== undefined;
    if (!hasPis && !hasChecked) return;

    const labelPrefix = segmentLabel ? `${attribute} ${segmentLabel}` : attribute;

    if (!hasPis && hasChecked) {
      logs.push(
        `For ${labelPrefix}, inspected value is ${formatWeightValue(checkedWeight)} while PIS value is not set.`,
      );
      return;
    }

    if (hasPis && !hasChecked) {
      logs.push(
        `For ${labelPrefix}, PIS value is ${formatWeightValue(pisWeight)} while inspected value is not set.`,
      );
      return;
    }

    const delta = Number(checkedWeight) - Number(pisWeight);
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.0001) return;

    const direction = delta > 0 ? "greater" : "smaller";
    logs.push(
      `For ${labelPrefix}, inspected value is ${formatDifferenceNumber(delta)} ${WEIGHT_UNIT} ${direction} than PIS weight.`,
    );
  };

  if (pisMeta?.mode === "indexed" || checkedMeta?.mode === "indexed") {
    const pisEntries = Array.isArray(pisMeta?.entries) ? pisMeta.entries : [];
    const checkedEntries = Array.isArray(checkedMeta?.entries) ? checkedMeta.entries : [];
    const pisEntryMap = new Map(pisEntries.map((entry) => [entry.key, entry]));
    const checkedEntryMap = new Map(
      checkedEntries.map((entry) => [entry.key, entry]),
    );
    const orderedKeys = [
      ...new Set([
        ...pisEntries.map((entry) => entry.key),
        ...checkedEntries.map((entry) => entry.key),
      ]),
    ];

    orderedKeys.forEach((key, index) => {
      const pisEntry = pisEntryMap.get(key) || null;
      const checkedEntry = checkedEntryMap.get(key) || null;
      const label =
        pisEntry?.label
        || checkedEntry?.label
        || formatMeasurementRemark(key)
        || `Entry ${index + 1}`;
      compareWeightSegment(label, pisEntry?.value, checkedEntry?.value);
    });

    return logs;
  }

  if (pisMeta?.mode === "split" || checkedMeta?.mode === "split") {
    compareWeightSegment(pisMeta?.topLabel || checkedMeta?.topLabel || "Top", pisMeta?.top, checkedMeta?.top);
    compareWeightSegment(pisMeta?.bottomLabel || checkedMeta?.bottomLabel || "Base", pisMeta?.bottom, checkedMeta?.bottom);
    return logs;
  }

  compareWeightSegment("", pisMeta?.value, checkedMeta?.value);
  return logs;
};

const InspectionReport = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const reportRef = useRef(null);
  const searchParams = useMemo(
    () => new URLSearchParams(location.search || ""),
    [location.search],
  );
  const selectedInspectionRecordId = String(
    searchParams.get("inspection_record_id") || "",
  ).trim();

  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [brandLogoSrc, setBrandLogoSrc] = useState("");
  const [brandLogoLoading, setBrandLogoLoading] = useState(false);
  const [productImageSrc, setProductImageSrc] = useState("");
  const [productImageLoading, setProductImageLoading] = useState(false);
  const [finishImageSrc, setFinishImageSrc] = useState("");
  const [finishImageLoading, setFinishImageLoading] = useState(false);
  const [finishImageError, setFinishImageError] = useState(false);
  const [finishSortBy, setFinishSortBy] = useState("uniqueCode");
  const [finishSortOrder, setFinishSortOrder] = useState("asc");
  const [inspectionSortBy, setInspectionSortBy] = useState("inspectionDate");
  const [inspectionSortOrder, setInspectionSortOrder] = useState("desc");
  const [remarkSortBy, setRemarkSortBy] = useState("inspectionDate");
  const [remarkSortOrder, setRemarkSortOrder] = useState("desc");
  const [previewFile, setPreviewFile] = useState(null);

  const selectedInspectionRecord = useMemo(() => {
    if (!selectedInspectionRecordId) return null;
    const sourceRows = Array.isArray(qc?.inspection_record) ? qc.inspection_record : [];
    return sourceRows.find(
      (record) => String(record?._id || "").trim() === selectedInspectionRecordId,
    ) || null;
  }, [qc?.inspection_record, selectedInspectionRecordId]);
  const selectedInspectionRecordMissing = Boolean(
    selectedInspectionRecordId && qc && !selectedInspectionRecord,
  );
  const isSingleInspectionReport = Boolean(selectedInspectionRecord);
  const reportInspectionRecords = useMemo(() => {
    if (selectedInspectionRecord) return [selectedInspectionRecord];
    return Array.isArray(qc?.inspection_record) ? qc.inspection_record : [];
  }, [qc?.inspection_record, selectedInspectionRecord]);
  const reportContextLabel = isSingleInspectionReport
    ? "Inspection Record Report"
    : "Inspection Report";
  const reportContextDetails = selectedInspectionRecord
    ? [
        formatDateDDMMYYYY(
          selectedInspectionRecord?.inspection_date || selectedInspectionRecord?.createdAt,
        ),
        toDisplayValue(selectedInspectionRecord?.inspector?.name, ""),
      ]
        .filter((value) => value && value !== "N/A")
        .join(" | ")
    : "";

  const backTarget = useMemo(() => {
    const fromPreviousPage = String(location.state?.fromPreviousPage || "").trim();
    if (fromPreviousPage.startsWith("/items") || fromPreviousPage.startsWith("/qc/")) {
      return fromPreviousPage;
    }
    const fromQcDetails = String(location.state?.fromQcDetails || "").trim();
    if (fromQcDetails.startsWith("/qc/")) {
      return fromQcDetails;
    }
    return `/qc/${encodeURIComponent(id)}`;
  }, [id, location.state]);

  const orderInfo = useMemo(() => {
    const orderQuantity = Number(qc?.order?.quantity ?? qc?.quantities?.client_demand ?? 0);
    const derivedOrderStatus = getDerivedOrderStatus({
      order: qc?.order || {},
      qc,
    });
    return {
      orderId: toDisplayValue(qc?.order?.order_id),
      brand: toDisplayValue(qc?.order?.brand),
      vendor: toDisplayValue(qc?.order?.vendor),
      requestDate: formatDateDDMMYYYY(qc?.request_date),
      requestType: toDisplayValue(qc?.request_type, "N/A"),
      orderQuantity: Number.isFinite(orderQuantity) ? String(orderQuantity) : "0",
      status: toDisplayValue(derivedOrderStatus),
      itemCode: toDisplayValue(qc?.item?.item_code),
      itemDescription: toDisplayValue(qc?.item?.description),
    };
  }, [qc]);

  const productImageUrl = useMemo(
    () =>
      String(
        qc?.item_master?.image?.url || qc?.item_master?.image?.link || "",
      ).trim(),
    [qc?.item_master?.image?.link, qc?.item_master?.image?.url],
  );

  const itemMasterFiles = useMemo(
    () =>
      ITEM_MASTER_FILE_OPTIONS.map((option) => ({
        ...option,
        file: qc?.item_master?.[option.field] || null,
      })),
    [qc?.item_master],
  );

  const uploadedItemMasterFiles = useMemo(
    () => itemMasterFiles.filter((entry) => hasStoredItemFile(entry.file)),
    [itemMasterFiles],
  );

  const handlePreviewItemMasterFile = useCallback((entry = {}) => {
    const fileUrl = getStoredItemFileUrl(entry.file);
    if (!fileUrl) return;

    if (shouldOpenFilePreviewExternally(entry.previewMode || "pdf")) {
      window.open(fileUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setPreviewFile({
      title: entry.label || "Item File",
      url: fileUrl,
      originalName: String(entry?.file?.originalName || "").trim(),
      previewMode: entry.previewMode || "pdf",
    });
  }, []);

  const inspectionRows = useMemo(() => {
    const sourceRows = reportInspectionRecords;

    return sourceRows
      .map((record, index) => ({
        key: String(record?._id || `inspection-${index}`),
        requestDate: record?.requested_date || qc?.request_date || "",
        inspectionDate: record?.inspection_date || record?.createdAt || "",
        inspectorName: toDisplayValue(record?.inspector?.name, "N/A"),
        requestedQty: Number(record?.vendor_requested ?? 0),
        offeredQty: Number(record?.vendor_offered ?? 0),
        inspectedQty: Number(record?.checked ?? 0),
        passedQty: Number(record?.passed ?? 0),
        pendingAfter: Number(record?.pending_after ?? 0),
        remarks: toDisplayValue(record?.remarks, "None"),
        sortTime: getInspectionRecordSortTime(record),
      }))
      .sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));
  }, [qc?.request_date, reportInspectionRecords]);

  const latestInspectionRecord = useMemo(() => {
    const sourceRows = reportInspectionRecords;

    return sourceRows.reduce((latest, record) => {
      if (!latest) return record;

      const latestSortTime = getInspectionRecordSortTime(latest);
      const recordSortTime = getInspectionRecordSortTime(record);
      if (recordSortTime !== latestSortTime) {
        return recordSortTime > latestSortTime ? record : latest;
      }

      const latestCreatedTime = toTimestamp(latest?.createdAt);
      const recordCreatedTime = toTimestamp(record?.createdAt);
      return recordCreatedTime > latestCreatedTime ? record : latest;
    }, null);
  }, [reportInspectionRecords]);

  const inspectionRemarkRows = useMemo(
    () =>
      inspectionRows.filter((row) => {
        const remark = String(row?.remarks || "").trim();
        return remark && remark.toLowerCase() !== "none";
      }),
    [inspectionRows],
  );

  const finishRows = useMemo(() => {
    const finishRowsByKey = new Map();

    toOptionalArray(qc?.item_master?.finish).forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || !hasFinishContent(entry)) {
        return;
      }

      const finishId = String(entry?.finish_id || entry?._id || "").trim();
      const uniqueCodeValue = String(
        entry?.unique_code || entry?.uniqueCode || "",
      ).trim();
      const vendorValue = String(entry?.vendor || "").trim();
      const vendorCodeValue = String(
        entry?.vendor_code || entry?.vendorCode || "",
      ).trim();
      const colorValue = String(entry?.color || "").trim();
      const colorCodeValue = String(
        entry?.color_code || entry?.colorCode || "",
      ).trim();
      const imageUrl = getFinishImageUrl(entry);
      const identityKey =
        [
          finishId,
          uniqueCodeValue.toUpperCase(),
          vendorCodeValue.toUpperCase(),
          colorCodeValue.toUpperCase(),
        ]
          .filter(Boolean)
          .join("|")
        || [vendorValue.toLowerCase(), colorValue.toLowerCase()]
          .filter(Boolean)
          .join("|")
        || `finish-${index}`;
      const completenessScore = [
        finishId,
        uniqueCodeValue,
        vendorValue,
        vendorCodeValue,
        colorValue,
        colorCodeValue,
        imageUrl,
      ].filter(Boolean).length;
      const nextRow = {
        key: finishId || uniqueCodeValue || identityKey,
        finishId,
        uniqueCode: toDisplayValue(uniqueCodeValue),
        vendor: toDisplayValue(vendorValue),
        vendorCode: toDisplayValue(vendorCodeValue),
        color: toDisplayValue(colorValue),
        colorCode: toDisplayValue(colorCodeValue),
        imageUrl,
        hasImage: Boolean(imageUrl),
        sortLabel:
          uniqueCodeValue
          || vendorCodeValue
          || colorCodeValue
          || vendorValue
          || colorValue
          || finishId
          || `finish-${index}`,
        completenessScore,
      };
      const existingRow = finishRowsByKey.get(identityKey);

      if (
        !existingRow
        || nextRow.completenessScore > existingRow.completenessScore
      ) {
        finishRowsByKey.set(identityKey, nextRow);
      }
    });

    return Array.from(finishRowsByKey.values()).sort((left, right) =>
      left.sortLabel.localeCompare(right.sortLabel, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [qc?.item_master?.finish]);

  const handleFinishSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        finishSortBy,
        finishSortOrder,
        column,
        defaultDirection,
      );
      setFinishSortBy(nextSortState.sortBy);
      setFinishSortOrder(nextSortState.sortOrder);
    },
    [finishSortBy, finishSortOrder],
  );

  const sortedFinishRows = useMemo(
    () =>
      sortClientRows(finishRows, {
        sortBy: finishSortBy,
        sortOrder: finishSortOrder,
        getSortValue: (row, column) => {
          if (column === "uniqueCode") return row?.uniqueCode;
          if (column === "vendor") return row?.vendor;
          if (column === "vendorCode") return row?.vendorCode;
          if (column === "color") return row?.color;
          if (column === "colorCode") return row?.colorCode;
          return "";
        },
      }),
    [finishRows, finishSortBy, finishSortOrder],
  );

  const handleInspectionSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        inspectionSortBy,
        inspectionSortOrder,
        column,
        defaultDirection,
      );
      setInspectionSortBy(nextSortState.sortBy);
      setInspectionSortOrder(nextSortState.sortOrder);
    },
    [inspectionSortBy, inspectionSortOrder],
  );

  const sortedInspectionRows = useMemo(
    () =>
      sortClientRows(inspectionRows, {
        sortBy: inspectionSortBy,
        sortOrder: inspectionSortOrder,
        getSortValue: (row, column) => {
          if (column === "requestDate") return toTimestamp(row?.requestDate);
          if (column === "inspectionDate") return toTimestamp(row?.inspectionDate);
          if (column === "inspector") return row?.inspectorName;
          if (column === "requested") return Number(row?.requestedQty || 0);
          if (column === "offered") return Number(row?.offeredQty || 0);
          if (column === "inspected") return Number(row?.inspectedQty || 0);
          if (column === "passed") return Number(row?.passedQty || 0);
          if (column === "pending") return Number(row?.pendingAfter || 0);
          return "";
        },
      }),
    [inspectionRows, inspectionSortBy, inspectionSortOrder],
  );

  const handleRemarkSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        remarkSortBy,
        remarkSortOrder,
        column,
        defaultDirection,
      );
      setRemarkSortBy(nextSortState.sortBy);
      setRemarkSortOrder(nextSortState.sortOrder);
    },
    [remarkSortBy, remarkSortOrder],
  );

  const sortedInspectionRemarkRows = useMemo(
    () =>
      sortClientRows(inspectionRemarkRows, {
        sortBy: remarkSortBy,
        sortOrder: remarkSortOrder,
        getSortValue: (row, column) => {
          if (column === "inspectionDate") return toTimestamp(row?.inspectionDate);
          if (column === "inspector") return row?.inspectorName;
          if (column === "remark") return row?.remarks;
          return "";
        },
      }),
    [inspectionRemarkRows, remarkSortBy, remarkSortOrder],
  );

  const labelRanges = useMemo(() => {
    const ranges = [];
    const seen = new Set();
    const inspectionRecords = reportInspectionRecords;

    inspectionRecords.forEach((record) => {
      const recordRanges = Array.isArray(record?.label_ranges) ? record.label_ranges : [];
      recordRanges.forEach((range) => {
        const start = Number(range?.start);
        const end = Number(range?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        const normalizedStart = Math.min(start, end);
        const normalizedEnd = Math.max(start, end);
        const key = `${normalizedStart}-${normalizedEnd}`;
        if (seen.has(key)) return;
        seen.add(key);
        ranges.push({ start: normalizedStart, end: normalizedEnd });
      });
    });

    return ranges.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });
  }, [reportInspectionRecords]);

  const itemMasterSummary = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    const inspectedSource = latestInspectionRecord || null;
    const hasLatestInspectionRecord = Boolean(inspectedSource);
    const allowItemInspectedFallback = !isSingleInspectionReport;
    const latestInspectedItemSizes = hasMeasurementEntriesData(
      inspectedSource?.inspected_item_sizes,
    )
      ? inspectedSource.inspected_item_sizes
      : null;
    const latestInspectedBoxSizes = hasMeasurementEntriesData(
      inspectedSource?.inspected_box_sizes,
    )
      ? inspectedSource.inspected_box_sizes
      : null;
    const inspectedItemSizesSource =
      latestInspectedItemSizes ||
      (allowItemInspectedFallback ? itemMaster?.inspected_item_sizes : []);
    const inspectedBoxSizesSource =
      latestInspectedBoxSizes ||
      (allowItemInspectedFallback ? itemMaster?.inspected_box_sizes : []);
    const useLatestItemSizes = Boolean(latestInspectedItemSizes);
    const useLatestBoxSizes = Boolean(latestInspectedBoxSizes);
    const pisItemEntries = normalizeMeasurementEntries(
      itemMaster?.pis_item_sizes,
      "net_weight",
      ITEM_INDEXED_REMARKS,
    );
    const inspectedItemEntries = normalizeMeasurementEntries(
      inspectedItemSizesSource,
      "net_weight",
      ITEM_INDEXED_REMARKS,
    );
    const pisBoxEntries = normalizeMeasurementEntries(
      itemMaster?.pis_box_sizes,
      "gross_weight",
      BOX_INDEXED_REMARKS,
    );
    const inspectedBoxEntries = normalizeMeasurementEntries(
      inspectedBoxSizesSource,
      "gross_weight",
      BOX_INDEXED_REMARKS,
    );
    const inspectedItemLegacyEntries = useLatestItemSizes || !allowItemInspectedFallback
      ? []
      : buildLegacyLbhEntries({
          top: itemMaster?.inspected_item_top_LBH,
          bottom: itemMaster?.inspected_item_bottom_LBH,
          single: itemMaster?.inspected_item_LBH,
          fallback: itemMaster?.item_LBH,
          singleRemark: "item",
          remarkOrder: ITEM_INDEXED_REMARKS,
        });
    const inspectedBoxLegacyEntries = useLatestBoxSizes || !allowItemInspectedFallback
      ? []
      : buildLegacyLbhEntries({
          top:
            itemMaster?.inspected_box_top_LBH ||
            itemMaster?.inspected_top_LBH ||
            itemMaster?.inspected_item_top_LBH,
          bottom:
            itemMaster?.inspected_box_bottom_LBH ||
            itemMaster?.inspected_bottom_LBH ||
            itemMaster?.inspected_item_bottom_LBH,
          single:
            itemMaster?.inspected_box_LBH ||
            itemMaster?.inspected_item_LBH,
          fallback: itemMaster?.box_LBH || itemMaster?.item_LBH,
          singleRemark: "box",
          remarkOrder: BOX_INDEXED_REMARKS,
        });
    const inspectedItemLbhEntries =
      inspectedItemEntries.length > 0 ? inspectedItemEntries : inspectedItemLegacyEntries;
    const inspectedBoxLbhEntries =
      inspectedBoxEntries.length > 0 ? inspectedBoxEntries : inspectedBoxLegacyEntries;
    const pisProductLbh =
      pisItemEntries.length > 0
        ? toStructuredLbhFromEntries(pisItemEntries, null, {
            indexedRemarks: ITEM_INDEXED_REMARKS,
          })
        : formatStructuredLbhValue();
    const checkedProductLbh =
      inspectedItemLbhEntries.length > 0
        ? toStructuredLbhFromEntries(
            inspectedItemLbhEntries,
            useLatestItemSizes
              ? null
              : allowItemInspectedFallback
                ? itemMaster?.inspected_item_LBH || itemMaster?.item_LBH
                : null,
            { indexedRemarks: ITEM_INDEXED_REMARKS },
          )
        : formatStructuredLbhValue({
            top:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.inspected_item_top_LBH,
            bottom:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.inspected_item_bottom_LBH,
            single:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.inspected_item_LBH,
            fallback:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.item_LBH,
          });
    const pisPackedSize =
      pisBoxEntries.length > 0
        ? toStructuredLbhFromEntries(pisBoxEntries, null, {
            indexedRemarks: BOX_INDEXED_REMARKS,
          })
        : formatStructuredLbhValue();
    const inspectedTopLbh =
      useLatestBoxSizes || !allowItemInspectedFallback
        ? {}
        : itemMaster?.inspected_box_top_LBH
          || itemMaster?.inspected_top_LBH
          || itemMaster?.inspected_item_top_LBH
          || {};
    const inspectedBottomLbh =
      useLatestBoxSizes || !allowItemInspectedFallback
        ? {}
        : itemMaster?.inspected_box_bottom_LBH
          || itemMaster?.inspected_bottom_LBH
          || itemMaster?.inspected_item_bottom_LBH
          || {};
    const checkedPackedSize =
      inspectedBoxLbhEntries.length > 0
        ? toStructuredLbhFromEntries(
            inspectedBoxLbhEntries,
            useLatestBoxSizes
              ? null
              : allowItemInspectedFallback
                ? itemMaster?.inspected_box_LBH
                  || itemMaster?.inspected_item_LBH
                  || itemMaster?.box_LBH
                  || itemMaster?.item_LBH
                : null,
            { indexedRemarks: BOX_INDEXED_REMARKS },
          )
        : formatStructuredLbhValue({
            top: inspectedTopLbh,
            bottom: inspectedBottomLbh,
            single:
              useLatestBoxSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.inspected_box_LBH
                  || itemMaster?.inspected_item_LBH
                  || itemMaster?.box_LBH
                  || itemMaster?.item_LBH,
            fallback:
              useLatestBoxSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.box_LBH || itemMaster?.item_LBH,
          });
    const pisNetWeight =
      pisItemEntries.length > 0
        ? toStructuredWeightFromEntries(
            pisItemEntries,
            itemMaster?.weight?.net,
            { indexedRemarks: ITEM_INDEXED_REMARKS },
          )
        : formatStructuredWeightValue({
            top: getWeightValue(itemMaster?.pis_weight, "top_net"),
            bottom: getWeightValue(itemMaster?.pis_weight, "bottom_net"),
            single: getWeightValue(itemMaster?.pis_weight, "total_net"),
            fallback: itemMaster?.weight?.net,
          });
    const checkedNetWeight =
      inspectedItemEntries.length > 0
        ? toStructuredWeightFromEntries(
            inspectedItemEntries,
            useLatestItemSizes || !allowItemInspectedFallback ? null : itemMaster?.weight?.net,
            { indexedRemarks: ITEM_INDEXED_REMARKS },
          )
        : formatStructuredWeightValue({
            top:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : getWeightValue(itemMaster?.inspected_weight, "top_net"),
            bottom:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : getWeightValue(itemMaster?.inspected_weight, "bottom_net"),
            single:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : getWeightValue(itemMaster?.inspected_weight, "total_net"),
            fallback:
              useLatestItemSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.weight?.net,
          });
    const pisGrossWeight =
      pisBoxEntries.length > 0
        ? toStructuredWeightFromEntries(
            pisBoxEntries,
            itemMaster?.weight?.gross,
            { indexedRemarks: BOX_INDEXED_REMARKS },
          )
        : formatStructuredWeightValue({
            top: getWeightValue(itemMaster?.pis_weight, "top_gross"),
            bottom: getWeightValue(itemMaster?.pis_weight, "bottom_gross"),
            single: getWeightValue(itemMaster?.pis_weight, "total_gross"),
            fallback: itemMaster?.weight?.gross,
          });
    const checkedGrossWeight =
      inspectedBoxEntries.length > 0
        ? toStructuredWeightFromEntries(
            inspectedBoxEntries,
            useLatestBoxSizes || !allowItemInspectedFallback ? null : itemMaster?.weight?.gross,
            { indexedRemarks: BOX_INDEXED_REMARKS },
          )
        : formatStructuredWeightValue({
            top:
              useLatestBoxSizes || !allowItemInspectedFallback
                ? null
                : getWeightValue(itemMaster?.inspected_weight, "top_gross"),
            bottom:
              useLatestBoxSizes || !allowItemInspectedFallback
                ? null
                : getWeightValue(itemMaster?.inspected_weight, "bottom_gross"),
            single:
              useLatestBoxSizes || !allowItemInspectedFallback
                ? null
                : getWeightValue(itemMaster?.inspected_weight, "total_gross"),
            fallback:
              useLatestBoxSizes || !allowItemInspectedFallback
                ? null
                : itemMaster?.weight?.gross,
          });
    const calculatedInspectedCbmRaw =
      hasLatestInspectionRecord
        ? inspectedSource?.cbm?.total
        : itemMaster?.cbm?.calculated_inspected_total ??
          itemMaster?.cbm?.calculated_total ??
          itemMaster?.cbm?.qc_total ??
          qc?.cbm?.total ??
      "0";
    const calculatedPisCbmRaw =
      itemMaster?.cbm?.calculated_pis_total ??
      "0";
    const pisCbmTopRaw =
      itemMaster?.cbm?.top ??
      "0";
    const pisCbmBottomRaw =
      itemMaster?.cbm?.bottom ??
      "0";
    const checkedCbmTopRaw =
      hasLatestInspectionRecord
        ? inspectedSource?.cbm?.box1
        : itemMaster?.cbm?.inspected_top ??
          itemMaster?.cbm?.qc_top ??
          qc?.cbm?.box1 ??
          qc?.cbm?.top ??
      "0";
    const checkedCbmBottomRaw =
      hasLatestInspectionRecord
        ? inspectedSource?.cbm?.box2
        : itemMaster?.cbm?.inspected_bottom ??
          itemMaster?.cbm?.qc_bottom ??
          qc?.cbm?.box2 ??
          qc?.cbm?.bottom ??
      "0";
    const calculatedInspectedCbm = formatPositiveCbm(calculatedInspectedCbmRaw, "Not Set");
    const calculatedPisCbm = formatPositiveCbm(calculatedPisCbmRaw, "Not Set");
    const pisCbmTop = formatPositiveCbm(pisCbmTopRaw, "Not Set");
    const pisCbmBottom = formatPositiveCbm(pisCbmBottomRaw, "Not Set");
    const checkedCbmTop = formatPositiveCbm(checkedCbmTopRaw, "Not Set");
    const checkedCbmBottom = formatPositiveCbm(checkedCbmBottomRaw, "Not Set");
    const showCbmTop = pisCbmTop !== "Not Set" || checkedCbmTop !== "Not Set";
    const showCbmBottom = pisCbmBottom !== "Not Set" || checkedCbmBottom !== "Not Set";
    const inspectedTotalCbm = formatPositiveCbm(
      hasLatestInspectionRecord ? inspectedSource?.cbm?.total : itemMaster?.cbm?.inspected_total,
      "Not Set",
    );
    const baseTotalCbm = formatPositiveCbm(itemMaster?.cbm?.total, "Not Set");
    const checkedCbmTotal = calculatedInspectedCbm !== "Not Set"
      ? calculatedInspectedCbm
      : (
          inspectedTotalCbm !== "Not Set"
            ? inspectedTotalCbm
            : allowItemInspectedFallback
              ? baseTotalCbm
              : "Not Set"
        );
    const inspectedMasterBarcodeCandidate =
      inspectedSource?.master_barcode ||
      inspectedSource?.barcode ||
      (allowItemInspectedFallback
        ? itemMaster?.qc?.master_barcode ||
          itemMaster?.qc?.barcode ||
          qc?.master_barcode ||
          qc?.barcode
        : 0) ||
      0;
    const inspectedBarcodeRaw =
      Number(inspectedMasterBarcodeCandidate) > 0
        ? String(inspectedMasterBarcodeCandidate).trim()
        : "";
    const inspectedInnerBarcodeRaw =
      Number(
        inspectedSource?.inner_barcode ||
          (allowItemInspectedFallback
            ? itemMaster?.qc?.inner_barcode || qc?.inner_barcode
            : 0) ||
          0,
      ) > 0
        ? String(
            inspectedSource?.inner_barcode ||
              (allowItemInspectedFallback
                ? itemMaster?.qc?.inner_barcode || qc?.inner_barcode
                : ""),
          ).trim()
        : "";
    const pisBarcodeRaw = String(
      itemMaster?.pis_master_barcode
      || itemMaster?.pis_barcode
      || (
        Number(itemMaster?.qc?.master_barcode || itemMaster?.qc?.barcode || 0) > 0
          ? String(itemMaster?.qc?.master_barcode || itemMaster.qc.barcode).trim()
          : ""
      )
      || "",
    ).trim();
    const pisInnerBarcodeRaw = String(itemMaster?.pis_inner_barcode || "").trim();
    const pisBarcodeValue = formatStoredBarcodeDisplay(pisBarcodeRaw);
    const inspectedBarcodeValue = formatStoredBarcodeDisplay(inspectedBarcodeRaw);
    const barcodeMismatch =
      toComparableValue(pisBarcodeRaw || "Not Set") !==
      toComparableValue(inspectedBarcodeRaw || "Not Set");
    const unifiedBarcodeValue =
      pisBarcodeValue !== "Not Set" ? pisBarcodeValue : inspectedBarcodeValue;
    const pisBarcodeRenderProps = getBarcodeRenderProps(pisBarcodeRaw);
    const inspectedBarcodeRenderProps = getBarcodeRenderProps(inspectedBarcodeRaw);
    const unifiedBarcodeRenderValue =
      pisBarcodeRenderProps?.value || inspectedBarcodeRenderProps?.value || "";
    const unifiedBarcodeRenderFormat =
      pisBarcodeRenderProps?.format || inspectedBarcodeRenderProps?.format || "EAN13";

    const rows = [
      ...buildMeasurementComparisonRows({
        attribute: "Product Size (L x B x H)",
        comparisonType: "lbh",
        pisMeta: pisProductLbh,
        checkedMeta: checkedProductLbh,
        indexedRemarkOrder: ITEM_INDEXED_REMARKS,
      }),
      ...buildMeasurementComparisonRows({
        attribute: "Box Size (L x B x H)",
        comparisonType: "lbh",
        pisMeta: pisPackedSize,
        checkedMeta: checkedPackedSize,
        indexedRemarkOrder: BOX_INDEXED_REMARKS,
      }),
      ...buildMeasurementComparisonRows({
        attribute: "Net Weight",
        comparisonType: "weight",
        pisMeta: pisNetWeight,
        checkedMeta: checkedNetWeight,
        indexedRemarkOrder: ITEM_INDEXED_REMARKS,
      }),
      ...buildMeasurementComparisonRows({
        attribute: "Gross Weight",
        comparisonType: "weight",
        pisMeta: pisGrossWeight,
        checkedMeta: checkedGrossWeight,
        indexedRemarkOrder: BOX_INDEXED_REMARKS,
      }),
      ...(showCbmTop
        ? [{ attribute: "Box 1 CBM", pis: pisCbmTop, checked: checkedCbmTop }]
        : []),
      ...(showCbmBottom
        ? [{ attribute: "Box 2 CBM", pis: pisCbmBottom, checked: checkedCbmBottom }]
        : []),
      { attribute: "Total Box CBM", pis: calculatedPisCbm, checked: checkedCbmTotal },
      { attribute: "Barcode", pis: pisBarcodeValue, checked: inspectedBarcodeValue },
    ];

    return {
      pisBarcodeValue,
      inspectedBarcodeValue,
      pisBarcodeRenderValue: pisBarcodeRenderProps?.value || "",
      inspectedBarcodeRenderValue: inspectedBarcodeRenderProps?.value || "",
      pisBarcodeRenderFormat: pisBarcodeRenderProps?.format || "EAN13",
      inspectedBarcodeRenderFormat: inspectedBarcodeRenderProps?.format || "EAN13",
      barcodeMismatch,
      unifiedBarcodeValue,
      unifiedBarcodeRenderValue,
      unifiedBarcodeRenderFormat,
      pisInnerBarcodeValue: formatStoredBarcodeDisplay(pisInnerBarcodeRaw),
      inspectedInnerBarcodeValue: formatStoredBarcodeDisplay(inspectedInnerBarcodeRaw),
      rows,
    };
  }, [isSingleInspectionReport, latestInspectionRecord, qc]);

  const bannerFinish = useMemo(
    () =>
      finishRows.find((row) =>
        row?.hasImage,
      ) || null,
    [finishRows],
  );

  const bannerFinishImageUrl = useMemo(
    () => String(bannerFinish?.imageUrl || "").trim(),
    [bannerFinish?.imageUrl],
  );

  const bannerFinishTitle = useMemo(() => {
    if (!bannerFinish) return "Finish";
    if (bannerFinish.uniqueCode !== "N/A") return bannerFinish.uniqueCode;
    if (bannerFinish.color !== "N/A") return bannerFinish.color;
    if (bannerFinish.vendor !== "N/A") return bannerFinish.vendor;
    if (bannerFinish.finishId) return bannerFinish.finishId;
    return "Finish";
  }, [bannerFinish]);

  const bannerFinishSubtitle = useMemo(() => {
    if (!bannerFinish) return "Finish details not available";
    if (bannerFinish.color !== "N/A" && bannerFinish.colorCode !== "N/A") {
      return `${bannerFinish.color} (${bannerFinish.colorCode})`;
    }
    if (bannerFinish.color !== "N/A") return bannerFinish.color;
    if (bannerFinish.colorCode !== "N/A") return bannerFinish.colorCode;
    if (bannerFinish.vendor !== "N/A" && bannerFinish.vendorCode !== "N/A") {
      return `${bannerFinish.vendor} (${bannerFinish.vendorCode})`;
    }
    if (bannerFinish.vendor !== "N/A") return bannerFinish.vendor;
    if (bannerFinish.vendorCode !== "N/A") return bannerFinish.vendorCode;
    return "Finish details available";
  }, [bannerFinish]);

  const bannerFinishSrc = useMemo(() => {
    if (finishImageError) return "";
    return String(finishImageSrc || bannerFinishImageUrl || "").trim();
  }, [bannerFinishImageUrl, finishImageError, finishImageSrc]);

  const differenceLogs = useMemo(() => {
    const rows = Array.isArray(itemMasterSummary?.rows) ? itemMasterSummary.rows : [];
    const logs = [];

    rows.forEach((row) => {
      const attribute = String(row?.attribute || "").trim();
      const pisValue = String(row?.pis ?? "").trim();
      const checkedValue = String(row?.checked ?? "").trim();

      if (!attribute || !pisValue || !checkedValue) return;

      if (row?.comparison_type === "lbh") {
        const lbhLogs = collectLbhDifferenceLogs({
          attribute,
          pisMeta: row?.pis_meta,
          checkedMeta: row?.checked_meta,
        });
        if (lbhLogs.length > 0) {
          logs.push(...lbhLogs);
        }
        return;
      }

      if (row?.comparison_type === "weight") {
        const weightLogs = collectWeightDifferenceLogs({
          attribute,
          pisMeta: row?.pis_meta,
          checkedMeta: row?.checked_meta,
        });
        if (weightLogs.length > 0) {
          logs.push(...weightLogs);
        }
        return;
      }

      const normalizedPis = toComparableValue(pisValue);
      const normalizedChecked = toComparableValue(checkedValue);
      if (normalizedPis === normalizedChecked) return;

      const isMissingPis = normalizedPis === "not set" || normalizedPis === "n/a";
      const isMissingChecked = normalizedChecked === "not set" || normalizedChecked === "n/a";

      if (isMissingPis && !isMissingChecked) {
        logs.push(`For ${attribute}, inspected value is ${checkedValue} while PIS value is not set.`);
        return;
      }
      if (!isMissingPis && isMissingChecked) {
        logs.push(`For ${attribute}, PIS value is ${pisValue} while inspected value is not set.`);
        return;
      }
      if (isMissingPis && isMissingChecked) return;

      const pisNumeric = Number(pisValue);
      const checkedNumeric = Number(checkedValue);
      if (Number.isFinite(pisNumeric) && Number.isFinite(checkedNumeric)) {
        const delta = checkedNumeric - pisNumeric;
        if (Math.abs(delta) >= 0.0001) {
          const direction = delta > 0 ? "greater" : "smaller";
          logs.push(
            `For ${attribute}, inspected value is ${formatDifferenceNumber(delta)} ${direction} than PIS value.`,
          );
        }
        return;
      }

      logs.push(`For ${attribute}, inspected value is ${checkedValue} while PIS value is ${pisValue}.`);
    });

    return logs;
  }, [itemMasterSummary?.rows]);

  const fetchQcDetails = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get(`/qc/${id}`, {
      });
      setQc(response?.data?.data || null);
    } catch (error) {
      console.error(error);
      setQc(null);
      alert("Failed to load inspection report.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const brandName = String(qc?.order?.brand || "").trim();
    if (!brandName) {
      setBrandLogoSrc("");
      setBrandLogoLoading(false);
      return;
    }

    let isMounted = true;

    const fetchBrandDetails = async () => {
      try {
        setBrandLogoLoading(true);
        const response = await api.get("/brands/");
        if (!isMounted) return;

        const brands = Array.isArray(response?.data?.data) ? response.data.data : [];
        const matchedBrand = brands.find(
          (brand) => getBrandKey(brand?.name) === getBrandKey(brandName),
        );
        const resolvedLogoSrc = toBrandLogoDataUrl(matchedBrand?.logo);
        if (!resolvedLogoSrc) {
          setBrandLogoSrc("");
          return;
        }

        if (resolvedLogoSrc.startsWith("data:image/")) {
          setBrandLogoSrc(resolvedLogoSrc);
          return;
        }

        try {
          setBrandLogoSrc(await fetchRemoteImageAsDataUrl(resolvedLogoSrc));
        } catch {
          setBrandLogoSrc(resolvedLogoSrc);
        }
      } catch (error) {
        if (isMounted) {
          setBrandLogoSrc("");
        }
      } finally {
        if (isMounted) {
          setBrandLogoLoading(false);
        }
      }
    };

    fetchBrandDetails();

    return () => {
      isMounted = false;
    };
  }, [qc?.order?.brand]);

  useEffect(() => {
    if (!productImageUrl) {
      setProductImageSrc("");
      setProductImageLoading(false);
      return;
    }

    let isMounted = true;
    setProductImageLoading(true);

    const loadProductImage = async () => {
      try {
        const nextImageSrc = productImageUrl.startsWith("data:image/")
          ? productImageUrl
          : await fetchRemoteImageAsDataUrl(productImageUrl);
        if (isMounted) {
          setProductImageSrc(nextImageSrc);
        }
      } catch {
        if (isMounted) {
          setProductImageSrc(productImageUrl);
        }
      } finally {
        if (isMounted) {
          setProductImageLoading(false);
        }
      }
    };

    loadProductImage();

    return () => {
      isMounted = false;
    };
  }, [productImageUrl]);

  useEffect(() => {
    setFinishImageError(false);

    if (!bannerFinishImageUrl) {
      setFinishImageSrc("");
      setFinishImageLoading(false);
      return;
    }

    let isMounted = true;
    setFinishImageLoading(true);

    const loadFinishImage = async () => {
      try {
        const nextImageSrc = bannerFinishImageUrl.startsWith("data:image/")
          ? bannerFinishImageUrl
          : await fetchRemoteImageAsDataUrl(bannerFinishImageUrl);
        if (isMounted) {
          setFinishImageSrc(nextImageSrc);
        }
      } catch {
        if (isMounted) {
          setFinishImageSrc(bannerFinishImageUrl);
        }
      } finally {
        if (isMounted) {
          setFinishImageLoading(false);
        }
      }
    };

    loadFinishImage();

    return () => {
      isMounted = false;
    };
  }, [bannerFinishImageUrl]);

  const handleConfirmAndExport = useCallback(async () => {
    if (
      !reportRef.current ||
      exportingPdf ||
      !qc ||
      brandLogoLoading ||
      productImageLoading ||
      finishImageLoading
    ) {
      return;
    }

    const confirmed = window.confirm(
      "Confirm export of this inspection report snapshot as PDF?",
    );
    if (!confirmed) return;

    try {
      setExportingPdf(true);
      const target = reportRef.current;
      await waitForImagesToLoad(target);
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: Math.max(target.scrollWidth, target.clientWidth),
        windowHeight: Math.max(target.scrollHeight, target.clientHeight),
        scrollX: 0,
        scrollY: -window.scrollY,
      });

      const imageData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const imageHeight = (canvas.height * printableWidth) / canvas.width;

      let remainingHeight = imageHeight;
      let yPosition = margin;

      pdf.addImage(
        imageData,
        "PNG",
        margin,
        yPosition,
        printableWidth,
        imageHeight,
        undefined,
        "FAST",
      );

      remainingHeight -= printableHeight;
      while (remainingHeight > 0) {
        pdf.addPage();
        yPosition = margin - (imageHeight - remainingHeight);
        pdf.addImage(
          imageData,
          "PNG",
          margin,
          yPosition,
          printableWidth,
          imageHeight,
          undefined,
          "FAST",
        );
        remainingHeight -= printableHeight;
      }

      const safePo = toFilenameSegment(qc?.order?.order_id, id || "po");
      const safeItemCode = toFilenameSegment(qc?.item?.item_code, "item");
      const safeInspectionRecord = selectedInspectionRecordId
        ? `_${toFilenameSegment(selectedInspectionRecordId, "inspection")}`
        : "";
      pdf.save(`inspection_report_${safePo}_${safeItemCode}${safeInspectionRecord}.pdf`);
    } catch (error) {
      console.error("Inspection report export failed:", error);
      alert("Failed to export inspection report PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [
    brandLogoLoading,
    exportingPdf,
    finishImageLoading,
    id,
    productImageLoading,
    qc,
    selectedInspectionRecordId,
  ]);

  useEffect(() => {
    fetchQcDetails();
  }, [fetchQcDetails]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-5 text-center">Loading...</div>
      </>
    );
  }

  if (!qc) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-5 text-center">Inspection report not found</div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-shell py-3 inspection-report-page">
        <div className="d-flex justify-content-between align-items-center mb-3 inspection-report-header">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(backTarget, { replace: false })}
          >
            Back
          </button>
          <div className="text-center">
            <h2 className="h4 mb-0">{reportContextLabel}</h2>
            {reportContextDetails && (
              <div className="small text-secondary">{reportContextDetails}</div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConfirmAndExport}
            disabled={
              exportingPdf ||
              brandLogoLoading ||
              productImageLoading ||
              finishImageLoading
            }
          >
            {exportingPdf
              ? "Exporting..."
              : brandLogoLoading || productImageLoading || finishImageLoading
              ? "Loading images..."
              : "Confirm & Export PDF"}
          </button>
        </div>

        {selectedInspectionRecordMissing && (
          <div className="alert alert-warning py-2 mb-3">
            Selected inspection record was not found. Showing the full inspection report.
          </div>
        )}

        <div className="card om-card inspection-report-card" ref={reportRef}>
          <div className="card-body d-grid gap-4">
            <section>
                <div className="d-flex justify-center align-center text-center mb-4">
                     <h3 className="h3 m-auto">{isSingleInspectionReport ? "QC Inspection Record Report" : "QC Report"}</h3>
                </div>
             
              <div className="inspection-report-summary-block">
                <div className="inspection-report-summary-column inspection-report-summary-primary">
                  <div className="inspection-report-summary-line">
                    <span><strong>Brand:</strong> {orderInfo.brand}</span>
                    <span><strong>Vendor:</strong> {orderInfo.vendor}</span>
                  </div>
                  <div className="inspection-report-summary-line">
                    <span><strong>Order ID:</strong> {orderInfo.orderId}</span>
                    <span><strong>Item Code:</strong> {orderInfo.itemCode}</span>
                    <span><strong>Description:</strong> {orderInfo.itemDescription}</span>
                  </div>
                  <div className="inspection-report-summary-line">
                    <span><strong>Request Date:</strong> {orderInfo.requestDate}</span>
                  </div>
                  <div className="inspection-report-summary-line">
                    <span><strong>Request Type:</strong> {orderInfo.requestType}</span>
                    <span><strong>Order Quantity:</strong> {orderInfo.orderQuantity}</span>
                    <span><strong>Status:</strong> {orderInfo.status}</span>
                  </div>
                </div>
                <div className="inspection-report-summary-column inspection-report-summary-media inspection-report-summary-media--brand">
                  <div className="inspection-report-brand-panel">
                    {brandLogoSrc ? (
                      <img
                        src={brandLogoSrc}
                        alt={`${orderInfo.brand} logo`}
                        className="inspection-report-brand-logo inspection-report-brand-logo--brand"
                      />
                    ) : (
                      <div className="inspection-report-media-empty">
                        Brand logo not available
                      </div>
                    )}
                  </div>
                  {bannerFinish && (
                    <div className="inspection-report-brand-panel inspection-report-finish-banner-panel">
                      {bannerFinishSrc ? (
                        <img
                          src={bannerFinishSrc}
                          alt={`${bannerFinishTitle} finish`}
                          className="inspection-report-brand-logo inspection-report-brand-logo--finish"
                          onError={() => setFinishImageError(true)}
                        />
                      ) : (
                        <div className="inspection-report-media-empty">
                          Finish image not available
                        </div>
                      )}
                      <div className="inspection-report-finish-banner-meta">
                        <div className="fw-semibold">{bannerFinishTitle}</div>
                        <div className="text-secondary small">{bannerFinishSubtitle}</div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="inspection-report-summary-column inspection-report-summary-media inspection-report-summary-media--product">
                  <div className="inspection-report-brand-panel">
                    {productImageSrc ? (
                      <img
                        src={productImageSrc}
                        alt={`${orderInfo.itemDescription} product`}
                        className="inspection-report-brand-logo inspection-report-brand-logo--product"
                      />
                    ) : (
                      <div className="inspection-report-image-skeleton">
                        <span>Product Image not available yet</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="h6 mb-0">Related Files</h3>
                <span className="small text-secondary">
                  {uploadedItemMasterFiles.length} {uploadedItemMasterFiles.length === 1 ? "file" : "files"}
                </span>
              </div>
              {uploadedItemMasterFiles.length > 0 ? (
                <div className="row g-3">
                  {uploadedItemMasterFiles.map((entry) => {
                    const fileUrl = getStoredItemFileUrl(entry.file);

                    return (
                      <div key={entry.value} className="col-md-6 col-xl-4">
                        <div className="card h-100 shadow-sm border-0">
                          <div className="card-body d-flex flex-column gap-2">
                            <div className="fw-semibold">{entry.label}</div>
                            <div className="small text-secondary">
                              {String(entry.file?.originalName || "Uploaded file").trim()}
                            </div>
                            <div className="mt-auto">
                              <div className="d-flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn btn-outline-primary btn-sm rounded-pill"
                                  onClick={() => handlePreviewItemMasterFile(entry)}
                                  disabled={!fileUrl}
                                >
                                  Preview
                                </button>
                                <a
                                  href={fileUrl || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-outline-secondary btn-sm rounded-pill"
                                  onClick={(event) => {
                                    if (!fileUrl) event.preventDefault();
                                  }}
                                >
                                  Open File
                                </a>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-secondary small">
                  No related item files uploaded yet.
                </div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">Finish Details</h3>
              {sortedFinishRows.length > 0 ? (
                <div className="table-responsive inspection-report-table-wrap">
                  <table className="table table-sm table-striped align-middle mb-0 inspection-report-finish-table">
                    <thead>
                      <tr>
                        <th>
                          <SortHeaderButton
                            label="Unique Code"
                            isActive={finishSortBy === "uniqueCode"}
                            direction={finishSortOrder}
                            onClick={() => handleFinishSortColumn("uniqueCode", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Vendor"
                            isActive={finishSortBy === "vendor"}
                            direction={finishSortOrder}
                            onClick={() => handleFinishSortColumn("vendor", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Vendor Code"
                            isActive={finishSortBy === "vendorCode"}
                            direction={finishSortOrder}
                            onClick={() => handleFinishSortColumn("vendorCode", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Color"
                            isActive={finishSortBy === "color"}
                            direction={finishSortOrder}
                            onClick={() => handleFinishSortColumn("color", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Color Code"
                            isActive={finishSortBy === "colorCode"}
                            direction={finishSortOrder}
                            onClick={() => handleFinishSortColumn("colorCode", "asc")}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFinishRows.map((row) => (
                        <tr key={row.key}>
                          <td>{row.uniqueCode}</td>
                          <td>{row.vendor}</td>
                          <td>{row.vendorCode}</td>
                          <td>{row.color}</td>
                          <td>{row.colorCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-secondary small">No finish details mapped for this item.</div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">Inspection Records</h3>
              {sortedInspectionRows.length > 0 ? (
                <div className="table-responsive inspection-report-table-wrap">
                  <table className="table table-sm table-striped align-middle mb-0 inspection-report-record-table">
                    <thead>
                      <tr>
                        <th>
                          <SortHeaderButton
                            label="Request Date"
                            isActive={inspectionSortBy === "requestDate"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("requestDate", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspection Date"
                            isActive={inspectionSortBy === "inspectionDate"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("inspectionDate", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspector"
                            isActive={inspectionSortBy === "inspector"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("inspector", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Requested"
                            isActive={inspectionSortBy === "requested"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("requested", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Offered"
                            isActive={inspectionSortBy === "offered"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("offered", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspected"
                            isActive={inspectionSortBy === "inspected"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("inspected", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Passed"
                            isActive={inspectionSortBy === "passed"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("passed", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Pending"
                            isActive={inspectionSortBy === "pending"}
                            direction={inspectionSortOrder}
                            onClick={() => handleInspectionSortColumn("pending", "desc")}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedInspectionRows.map((row) => (
                        <tr key={row.key}>
                          <td>{formatDateDDMMYYYY(row.requestDate)}</td>
                          <td>{formatDateDDMMYYYY(row.inspectionDate)}</td>
                          <td>{row.inspectorName}</td>
                          <td>{row.requestedQty}</td>
                          <td>{row.offeredQty}</td>
                          <td>{row.inspectedQty}</td>
                          <td>{row.passedQty}</td>
                          <td>{row.pendingAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-secondary small">No inspection records found.</div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">Product Packing Details</h3>
              <div className="table-responsive mb-3 inspection-report-table-wrap">
                <table className="table table-sm table-striped table-bordered align-middle mb-0 inspection-report-packing-table">
                  <thead>
                    <tr>
                      <th>Attribute</th>
                      <th>PIS</th>
                      <th>Inspected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemMasterSummary.rows.map((row) => (
                      <tr key={row.key || row.attribute}>
                        <td>{row.attribute}</td>
                        <td>{row.pis}</td>
                        <td>{row.checked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {itemMasterSummary.barcodeMismatch ? (
                <div className="row g-3 mt-1">
                  <div className="col-md-6">
                    <div className="fw-semibold mb-1">
                      PIS Barcode: {itemMasterSummary.pisBarcodeValue}
                    </div>
                    {itemMasterSummary.pisBarcodeRenderValue ? (
                      <div className="qc-barcode-wrapper inspection-report-barcode-wrapper">
                        <Barcode
                          value={itemMasterSummary.pisBarcodeRenderValue}
                          format={itemMasterSummary.pisBarcodeRenderFormat}
                        />
                      </div>
                    ) : (
                      <div className="text-secondary small">Not Set</div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <div className="fw-semibold mb-1">
                      QC Barcode: {itemMasterSummary.inspectedBarcodeValue}
                    </div>
                    {itemMasterSummary.inspectedBarcodeRenderValue ? (
                      <div className="qc-barcode-wrapper inspection-report-barcode-wrapper">
                        <Barcode
                          value={itemMasterSummary.inspectedBarcodeRenderValue}
                          format={itemMasterSummary.inspectedBarcodeRenderFormat}
                        />
                      </div>
                    ) : (
                      <div className="text-secondary small">Not Set</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-2">
                  <div className="fw-semibold mb-1">
                    Barcode (PIS/QC): {itemMasterSummary.unifiedBarcodeValue}
                  </div>
                  {itemMasterSummary.unifiedBarcodeRenderValue ? (
                    <div className="qc-barcode-wrapper inspection-report-barcode-wrapper">
                      <Barcode
                        value={itemMasterSummary.unifiedBarcodeRenderValue}
                        format={itemMasterSummary.unifiedBarcodeRenderFormat}
                      />
                    </div>
                  ) : (
                    <div className="text-secondary small">Not Set</div>
                  )}
                </div>
              )}
              {(itemMasterSummary.pisInnerBarcodeValue !== "Not Set" ||
                itemMasterSummary.inspectedInnerBarcodeValue !== "Not Set") && (
                <div className="row g-3 mt-3">
                  <div className="col-md-6">
                    <div className="fw-semibold mb-1">
                      PIS Inner Carton Barcode: {itemMasterSummary.pisInnerBarcodeValue}
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="fw-semibold mb-1">
                      QC Inner Carton Barcode: {itemMasterSummary.inspectedInnerBarcodeValue}
                    </div>
                  </div>
                </div>
              )}
              {itemMasterSummary.barcodeMismatch && (
                <div className="alert alert-warning py-2 mb-0 mt-3">
                  Barcode mismatch detected between PIS master barcode and QC master barcode.
                </div>
              )}
            </section>
            <section>
              <h3 className="h6 mb-3">Difference Logs (PIS vs Inspected)</h3>
              {differenceLogs.length > 0 ? (
                <ul className="inspection-report-diff-logs">
                  {differenceLogs.map((log, index) => (
                    <li key={`diff-log-${index}`}>{log}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-secondary small">No differences found between PIS and inspected values.</div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">Label Ranges And Remarks</h3>
              <div className="inspection-report-notes-block">
                <div className="mb-3">
                  <div className="fw-semibold mb-2">Label Ranges</div>
                  {labelRanges.length > 0 ? (
                    <div className="inspection-report-label-list">
                      {labelRanges.map((range, index) => (
                        <span
                          key={`label-range-${range.start}-${range.end}-${index}`}
                          className="inspection-report-label-chip"
                        >
                          {range.start} - {range.end}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-secondary small">No label ranges added.</div>
                  )}
                </div>

                <div>
                  <div className="fw-semibold mb-2">Inspection Remarks</div>
                  {sortedInspectionRemarkRows.length > 0 ? (
                    <div className="table-responsive inspection-report-table-wrap">
                      <table className="table table-sm table-striped align-middle mb-0 inspection-report-remarks-table">
                        <thead>
                          <tr>
                            <th>
                              <SortHeaderButton
                                label="Inspection Date"
                                isActive={remarkSortBy === "inspectionDate"}
                                direction={remarkSortOrder}
                                onClick={() => handleRemarkSortColumn("inspectionDate", "desc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Inspector"
                                isActive={remarkSortBy === "inspector"}
                                direction={remarkSortOrder}
                                onClick={() => handleRemarkSortColumn("inspector", "asc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Remark"
                                isActive={remarkSortBy === "remark"}
                                direction={remarkSortOrder}
                                onClick={() => handleRemarkSortColumn("remark", "asc")}
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedInspectionRemarkRows.map((row) => (
                            <tr key={`remark-${row.key}`}>
                              <td>{formatDateDDMMYYYY(row.inspectionDate)}</td>
                              <td>{row.inspectorName}</td>
                              <td>{row.remarks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-secondary small">No inspection remarks found.</div>
                  )}
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>

      {previewFile && (
        <FilePreviewModal
          title={previewFile.title}
          url={previewFile.url}
          originalName={previewFile.originalName}
          previewMode={previewFile.previewMode}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
};

export default InspectionReport;
