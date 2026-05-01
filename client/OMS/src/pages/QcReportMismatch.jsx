import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_TIMELINE = "1m";
const DEFAULT_CUSTOM_DAYS = 30;
const DEFAULT_FILTER = "all";
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [20, 50, 100];
const TIMELINE_DAYS = Object.freeze({
  "1m": 30,
  "3m": 90,
  "6m": 180,
});
const NUMBER_TOLERANCE = 0.001;
const STATUS_OPTIONS = Object.freeze([
  { value: DEFAULT_FILTER, label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "Inspection Done", label: "Inspection Done" },
  { value: "goods not ready", label: "Goods Not Ready" },
  { value: "rejected", label: "Rejected" },
  { value: "transfered", label: "Transferred" },
]);
const ITEM_SIZE_FIELDS = Object.freeze([
  { key: "L", label: "L", type: "number" },
  { key: "B", label: "B", type: "number" },
  { key: "H", label: "H", type: "number" },
  { key: "remark", label: "Remark", type: "text" },
  { key: "net_weight", label: "Net Weight", type: "number" },
  { key: "gross_weight", label: "Gross Weight", type: "number" },
]);
const BOX_SIZE_FIELDS = Object.freeze([
  { key: "L", label: "L", type: "number" },
  { key: "B", label: "B", type: "number" },
  { key: "H", label: "H", type: "number" },
  { key: "remark", label: "Remark", type: "text" },
  { key: "net_weight", label: "Net Weight", type: "number" },
  { key: "gross_weight", label: "Gross Weight", type: "number" },
  { key: "box_type", label: "Box Type", type: "text" },
  { key: "item_count_in_inner", label: "Item Count In Inner", type: "number" },
  { key: "box_count_in_master", label: "Box Count In Master", type: "number" },
]);

const normalizeTimeline = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "1m" || normalized === "3m" || normalized === "6m") {
    return normalized;
  }
  if (normalized === "custom") return "custom";
  return DEFAULT_TIMELINE;
};

const parseCustomDays = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CUSTOM_DAYS;
  return Math.min(parsed, 3650);
};

const normalizeFilterValue = (value, fallback = DEFAULT_FILTER) => {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return fallback;
  }
  return normalized;
};

const normalizeTextValue = (value) => String(value || "").trim();

const normalizeBooleanParam = (value, fallback = false) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
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

const getDateRangeFromTimeline = (timelineValue, customDaysValue) => {
  const normalizedTimeline = normalizeTimeline(timelineValue);
  const days = normalizedTimeline === "custom"
    ? parseCustomDays(customDaysValue)
    : TIMELINE_DAYS[normalizedTimeline];

  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (Math.max(1, days) - 1));

  return {
    from_date: toISODateString(fromDate) || toISODateString(toDate),
    to_date: toISODateString(toDate),
  };
};

const getDateRangeFromSearchParams = (searchParams, timelineValue, customDaysValue) => {
  const derivedRange = getDateRangeFromTimeline(timelineValue, customDaysValue);

  return {
    from_date: toISODateString(searchParams.get("from_date")) || derivedRange.from_date,
    to_date: toISODateString(searchParams.get("to_date")) || derivedRange.to_date,
  };
};

const normalizeLookupKey = (value) => normalizeTextValue(value).toLowerCase();

const formatNumberValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) <= NUMBER_TOLERANCE) {
    return "Not Set";
  }
  return parsed.toFixed(3).replace(/\.?0+$/, "");
};

const formatTextValue = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized || "Not Set";
};

const formatBoxModeLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "Not Set";
  if (normalized === "individual") return "Individual";
  if (normalized === "carton") return "Carton";
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatComparisonValue = (value, type = "text", fieldKey = "") => {
  if (fieldKey === "box_mode") {
    return formatBoxModeLabel(value);
  }
  if (fieldKey === "remark" || fieldKey === "box_type") {
    return formatTextValue(value);
  }
  return type === "number" ? formatNumberValue(value) : formatTextValue(value);
};

const normalizeComparisonValue = (value, type = "text") => {
  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return String(value ?? "").trim().toLowerCase();
};

const valuesMatch = (left, right, type = "text") => {
  if (type === "number") {
    return Math.abs(normalizeComparisonValue(left, type) - normalizeComparisonValue(right, type))
      <= NUMBER_TOLERANCE;
  }
  return normalizeComparisonValue(left, type) === normalizeComparisonValue(right, type);
};

const buildMismatchKeySet = (mismatches = []) =>
  new Set(
    (Array.isArray(mismatches) ? mismatches : []).map((entry) =>
      `${Number(entry?.index || 0)}:${String(entry?.field || "").trim()}`,
    ),
  );

const buildSheetRows = ({
  inspections = [],
  currentEntries = [],
  labelPrefix = "",
  fields = [],
  snapshotKey = "",
  mismatchKey = "",
} = {}) => {
  const safeInspections = Array.isArray(inspections) ? inspections : [];
  const maxLength = Math.max(
    Array.isArray(currentEntries) ? currentEntries.length : 0,
    ...safeInspections.map((inspection) =>
      Array.isArray(inspection?.inspection_snapshot?.[snapshotKey])
        ? inspection.inspection_snapshot[snapshotKey].length
        : 0,
    ),
  );

  if (maxLength === 0) {
    return [];
  }

  const rows = [];
  for (let index = 0; index < maxLength; index += 1) {
    const currentEntry = currentEntries[index] || {};

    fields.forEach((field) => {
      const inspectionCells = safeInspections.map((inspection, inspectionIndex) => {
        const inspectionEntries = Array.isArray(inspection?.inspection_snapshot?.[snapshotKey])
          ? inspection.inspection_snapshot[snapshotKey]
          : [];
        const inspectionEntry = inspectionEntries[index] || {};
        const mismatchKeySet = buildMismatchKeySet(inspection?.[mismatchKey]);
        const mismatchKey = `${index}:${field.key}`;
        const inspectionValue = inspectionEntry?.[field.key];
        const currentValue = currentEntry?.[field.key];

        return {
          key: `${inspection?.inspection_id || inspectionIndex}-${index}-${field.key}`,
          inspection_id: inspection?.inspection_id || "",
          label: inspection?.sheet_label || `Inspection ${inspectionIndex + 1}`,
          inspection_date: inspection?.inspection_date || "",
          inspector_name: inspection?.inspector_name || "Unassigned",
          value: formatComparisonValue(inspectionValue, field.type, field.key),
          is_mismatch:
            mismatchKeySet.has(mismatchKey) ||
            !valuesMatch(inspectionValue, currentValue, field.type),
        };
      });

      rows.push({
        key: `${labelPrefix}-${index}-${field.key}`,
        field: `${labelPrefix} ${index + 1} - ${field.label}`,
        current_value: formatComparisonValue(currentEntry?.[field.key], field.type, field.key),
        inspection_cells: inspectionCells,
        is_mismatch: inspectionCells.some((cell) => cell.is_mismatch),
      });
    });
  }

  return rows;
};

const buildBoxModeSheetRows = ({
  inspections = [],
  currentMode = "",
} = {}) => {
  const safeInspections = Array.isArray(inspections) ? inspections : [];
  if (!currentMode && safeInspections.length === 0) {
    return [];
  }

  return [{
    key: "box-mode",
    field: "Box Mode",
    current_value: formatBoxModeLabel(currentMode),
    inspection_cells: safeInspections.map((inspection, inspectionIndex) => {
      const inspectionMode = inspection?.inspection_snapshot?.inspected_box_mode || "";
      return {
        key: `${inspection?.inspection_id || inspectionIndex}-box-mode`,
        inspection_id: inspection?.inspection_id || "",
        label: inspection?.sheet_label || `Inspection ${inspectionIndex + 1}`,
        inspection_date: inspection?.inspection_date || "",
        inspector_name: inspection?.inspector_name || "Unassigned",
        value: formatBoxModeLabel(inspectionMode),
        is_mismatch:
          Boolean(inspection?.box_mode_mismatch) ||
          !valuesMatch(inspectionMode, currentMode, "text"),
      };
    }),
    is_mismatch: safeInspections.some((inspection) =>
      Boolean(inspection?.box_mode_mismatch) ||
      !valuesMatch(inspection?.inspection_snapshot?.inspected_box_mode, currentMode, "text"),
    ),
  }];
};

const defaultReport = {
  rows: [],
  summary: {
    total_inspections: 0,
    mismatch_inspections: 0,
    clean_inspections: 0,
    item_size_mismatch_count: 0,
    box_size_mismatch_count: 0,
    box_mode_mismatch_count: 0,
  },
  filters: {
    timeline: DEFAULT_TIMELINE,
    custom_days: null,
    from_date: "",
    to_date: "",
    brand: "",
    vendor: "",
    inspector: "",
    status: "",
    order_id: "",
    item_code: "",
    mismatch_only: false,
    brand_options: [],
    vendor_options: [],
    inspector_options: [],
  },
  pagination: {
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 1,
  },
};

const SummaryCard = ({ label, value }) => (
  <div className="col-md-6 col-xl-2">
    <div className="card om-card h-100">
      <div className="card-body">
        <div className="small text-secondary">{label}</div>
        <div className="h4 mb-0 mt-2">{value}</div>
      </div>
    </div>
  </div>
);

const QcReportMismatch = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "qc-report-mismatch");

  const initialTimeline = normalizeTimeline(searchParams.get("timeline"));
  const initialCustomDays = parseCustomDays(searchParams.get("custom_days"));
  const initialDateRange = getDateRangeFromSearchParams(
    searchParams,
    initialTimeline,
    initialCustomDays,
  );

  const [timeline, setTimeline] = useState(() => initialTimeline);
  const [draftTimeline, setDraftTimeline] = useState(() => initialTimeline);
  const [customDays, setCustomDays] = useState(() => initialCustomDays);
  const [draftCustomDays, setDraftCustomDays] = useState(() => initialCustomDays);
  const [fromDate, setFromDate] = useState(() => initialDateRange.from_date);
  const [draftFromDate, setDraftFromDate] = useState(() => initialDateRange.from_date);
  const [toDate, setToDate] = useState(() => initialDateRange.to_date);
  const [draftToDate, setDraftToDate] = useState(() => initialDateRange.to_date);
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
  const [inspectorFilter, setInspectorFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("inspector")),
  );
  const [draftInspectorFilter, setDraftInspectorFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("inspector")),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("status")),
  );
  const [draftStatusFilter, setDraftStatusFilter] = useState(() =>
    normalizeFilterValue(searchParams.get("status")),
  );
  const [orderIdFilter, setOrderIdFilter] = useState(() =>
    normalizeTextValue(searchParams.get("order_id")),
  );
  const [draftOrderIdFilter, setDraftOrderIdFilter] = useState(() =>
    normalizeTextValue(searchParams.get("order_id")),
  );
  const [itemCodeFilter, setItemCodeFilter] = useState(() =>
    normalizeTextValue(searchParams.get("item_code")),
  );
  const [draftItemCodeFilter, setDraftItemCodeFilter] = useState(() =>
    normalizeTextValue(searchParams.get("item_code")),
  );
  const [mismatchOnly, setMismatchOnly] = useState(() =>
    normalizeBooleanParam(searchParams.get("mismatch_only"), false),
  );
  const [draftMismatchOnly, setDraftMismatchOnly] = useState(() =>
    normalizeBooleanParam(searchParams.get("mismatch_only"), false),
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      if (fromDate > toDate) {
        setReport(defaultReport);
        setError("From date cannot be later than To date.");
        return;
      }

      const params = {
        timeline,
        from_date: fromDate,
        to_date: toDate,
        page,
        limit,
        mismatch_only: mismatchOnly,
      };

      if (timeline === "custom") {
        params.custom_days = customDays;
      }
      if (brandFilter !== DEFAULT_FILTER) {
        params.brand = brandFilter;
      }
      if (vendorFilter !== DEFAULT_FILTER) {
        params.vendor = vendorFilter;
      }
      if (inspectorFilter !== DEFAULT_FILTER) {
        params.inspector = inspectorFilter;
      }
      if (statusFilter !== DEFAULT_FILTER) {
        params.status = statusFilter;
      }
      if (orderIdFilter) {
        params.order_id = orderIdFilter;
      }
      if (itemCodeFilter) {
        params.item_code = itemCodeFilter;
      }

      const response = await api.get("/reports/qc-report-mismatch", { params });
      const responseData = response?.data || {};

      setReport({
        rows: Array.isArray(responseData?.rows) ? responseData.rows : [],
        summary: responseData?.summary || defaultReport.summary,
        filters: {
          ...defaultReport.filters,
          ...(responseData?.filters || {}),
        },
        pagination: {
          ...defaultReport.pagination,
          ...(responseData?.pagination || {}),
        },
      });
    } catch (err) {
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load QC report mismatch.");
    } finally {
      setLoading(false);
    }
  }, [
    brandFilter,
    customDays,
    fromDate,
    inspectorFilter,
    itemCodeFilter,
    limit,
    mismatchOnly,
    orderIdFilter,
    page,
    statusFilter,
    timeline,
    toDate,
    vendorFilter,
  ]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextTimeline = normalizeTimeline(searchParams.get("timeline"));
    const nextCustomDays = parseCustomDays(searchParams.get("custom_days"));
    const nextDateRange = getDateRangeFromSearchParams(
      searchParams,
      nextTimeline,
      nextCustomDays,
    );
    const nextBrandFilter = normalizeFilterValue(searchParams.get("brand"));
    const nextVendorFilter = normalizeFilterValue(searchParams.get("vendor"));
    const nextInspectorFilter = normalizeFilterValue(searchParams.get("inspector"));
    const nextStatusFilter = normalizeFilterValue(searchParams.get("status"));
    const nextOrderIdFilter = normalizeTextValue(searchParams.get("order_id"));
    const nextItemCodeFilter = normalizeTextValue(searchParams.get("item_code"));
    const nextMismatchOnly = normalizeBooleanParam(
      searchParams.get("mismatch_only"),
      false,
    );
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setDraftTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
    setDraftCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
    setFromDate((prev) => (prev === nextDateRange.from_date ? prev : nextDateRange.from_date));
    setDraftFromDate((prev) => (
      prev === nextDateRange.from_date ? prev : nextDateRange.from_date
    ));
    setToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setDraftToDate((prev) => (prev === nextDateRange.to_date ? prev : nextDateRange.to_date));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setInspectorFilter((prev) => (
      prev === nextInspectorFilter ? prev : nextInspectorFilter
    ));
    setDraftInspectorFilter((prev) => (
      prev === nextInspectorFilter ? prev : nextInspectorFilter
    ));
    setStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
    setDraftStatusFilter((prev) => (
      prev === nextStatusFilter ? prev : nextStatusFilter
    ));
    setOrderIdFilter((prev) => (prev === nextOrderIdFilter ? prev : nextOrderIdFilter));
    setDraftOrderIdFilter((prev) => (
      prev === nextOrderIdFilter ? prev : nextOrderIdFilter
    ));
    setItemCodeFilter((prev) => (prev === nextItemCodeFilter ? prev : nextItemCodeFilter));
    setDraftItemCodeFilter((prev) => (
      prev === nextItemCodeFilter ? prev : nextItemCodeFilter
    ));
    setMismatchOnly((prev) => (prev === nextMismatchOnly ? prev : nextMismatchOnly));
    setDraftMismatchOnly((prev) => (prev === nextMismatchOnly ? prev : nextMismatchOnly));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (timeline !== DEFAULT_TIMELINE) {
      next.set("timeline", timeline);
    }
    if (timeline === "custom") {
      next.set("custom_days", String(customDays));
    }
    next.set("from_date", fromDate);
    next.set("to_date", toDate);
    if (brandFilter !== DEFAULT_FILTER) {
      next.set("brand", brandFilter);
    }
    if (vendorFilter !== DEFAULT_FILTER) {
      next.set("vendor", vendorFilter);
    }
    if (inspectorFilter !== DEFAULT_FILTER) {
      next.set("inspector", inspectorFilter);
    }
    if (statusFilter !== DEFAULT_FILTER) {
      next.set("status", statusFilter);
    }
    if (orderIdFilter) {
      next.set("order_id", orderIdFilter);
    }
    if (itemCodeFilter) {
      next.set("item_code", itemCodeFilter);
    }
    if (mismatchOnly) {
      next.set("mismatch_only", "true");
    }
    if (page !== 1) {
      next.set("page", String(page));
    }
    if (limit !== DEFAULT_LIMIT) {
      next.set("limit", String(limit));
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    customDays,
    fromDate,
    inspectorFilter,
    itemCodeFilter,
    limit,
    mismatchOnly,
    orderIdFilter,
    page,
    searchParams,
    setSearchParams,
    statusFilter,
    syncedQuery,
    timeline,
    toDate,
    vendorFilter,
  ]);

  const handleTimelineChange = useCallback((event) => {
    const nextTimeline = normalizeTimeline(event.target.value);
    const nextRange = getDateRangeFromTimeline(nextTimeline, draftCustomDays);
    setDraftTimeline(nextTimeline);
    setDraftFromDate(nextRange.from_date);
    setDraftToDate(nextRange.to_date);
  }, [draftCustomDays]);

  const handleCustomDaysChange = useCallback((event) => {
    const nextCustomDays = parseCustomDays(event.target.value);
    setDraftCustomDays(nextCustomDays);
    if (draftTimeline === "custom") {
      const nextRange = getDateRangeFromTimeline("custom", nextCustomDays);
      setDraftFromDate(nextRange.from_date);
      setDraftToDate(nextRange.to_date);
    }
  }, [draftTimeline]);

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setTimeline(normalizeTimeline(draftTimeline));
    setCustomDays(parseCustomDays(draftCustomDays));
    setFromDate(toISODateString(draftFromDate) || fromDate);
    setToDate(toISODateString(draftToDate) || toDate);
    setBrandFilter(normalizeFilterValue(draftBrandFilter));
    setVendorFilter(normalizeFilterValue(draftVendorFilter));
    setInspectorFilter(normalizeFilterValue(draftInspectorFilter));
    setStatusFilter(normalizeFilterValue(draftStatusFilter));
    setOrderIdFilter(normalizeTextValue(draftOrderIdFilter));
    setItemCodeFilter(normalizeTextValue(draftItemCodeFilter));
    setMismatchOnly(Boolean(draftMismatchOnly));
    setPage(1);
  }, [
    draftBrandFilter,
    draftCustomDays,
    draftFromDate,
    draftInspectorFilter,
    draftItemCodeFilter,
    draftMismatchOnly,
    draftOrderIdFilter,
    draftStatusFilter,
    draftTimeline,
    draftToDate,
    draftVendorFilter,
    fromDate,
    toDate,
  ]);

  const handleClearFilters = useCallback(() => {
    const defaultRange = getDateRangeFromTimeline(DEFAULT_TIMELINE, DEFAULT_CUSTOM_DAYS);
    setDraftTimeline(DEFAULT_TIMELINE);
    setDraftCustomDays(DEFAULT_CUSTOM_DAYS);
    setDraftFromDate(defaultRange.from_date);
    setDraftToDate(defaultRange.to_date);
    setDraftBrandFilter(DEFAULT_FILTER);
    setDraftVendorFilter(DEFAULT_FILTER);
    setDraftInspectorFilter(DEFAULT_FILTER);
    setDraftStatusFilter(DEFAULT_FILTER);
    setDraftOrderIdFilter("");
    setDraftItemCodeFilter("");
    setDraftMismatchOnly(false);
    setTimeline(DEFAULT_TIMELINE);
    setCustomDays(DEFAULT_CUSTOM_DAYS);
    setFromDate(defaultRange.from_date);
    setToDate(defaultRange.to_date);
    setBrandFilter(DEFAULT_FILTER);
    setVendorFilter(DEFAULT_FILTER);
    setInspectorFilter(DEFAULT_FILTER);
    setStatusFilter(DEFAULT_FILTER);
    setOrderIdFilter("");
    setItemCodeFilter("");
    setMismatchOnly(false);
    setPage(1);
    setLimit(DEFAULT_LIMIT);
  }, []);

  const filters = report?.filters || defaultReport.filters;
  const summary = report?.summary || defaultReport.summary;
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const pagination = report?.pagination || defaultReport.pagination;
  const selectedInspectionRecords = useMemo(
    () => (Array.isArray(selectedRow?.inspection_records) ? selectedRow.inspection_records : []),
    [selectedRow],
  );
  const itemDetailRows = useMemo(() => {
    if (!selectedRow) return [];
    return buildSheetRows({
      inspections: selectedInspectionRecords,
      currentEntries: selectedRow?.current_qc_inspected_item_sizes,
      labelPrefix: "Item Size",
      fields: ITEM_SIZE_FIELDS,
      snapshotKey: "inspected_item_sizes",
      mismatchKey: "item_size_mismatches",
    });
  }, [selectedInspectionRecords, selectedRow]);

  const boxDetailRows = useMemo(() => {
    if (!selectedRow) return [];
    return buildSheetRows({
      inspections: selectedInspectionRecords,
      currentEntries: selectedRow?.current_qc_inspected_box_sizes,
      labelPrefix: "Box Size",
      fields: BOX_SIZE_FIELDS,
      snapshotKey: "inspected_box_sizes",
      mismatchKey: "box_size_mismatches",
    });
  }, [selectedInspectionRecords, selectedRow]);

  const boxModeRows = useMemo(() => {
    if (!selectedRow) return [];
    return buildBoxModeSheetRows({
      inspections: selectedInspectionRecords,
      currentMode: selectedRow?.current_qc_inspected_box_mode,
    });
  }, [selectedInspectionRecords, selectedRow]);

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h4 mb-0">QC Report Mismatch</h2>
          <span className="small text-secondary">
            All inspection snapshots vs current inspected sizes
          </span>
        </div>

        <div className="card om-card mb-3">
          <form className="card-body row g-2 align-items-end" onSubmit={handleApplyFilters}>
            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">Timeline</label>
              <select
                className="form-select"
                value={draftTimeline}
                onChange={handleTimelineChange}
              >
                <option value="1m">Last 1 month</option>
                <option value="3m">Last 3 months</option>
                <option value="6m">Last 6 months</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {draftTimeline === "custom" && (
              <div className="col-lg-2 col-md-4">
                <label className="form-label mb-1">Custom Days</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  className="form-control"
                  value={draftCustomDays}
                  onChange={handleCustomDaysChange}
                />
              </div>
            )}

            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">From</label>
              <input
                type="date"
                className="form-control"
                value={draftFromDate}
                max={draftToDate}
                onChange={(event) => setDraftFromDate(toISODateString(event.target.value) || draftFromDate)}
              />
            </div>

            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">To</label>
              <input
                type="date"
                className="form-control"
                value={draftToDate}
                min={draftFromDate}
                onChange={(event) => setDraftToDate(toISODateString(event.target.value) || draftToDate)}
              />
            </div>

            <div className="col-lg-2 col-md-4">
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

            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={draftVendorFilter}
                onChange={(event) => setDraftVendorFilter(event.target.value)}
              >
                <option value={DEFAULT_FILTER}>All Vendors</option>
                {(Array.isArray(filters.vendor_options) ? filters.vendor_options : []).map((vendorOption) => (
                  <option key={vendorOption} value={vendorOption}>
                    {vendorOption}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">Inspector</label>
              <select
                className="form-select"
                value={draftInspectorFilter}
                onChange={(event) => setDraftInspectorFilter(event.target.value)}
              >
                <option value={DEFAULT_FILTER}>All Inspectors</option>
                {(Array.isArray(filters.inspector_options) ? filters.inspector_options : []).map((option) => (
                  <option key={option?._id} value={option?._id}>
                    {option?.name || "Unknown"}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">Status</label>
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

            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">PO / Order ID</label>
              <input
                type="text"
                className="form-control"
                value={draftOrderIdFilter}
                placeholder="Search PO"
                onChange={(event) => setDraftOrderIdFilter(event.target.value)}
              />
            </div>

            <div className="col-lg-2 col-md-4">
              <label className="form-label mb-1">Item Code</label>
              <input
                type="text"
                className="form-control"
                value={draftItemCodeFilter}
                placeholder="Search item"
                onChange={(event) => setDraftItemCodeFilter(event.target.value)}
              />
            </div>

            <div className="col-lg-2 col-md-4">
              <div className="form-check mt-4 pt-2">
                <input
                  id="qc-report-mismatch-only"
                  type="checkbox"
                  className="form-check-input"
                  checked={draftMismatchOnly}
                  onChange={(event) => setDraftMismatchOnly(event.target.checked)}
                />
                <label htmlFor="qc-report-mismatch-only" className="form-check-label">
                  Show mismatch only
                </label>
              </div>
            </div>

            <div className="col-12 d-flex flex-wrap justify-content-end gap-2 mt-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={handleClearFilters}
                disabled={loading}
              >
                Clear
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? "Loading..." : "Apply"}
              </button>
            </div>
          </form>
        </div>

        <div className="row g-3 mb-3">
          <SummaryCard label="Total Inspections" value={summary.total_inspections ?? 0} />
          <SummaryCard label="Mismatch Inspections" value={summary.mismatch_inspections ?? 0} />
          <SummaryCard label="Clean Inspections" value={summary.clean_inspections ?? 0} />
          <SummaryCard label="Item Size Mismatches" value={summary.item_size_mismatch_count ?? 0} />
          <SummaryCard label="Box Size Mismatches" value={summary.box_size_mismatch_count ?? 0} />
          <SummaryCard label="Box Mode Mismatches" value={summary.box_mode_mismatch_count ?? 0} />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">
              Range: {formatDateDDMMYYYY(filters.from_date)} - {formatDateDDMMYYYY(filters.to_date)}
            </span>
            <span className="om-summary-chip">
              Rows: {pagination.total ?? 0}
            </span>
            <span className="om-summary-chip">
              Mismatch Only: {filters.mismatch_only ? "Yes" : "No"}
            </span>
            <span className="om-summary-chip">
              Page: {pagination.page ?? 1}
            </span>
            <span className="om-summary-chip">
              Limit: {pagination.limit ?? DEFAULT_LIMIT}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5">Loading QC report mismatch...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-5 text-secondary">
                No inspection records found for the selected filters.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>PO / Order ID</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Item Code</th>
                      <th>Item Description</th>
                      <th>Inspector</th>
                      <th>Requested Date</th>
                      <th>Inspection Date</th>
                      <th>Status</th>
                      <th>Checked</th>
                      <th>Passed</th>
                      <th>Box Mode</th>
                      <th>Mismatch Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const hasMismatch = Boolean(row?.mismatch_summary?.has_mismatch);
                      return (
                        <tr key={row?.inspection_id || row?.id}>
                          <td>{row?.order_id || "N/A"}</td>
                          <td>{row?.brand || "N/A"}</td>
                          <td>{row?.vendor || "N/A"}</td>
                          <td>{row?.item_code || "N/A"}</td>
                          <td>{row?.item_description || "N/A"}</td>
                          <td>{row?.inspector_name || "Unassigned"}</td>
                          <td>{formatDateDDMMYYYY(row?.requested_date)}</td>
                          <td>{formatDateDDMMYYYY(row?.inspection_date)}</td>
                          <td>{row?.status || "N/A"}</td>
                          <td>
                            <div>{row?.checked ?? 0}</div>
                            <div className="small text-secondary">
                              {row?.inspection_count || 0} inspections
                            </div>
                          </td>
                          <td>
                            <div>{row?.passed ?? 0}</div>
                            <div className="small text-secondary">
                              Pending: {row?.pending_after ?? 0}
                            </div>
                          </td>
                          <td>
                            <div className="small">
                              <div>Current: {formatBoxModeLabel(row?.current_qc_inspected_box_mode)}</div>
                              <div className="text-secondary">
                                Records: {row?.inspection_count || 0}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${hasMismatch ? "text-bg-danger" : "text-bg-success"}`}>
                              {hasMismatch ? "Mismatch" : "Matched"}
                            </span>
                            <div className="small text-secondary mt-1">
                              {row?.mismatch_summary?.mismatch_inspection_count || 0} / {row?.inspection_count || 0} inspections
                            </div>
                            {hasMismatch ? (
                              <div className="small text-secondary">
                                {row?.mismatch_summary?.mismatch_count || 0} fields
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => setSelectedRow(row)}
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
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
              {LIMIT_OPTIONS.map((limitOption) => (
                <option key={limitOption} value={limitOption}>
                  {limitOption}
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

      {selectedRow && (
        <div
          className="modal d-block om-modal-backdrop"
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedRow(null)}
        >
          <div
            className="modal-dialog modal-dialog-centered modal-xl"
            role="document"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <div>
                  <h5 className="modal-title">QC Report Mismatch Details</h5>
                  <div className="small text-muted">
                    {selectedRow?.order_id || "N/A"} | {selectedRow?.item_code || "N/A"} |{" "}
                    {selectedRow?.inspection_count || 0} inspections
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setSelectedRow(null)}
                />
              </div>

              <div className="modal-body">
                <div className="d-flex flex-wrap gap-2 mb-3">
                  <span className="om-summary-chip">
                    Latest Requested: {formatDateDDMMYYYY(selectedRow?.requested_date)}
                  </span>
                  <span className="om-summary-chip">
                    Latest Inspected: {formatDateDDMMYYYY(selectedRow?.inspection_date)}
                  </span>
                  <span className="om-summary-chip">
                    Total Checked: {selectedRow?.checked ?? 0}
                  </span>
                  <span className="om-summary-chip">
                    Total Passed: {selectedRow?.passed ?? 0}
                  </span>
                  <span className="om-summary-chip">
                    Pending After: {selectedRow?.pending_after ?? 0}
                  </span>
                  <span className="om-summary-chip">
                    Mismatch Inspections: {selectedRow?.mismatch_summary?.mismatch_inspection_count || 0}
                  </span>
                </div>

                {[
                  { title: "Item Sizes", rows: itemDetailRows },
                  { title: "Box Sizes", rows: boxDetailRows },
                  { title: "Box Mode", rows: boxModeRows },
                ].map((section) => (
                  <section key={section.title} className="mb-4">
                    <h6 className="mb-2">{section.title}</h6>
                    {section.rows.length === 0 ? (
                      <div className="text-secondary small">No saved comparison rows.</div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Field</th>
                              <th>Current QC Value</th>
                              {selectedInspectionRecords.map((inspection) => (
                                <th key={inspection?.inspection_id || inspection?.sheet_label}>
                                  <div>{inspection?.sheet_label || "Inspection"}</div>
                                  <div className="small text-secondary fw-normal">
                                    {formatDateDDMMYYYY(inspection?.inspection_date)}
                                  </div>
                                  <div className="small text-secondary fw-normal">
                                    {inspection?.inspector_name || "Unassigned"}
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {section.rows.map((entry) => (
                              <tr
                                key={entry.key}
                                className={entry.is_mismatch ? "table-warning" : ""}
                              >
                                <td>{entry.field}</td>
                                <td>{entry.current_value}</td>
                                {entry.inspection_cells.map((cell) => (
                                  <td
                                    key={cell.key}
                                    className={cell.is_mismatch ? "table-danger" : ""}
                                  >
                                    <div>{cell.value}</div>
                                    <div className="small text-secondary">
                                      {cell.is_mismatch ? "Mismatch" : "Matched"}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                ))}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setSelectedRow(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default QcReportMismatch;
