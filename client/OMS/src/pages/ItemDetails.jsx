import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import FilePreviewModal from "../components/FilePreviewModal";
import QcItemComplaintsSection from "../components/complaints/QcItemComplaintsSection";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getFilePreviewSource,
  getStoredItemFileUrl,
  hasStoredItemFile,
  ITEM_FILE_OPTIONS,
  shouldOpenFilePreviewExternally,
} from "../constants/itemFiles";
import { formatEan13BarcodeDisplay } from "../utils/barcode";
import { formatDateDDMMYYYY } from "../utils/date";
import { formatFixedNumber, formatLbhValue } from "../utils/measurementDisplay";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import "../App.css";

const SIZE_UNIT = "cm";
const WEIGHT_UNIT = "kg";
const ENTRY_LIMIT = 4;
const ITEM_INDEXED_REMARKS = ["top", "base", "item", "item1", "item2", "item3", "item4"];
const BOX_INDEXED_REMARKS = ["top", "base", "box", "inner", "master", "box1", "box2", "box3", "box4"];

const normalizeText = (value) => String(value ?? "").trim();
const toDisplay = (value, fallback = "Not Set") => normalizeText(value) || fallback;
const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Not Set";
  return formatFixedNumber(parsed);
};
const formatWeight = (value) => {
  const formatted = formatNumber(value);
  return formatted === "Not Set" ? formatted : `${formatted} ${WEIGHT_UNIT}`;
};
const formatCbm = (value) => {
  const formatted = formatNumber(value);
  return formatted;
};
const formatDisplayLbhValue = (value) =>
  formatLbhValue(value, { fallback: "Not Set", suffix: SIZE_UNIT });
const formatLabel = (value) =>
  normalizeText(value)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const getPrimaryBrand = (item = {}) =>
  normalizeText(
    item?.brand_name ||
      item?.brand ||
      (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : ""),
  );

const getVendors = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.map(normalizeText).filter(Boolean).join(", ")
    : "Not Set";

const getRemarkLabel = (entry = {}, fallback = "Entry") => {
  const remark = normalizeText(entry?.remark || entry?.box_type || entry?.type).toLowerCase();
  if (!remark) return fallback;
  if (remark === "base") return "Base";
  if (remark === "top") return "Top";
  if (remark === "inner") return "Inner";
  if (remark === "master") return "Master";
  return remark.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const formatMeasurementRemark = (remark = "") => {
  const normalized = normalizeText(remark).toLowerCase();
  if (!normalized) return "";
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const buildMeasurementEntryKey = (entry = {}, index = 0) => {
  const normalizedRemark = normalizeText(entry?.remark || entry?.type).toLowerCase();
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
    if (safeLeftIndex !== safeRightIndex) return safeLeftIndex - safeRightIndex;
    return leftKey.localeCompare(rightKey);
  });

const hasIndexedMeasurementEntries = (entries = [], indexedRemarks = []) =>
  entries.some((entry) =>
    (Array.isArray(indexedRemarks) ? indexedRemarks : []).includes(
      normalizeText(entry?.remark || entry?.type).toLowerCase(),
    ));

const toPositiveWeightOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const hasAnyPositiveLbh = (value = {}) =>
  ["L", "B", "H"].some((key) => {
    const parsed = Number(value?.[key] || 0);
    return Number.isFinite(parsed) && parsed > 0;
  });

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
      ].filter(Boolean).join(" | "),
    };
  }

  return {
    mode: "single",
    value: resolvedSingle,
    display: formatDisplayLbhValue(resolvedSingle || {}),
  };
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
        resolvedTop !== null ? `${topLabel}: ${formatWeight(resolvedTop)}` : "",
        resolvedBottom !== null ? `${bottomLabel}: ${formatWeight(resolvedBottom)}` : "",
      ].filter(Boolean).join(" | "),
    };
  }

  return {
    mode: "single",
    value: resolvedSingle,
    display: formatWeight(resolvedSingle),
  };
};

const normalizeMeasurementEntries = (entries = [], weightKey = "", remarkOrder = []) =>
  sortMeasurementEntries(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const L = Number(entry?.L || 0);
        const B = Number(entry?.B || 0);
        const H = Number(entry?.H || 0);
        const weight = Number(weightKey ? entry?.[weightKey] : 0);
        return {
          remark: normalizeText(entry?.remark || entry?.type).toLowerCase(),
          L: Number.isFinite(L) ? L : 0,
          B: Number.isFinite(B) ? B : 0,
          H: Number.isFinite(H) ? H : 0,
          weight: Number.isFinite(weight) ? weight : 0,
        };
      })
      .filter((entry) => entry.L > 0 && entry.B > 0 && entry.H > 0)
      .slice(0, ENTRY_LIMIT),
    remarkOrder,
  );

const toMeasurementRowEntry = (entry = {}, index = 0, value, display = "") => ({
  key: buildMeasurementEntryKey(entry, index),
  label: formatMeasurementRemark(entry?.remark) || `Entry ${index + 1}`,
  value,
  display,
});

const toStructuredLbhFromEntries = (entries = [], fallback = null, { indexedRemarks = [] } = {}) => {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (normalizedEntries.length === 0) return formatStructuredLbhValue({ single: fallback, fallback });
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
  const [firstEntry] = normalizedEntries;
  if (firstEntry?.remark === "top" || firstEntry?.remark === "base") {
    return formatStructuredLbhValue({
      top: firstEntry?.remark === "top" ? firstEntry : null,
      bottom: firstEntry?.remark === "base" ? firstEntry : null,
    });
  }
  return formatStructuredLbhValue({ single: firstEntry });
};

const toStructuredWeightFromEntries = (entries = [], fallback = null, { indexedRemarks = [] } = {}) => {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (normalizedEntries.length === 0) return formatStructuredWeightValue({ single: fallback, fallback });
  if (normalizedEntries.length > 1 || hasIndexedMeasurementEntries(normalizedEntries, indexedRemarks)) {
    const indexedEntries = normalizedEntries.map((entry, index) =>
      toMeasurementRowEntry(
        entry,
        index,
        toPositiveWeightOrNull(entry?.weight),
        formatWeight(toPositiveWeightOrNull(entry?.weight)),
      ));
    return {
      mode: "indexed",
      entries: indexedEntries,
      display: indexedEntries.map((entry) => `${entry.label}: ${entry.display}`).join(" | "),
    };
  }
  const [firstEntry] = normalizedEntries;
  const firstWeight = toPositiveWeightOrNull(firstEntry?.weight);
  if (firstEntry?.remark === "top" || firstEntry?.remark === "base") {
    return formatStructuredWeightValue({
      top: firstEntry?.remark === "top" ? firstWeight : null,
      bottom: firstEntry?.remark === "base" ? firstWeight : null,
    });
  }
  return formatStructuredWeightValue({ single: firstWeight });
};

const buildMeasurementComparisonRows = ({
  attribute = "",
  comparisonType = "",
  pisMeta = null,
  checkedMeta = null,
  masterMeta = null,
  indexedRemarkOrder = [],
} = {}) => {
  const normalizedAttribute = normalizeText(attribute);
  if (!normalizedAttribute) return [];

  const pisEntries = Array.isArray(pisMeta?.entries) ? pisMeta.entries : [];
  const checkedEntries = Array.isArray(checkedMeta?.entries) ? checkedMeta.entries : [];
  const masterEntries = Array.isArray(masterMeta?.entries) ? masterMeta.entries : [];
  const hasIndexedRows =
    pisMeta?.mode === "indexed" ||
    checkedMeta?.mode === "indexed" ||
    masterMeta?.mode === "indexed";

  if (hasIndexedRows && comparisonType === "weight") {
    return [{
      key: normalizedAttribute,
      attribute: normalizedAttribute,
      pis: pisMeta?.display || "Not Set",
      inspected: checkedMeta?.display || "Not Set",
      master: masterMeta?.display || "Not Set",
    }];
  }

  if (!hasIndexedRows) {
    return [{
      key: normalizedAttribute,
      attribute: normalizedAttribute,
      pis: pisMeta?.display || "Not Set",
      inspected: checkedMeta?.display || "Not Set",
      master: masterMeta?.display || "Not Set",
    }];
  }

  const pisEntryMap = new Map(pisEntries.map((entry) => [entry.key, entry]));
  const checkedEntryMap = new Map(checkedEntries.map((entry) => [entry.key, entry]));
  const masterEntryMap = new Map(masterEntries.map((entry) => [entry.key, entry]));
  const preferredOrder = Array.isArray(indexedRemarkOrder) && indexedRemarkOrder.length > 0
    ? indexedRemarkOrder
    : [
        ...new Set([
          ...pisEntries.map((entry) => entry.key),
          ...checkedEntries.map((entry) => entry.key),
          ...masterEntries.map((entry) => entry.key),
        ]),
      ];
  const trailingKeys = [
    ...new Set([
      ...pisEntries.map((entry) => entry.key),
      ...checkedEntries.map((entry) => entry.key),
      ...masterEntries.map((entry) => entry.key),
    ]),
  ].filter((key) => !preferredOrder.includes(key));

  return [...preferredOrder, ...trailingKeys]
    .filter((key) => pisEntryMap.has(key) || checkedEntryMap.has(key) || masterEntryMap.has(key))
    .map((key, index) => {
      const pisEntry = pisEntryMap.get(key) || null;
      const checkedEntry = checkedEntryMap.get(key) || null;
      const masterEntry = masterEntryMap.get(key) || null;
      const label = pisEntry?.label || checkedEntry?.label || masterEntry?.label || formatMeasurementRemark(key) || `Entry ${index + 1}`;
      return {
        key: `${normalizedAttribute}-${key}`,
        attribute: `${normalizedAttribute} - ${label}`,
        pis: pisEntry?.display || "Not Set",
        inspected: checkedEntry?.display || "Not Set",
        master: masterEntry?.display || "Not Set",
      };
    });
};

const isCartonBoxMode = (value) => normalizeText(value).toLowerCase() === "carton";
const isIndividualBoxMode = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return !normalized || normalized === "individual";
};

const getConditionalBarcodeValue = ({ mode, individual = "", cartonMaster = "", cartonInner = "", type = "" }) => {
  if (type === "individual") return isIndividualBoxMode(mode) ? formatEan13BarcodeDisplay(individual) : "Not Set";
  if (type === "cartonMaster") return isCartonBoxMode(mode) ? formatEan13BarcodeDisplay(cartonMaster || individual) : "Not Set";
  if (type === "cartonInner") return isCartonBoxMode(mode) ? formatEan13BarcodeDisplay(cartonInner) : "Not Set";
  return "Not Set";
};

const hasSizeValue = (entry = {}, weightKey = "") =>
  ["L", "B", "H", weightKey, "item_count_in_inner", "box_count_in_master"].some((key) => {
    if (!key) return false;
    const parsed = Number(entry?.[key]);
    return Number.isFinite(parsed) && parsed > 0;
  });

const formatSizeEntries = (entries = [], weightKey = "") => {
  const rows = (Array.isArray(entries) ? entries : [])
    .filter((entry) => hasSizeValue(entry, weightKey))
    .slice(0, ENTRY_LIMIT);
  if (rows.length === 0) return "Not Set";

  return rows
    .map((entry, index) => {
      const size = formatLbhValue(entry, { fallback: "Not Set", suffix: SIZE_UNIT });
      const weight = weightKey && Number(entry?.[weightKey] || 0) > 0
        ? `${formatLabel(weightKey)}: ${formatWeight(entry?.[weightKey])}`
        : "";
      const counts = [
        Number(entry?.item_count_in_inner || 0) > 0
          ? `Inner count: ${formatNumber(entry.item_count_in_inner)}`
          : "",
        Number(entry?.box_count_in_master || 0) > 0
          ? `Master count: ${formatNumber(entry.box_count_in_master)}`
          : "",
      ].filter(Boolean);
      return [
        `${getRemarkLabel(entry, `Entry ${index + 1}`)}: ${size}`,
        weight,
        ...counts,
      ].filter(Boolean).join(" | ");
    })
    .join(" || ");
};

const getWeightValue = (weight = {}, key = "") => {
  const legacyKey = key === "total_net" ? "net" : key === "total_gross" ? "gross" : "";
  return toSafeNumber(weight?.[key] ?? (legacyKey ? weight?.[legacyKey] : undefined));
};

const formatSpecValue = (field = {}) => {
  const valueType = normalizeText(field?.value_type).toLowerCase();
  if (valueType === "number") return formatNumber(field?.value_number);
  if (valueType === "boolean") {
    if (field?.value_boolean === null || field?.value_boolean === undefined) return "Not Set";
    return field.value_boolean ? "Yes" : "No";
  }
  if (valueType === "date") return field?.value_date ? formatDateDDMMYYYY(field.value_date) : "Not Set";
  if (valueType === "array") {
    return Array.isArray(field?.value_array) && field.value_array.length > 0
      ? field.value_array.join(", ")
      : "Not Set";
  }
  return toDisplay(field?.raw_value ?? field?.value_text);
};

const normalizeRawValues = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== "")
    .map(([key, entryValue]) => ({
      label: formatLabel(key),
      value: typeof entryValue === "object" ? JSON.stringify(entryValue) : String(entryValue),
    }));
};

const toBrandLogoDataUrl = (logoObj) => {
  if (typeof logoObj?.url === "string" && logoObj.url.trim()) return logoObj.url.trim();
  const raw = logoObj?.data?.data || logoObj?.data;
  if (!Array.isArray(raw) || raw.length === 0) return "";
  let binary = "";
  raw.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:${logoObj?.contentType || "image/webp"};base64,${window.btoa(binary)}`;
};

const getBrandKey = (value) => normalizeText(value).toLowerCase();

const DetailCard = ({ title, children }) => (
  <div className="card om-card h-100 product-database-detail-card">
    <div className="card-body">
      <h3 className="h6 mb-3">{title}</h3>
      {children}
    </div>
  </div>
);

const KeyValueGrid = ({ rows = [] }) => (
  <div className="product-database-detail-grid">
    {rows.map((row) => (
      <div key={row.label} className="product-database-detail-field">
        <div className="small text-secondary">{row.label}</div>
        <div className="fw-semibold">{row.value || "Not Set"}</div>
      </div>
    ))}
  </div>
);

const ItemDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { itemCode } = useParams();
  const resolvedItemCode = useMemo(
    () => decodeURIComponent(String(itemCode || "")).trim(),
    [itemCode],
  );
  const backTarget = useMemo(() => {
    const fromItems = String(location.state?.fromItems || location.state?.fromPreviousPage || "").trim();
    return fromItems.startsWith("/") ? fromItems : "/items";
  }, [location.state]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(null);
  const [brandLogoSrc, setBrandLogoSrc] = useState("");
  const [previewFile, setPreviewFile] = useState(null);
  const [poSortBy, setPoSortBy] = useState("po");
  const [poSortOrder, setPoSortOrder] = useState("asc");

  const fetchDetails = useCallback(async () => {
    if (!resolvedItemCode) {
      setError("Item code is required.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/items/${encodeURIComponent(resolvedItemCode)}/details`);
      setDetails(response?.data?.data || null);
    } catch (fetchError) {
      setDetails(null);
      setError(fetchError?.response?.data?.message || "Failed to load item details.");
    } finally {
      setLoading(false);
    }
  }, [resolvedItemCode]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const item = details?.item || {};
  const productDatabase = details?.product_database || {};
  const orders = Array.isArray(details?.orders) ? details.orders : [];
  const brandName = getPrimaryBrand(item);
  const productImageUrl = getStoredItemFileUrl(item?.image);

  useEffect(() => {
    if (!brandName) {
      setBrandLogoSrc("");
      return;
    }

    let cancelled = false;
    const loadBrandLogo = async () => {
      try {
        const response = await api.get("/brands/");
        if (cancelled) return;
        const brands = Array.isArray(response?.data?.data) ? response.data.data : [];
        const matchedBrand = brands.find((brand) => getBrandKey(brand?.name) === getBrandKey(brandName));
        setBrandLogoSrc(toBrandLogoDataUrl(matchedBrand?.logo));
      } catch {
        if (!cancelled) setBrandLogoSrc("");
      }
    };
    loadBrandLogo();
    return () => {
      cancelled = true;
    };
  }, [brandName]);

  const uploadedFiles = useMemo(
    () =>
      ITEM_FILE_OPTIONS
        .map((option) => ({
          ...option,
          file: item?.[option.field] || null,
        }))
        .filter((entry) => hasStoredItemFile(entry.file)),
    [item],
  );

  const finishRows = useMemo(
    () =>
      (Array.isArray(item?.finish) ? item.finish : [])
        .map((entry, index) => ({
          key: entry?._id || `${entry?.unique_code || "finish"}-${index}`,
          uniqueCode: toDisplay(entry?.unique_code, "N/A"),
          vendor: toDisplay(entry?.vendor, "N/A"),
          vendorCode: toDisplay(entry?.vendor_code, "N/A"),
          color: toDisplay(entry?.color, "N/A"),
          colorCode: toDisplay(entry?.color_code, "N/A"),
        }))
        .filter((entry) =>
          [entry.uniqueCode, entry.vendor, entry.vendorCode, entry.color, entry.colorCode]
            .some((value) => value !== "N/A"),
        ),
    [item?.finish],
  );

  const handlePoSort = (column, defaultDirection = "asc") => {
    const next = getNextClientSortState(poSortBy, poSortOrder, column, defaultDirection);
    setPoSortBy(next.sortBy);
    setPoSortOrder(next.sortOrder);
  };

  const sortedOrders = useMemo(
    () =>
      sortClientRows(orders, {
        sortBy: poSortBy,
        sortOrder: poSortOrder,
        getSortValue: (row, column) => {
          if (column === "po") return row?.po;
          if (column === "orderDate") return new Date(row?.order_date || 0).getTime();
          if (column === "etd") return new Date(row?.etd || 0).getTime();
          if (column === "lastInspected") return new Date(row?.last_inspected_date || 0).getTime();
          if (column === "quantity") return Number(row?.order_quantity || 0);
          if (column === "status") return row?.current_status;
          if (column === "count") return Number(row?.inspection_count || 0);
          return "";
        },
      }),
    [orders, poSortBy, poSortOrder],
  );

  const attributeRows = useMemo(
    () => {
      const pisItemEntries = normalizeMeasurementEntries(item?.pis_item_sizes, "net_weight", ITEM_INDEXED_REMARKS);
      const inspectedItemEntries = normalizeMeasurementEntries(item?.inspected_item_sizes, "net_weight", ITEM_INDEXED_REMARKS);
      const masterItemEntries = normalizeMeasurementEntries(item?.master_item_sizes, "net_weight", ITEM_INDEXED_REMARKS);
      const pisBoxEntries = normalizeMeasurementEntries(item?.pis_box_sizes, "gross_weight", BOX_INDEXED_REMARKS);
      const inspectedBoxEntries = normalizeMeasurementEntries(item?.inspected_box_sizes, "gross_weight", BOX_INDEXED_REMARKS);
      const masterBoxEntries = normalizeMeasurementEntries(item?.master_box_sizes, "gross_weight", BOX_INDEXED_REMARKS);
      const barcodeRows = [];
      const sourceModes = [
        item?.pis_box_mode,
        item?.inspected_box_mode,
        item?.master_box_mode,
      ];
      const showIndividualBarcode = sourceModes.some(isIndividualBoxMode);
      const showCartonBarcodes = sourceModes.some(isCartonBoxMode);

      if (showIndividualBarcode) {
        barcodeRows.push({
          key: "Barcode",
          attribute: "Barcode",
          pis: getConditionalBarcodeValue({
            mode: item?.pis_box_mode,
            individual: item?.pis_master_barcode || item?.pis_barcode,
            type: "individual",
          }),
          inspected: getConditionalBarcodeValue({
            mode: item?.inspected_box_mode,
            individual: item?.qc?.master_barcode || item?.qc?.barcode,
            type: "individual",
          }),
          master: getConditionalBarcodeValue({
            mode: item?.master_box_mode,
            individual: item?.master_master_barcode || item?.master_barcode,
            type: "individual",
          }),
        });
      }

      if (showCartonBarcodes) {
        barcodeRows.push(
          {
            key: "Master Carton Barcode",
            attribute: "Master Carton Barcode",
            pis: getConditionalBarcodeValue({
              mode: item?.pis_box_mode,
              individual: item?.pis_barcode,
              cartonMaster: item?.pis_master_barcode || item?.pis_barcode,
              type: "cartonMaster",
            }),
            inspected: getConditionalBarcodeValue({
              mode: item?.inspected_box_mode,
              individual: item?.qc?.barcode,
              cartonMaster: item?.qc?.master_barcode || item?.qc?.barcode,
              type: "cartonMaster",
            }),
            master: getConditionalBarcodeValue({
              mode: item?.master_box_mode,
              individual: item?.master_barcode,
              cartonMaster: item?.master_master_barcode || item?.master_barcode,
              type: "cartonMaster",
            }),
          },
          {
            key: "Inner Carton Barcode",
            attribute: "Inner Carton Barcode",
            pis: getConditionalBarcodeValue({
              mode: item?.pis_box_mode,
              cartonInner: item?.pis_inner_barcode,
              type: "cartonInner",
            }),
            inspected: getConditionalBarcodeValue({
              mode: item?.inspected_box_mode,
              cartonInner: item?.qc?.inner_barcode,
              type: "cartonInner",
            }),
            master: getConditionalBarcodeValue({
              mode: item?.master_box_mode,
              cartonInner: item?.master_inner_barcode,
              type: "cartonInner",
            }),
          },
        );
      }

      return [
        ...buildMeasurementComparisonRows({
          attribute: "Product Size (L x B x H)",
          comparisonType: "lbh",
          pisMeta: toStructuredLbhFromEntries(pisItemEntries, null, { indexedRemarks: ITEM_INDEXED_REMARKS }),
          checkedMeta: toStructuredLbhFromEntries(inspectedItemEntries, null, { indexedRemarks: ITEM_INDEXED_REMARKS }),
          masterMeta: toStructuredLbhFromEntries(masterItemEntries, null, { indexedRemarks: ITEM_INDEXED_REMARKS }),
          indexedRemarkOrder: ITEM_INDEXED_REMARKS,
        }),
        ...buildMeasurementComparisonRows({
          attribute: "Box Size (L x B x H)",
          comparisonType: "lbh",
          pisMeta: toStructuredLbhFromEntries(pisBoxEntries, null, { indexedRemarks: BOX_INDEXED_REMARKS }),
          checkedMeta: toStructuredLbhFromEntries(inspectedBoxEntries, null, { indexedRemarks: BOX_INDEXED_REMARKS }),
          masterMeta: toStructuredLbhFromEntries(masterBoxEntries, null, { indexedRemarks: BOX_INDEXED_REMARKS }),
          indexedRemarkOrder: BOX_INDEXED_REMARKS,
        }),
        ...buildMeasurementComparisonRows({
          attribute: "Net Weight",
          comparisonType: "weight",
          pisMeta: toStructuredWeightFromEntries(
            pisItemEntries,
            getWeightValue(item?.pis_weight, "total_net"),
            { indexedRemarks: ITEM_INDEXED_REMARKS },
          ),
          checkedMeta: toStructuredWeightFromEntries(
            inspectedItemEntries,
            getWeightValue(item?.inspected_weight, "total_net"),
            { indexedRemarks: ITEM_INDEXED_REMARKS },
          ),
          masterMeta: toStructuredWeightFromEntries(
            masterItemEntries,
            null,
            { indexedRemarks: ITEM_INDEXED_REMARKS },
          ),
          indexedRemarkOrder: ITEM_INDEXED_REMARKS,
        }),
        ...buildMeasurementComparisonRows({
          attribute: "Gross Weight",
          comparisonType: "weight",
          pisMeta: toStructuredWeightFromEntries(
            pisBoxEntries,
            getWeightValue(item?.pis_weight, "total_gross"),
            { indexedRemarks: BOX_INDEXED_REMARKS },
          ),
          checkedMeta: toStructuredWeightFromEntries(
            inspectedBoxEntries,
            getWeightValue(item?.inspected_weight, "total_gross"),
            { indexedRemarks: BOX_INDEXED_REMARKS },
          ),
          masterMeta: toStructuredWeightFromEntries(
            masterBoxEntries,
            null,
            { indexedRemarks: BOX_INDEXED_REMARKS },
          ),
          indexedRemarkOrder: BOX_INDEXED_REMARKS,
        }),
        {
          key: "Box 1 CBM",
          attribute: "Box 1 CBM",
          pis: formatCbm(item?.cbm?.top),
          inspected: formatCbm(item?.cbm?.inspected_top || item?.cbm?.qc_top),
          master: "Not Set",
        },
        {
          key: "Box 2 CBM",
          attribute: "Box 2 CBM",
          pis: formatCbm(item?.cbm?.bottom),
          inspected: formatCbm(item?.cbm?.inspected_bottom || item?.cbm?.qc_bottom),
          master: "Not Set",
        },
        {
          key: "Total Box CBM",
          attribute: "Total Box CBM",
          pis: formatCbm(item?.cbm?.calculated_pis_total || item?.cbm?.total),
          inspected: formatCbm(item?.cbm?.calculated_inspected_total || item?.cbm?.calculated_total || item?.cbm?.qc_total),
          master: "Not Set",
        },
        ...barcodeRows,
      ];
    },
    [item],
  );

  const specGroups = useMemo(() => {
    const groups = new Map();
    (Array.isArray(item?.product_specs?.fields) ? item.product_specs.fields : []).forEach((field) => {
      const groupLabel = toDisplay(field?.group_label || field?.group_key, "Product Specs");
      const rows = groups.get(groupLabel) || [];
      rows.push({
        label: field?.label || formatLabel(field?.key),
        value: formatSpecValue(field),
      });
      groups.set(groupLabel, rows);
    });
    return groups;
  }, [item?.product_specs?.fields]);

  const rawValueRows = useMemo(
    () => normalizeRawValues(item?.product_specs?.raw_values),
    [item?.product_specs?.raw_values],
  );

  const handlePreviewFile = (entry) => {
    const fileUrl = getStoredItemFileUrl(entry.file);
    if (!getFilePreviewSource({ fileUrl, previewMode: entry.previewMode })) return;
    if (shouldOpenFilePreviewExternally(entry.previewMode)) {
      window.open(fileUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setPreviewFile({
      title: entry.label,
      originalUrl: fileUrl,
      mode: entry.previewMode,
    });
  };

  return (
    <>
      <Navbar />
      <div className="page-shell py-3 inspection-report-page">
        <div className="d-flex justify-content-between align-items-center mb-3 inspection-report-header">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(backTarget)}>
            Back
          </button>
          <h2 className="h4 mb-0">Item Details</h2>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => fetchDetails()} disabled={loading}>
            Refresh
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card inspection-report-card">
          <div className="card-body d-grid gap-4">
            {loading ? (
              <div className="text-center py-5">Loading item details...</div>
            ) : (
              <>
                <section>
                  <div className="d-flex justify-center align-center text-center mb-4">
                    <h3 className="h3 m-auto">Item Details</h3>
                  </div>
                  <div className="inspection-report-summary-line mb-3">
                    <span><strong>Item Code:</strong> {toDisplay(item?.code, resolvedItemCode)}</span>
                    <span><strong>Description:</strong> {toDisplay(item?.description || item?.name)}</span>
                    <span><strong>Vendor:</strong> {getVendors(item)}</span>
                  </div>
                  <div className="inspection-report-summary-block">
                    <div className="inspection-report-summary-column inspection-report-summary-media inspection-report-summary-media--brand">
                      <div className="inspection-report-brand-panel">
                        {brandLogoSrc ? (
                          <img src={brandLogoSrc} alt={`${brandName} logo`} className="inspection-report-brand-logo inspection-report-brand-logo--brand" />
                        ) : (
                          <div className="inspection-report-media-empty">{brandName || "Brand"} logo not available</div>
                        )}
                      </div>
                    </div>
                    <div className="inspection-report-summary-column inspection-report-summary-media inspection-report-summary-media--product">
                      <div className="inspection-report-brand-panel">
                        {productImageUrl ? (
                          <img src={productImageUrl} alt={`${item?.description || item?.code || "Item"} product`} className="inspection-report-brand-logo inspection-report-brand-logo--product" />
                        ) : (
                          <div className="inspection-report-image-skeleton"><span>Product Image not available yet</span></div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h3 className="h6 mb-0">Related Files</h3>
                    <span className="small text-secondary">{uploadedFiles.length} {uploadedFiles.length === 1 ? "file" : "files"}</span>
                  </div>
                  {uploadedFiles.length > 0 ? (
                    <div className="row g-3">
                      {uploadedFiles.map((entry) => {
                        const fileUrl = getStoredItemFileUrl(entry.file);
                        return (
                          <div key={entry.value} className="col-md-6 col-xl-4">
                            <div className="card h-100 shadow-sm border-0">
                              <div className="card-body d-flex flex-column gap-2">
                                <div className="fw-semibold">{entry.label}</div>
                                <div className="small text-secondary">{toDisplay(entry.file?.originalName || entry.file?.original_name, "Uploaded file")}</div>
                                <div className="mt-auto d-flex flex-wrap gap-2">
                                  <button type="button" className="btn btn-outline-primary btn-sm rounded-pill" onClick={() => handlePreviewFile(entry)} disabled={!fileUrl}>
                                    Preview
                                  </button>
                                  <a href={fileUrl || "#"} target="_blank" rel="noreferrer" className="btn btn-outline-secondary btn-sm rounded-pill" onClick={(event) => { if (!fileUrl) event.preventDefault(); }}>
                                    Open File
                                  </a>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-secondary small">No related item files uploaded yet.</div>
                  )}
                </section>

                <section>
                  <h3 className="h6 mb-3">Finish Details</h3>
                  {finishRows.length > 0 ? (
                    <div className="table-responsive inspection-report-table-wrap">
                      <table className="table table-sm table-striped align-middle mb-0 inspection-report-finish-table">
                        <thead>
                          <tr>
                            <th>Unique Code</th>
                            <th>Vendor</th>
                            <th>Vendor Code</th>
                            <th>Color</th>
                            <th>Color Code</th>
                          </tr>
                        </thead>
                        <tbody>
                          {finishRows.map((row) => (
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

                <QcItemComplaintsSection itemCode={item?.code || resolvedItemCode} />

                <section>
                  <h3 className="h6 mb-3">POs</h3>
                  <div className="table-responsive inspection-report-table-wrap">
                    <table className="table table-sm table-striped align-middle mb-0 inspection-report-record-table">
                      <thead>
                        <tr>
                          <th><SortHeaderButton label="PO" isActive={poSortBy === "po"} direction={poSortOrder} onClick={() => handlePoSort("po", "asc")} /></th>
                          <th><SortHeaderButton label="Order Date" isActive={poSortBy === "orderDate"} direction={poSortOrder} onClick={() => handlePoSort("orderDate", "desc")} /></th>
                          <th><SortHeaderButton label="ETD" isActive={poSortBy === "etd"} direction={poSortOrder} onClick={() => handlePoSort("etd", "desc")} /></th>
                          <th><SortHeaderButton label="Last Inspected Date" isActive={poSortBy === "lastInspected"} direction={poSortOrder} onClick={() => handlePoSort("lastInspected", "desc")} /></th>
                          <th><SortHeaderButton label="Order Qty" isActive={poSortBy === "quantity"} direction={poSortOrder} onClick={() => handlePoSort("quantity", "desc")} /></th>
                          <th><SortHeaderButton label="Current Status" isActive={poSortBy === "status"} direction={poSortOrder} onClick={() => handlePoSort("status", "asc")} /></th>
                          <th><SortHeaderButton label="Inspection Count" isActive={poSortBy === "count"} direction={poSortOrder} onClick={() => handlePoSort("count", "desc")} /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedOrders.length === 0 ? (
                          <tr><td colSpan={7} className="text-center text-secondary">No POs found for this item.</td></tr>
                        ) : sortedOrders.map((row) => (
                          <tr
                            key={row.id || row.po}
                            style={{ cursor: row.qc_id ? "pointer" : "default" }}
                            onClick={() => {
                              if (row.qc_id) {
                                navigate(`/qc/${encodeURIComponent(row.qc_id)}`, {
                                  state: { fromPreviousPage: `${location.pathname}${location.search}` },
                                });
                              }
                            }}
                          >
                            <td>{toDisplay(row.po, "N/A")}</td>
                            <td>{row.order_date ? formatDateDDMMYYYY(row.order_date) : "Not Set"}</td>
                            <td>{row.etd ? formatDateDDMMYYYY(row.etd) : "Not Set"}</td>
                            <td>{row.last_inspected_date ? formatDateDDMMYYYY(row.last_inspected_date) : "Not Set"}</td>
                            <td>{Number(row.order_quantity || 0)}</td>
                            <td>{toDisplay(row.current_status, "N/A")}</td>
                            <td>{Number(row.inspection_count || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                          <th>Master</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attributeRows.map((row) => (
                          <tr key={row.attribute}>
                            <td>{row.attribute}</td>
                            <td>{row.pis}</td>
                            <td>{row.inspected}</td>
                            <td>{row.master}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <h3 className="h6 mb-3">Product Database Material Details</h3>
                  <div className="row g-4">
                    <div className="col-xl-6">
                      <DetailCard title="Product Database Summary">
                        <KeyValueGrid
                          rows={[
                            { label: "Status", value: toDisplay(productDatabase?.pd_checked) },
                            { label: "Country Of Origin", value: toDisplay(productDatabase?.country_of_origin || item?.country_of_origin) },
                            { label: "Product Type", value: toDisplay(item?.product_type?.label || item?.product_type?.key) },
                            { label: "Template Version", value: item?.product_type?.version ? `v${item.product_type.version}` : "Not Set" },
                          ]}
                        />
                      </DetailCard>
                    </div>
                    <div className="col-xl-6">
                      <DetailCard title="Product Database Barcodes">
                        <KeyValueGrid
                          rows={[
                            { label: "Single / Master Barcode", value: formatEan13BarcodeDisplay(item?.pd_master_barcode || item?.pd_barcode) },
                            { label: "Inner Barcode", value: formatEan13BarcodeDisplay(item?.pd_inner_barcode) },
                          ]}
                        />
                      </DetailCard>
                    </div>
                    <div className="col-12">
                      <DetailCard title="Product Database Measurements">
                        <div className="table-responsive">
                          <table className="table table-sm align-middle mb-0">
                            <thead>
                              <tr>
                                <th>Type</th>
                                <th>Values</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr><td>Item Sizes</td><td>{formatSizeEntries(item?.pd_item_sizes, "net_weight")}</td></tr>
                              <tr><td>Box Sizes</td><td>{formatSizeEntries(item?.pd_box_sizes, "gross_weight")}</td></tr>
                              <tr><td>Box Mode</td><td>{toDisplay(item?.pd_box_mode || item?.product_specs?.box_mode)}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      </DetailCard>
                    </div>
                    {[...specGroups.entries()].map(([groupLabel, rows]) => (
                      <div className="col-xl-6" key={groupLabel}>
                        <DetailCard title={groupLabel}>
                          <KeyValueGrid rows={rows} />
                        </DetailCard>
                      </div>
                    ))}
                    {specGroups.size === 0 && (
                      <div className="col-12">
                        <DetailCard title="Product Specs">
                          <div className="text-secondary small">No product spec fields stored.</div>
                        </DetailCard>
                      </div>
                    )}
                    {rawValueRows.length > 0 && (
                      <div className="col-12">
                        <DetailCard title="Raw Product Values">
                          <KeyValueGrid rows={rawValueRows} />
                        </DetailCard>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      {previewFile && (
        <FilePreviewModal
          title={previewFile.title}
          url={previewFile.originalUrl}
          previewMode={previewFile.mode}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
};

export default ItemDetails;
