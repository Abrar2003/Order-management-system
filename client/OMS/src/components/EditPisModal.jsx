import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import useFormDraft from "../hooks/useFormDraft";
import MeasuredSizeSection from "./MeasuredSizeSection";
import ProductImageThumbnail from "./ProductImageThumbnail";
import { getCountryOfOriginOptions } from "../constants/countryOfOrigin";
import { formatDateDDMMYYYY } from "../utils/date";
import {
  BOX_ENTRY_TYPES,
  BOX_PACKAGING_MODES,
  BOX_SIZE_ENTRY_LIMIT,
  BOX_SIZE_REMARK_OPTIONS,
  ITEM_SIZE_ENTRY_LIMIT,
  ITEM_SIZE_REMARK_OPTIONS,
  buildMeasuredSizeEntriesFromLegacy,
  calculateMeasuredSizeEntriesCbm,
  detectBoxPackagingMode,
  ensureMeasuredSizeEntryCount,
  getFixedBoxEntryCount,
  hasMeaningfulMeasuredSize,
  normalizeSizeCount,
  parseMeasuredSizeEntries,
  resolvePreferredMeasuredSizeCbm,
} from "../utils/measuredSizeForm";
import { formatEan13BarcodeDisplay } from "../utils/barcode";
import { getUserFromToken } from "../auth/auth.utils";
import { isStrictAdminRole, normalizeUserRole } from "../auth/permissions";
import "../App.css";

const toText = (value, fallback = "") => String(value ?? fallback).trim();
const isPisChecked = (item = {}) => item?.pis_checked_flag === true;
const formatFallback = (value, fallback = "Not Set") => {
  const text = toText(value);
  return text && text !== "0" ? text : fallback;
};
const formatBoxMode = (mode = "") => {
  const resolvedMode = detectBoxPackagingMode(mode);
  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) return "Inner / Master Carton";
  if (resolvedMode === BOX_PACKAGING_MODES.INDIVIDUAL_MASTER) {
    return "Individual packing + master";
  }
  return "Individual Boxes";
};
const formatRemarkLabel = (remark = "", fallback = "Entry") => {
  const normalized = toText(remark).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  if (normalized === "base2") return "Base 2";
  if (normalized === "pedestal") return "Pedestal";
  if (normalized === "stretcher") return "Stretcher";
  if (normalized === "inner") return "Inner Carton";
  if (normalized === "master") return "Master Carton";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};
const formatEntrySize = (entry = {}) => {
  const parts = [entry?.L, entry?.B, entry?.H].map((value) => formatFallback(value, ""));
  return parts.every(Boolean) ? parts.join(" x ") : "Not Set";
};
const formatEntryWeight = (entry = {}, label = "Weight") => (
  formatFallback(entry?.weight, "") ? `${label}: ${formatFallback(entry.weight)}` : `${label}: Not Set`
);
const formatEntries = (entries = [], weightLabel = "Weight") => {
  const meaningfulEntries = (Array.isArray(entries) ? entries : [])
    .filter((entry) => hasMeaningfulMeasuredSize(entry));
  if (meaningfulEntries.length === 0) return "Not Set";

  return meaningfulEntries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      return `${label}: ${formatEntrySize(entry)} (${formatEntryWeight(entry, weightLabel)})`;
    })
    .join(" | ");
};

const hasMeaningfulEntryList = (entries = []) =>
  (Array.isArray(entries) ? entries : []).some((entry) =>
    hasMeaningfulMeasuredSize(entry),
  );

const getBrandLabel = (item = {}) =>
  toText(
    item?.brand
    || item?.brand_name
    || (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "")
    || "N/A",
  );

const getVendorsLabel = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.join(", ")
    : "N/A";

const toTimestamp = (value) => {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const buildLatestInspectionContext = (orders = []) =>
  (Array.isArray(orders) ? orders : [])
    .flatMap((order) =>
      (Array.isArray(order?.inspections) ? order.inspections : [])
        .filter(
          (inspection) =>
            toText(order?.order_id) &&
            toText(inspection?.inspection_date) &&
            toText(inspection?.inspector_name) &&
            toText(inspection?.inspector_name).toLowerCase() !== "n/a",
        )
        .map((inspection) => ({
          order_id: toText(order?.order_id),
          brand: toText(order?.brand),
          vendor: toText(order?.vendor),
          inspector_name: toText(inspection?.inspector_name),
          inspection_date: toText(inspection?.inspection_date),
          requested_date: toText(inspection?.requested_date),
          sort_time: Math.max(
            toTimestamp(inspection?.inspection_date),
            toTimestamp(inspection?.requested_date),
            toTimestamp(order?.order_date),
          ),
        })),
    )
    .sort((left, right) => (right.sort_time || 0) - (left.sort_time || 0))[0] || null;

const normalizeRemark = (value = "") => String(value || "").trim().toLowerCase();

const hasFetchableMeasuredValue = (entry = {}) => {
  const hasDimensionOrWeight = ["L", "B", "H", "weight"].some(
    (field) => toText(entry?.[field]) !== "",
  );
  if (hasDimensionOrWeight) return true;

  return ["item_count_in_inner", "box_count_in_master"].some((field) => {
    const text = toText(entry?.[field]);
    return text !== "" && text !== "0";
  });
};

const sortMeasuredEntriesByRemark = (entries = [], preferredOrder = []) => {
  const orderLookup = new Map(
    preferredOrder.map((remark, index) => [normalizeRemark(remark), index]),
  );

  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const leftRemark = normalizeRemark(left?.remark || left?.type || left?.box_type);
    const rightRemark = normalizeRemark(right?.remark || right?.type || right?.box_type);
    const leftRank = orderLookup.has(leftRemark)
      ? orderLookup.get(leftRemark)
      : preferredOrder.length;
    const rightRank = orderLookup.has(rightRemark)
      ? orderLookup.get(rightRemark)
      : preferredOrder.length;

    if (leftRank !== rightRank) return leftRank - rightRank;
    return leftRemark.localeCompare(rightRemark, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
};

const createBlankCartonFetchEntry = (boxType = BOX_ENTRY_TYPES.INNER) => ({
  remark: boxType,
  box_type: boxType,
  L: "",
  B: "",
  H: "",
  weight: "",
  item_count_in_inner: boxType === BOX_ENTRY_TYPES.INNER ? "" : "0",
  box_count_in_master: boxType === BOX_ENTRY_TYPES.MASTER ? "" : "0",
});

const arrangeCartonEntriesForFetch = (entries = []) => {
  const cartonEntries = Array.isArray(entries) ? entries : [];
  const findEntry = (boxType) =>
    cartonEntries.find((entry) => {
      const remark = normalizeRemark(entry?.remark || entry?.type);
      const entryBoxType = normalizeRemark(entry?.box_type);
      return remark === boxType || entryBoxType === boxType;
    });

  const innerEntry = findEntry(BOX_ENTRY_TYPES.INNER);
  const masterEntry = findEntry(BOX_ENTRY_TYPES.MASTER);
  return [
    innerEntry || createBlankCartonFetchEntry(BOX_ENTRY_TYPES.INNER),
    masterEntry || createBlankCartonFetchEntry(BOX_ENTRY_TYPES.MASTER),
  ];
};

const buildInspectedMeasurementDetails = (item = {}) => {
  const inspectedBoxMode = detectBoxPackagingMode(
    item?.inspected_box_mode,
    item?.inspected_box_sizes,
  );
  const itemEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_item_sizes,
    weightKey: "net_weight",
  }).filter((entry) => hasFetchableMeasuredValue(entry));
  const boxEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_box_sizes,
    mode: inspectedBoxMode,
    weightKey: "gross_weight",
    limit: BOX_SIZE_ENTRY_LIMIT,
  }).filter((entry) => hasFetchableMeasuredValue(entry));

  const sortedItemEntries = sortMeasuredEntriesByRemark(
    itemEntries,
    ["item", "top", "base", "base2", "pedestal", "stretcher"],
  );
  const sortedBoxEntries =
    inspectedBoxMode === BOX_PACKAGING_MODES.CARTON
      ? (boxEntries.length > 0 ? arrangeCartonEntriesForFetch(boxEntries) : [])
      : sortMeasuredEntriesByRemark(boxEntries, ["box", "top", "base"]);
  const fixedBoxCount = getFixedBoxEntryCount(inspectedBoxMode);

  return {
    inspectedBoxMode,
    itemEntries: sortedItemEntries.slice(0, ITEM_SIZE_ENTRY_LIMIT),
    boxEntries: sortedBoxEntries.slice(
      0,
      fixedBoxCount ?? BOX_SIZE_ENTRY_LIMIT,
    ),
  };
};

const buildMeasurementEntriesForFormSource = (item = {}, source = "pis", group = "item") => {
  const isMaster = source === "master";
  const isItemGroup = group === "item";
  const boxMode = isMaster
    ? detectBoxPackagingMode(item?.master_box_mode, item?.master_box_sizes)
    : detectBoxPackagingMode(item?.pis_box_mode, item?.pis_box_sizes);

  return buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: isMaster
        ? (isItemGroup ? item?.master_item_sizes : item?.master_box_sizes)
        : (isItemGroup ? item?.pis_item_sizes : item?.pis_box_sizes),
    mode: isItemGroup ? undefined : boxMode,
    weightKey: isItemGroup ? "net_weight" : "gross_weight",
    limit: isItemGroup ? ITEM_SIZE_ENTRY_LIMIT : BOX_SIZE_ENTRY_LIMIT,
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));
};

const resolveInitialFormSource = (item = {}, preferMaster = false, group = "item") => {
  const masterEntries = preferMaster
    ? buildMeasurementEntriesForFormSource(item, "master", group)
    : [];

  if (hasMeaningfulEntryList(masterEntries)) {
    return {
      source: "master",
      entries: masterEntries,
      boxMode: detectBoxPackagingMode(item?.master_box_mode, item?.master_box_sizes),
    };
  }

  const pisEntries = buildMeasurementEntriesForFormSource(item, "pis", group);

  return {
    source: "pis",
    entries: pisEntries,
    boxMode: detectBoxPackagingMode(item?.pis_box_mode, item?.pis_box_sizes),
  };
};

const buildInitialForm = (item = {}, options = {}) => {
  const preferMaster = options?.preferMaster === true;
  const itemSource = resolveInitialFormSource(item, preferMaster, "item");
  const boxSource = resolveInitialFormSource(item, preferMaster, "box");
  const resolvedBoxMode = boxSource.source === "master"
    ? detectBoxPackagingMode(item?.master_box_mode, item?.master_box_sizes)
    : boxSource.boxMode;
  const resolvedMasterBarcode = preferMaster
    ? toText(item?.master_master_barcode || item?.master_barcode)
      || toText(item?.pis_master_barcode || item?.pis_barcode)
    : toText(item?.pis_master_barcode || item?.pis_barcode);
  const resolvedInnerBarcode = preferMaster
    ? toText(item?.master_inner_barcode) || toText(item?.pis_inner_barcode)
    : toText(item?.pis_inner_barcode);
  const resolvedCountryOfOrigin = preferMaster
    ? toText(item?.master_country_of_origin) || toText(item?.country_of_origin)
    : toText(item?.country_of_origin);

  const pisItemEntries = itemSource.entries;
  const pisBoxEntries = boxSource.entries;

  const pisItemCount =
    pisItemEntries.length > 0
      ? normalizeSizeCount(pisItemEntries.length, 1)
      : 1;
  const pisBoxFixedCount = getFixedBoxEntryCount(resolvedBoxMode);
  const pisBoxCount =
    pisBoxFixedCount ??
    (pisBoxEntries.length > 0
      ? normalizeSizeCount(pisBoxEntries.length, 1, BOX_SIZE_ENTRY_LIMIT)
      : 1);

  return {
    country_of_origin: resolvedCountryOfOrigin,
    barcode_exempted: item?.barcode_exempted === true,
    kd: Boolean(item?.kd),
    mounting_file_needed: Boolean(item?.mounting_file_needed),
    master_barcode: resolvedMasterBarcode,
    inner_barcode: resolvedInnerBarcode,
    pis_item_count: String(pisItemCount),
    pis_box_mode: resolvedBoxMode,
    pis_box_count: String(pisBoxCount),
    pis_item_sizes: ensureMeasuredSizeEntryCount(pisItemEntries, pisItemCount, {
      singleRemark: "item",
    }),
    pis_box_sizes: ensureMeasuredSizeEntryCount(pisBoxEntries, pisBoxCount, {
      mode: resolvedBoxMode,
      singleRemark: "box",
      limit: BOX_SIZE_ENTRY_LIMIT,
    }),
  };
};

const buildInspectedReference = (item = {}) => {
  const inspectedBoxMode = detectBoxPackagingMode(
    item?.inspected_box_mode,
    item?.inspected_box_sizes,
  );
  const inspectedItemEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_item_sizes,
    weightKey: "net_weight",
  });
  const inspectedBoxEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_box_sizes,
    mode: inspectedBoxMode,
    weightKey: "gross_weight",
  });

  return {
    masterBarcode: formatEan13BarcodeDisplay(
      formatFallback(item?.qc?.master_barcode || item?.qc?.barcode, ""),
    ),
    innerBarcode: formatEan13BarcodeDisplay(
      formatFallback(item?.qc?.inner_barcode, ""),
    ),
    boxMode: formatBoxMode(inspectedBoxMode),
    itemSizes: formatEntries(inspectedItemEntries, "Net"),
    boxSizes: formatEntries(inspectedBoxEntries, "Gross"),
    cbm: [
      `Top: ${formatFallback(item?.cbm?.inspected_top)}`,
      `Bottom: ${formatFallback(item?.cbm?.inspected_bottom)}`,
      `Total: ${formatFallback(item?.cbm?.inspected_total)}`,
      `Calculated: ${formatFallback(item?.cbm?.calculated_inspected_total)}`,
    ].join(" | "),
  };
};

const EditPisModal = ({ item, onClose, onUpdated, updateSource = "" }) => {
  const isMasterUpdate =
    updateSource === "pis_diffs" || updateSource === "final_pis_check";
  const isPisDiffUpdate = isMasterUpdate;
  const [form, setForm] = useState(() =>
    buildInitialForm(item, { preferMaster: isMasterUpdate }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [latestInspectionContext, setLatestInspectionContext] = useState(null);
  const [latestInspectionContextLoading, setLatestInspectionContextLoading] = useState(false);
  const [latestInspectionContextLoaded, setLatestInspectionContextLoaded] = useState(false);
  const user = getUserFromToken();
  const canToggleBarcodeExemption = isStrictAdminRole(
    normalizeUserRole(user?.role),
  );
  const editScopeLabel = isPisDiffUpdate ? "Master" : "PIS";
  const {
    clearDraft,
    draftMessage,
    draftStatus,
    hasDraftStatus,
  } = useFormDraft({
    enabled: Boolean(item?._id),
    basePath: item?._id ? `/items/${item._id}/form-draft` : "",
    mode: isPisDiffUpdate ? "pis_master_update" : "pis_update",
    recordId: "",
    form,
    setForm,
  });

  const itemCode = useMemo(() => toText(item?.code, "N/A"), [item?.code]);
  const itemDescription = useMemo(
    () => toText(item?.description || item?.name, "N/A"),
    [item?.description, item?.name],
  );
  const brandLabel = useMemo(() => getBrandLabel(item), [item]);
  const vendorsLabel = useMemo(() => getVendorsLabel(item), [item]);
  const countryOfOriginOptions = useMemo(
    () => getCountryOfOriginOptions(form.country_of_origin),
    [form.country_of_origin],
  );
  const showInspectedReference = !isPisChecked(item);
  const inspectedReference = useMemo(() => buildInspectedReference(item), [item]);
  const inspectedMeasurementDetails = useMemo(
    () => buildInspectedMeasurementDetails(item),
    [item],
  );
  const displayedItemEntries = useMemo(
    () =>
      ensureMeasuredSizeEntryCount(form.pis_item_sizes, form.pis_item_count, {
        singleRemark: "item",
      }),
    [form.pis_item_sizes, form.pis_item_count],
  );
  const displayedBoxEntries = useMemo(
    () =>
      ensureMeasuredSizeEntryCount(form.pis_box_sizes, form.pis_box_count, {
        mode: form.pis_box_mode,
        singleRemark: "box",
        limit: BOX_SIZE_ENTRY_LIMIT,
      }),
    [form.pis_box_count, form.pis_box_mode, form.pis_box_sizes],
  );
  const calculatedPisItemCbm = useMemo(
    () => calculateMeasuredSizeEntriesCbm(form.pis_item_sizes, form.pis_item_count),
    [form.pis_item_sizes, form.pis_item_count],
  );
  const calculatedPisBoxCbm = useMemo(
    () =>
      calculateMeasuredSizeEntriesCbm(form.pis_box_sizes, form.pis_box_count, {
        mode: form.pis_box_mode,
        limit: BOX_SIZE_ENTRY_LIMIT,
      }),
    [form.pis_box_count, form.pis_box_mode, form.pis_box_sizes],
  );
  const calculatedPisCbm = useMemo(() => {
    return resolvePreferredMeasuredSizeCbm(
      calculatedPisBoxCbm,
      calculatedPisItemCbm,
    );
  }, [calculatedPisBoxCbm, calculatedPisItemCbm]);
  const isPisCartonMode = form.pis_box_mode === BOX_PACKAGING_MODES.CARTON;

  useEffect(() => {
    if (!showInspectedReference || !itemCode || itemCode === "N/A") {
      setLatestInspectionContext(null);
      setLatestInspectionContextLoading(false);
      setLatestInspectionContextLoaded(false);
      return undefined;
    }

    let ignore = false;

    const fetchLatestInspectionContext = async () => {
      try {
        setLatestInspectionContextLoading(true);
        setLatestInspectionContextLoaded(false);
        const response = await api.get(
          `/items/${encodeURIComponent(itemCode)}/orders-history`,
        );
        if (ignore) return;
        setLatestInspectionContext(
          buildLatestInspectionContext(response?.data?.data),
        );
      } catch {
        if (!ignore) {
          setLatestInspectionContext(null);
        }
      } finally {
        if (!ignore) {
          setLatestInspectionContextLoading(false);
          setLatestInspectionContextLoaded(true);
        }
      }
    };

    fetchLatestInspectionContext();

    return () => {
      ignore = true;
    };
  }, [itemCode, showInspectedReference]);

  const updateField = (path, value) => {
    setForm((prev) => {
      const next = { ...prev };
      const chunks = path.split(".");
      let cursor = next;
      for (let i = 0; i < chunks.length - 1; i += 1) {
        cursor[chunks[i]] = { ...cursor[chunks[i]] };
        cursor = cursor[chunks[i]];
      }
      cursor[chunks[chunks.length - 1]] = value;
      return next;
    });
  };

  const handleCountChange = (countKey, entriesKey, value) => {
    const isBoxEntries = entriesKey.includes("box");
    const safeCount = String(
      normalizeSizeCount(value, 1, isBoxEntries ? BOX_SIZE_ENTRY_LIMIT : undefined),
    );
    setForm((prev) => ({
      ...prev,
      [countKey]: safeCount,
      [entriesKey]: ensureMeasuredSizeEntryCount(prev[entriesKey], safeCount, {
        singleRemark: isBoxEntries ? "box" : "item",
        ...(isBoxEntries ? { limit: BOX_SIZE_ENTRY_LIMIT } : {}),
      }),
    }));
  };

  const handleBoxModeChange = (value) => {
    const nextMode = detectBoxPackagingMode(value, form.pis_box_sizes);
    const nextCount = String(getFixedBoxEntryCount(nextMode) ?? form.pis_box_count);
    setForm((prev) => ({
      ...prev,
      pis_box_mode: nextMode,
      pis_box_count: nextCount,
      inner_barcode:
        nextMode === BOX_PACKAGING_MODES.CARTON ? prev.inner_barcode : "",
      pis_box_sizes: ensureMeasuredSizeEntryCount(prev.pis_box_sizes, nextCount, {
        mode: nextMode,
        singleRemark: "box",
        limit: BOX_SIZE_ENTRY_LIMIT,
      }),
    }));
  };

  const handleSizeEntryChange = (entriesKey, index, field, value) => {
    if (field !== "remark" && value !== "") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      [entriesKey]: ensureMeasuredSizeEntryCount(
        prev[entriesKey].map((entry, entryIndex) =>
          entryIndex === index
            ? {
                ...entry,
                [field]:
                  field === "remark"
                    ? String(value || "").trim().toLowerCase()
                    : value,
              }
            : entry,
        ),
        prev[entriesKey]?.length || 1,
        {
          ...(entriesKey === "pis_box_sizes"
            ? { mode: prev.pis_box_mode, limit: BOX_SIZE_ENTRY_LIMIT }
            : {}),
          singleRemark: entriesKey.includes("box") ? "box" : "item",
        },
      ),
    }));
  };

  const handleFetchDetails = () => {
    if (!latestInspectionContext) {
      setError("No valid inspected record available.");
      return;
    }

    const hasItemEntries = inspectedMeasurementDetails.itemEntries.length > 0;
    const hasBoxEntries = inspectedMeasurementDetails.boxEntries.length > 0;
    const inspectedMasterBarcode = toText(
      item?.qc?.master_barcode || item?.qc?.barcode,
    );
    const inspectedInnerBarcode = toText(item?.qc?.inner_barcode);
    const hasInspectedMasterBarcode =
      inspectedMasterBarcode && inspectedMasterBarcode !== "0";
    const hasInspectedInnerBarcode =
      inspectedInnerBarcode && inspectedInnerBarcode !== "0";

    if (
      !hasItemEntries &&
      !hasBoxEntries &&
      !hasInspectedMasterBarcode &&
      !hasInspectedInnerBarcode
    ) {
      setError("No inspected details found to fetch.");
      return;
    }

    setError("");
    setForm((prev) => {
      const next = { ...prev };

      if (hasItemEntries) {
        const itemCount = normalizeSizeCount(
          inspectedMeasurementDetails.itemEntries.length,
          1,
        );
        next.pis_item_count = String(itemCount);
        next.pis_item_sizes = ensureMeasuredSizeEntryCount(
          inspectedMeasurementDetails.itemEntries,
          itemCount,
          { singleRemark: "item" },
        );
      }

      if (hasBoxEntries) {
        const boxMode = inspectedMeasurementDetails.inspectedBoxMode;
        const boxCount =
          getFixedBoxEntryCount(boxMode) ??
          normalizeSizeCount(
            inspectedMeasurementDetails.boxEntries.length,
            1,
            BOX_SIZE_ENTRY_LIMIT,
          );
        next.pis_box_mode = boxMode;
        next.pis_box_count = String(boxCount);
        next.pis_box_sizes = ensureMeasuredSizeEntryCount(
          inspectedMeasurementDetails.boxEntries,
          boxCount,
          { mode: boxMode, singleRemark: "box", limit: BOX_SIZE_ENTRY_LIMIT },
        );
      }

      if (hasInspectedMasterBarcode) {
        next.master_barcode = inspectedMasterBarcode;
      }

      if (hasInspectedInnerBarcode) {
        next.inner_barcode = inspectedInnerBarcode;
      }

      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      const pisItemPayload = parseMeasuredSizeEntries({
        entries: form.pis_item_sizes,
        count: form.pis_item_count,
        groupLabel: `${editScopeLabel} item size`,
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "net_weight",
        weightFieldLabel: "Net weight",
        allowIncomplete: true,
        singleRemark: "item",
      });
      if (pisItemPayload.error) {
        throw new Error(pisItemPayload.error);
      }

      const pisBoxPayload = parseMeasuredSizeEntries({
        entries: form.pis_box_sizes,
        count: form.pis_box_count,
        groupLabel: `${editScopeLabel} box size`,
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "gross_weight",
        weightFieldLabel: "Gross weight",
        mode: form.pis_box_mode,
        allowIncomplete: true,
        singleRemark: "box",
        limit: BOX_SIZE_ENTRY_LIMIT,
      });
      if (pisBoxPayload.error) {
        throw new Error(pisBoxPayload.error);
      }

      const payload = {
        pis_box_mode: form.pis_box_mode,
        pis_item_sizes: pisItemPayload.value,
        pis_box_sizes: pisBoxPayload.value,
      };
      payload.country_of_origin = toText(form.country_of_origin);
      payload.pis_barcode = toText(form.master_barcode);
      payload.pis_master_barcode = toText(form.master_barcode);
      payload.pis_inner_barcode = isPisCartonMode ? toText(form.inner_barcode) : "";
      payload.kd = Boolean(form.kd);
      payload.mounting_file_needed = Boolean(form.mounting_file_needed);
      if (canToggleBarcodeExemption) {
        payload.barcode_exempted = Boolean(form.barcode_exempted);
      }
      if (updateSource) {
        payload.pis_update_source = updateSource;
      }
      if (isPisDiffUpdate) {
        payload.sync_master_data = true;
        payload.pis_checked_flag = true;
      }

      const response = await api.patch(`/items/${item?._id}/pis`, payload);
      await clearDraft({ resetStatus: false });
      const fallbackItem = isPisDiffUpdate
        ? {
            ...item,
            country_of_origin: payload.country_of_origin,
            pis_barcode: payload.pis_barcode,
            pis_master_barcode: payload.pis_master_barcode,
            pis_inner_barcode: payload.pis_inner_barcode,
            pis_box_mode: payload.pis_box_mode,
            pis_item_sizes: payload.pis_item_sizes,
            pis_box_sizes: payload.pis_box_sizes,
            kd: payload.kd,
            mounting_file_needed: payload.mounting_file_needed,
            barcode_exempted: canToggleBarcodeExemption
              ? payload.barcode_exempted
              : item?.barcode_exempted,
            master_country_of_origin: payload.country_of_origin,
            master_barcode: payload.pis_master_barcode,
            master_master_barcode: payload.pis_master_barcode,
            master_inner_barcode: payload.pis_inner_barcode,
            master_box_mode: payload.pis_box_mode,
            master_item_sizes: payload.pis_item_sizes,
            master_box_sizes: payload.pis_box_sizes,
            pis_checked_flag: true,
          }
        : item;
      onUpdated?.(response?.data?.data || fallbackItem);
      onClose?.();
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message || saveError?.message || "Failed to update PIS values.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Update {editScopeLabel}: {itemCode}</h5>
            {hasDraftStatus && (
              <span
                className={`badge ms-auto me-2 ${
                  draftStatus === "error" ? "text-bg-warning" : "text-bg-light"
                }`}
              >
                {draftMessage}
              </span>
            )}
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onClose}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-md-4">
                <label className="form-label">Code (Read Only)</label>
                <input type="text" className="form-control" value={itemCode} disabled />
              </div>
              <div className="col-md-4">
                <label className="form-label">Brand (Read Only)</label>
                <input type="text" className="form-control" value={brandLabel} disabled />
              </div>
              <div className="col-md-4">
                <label className="form-label">Vendors (Read Only)</label>
                <input type="text" className="form-control" value={vendorsLabel} disabled />
              </div>
              <div className="col-md-8">
                <label className="form-label">Description (Read Only)</label>
                <input type="text" className="form-control" value={itemDescription} disabled />
              </div>
              <div className="col-md-4">
                <label className="form-label">Country of Origin</label>
                <select
                  className="form-select"
                  value={form.country_of_origin}
                  onChange={(event) => updateField("country_of_origin", event.target.value)}
                  disabled={saving}
                >
                  <option value="">Select country</option>
                  {countryOfOriginOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">K/D</label>
                <div className="btn-group w-100" role="group" aria-label="K/D">
                  <button
                    type="button"
                    className={`btn ${form.kd ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => updateField("kd", true)}
                    disabled={saving}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`btn ${!form.kd ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => updateField("kd", false)}
                    disabled={saving}
                  >
                    No
                  </button>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label">Mounting File Needed</label>
                <div className="btn-group w-100" role="group" aria-label="Mounting File Needed">
                  <button
                    type="button"
                    className={`btn ${form.mounting_file_needed ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => updateField("mounting_file_needed", true)}
                    disabled={saving}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`btn ${!form.mounting_file_needed ? "btn-primary" : "btn-outline-secondary"}`}
                    onClick={() => updateField("mounting_file_needed", false)}
                    disabled={saving}
                  >
                    No
                  </button>
                </div>
              </div>
              {canToggleBarcodeExemption && (
                <div className="col-md-4">
                  <label className="form-label">Barcode Exempted Item</label>
                  <div className="btn-group w-100" role="group" aria-label="Barcode Exempted Item">
                    <button
                      type="button"
                      className={`btn ${form.barcode_exempted ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => updateField("barcode_exempted", true)}
                      disabled={saving}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className={`btn ${!form.barcode_exempted ? "btn-primary" : "btn-outline-secondary"}`}
                      onClick={() => updateField("barcode_exempted", false)}
                      disabled={saving}
                    >
                      No
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="row g-2">
              <div className={isPisCartonMode ? "col-md-6" : "col-md-12"}>
                <label className="form-label">
                  {isPisCartonMode ? "Master Carton Barcode" : "Barcode"}
                </label>
                <input
                  type="text"
                  className="form-control"
                  value={form.master_barcode}
                  onChange={(event) => updateField("master_barcode", event.target.value)}
                  disabled={saving}
                />
              </div>
              {isPisCartonMode && (
                <div className="col-md-6">
                  <label className="form-label">Inner Carton Barcode</label>
                  <input
                    type="text"
                    className="form-control"
                    value={form.inner_barcode}
                    onChange={(event) => updateField("inner_barcode", event.target.value)}
                    disabled={saving}
                  />
                </div>
              )}
            </div>

            {showInspectedReference && (
              <div className="border rounded p-3">
                <div className="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">
                  <h6 className="mb-0">Latest Inspected Reference</h6>
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={handleFetchDetails}
                      disabled={
                        saving ||
                        latestInspectionContextLoading ||
                        !latestInspectionContext
                      }
                    >
                      Fetch details
                    </button>
                    <span className="badge text-bg-warning">Needs PIS Check</span>
                  </div>
                </div>
                {latestInspectionContextLoading && (
                  <div className="text-secondary small">
                    Loading inspected record...
                  </div>
                )}
                {!latestInspectionContextLoading &&
                  latestInspectionContextLoaded &&
                  !latestInspectionContext && (
                    <div className="alert alert-secondary mb-0">
                      No valid inspected record available.
                    </div>
                  )}
                {!latestInspectionContextLoading && latestInspectionContext && (
                  <div className="row g-3 small">
                    <div className="col-md-3">
                      <div className="text-secondary">PO Number</div>
                      <div className="fw-semibold">
                        {latestInspectionContext.order_id}
                      </div>
                    </div>
                  <div className="col-md-3">
                    <div className="text-secondary">Brand</div>
                    <div className="fw-semibold">
                      {latestInspectionContext.brand || brandLabel}
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="text-secondary">Vendor</div>
                    <div className="fw-semibold">
                      {latestInspectionContext.vendor || vendorsLabel}
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="text-secondary">Inspector</div>
                    <div className="fw-semibold">
                      {latestInspectionContext.inspector_name}
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="text-secondary">Inspection Date</div>
                    <div className="fw-semibold">
                      {formatDateDDMMYYYY(
                        latestInspectionContext.inspection_date,
                        "N/A",
                      )}
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-secondary">Master Carton Barcode</div>
                    <div className="fw-semibold">{inspectedReference.masterBarcode}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-secondary">Inner Carton Barcode</div>
                    <div className="fw-semibold">{inspectedReference.innerBarcode}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-secondary">Inspected Item Sizes and Net Weight</div>
                    <div>{inspectedReference.itemSizes}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-secondary">Inspected Box Sizes and Gross Weight</div>
                    <div>{inspectedReference.boxSizes}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="text-secondary">Inspected Box Mode</div>
                    <div>{inspectedReference.boxMode}</div>
                  </div>
                  {isPisDiffUpdate && (
                    <div className="col-md-4 ms-md-auto">
                      <div className="text-secondary mb-2">Product Image</div>
                      <ProductImageThumbnail
                        src={item?.product_image_url}
                        originalName={item?.product_image?.originalName}
                        alt={`${itemCode} product image`}
                        size="md"
                      />
                    </div>
                  )}
                  <div className="col-md-8">
                    <div className="text-secondary">Inspected CBM</div>
                    <div>{inspectedReference.cbm}</div>
                  </div>
                  </div>
                )}
              </div>
            )}

            <div className="row g-3">
              <div className="col-12">
                <h6 className="mb-0">{editScopeLabel} Measurements</h6>
              </div>

              <MeasuredSizeSection
                sectionKey="pis-item"
                title={`${editScopeLabel} Item Sizes (cm) and Net Weight`}
                countLabel="Item Sets"
                countValue={form.pis_item_count}
                entries={displayedItemEntries}
                remarkOptions={ITEM_SIZE_REMARK_OPTIONS}
                weightLabel="Net Weight"
                disabled={saving}
                onCountChange={(value) =>
                  handleCountChange("pis_item_count", "pis_item_sizes", value)
                }
                onEntryChange={(index, field, value) =>
                  handleSizeEntryChange("pis_item_sizes", index, field, value)
                }
              />

              <MeasuredSizeSection
                sectionKey="pis-box"
                title={`${editScopeLabel} Box Sizes (cm) and Gross Weight`}
                countLabel="Box Sets"
                countValue={form.pis_box_count}
                entries={displayedBoxEntries}
                remarkOptions={BOX_SIZE_REMARK_OPTIONS}
                weightLabel="Gross Weight"
                mode={form.pis_box_mode}
                showModeSelector
                disabled={saving}
                onModeChange={handleBoxModeChange}
                onCountChange={(value) =>
                  handleCountChange("pis_box_count", "pis_box_sizes", value)
                }
                onEntryChange={(index, field, value) =>
                  handleSizeEntryChange("pis_box_sizes", index, field, value)
                }
              />

              <div className="col-md-4">
                <label className="form-label">Calculated {editScopeLabel} CBM</label>
                <input
                  type="text"
                  className="form-control"
                  value={calculatedPisCbm}
                  disabled
                  readOnly
                />
              </div>
            </div>

            {error && <div className="alert alert-danger mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={() => clearDraft()}
              disabled={saving}
            >
              Discard Draft
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : `Save ${editScopeLabel}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditPisModal;
