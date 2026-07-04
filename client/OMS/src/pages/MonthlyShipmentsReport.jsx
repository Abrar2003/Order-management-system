import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { formatCbm } from "../utils/cbm";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_TAB = "overall";
const DEFAULT_PERIOD_MODE = "last-six-months";
const TAB_OPTIONS = Object.freeze([
  { key: "overall", label: "Overall" },
  { key: "by-brand", label: "By Brand" },
  { key: "by-vendor", label: "By Vendor" },
]);
const PERIOD_OPTIONS = Object.freeze([
  { value: "last-six-months", label: "Last 6 Completed Months" },
  { value: "month", label: "Month Selection" },
  { value: "custom", label: "Custom Date Range" },
]);
const MONTH_OPTIONS = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((label, index) => ({ label, value: String(index + 1) })));

const BRAND_COLORS = Object.freeze([
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#ca8a04",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#4d7c0f",
  "#ea580c",
  "#0f766e",
  "#9333ea",
  "#475569",
]);

const emptyReport = {
  period: {
    mode: DEFAULT_PERIOD_MODE,
    from_date: "",
    to_date: "",
    label: "",
    months: [],
  },
  filters: {
    country: "",
    brand: "",
    vendor: "",
    selected_vendor: "",
    options: {
      countries: [],
      brands: [],
      vendors: [],
    },
  },
  summary: {
    total_unique_containers: 0,
    total_allocated_cbm: 0,
    vendors_count: 0,
  },
  overall: { vendor_totals: [] },
  by_brand: { brands: [] },
  by_vendor: {
    distribution: { brands: [], rows: [] },
    monthly_trend: { vendor: "", brands: [], rows: [] },
    selected_vendor: "",
  },
};

const normalizeTab = (value) =>
  TAB_OPTIONS.some((option) => option.key === value) ? value : DEFAULT_TAB;

const normalizePeriodMode = (value) =>
  PERIOD_OPTIONS.some((option) => option.value === value)
    ? value
    : DEFAULT_PERIOD_MODE;

const normalizeFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return "";
  }
  return normalized;
};

const getPreviousMonthSelection = () => {
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  return {
    year: String(year),
    month: String(month),
  };
};

const buildYearOptions = () => {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear + 1; year >= currentYear - 8; year -= 1) {
    years.push(String(year));
  }
  return years;
};

const getBrandColor = (brand, index = 0) =>
  BRAND_COLORS[index % BRAND_COLORS.length] || BRAND_COLORS[0];

const formatNumber = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
};

const getBarPayload = (entry) => entry?.payload || entry || {};

const getSeriesMeta = (row, seriesEntry = {}) => {
  const meta = row?.__meta || {};
  if (seriesEntry.key && meta[seriesEntry.key]) return meta[seriesEntry.key];
  const brandKey = normalizeKey(seriesEntry.brand);
  return Object.values(meta).find((entry) => normalizeKey(entry?.brand) === brandKey) || {};
};

const getTooltipSeriesMeta = (item) => {
  const row = getBarPayload(item);
  const meta = row?.__meta || {};
  if (item?.dataKey && meta[item.dataKey]) return meta[item.dataKey];
  const brandKey = normalizeKey(item?.name);
  return Object.values(meta).find((entry) => normalizeKey(entry?.brand) === brandKey) || {};
};

const getTooltipAxisValue = ({ row, label, xKey } = {}) =>
  row?.[xKey] || label || "N/A";

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const getAdaptiveBarSize = ({
  chartWidth,
  itemCount,
  seriesCount = 1,
  minSize = 5,
  maxSize = 44,
} = {}) => {
  const width = Math.max(1, Number(chartWidth || 0));
  const items = Math.max(1, Number(itemCount || 0));
  const series = Math.max(1, Number(seriesCount || 1));
  const drawableWidth = Math.max(1, width - 120);
  const categoryWidth = drawableWidth / items;
  const targetSize = (categoryWidth * 0.52) / series;
  return Math.round(clampNumber(targetSize, minSize, maxSize));
};

const KpiTile = ({ label, value }) => (
  <div className="monthly-shipments-kpi">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const EmptyState = ({ children }) => (
  <div className="card om-card monthly-shipments-state">
    <div className="card-body text-secondary">{children}</div>
  </div>
);

const ChartFrame = ({ children, height = 340 }) => {
  const frameRef = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;

    const updateWidth = () => {
      setWidth(Math.max(1, Math.floor(frame.getBoundingClientRect().width || 0)));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className="monthly-shipments-chart-frame" style={{ height }}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  );
};

const TooltipBox = ({ title, rows }) => (
  <div className="monthly-shipments-tooltip">
    <div className="fw-semibold mb-1">{title}</div>
    {rows.map((row) => (
      <div key={row.label} className="d-flex justify-content-between gap-3">
        <span className="text-secondary">{row.label}</span>
        <span className="fw-semibold text-end">{row.value}</span>
      </div>
    ))}
  </div>
);

const OverallTooltip = ({ active, payload, periodLabel }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <TooltipBox
      title={row.vendor || "Vendor"}
      rows={[
        { label: "Containers", value: formatNumber(row.containers) },
        { label: "Allocated CBM", value: formatCbm(row.cbm) },
        { label: "Period", value: periodLabel || "N/A" },
      ]}
    />
  );
};

const GroupedTooltip = ({ active, payload, label, periodLabel, xLabel, xKey }) => {
  if (!active || !payload?.length) return null;
  const item = payload.find((entry) => Number(entry?.value || 0) > 0) || payload[0];
  const row = getBarPayload(item);
  const meta = getTooltipSeriesMeta(item);
  const brand = meta.brand || String(item?.name || item?.dataKey || "");
  const axisValue = getTooltipAxisValue({ row, label, xKey });
  return (
    <TooltipBox
      title={brand || axisValue || "Brand"}
      rows={[
        { label: xLabel, value: axisValue },
        { label: "Containers", value: formatNumber(meta.unique_container_count ?? item?.value) },
        { label: "Allocated CBM", value: formatCbm(meta.total_allocated_cbm) },
        { label: "Period", value: periodLabel || "N/A" },
      ]}
    />
  );
};

const toSingleBarRows = (rows = [], labelKey = "vendor") =>
  rows.map((entry) => ({
    [labelKey]: entry?.[labelKey] || "N/A",
    containers: Number(entry?.unique_container_count || 0),
    cbm: Number(entry?.total_allocated_cbm || 0),
  }));

const toBrandSeries = (brands = []) =>
  (Array.isArray(brands) ? brands : []).map((brand, index) => ({
    brand,
    key: `brand_${index}`,
  }));

const toGroupedRows = ({ rows = [], series = [], xKey = "vendor" } = {}) =>
  rows.map((entry) => {
    const chartRow = {
      [xKey]: entry?.[xKey] || "N/A",
      __meta: {},
    };
    series.forEach((seriesEntry) => {
      const total = (entry?.totals || []).find(
        (item) => item?.brand === seriesEntry.brand,
      );
      chartRow[seriesEntry.key] = Number(total?.unique_container_count || 0);
      chartRow.__meta[seriesEntry.key] = {
        brand: seriesEntry.brand,
        unique_container_count: Number(total?.unique_container_count || 0),
        total_allocated_cbm: Number(total?.total_allocated_cbm || 0),
      };
    });
    return chartRow;
  });

const toMonthlyRows = ({ rows = [], series = [] } = {}) =>
  rows.map((entry) => {
    const chartRow = {
      month: entry?.month || "",
      month_label: entry?.month_label || entry?.month || "N/A",
      __meta: {},
    };
    series.forEach((seriesEntry) => {
      const total = (entry?.totals || []).find(
        (item) => item?.brand === seriesEntry.brand,
      );
      chartRow[seriesEntry.key] = Number(total?.unique_container_count || 0);
      chartRow.__meta[seriesEntry.key] = {
        brand: seriesEntry.brand,
        unique_container_count: Number(total?.unique_container_count || 0),
        total_allocated_cbm: Number(total?.total_allocated_cbm || 0),
      };
    });
    return chartRow;
  });

const DetailModal = ({ detail, onClose, onOpenContainer }) => {
  if (!detail?.open) return null;
  const rows = Array.isArray(detail.rows) ? detail.rows : [];

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-xl">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{detail.title || "Containers"}</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
            />
          </div>
          <div className="modal-body">
            <div className="d-flex flex-wrap gap-2 mb-3">
              <span className="om-summary-chip">
                Containers: {detail.summary?.total_unique_containers ?? rows.length}
              </span>
              <span className="om-summary-chip">
                Allocated CBM: {formatCbm(detail.summary?.total_allocated_cbm)}
              </span>
            </div>

            {detail.loading ? (
              <div className="text-secondary py-4">Loading containers...</div>
            ) : detail.error ? (
              <div className="alert alert-danger mb-0" role="alert">
                {detail.error}
              </div>
            ) : rows.length === 0 ? (
              <div className="text-secondary py-4">
                No containers found for this selection.
              </div>
            ) : (
              <div className="table-responsive monthly-shipments-detail-table">
                <table className="table table-sm table-striped align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Container</th>
                      <th>Vendor</th>
                      <th>Brands</th>
                      <th>Stuffing Date</th>
                      <th>POs</th>
                      <th>Country</th>
                      <th>Allocated CBM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const container = String(row.container || "").trim();
                      const canOpenContainer = Boolean(container);
                      const handleOpenContainer = () => {
                        if (canOpenContainer) onOpenContainer(container);
                      };

                      return (
                      <tr
                        key={row.container}
                        className={canOpenContainer ? "monthly-shipments-detail-row" : ""}
                        role={canOpenContainer ? "button" : undefined}
                        tabIndex={canOpenContainer ? 0 : undefined}
                        title={canOpenContainer ? "Open shipments filtered by this container" : undefined}
                        onClick={handleOpenContainer}
                        onKeyDown={(event) => {
                          if (!canOpenContainer) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleOpenContainer();
                          }
                        }}
                      >
                        <td>{row.container || "N/A"}</td>
                        <td>{row.vendor || "N/A"}</td>
                        <td>{(row.brands || []).join(", ") || "N/A"}</td>
                        <td>
                          {row.stuffing_date_from === row.stuffing_date_to
                            ? formatDateDDMMYYYY(row.stuffing_date_from)
                            : `${formatDateDDMMYYYY(row.stuffing_date_from)} - ${formatDateDDMMYYYY(row.stuffing_date_to)}`}
                        </td>
                        <td>{(row.order_ids || []).join(", ") || "N/A"}</td>
                        <td>{(row.countries || []).join(", ") || "N/A"}</td>
                        <td>{formatCbm(row.allocated_cbm)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const MonthlyShipmentsReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultMonthSelection = getPreviousMonthSelection();

  const [activeTab, setActiveTab] = useState(() =>
    normalizeTab(searchParams.get("tab")),
  );
  const [periodMode, setPeriodMode] = useState(() =>
    normalizePeriodMode(searchParams.get("period_mode")),
  );
  const [selectedYear, setSelectedYear] = useState(() =>
    searchParams.get("year") || defaultMonthSelection.year,
  );
  const [selectedMonth, setSelectedMonth] = useState(() =>
    searchParams.get("month") || defaultMonthSelection.month,
  );
  const [fromDate, setFromDate] = useState(() =>
    toISODateString(searchParams.get("from_date")) || "",
  );
  const [toDate, setToDate] = useState(() =>
    toISODateString(searchParams.get("to_date")) || "",
  );
  const [countryFilter, setCountryFilter] = useState(() =>
    normalizeFilter(searchParams.get("country")),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilter(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilter(searchParams.get("vendor")),
  );
  const [selectedVendor, setSelectedVendor] = useState(() =>
    normalizeFilter(searchParams.get("selected_vendor")),
  );
  const [report, setReport] = useState(emptyReport);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsedBrands, setCollapsedBrands] = useState(() => new Set());
  const [detail, setDetail] = useState({
    open: false,
    loading: false,
    error: "",
    rows: [],
    summary: {},
    title: "",
  });

  const yearOptions = useMemo(buildYearOptions, []);

  const includeGlobalVendorFilter = activeTab !== "by-vendor";

  const requestParams = useMemo(() => {
    const params = {
      period_mode: periodMode,
    };
    if (periodMode === "month") {
      params.year = selectedYear;
      params.month = selectedMonth;
    }
    if (periodMode === "custom") {
      params.from_date = fromDate;
      params.to_date = toDate;
    }
    if (countryFilter) params.country = countryFilter;
    if (brandFilter) params.brand = brandFilter;
    if (includeGlobalVendorFilter && vendorFilter) params.vendor = vendorFilter;
    if (selectedVendor) params.selected_vendor = selectedVendor;
    return params;
  }, [
    brandFilter,
    countryFilter,
    fromDate,
    includeGlobalVendorFilter,
    periodMode,
    selectedMonth,
    selectedVendor,
    selectedYear,
    toDate,
    vendorFilter,
  ]);

  const validationError = useMemo(() => {
    if (periodMode === "custom") {
      if (!fromDate || !toDate) {
        return "From date and To date are required for a custom range.";
      }
      if (fromDate > toDate) {
        return "To date cannot be before From date.";
      }
    }
    return "";
  }, [fromDate, periodMode, toDate]);

  const fetchReport = useCallback(async () => {
    if (validationError) {
      setReport(emptyReport);
      setError(validationError);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/monthly-shipments", {
        params: requestParams,
      });
      const data = response?.data || {};
      setReport({
        ...emptyReport,
        ...data,
        filters: {
          ...emptyReport.filters,
          ...(data.filters || {}),
          options: {
            ...emptyReport.filters.options,
            ...(data.filters?.options || {}),
          },
        },
        overall: {
          ...emptyReport.overall,
          ...(data.overall || {}),
        },
        by_brand: {
          ...emptyReport.by_brand,
          ...(data.by_brand || {}),
        },
        by_vendor: {
          ...emptyReport.by_vendor,
          ...(data.by_vendor || {}),
          distribution: {
            ...emptyReport.by_vendor.distribution,
            ...(data.by_vendor?.distribution || {}),
          },
          monthly_trend: {
            ...emptyReport.by_vendor.monthly_trend,
            ...(data.by_vendor?.monthly_trend || {}),
          },
        },
      });
      const responseSelectedVendor = normalizeFilter(
        data?.filters?.selected_vendor || data?.by_vendor?.selected_vendor,
      );
      if (!selectedVendor && responseSelectedVendor) {
        setSelectedVendor(responseSelectedVendor);
      }
    } catch (err) {
      setReport(emptyReport);
      setError(
        err?.response?.data?.message || "Failed to load monthly shipments report.",
      );
    } finally {
      setLoading(false);
    }
  }, [requestParams, selectedVendor, validationError]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== DEFAULT_TAB) next.set("tab", activeTab);
    if (periodMode !== DEFAULT_PERIOD_MODE) next.set("period_mode", periodMode);
    if (periodMode === "month") {
      next.set("year", selectedYear);
      next.set("month", selectedMonth);
    }
    if (periodMode === "custom") {
      next.set("from_date", fromDate);
      next.set("to_date", toDate);
    }
    if (countryFilter) next.set("country", countryFilter);
    if (brandFilter) next.set("brand", brandFilter);
    if (includeGlobalVendorFilter && vendorFilter) next.set("vendor", vendorFilter);
    if (selectedVendor) next.set("selected_vendor", selectedVendor);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    activeTab,
    brandFilter,
    countryFilter,
    fromDate,
    includeGlobalVendorFilter,
    periodMode,
    searchParams,
    selectedMonth,
    selectedVendor,
    selectedYear,
    setSearchParams,
    toDate,
    vendorFilter,
  ]);

  const options = report?.filters?.options || emptyReport.filters.options;
  const periodLabel = report?.period?.label || "N/A";
  const activeSummary = report?.summary || emptyReport.summary;
  const overallRows = useMemo(
    () => toSingleBarRows(report?.overall?.vendor_totals || [], "vendor"),
    [report?.overall?.vendor_totals],
  );
  const brandSections = useMemo(
    () => report?.by_brand?.brands || [],
    [report?.by_brand?.brands],
  );
  const distribution = report?.by_vendor?.distribution || emptyReport.by_vendor.distribution;
  const distributionBrands = distribution?.brands || [];
  const distributionSeries = useMemo(
    () => toBrandSeries(distributionBrands),
    [distributionBrands],
  );
  const distributionRows = useMemo(
    () => toGroupedRows({ rows: distribution?.rows || [], series: distributionSeries, xKey: "vendor" }),
    [distribution?.rows, distributionSeries],
  );
  const monthlyTrend = report?.by_vendor?.monthly_trend || emptyReport.by_vendor.monthly_trend;
  const monthlyBrands = monthlyTrend?.brands || [];
  const monthlySeries = useMemo(
    () => toBrandSeries(monthlyBrands),
    [monthlyBrands],
  );
  const monthlyRows = useMemo(
    () => toMonthlyRows({ rows: monthlyTrend?.rows || [], series: monthlySeries }),
    [monthlyTrend?.rows, monthlySeries],
  );
  const selectedVendorValue = selectedVendor || report?.filters?.selected_vendor || "";

  useEffect(() => {
    if (brandSections.length <= 5) {
      setCollapsedBrands(new Set());
      return;
    }
    setCollapsedBrands(
      new Set(brandSections.slice(4).map((entry) => String(entry?.brand || ""))),
    );
  }, [brandSections]);

  const handlePeriodModeChange = (value) => {
    const nextMode = normalizePeriodMode(value);
    setPeriodMode(nextMode);
    if (nextMode === "month") {
      const fallback = getPreviousMonthSelection();
      setSelectedYear((prev) => prev || fallback.year);
      setSelectedMonth((prev) => prev || fallback.month);
      setFromDate("");
      setToDate("");
    }
    if (nextMode === "custom") {
      setSelectedYear("");
      setSelectedMonth("");
      setFromDate((prev) => prev || report?.period?.from_date || "");
      setToDate((prev) => prev || report?.period?.to_date || "");
    }
  };

  const handleMonthYearChange = ({ year, month }) => {
    if (year !== undefined) setSelectedYear(year);
    if (month !== undefined) setSelectedMonth(month);
    setFromDate("");
    setToDate("");
  };

  const handleCustomDateChange = ({ from, to }) => {
    setPeriodMode("custom");
    setSelectedYear("");
    setSelectedMonth("");
    if (from !== undefined) setFromDate(toISODateString(from));
    if (to !== undefined) setToDate(toISODateString(to));
  };

  const handleReset = () => {
    const fallback = getPreviousMonthSelection();
    setActiveTab(DEFAULT_TAB);
    setPeriodMode(DEFAULT_PERIOD_MODE);
    setSelectedYear(fallback.year);
    setSelectedMonth(fallback.month);
    setFromDate("");
    setToDate("");
    setCountryFilter("");
    setBrandFilter("");
    setVendorFilter("");
    setSelectedVendor("");
  };

  const fetchDetail = useCallback(
    async (detailParams, title) => {
      setDetail({
        open: true,
        loading: true,
        error: "",
        rows: [],
        summary: {},
        title,
      });
      try {
        const response = await api.get("/reports/monthly-shipments/drilldown", {
          params: {
            ...requestParams,
            ...detailParams,
          },
        });
        setDetail({
          open: true,
          loading: false,
          error: "",
          rows: Array.isArray(response?.data?.records) ? response.data.records : [],
          summary: response?.data?.summary || {},
          title,
        });
      } catch (err) {
        setDetail({
          open: true,
          loading: false,
          error:
            err?.response?.data?.message ||
            "Failed to load container drill-down.",
          rows: [],
          summary: {},
          title,
        });
      }
    },
    [requestParams],
  );

  const closeDetail = () => {
    setDetail((prev) => ({ ...prev, open: false }));
  };

  const openShipmentsForContainer = useCallback(
    (container) => {
      const normalizedContainer = String(container || "").trim();
      if (!normalizedContainer) return;
      navigate({
        pathname: "/shipments",
        search: `?container=${encodeURIComponent(normalizedContainer)}`,
      });
    },
    [navigate],
  );

  const toggleBrandSection = (brand) => {
    const key = String(brand || "");
    setCollapsedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderFilterBar = () => (
    <div className="card om-card mb-3">
      <div className="card-body">
        <div className="monthly-shipments-filter-grid">
          <div>
            <label className="form-label mb-1">Period</label>
            <select
              className="form-select"
              value={periodMode}
              onChange={(event) => handlePeriodModeChange(event.target.value)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {periodMode === "month" && (
            <>
              <div>
                <label className="form-label mb-1">Year</label>
                <select
                  className="form-select"
                  value={selectedYear}
                  onChange={(event) =>
                    handleMonthYearChange({ year: event.target.value })
                  }
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label mb-1">Month</label>
                <select
                  className="form-select"
                  value={selectedMonth}
                  onChange={(event) =>
                    handleMonthYearChange({ month: event.target.value })
                  }
                >
                  {MONTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {periodMode === "custom" && (
            <>
              <div>
                <label className="form-label mb-1">From</label>
                <input
                  type="date"
                  className="form-control"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(event) =>
                    handleCustomDateChange({ from: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="form-label mb-1">To</label>
                <input
                  type="date"
                  className="form-control"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(event) =>
                    handleCustomDateChange({ to: event.target.value })
                  }
                />
              </div>
            </>
          )}

          <div>
            <label className="form-label mb-1">Country</label>
            <select
              className="form-select"
              value={countryFilter}
              onChange={(event) => setCountryFilter(normalizeFilter(event.target.value))}
            >
              <option value="">All Countries</option>
              {(options.countries || []).map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label mb-1">Brand</label>
            <select
              className="form-select"
              value={brandFilter}
              onChange={(event) => setBrandFilter(normalizeFilter(event.target.value))}
            >
              <option value="">All Brands</option>
              {(options.brands || []).map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </div>

          {includeGlobalVendorFilter && (
            <div>
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={vendorFilter}
                onChange={(event) => setVendorFilter(normalizeFilter(event.target.value))}
              >
                <option value="">All Vendors</option>
                {(options.vendors || []).map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="monthly-shipments-filter-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={fetchReport}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleReset}
              disabled={loading}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderOverall = () => (
    <div className="d-grid gap-3">
      <div className="monthly-shipments-kpi-row">
        <KpiTile
          label="Total Unique Containers"
          value={formatNumber(activeSummary.total_unique_containers)}
        />
        <KpiTile
          label="Total Allocated CBM"
          value={formatCbm(activeSummary.total_allocated_cbm)}
        />
        <KpiTile
          label="Vendors Represented"
          value={formatNumber(activeSummary.vendors_count)}
        />
      </div>

      {overallRows.length === 0 ? (
        <EmptyState>No shipment containers found for the selected filters.</EmptyState>
      ) : (
        <div className="card om-card">
          <div className="card-body">
            <ChartFrame height={380}>
              {({ width, height }) => (
                <BarChart
                  width={width}
                  height={height}
                  data={overallRows}
                  margin={{ top: 24, right: 24, left: 0, bottom: 12 }}
                  barCategoryGap="18%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="vendor"
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={94}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip
                    content={<OverallTooltip periodLabel={periodLabel} />}
                    cursor={{ fill: "rgba(37, 99, 235, 0.08)" }}
                  />
                  <Bar
                    dataKey="containers"
                    name="Containers"
                    fill="#2563eb"
                    barSize={getAdaptiveBarSize({
                      chartWidth: width,
                      itemCount: overallRows.length,
                      maxSize: 48,
                    })}
                  >
                    {overallRows.map((row) => (
                      <Cell
                        key={`overall-${row.vendor}`}
                        cursor="pointer"
                        onClick={() => {
                          fetchDetail(
                            { detail_vendor: row.vendor },
                            `Containers - ${row.vendor || "Vendor"}`,
                          );
                        }}
                      />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ChartFrame>
          </div>
        </div>
      )}
    </div>
  );

  const renderBrandSection = (section) => {
    const brand = section?.brand || "N/A";
    const isCollapsed = collapsedBrands.has(brand);
    const rows = toSingleBarRows(section?.vendors || [], "vendor");

    return (
      <div key={brand} className="card om-card monthly-shipments-brand-section">
        <div className="card-body">
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <div>
              <h3 className="h6 mb-1">{brand}</h3>
              <div className="d-flex flex-wrap gap-2">
                <span className="om-summary-chip">
                  Containers: {formatNumber(section?.unique_container_count)}
                </span>
                <span className="om-summary-chip">
                  Allocated CBM: {formatCbm(section?.total_allocated_cbm)}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => toggleBrandSection(brand)}
            >
              {isCollapsed ? "Show" : "Hide"}
            </button>
          </div>

          {!isCollapsed && (
            rows.length === 0 ? (
              <div className="text-secondary">No vendor shipments found.</div>
            ) : (
            <ChartFrame height={360}>
                {({ width, height }) => (
                  <BarChart
                    width={width}
                    height={height}
                    data={rows}
                    margin={{ top: 24, right: 24, left: 0, bottom: 12 }}
                    barCategoryGap="18%"
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="vendor"
                      interval={0}
                      angle={-28}
                      textAnchor="end"
                      height={94}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      content={<OverallTooltip periodLabel={periodLabel} />}
                      cursor={{ fill: "rgba(22, 163, 74, 0.08)" }}
                    />
                    <Bar
                      dataKey="containers"
                      name="Containers"
                      fill="#16a34a"
                      barSize={getAdaptiveBarSize({
                        chartWidth: width,
                        itemCount: rows.length,
                        maxSize: 48,
                      })}
                    >
                      {rows.map((row) => (
                        <Cell
                          key={`${brand}-${row.vendor}`}
                          cursor="pointer"
                          onClick={() => {
                            fetchDetail(
                              {
                                detail_brand: brand,
                                detail_vendor: row.vendor,
                              },
                              `Containers - ${brand} / ${row.vendor || "Vendor"}`,
                            );
                          }}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ChartFrame>
            )
          )}
        </div>
      </div>
    );
  };

  const renderByBrand = () => (
    brandSections.length === 0 ? (
      <EmptyState>No brand shipment containers found for the selected filters.</EmptyState>
    ) : (
      <div className="d-grid gap-3">
        {brandSections.map((section) => renderBrandSection(section))}
      </div>
    )
  );

  const renderDistributionChart = () => (
    distributionRows.length === 0 || distributionBrands.length === 0 ? (
      <EmptyState>No vendor and brand shipment distribution found.</EmptyState>
    ) : (
      <div className="card om-card">
        <div className="card-body">
          <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
            <h3 className="h6 mb-0">Vendor vs Brand Container Distribution</h3>
            <span className="om-summary-chip">Period: {periodLabel}</span>
          </div>
          <ChartFrame height={410}>
            {({ width, height }) => (
              <BarChart
                width={width}
                height={height}
                data={distributionRows}
                margin={{ top: 24, right: 24, left: 0, bottom: 12 }}
                barCategoryGap="18%"
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="vendor"
                  interval={0}
                  angle={-28}
                  textAnchor="end"
                  height={98}
                  tick={{ fontSize: 12 }}
                />
                <YAxis allowDecimals={false} />
                <Tooltip
                  shared={false}
                  content={<GroupedTooltip periodLabel={periodLabel} xLabel="Vendor" xKey="vendor" />}
                  cursor={{ fill: "rgba(71, 85, 105, 0.08)" }}
                />
                <Legend />
                {distributionSeries.map((seriesEntry, index) => (
                  <Bar
                    key={seriesEntry.key}
                    dataKey={seriesEntry.key}
                    name={seriesEntry.brand}
                    fill={getBrandColor(seriesEntry.brand, index)}
                    barSize={getAdaptiveBarSize({
                      chartWidth: width,
                      itemCount: distributionRows.length,
                      seriesCount: distributionSeries.length,
                      minSize: 4,
                      maxSize: 24,
                    })}
                  >
                    {distributionRows.map((row) => {
                      const meta = getSeriesMeta(row, seriesEntry);
                      const vendor = row.vendor || "";
                      const brand = meta.brand || seriesEntry.brand;
                      return (
                        <Cell
                          key={`${seriesEntry.key}-${vendor}`}
                          cursor={Number(meta.unique_container_count || 0) > 0 ? "pointer" : "default"}
                          onClick={() => {
                            if (!vendor || Number(meta.unique_container_count || 0) <= 0) return;
                            setSelectedVendor(vendor);
                            fetchDetail(
                              {
                                detail_vendor: vendor,
                                detail_brand: brand,
                              },
                              `Containers - ${vendor || "Vendor"} / ${brand}`,
                            );
                          }}
                        />
                      );
                    })}
                  </Bar>
                ))}
              </BarChart>
            )}
          </ChartFrame>
        </div>
      </div>
    )
  );

  const renderMonthlyTrend = () => (
    <div className="card om-card">
      <div className="card-body">
        <div className="d-flex flex-wrap justify-content-between gap-2 align-items-end mb-3">
          <div>
            <h3 className="h6 mb-1">Monthly Trend</h3>
            <span className="om-summary-chip">Period: {periodLabel}</span>
          </div>
          <div className="monthly-shipments-vendor-select">
            <label className="form-label mb-1">Vendor</label>
            <select
              className="form-select"
              value={selectedVendorValue}
              onChange={(event) => setSelectedVendor(normalizeFilter(event.target.value))}
            >
              <option value="">Select Vendor</option>
              {(options.vendors || []).map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!selectedVendorValue ? (
          <div className="text-secondary">Select a vendor to load the monthly trend.</div>
        ) : monthlyRows.length === 0 || monthlyBrands.length === 0 ? (
          <div className="text-secondary">No monthly shipment trend found for this vendor.</div>
        ) : (
          <ChartFrame height={380}>
            {({ width, height }) => (
              <BarChart
                width={width}
                height={height}
                data={monthlyRows}
                margin={{ top: 24, right: 24, left: 0, bottom: 10 }}
                barCategoryGap="18%"
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month_label" interval={0} height={64} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip
                  shared={false}
                  content={<GroupedTooltip periodLabel={periodLabel} xLabel="Month" xKey="month_label" />}
                  cursor={{ fill: "rgba(71, 85, 105, 0.08)" }}
                />
                <Legend />
                {monthlySeries.map((seriesEntry, index) => (
                  <Bar
                    key={seriesEntry.key}
                    dataKey={seriesEntry.key}
                    name={seriesEntry.brand}
                    fill={getBrandColor(seriesEntry.brand, index)}
                    barSize={getAdaptiveBarSize({
                      chartWidth: width,
                      itemCount: monthlyRows.length,
                      seriesCount: monthlySeries.length,
                      minSize: 4,
                      maxSize: 24,
                    })}
                  >
                    {monthlyRows.map((row) => {
                      const meta = getSeriesMeta(row, seriesEntry);
                      const brand = meta.brand || seriesEntry.brand;
                      return (
                        <Cell
                          key={`${seriesEntry.key}-${row.month}`}
                          cursor={Number(meta.unique_container_count || 0) > 0 ? "pointer" : "default"}
                          onClick={() => {
                            if (Number(meta.unique_container_count || 0) <= 0) return;
                            fetchDetail(
                              {
                                detail_vendor: selectedVendorValue,
                                detail_brand: brand,
                                month: row.month,
                              },
                              `Containers - ${selectedVendorValue} / ${brand} / ${row.month_label || "Month"}`,
                            );
                          }}
                        />
                      );
                    })}
                  </Bar>
                ))}
              </BarChart>
            )}
          </ChartFrame>
        )}
      </div>
    </div>
  );

  const renderByVendor = () => (
    <div className="d-grid gap-3">
      {renderDistributionChart()}
      {renderMonthlyTrend()}
    </div>
  );

  const renderActiveTab = () => {
    if (loading) {
      return <EmptyState>Loading monthly shipments report...</EmptyState>;
    }
    if (error) {
      return (
        <div className="alert alert-danger mb-0" role="alert">
          {error}
        </div>
      );
    }
    if (activeTab === "by-brand") return renderByBrand();
    if (activeTab === "by-vendor") return renderByVendor();
    return renderOverall();
  };

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page monthly-shipments-page py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Monthly Shipments Reports</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <ul className="nav nav-tabs monthly-shipments-tabs">
              {TAB_OPTIONS.map((tab) => (
                <li key={tab.key} className="nav-item">
                  <button
                    type="button"
                    className={`nav-link ${activeTab === tab.key ? "active" : ""}`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {renderFilterBar()}

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Period: {periodLabel}</span>
            <span className="om-summary-chip">
              Country: {countryFilter || "all"}
            </span>
            <span className="om-summary-chip">
              Brand: {brandFilter || "all"}
            </span>
            {includeGlobalVendorFilter && (
              <span className="om-summary-chip">
                Vendor: {vendorFilter || "all"}
              </span>
            )}
          </div>
        </div>

        {renderActiveTab()}
      </div>

      <DetailModal
        detail={detail}
        onClose={closeDetail}
        onOpenContainer={openShipmentsForContainer}
      />
    </>
  );
};

export default MonthlyShipmentsReport;
