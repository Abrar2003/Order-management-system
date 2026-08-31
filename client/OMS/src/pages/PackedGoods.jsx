import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import Navbar from "../components/Navbar";
import ReportInfoBanner from "../components/ReportInfoBanner";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { formatCbm } from "../utils/cbm";
import { getOptionText } from "../utils/optionText";
import "../App.css";
import { exportElementToPdf } from "../services/pdfExport.service";

const DEFAULT_SORT_BY = "po";
const DEFAULT_SORT_ORDER = "asc";
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const DEFAULT_BRAND_FILTER = ["all"];

const normalizeFilterValue = (value, fallback = "all") => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};

const normalizeFilterValues = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .flatMap((value) => String(value || "").split(","))
        .map((value) => String(value || "").trim())
        .filter((value) => {
          const lowered = value.toLowerCase();
          return (
            value.length > 0
            && lowered !== "all"
            && lowered !== "undefined"
            && lowered !== "null"
          );
        }),
    ),
  ].sort((left, right) => left.localeCompare(right));

const normalizeBrandFilter = (values = DEFAULT_BRAND_FILTER) => {
  const normalized = normalizeFilterValues(values);
  return normalized.length > 0 ? normalized : DEFAULT_BRAND_FILTER;
};

const isAllBrandFilter = (values = DEFAULT_BRAND_FILTER) =>
  !Array.isArray(values) || values.length === 0 || values.includes("all");

const areBrandFiltersEqual = (left, right) => {
  const normalizedLeft = normalizeBrandFilter(left);
  const normalizedRight = normalizeBrandFilter(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      values.map(getOptionText).filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));


const parseSortBy = (value) => {
  const normalized = String(value || "").trim();
  const allowed = new Set([
    "previouslyPackedQuantity",
    "periodPackedQuantity",
    "totalPackedQuantity",
    "po",
    "brand",
    "vendor",
    "itemCode",
    "orderQuantity",
    "packedQuantity",
    "totalCbm",
  ]);
  return allowed.has(normalized) ? normalized : DEFAULT_SORT_BY;
};

const parseSortOrder = (value) =>
  String(value || "").trim().toLowerCase() === "desc" ? "desc" : "asc";

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const buildFilterStateFromSearchParams = (params) => {
  const brandParams = params.getAll("brand");

  return {
    brand: normalizeBrandFilter(brandParams.length > 0 ? brandParams : params.get("brand")),
    vendor: normalizeFilterValue(params.get("vendor")),
    po: normalizeFilterValue(params.get("po")),
    fromDate: params.get("from_date") || "",
    toDate: params.get("to_date") || "",
  };
};

const buildPackedGoodsSearchParams = ({
  appliedFilters,
  sortBy,
  sortOrder,
  page,
  limit,
}) => {
  const next = new URLSearchParams();

  const selectedBrands = normalizeBrandFilter(appliedFilters?.brand);
  if (!isAllBrandFilter(selectedBrands)) {
    next.set("brand", selectedBrands.join(","));
  }

  if (appliedFilters?.vendor !== "all") next.set("vendor", appliedFilters.vendor);
  if (appliedFilters?.po !== "all") next.set("po", appliedFilters.po);
  if (appliedFilters?.fromDate) next.set("from_date", appliedFilters.fromDate);
  if (appliedFilters?.toDate) next.set("to_date", appliedFilters.toDate);
  if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
  if (sortOrder !== DEFAULT_SORT_ORDER) next.set("sort_order", sortOrder);
  if (page > 1) next.set("page", String(page));
  if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
  return next;
};

const buildPackedGoodsApiQuery = (filters = {}) => {
  const params = new URLSearchParams();
  const selectedBrands = normalizeBrandFilter(filters?.brand);
  if (!isAllBrandFilter(selectedBrands)) {
    params.set("brand", selectedBrands.join(","));
  }
  if (filters?.vendor && filters.vendor !== "all") {
    params.set("vendor", filters.vendor);
  }
  if (filters?.po && filters.po !== "all") {
    params.set("order_id", filters.po);
  }
  if (filters?.fromDate) params.set("from_date", filters.fromDate);
  if (filters?.toDate) params.set("to_date", filters.toDate);
  return params;
};

const getDownloadFileName = (response, fallbackName) => {
  const disposition = String(response?.headers?.["content-disposition"] || "");
  const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : fallbackName;
};

const downloadBlobResponse = (response, fallbackName, fallbackType) => {
  const blob = new Blob([response.data], {
    type: response?.headers?.["content-type"] || fallbackType,
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = getDownloadFileName(response, fallbackName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

const PackedGoods = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "packed-goods");
  const { hasPermission } = usePermissions();

  const initialFilters = buildFilterStateFromSearchParams(searchParams);
  const initialSortBy = parseSortBy(searchParams.get("sort_by"));
  const initialSortOrder = parseSortOrder(searchParams.get("sort_order"));
  const canExportPackedGoods = hasPermission("orders", "export");

  const [allRows, setAllRows] = useState([]);
  const [availableFilters, setAvailableFilters] = useState({ brands: [], vendors: [], order_ids: [] });
  const [summary, setSummary] = useState({ total_rows: 0, previously_packed_quantity: 0, period_packed_quantity: 0, total_packed_quantity: 0, shipped_quantity: 0, total_packed_cbm: 0 });
  const [warnings, setWarnings] = useState([]);
  const [draftBrand, setDraftBrand] = useState(initialFilters.brand);
  const [draftVendor, setDraftVendor] = useState(initialFilters.vendor);
  const [draftPo, setDraftPo] = useState(initialFilters.po);
  const [draftFromDate, setDraftFromDate] = useState(initialFilters.fromDate);
  const [draftToDate, setDraftToDate] = useState(initialFilters.toDate);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() =>
    parseLimit(searchParams.get("limit")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [exportingFormat, setExportingFormat] = useState("");

  const reportRef = useRef(null);

  const fetchPackedGoods = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const query = buildPackedGoodsApiQuery(appliedFilters);
      const response = await api.get(`/orders/packed-goods?${query.toString()}`);
      const filters = response?.data?.filters || {};
      setAllRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setAvailableFilters(filters);
      setSummary(response?.data?.summary || { total_rows: 0, previously_packed_quantity: 0, period_packed_quantity: 0, total_packed_quantity: 0, shipped_quantity: 0, total_packed_cbm: 0 });
      setWarnings(Array.isArray(response?.data?.warnings) ? response.data.warnings : []);

      if (
        filters.from_date
        && filters.to_date
        && !appliedFilters.fromDate
        && !appliedFilters.toDate
      ) {
        setDraftFromDate(filters.from_date);
        setDraftToDate(filters.to_date);
        setAppliedFilters((previous) => ({
          ...previous,
          fromDate: filters.from_date,
          toDate: filters.to_date,
        }));
      }
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.message || "Failed to load packed goods.",
      );
      setAllRows([]);
      setAvailableFilters({ brands: [], vendors: [], order_ids: [] });
      setSummary({ total_rows: 0, previously_packed_quantity: 0, period_packed_quantity: 0, total_packed_quantity: 0, shipped_quantity: 0, total_packed_cbm: 0 });
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    fetchPackedGoods();
  }, [fetchPackedGoods]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextFilters = buildFilterStateFromSearchParams(searchParams);
    const nextSortBy = parseSortBy(searchParams.get("sort_by"));
    const nextSortOrder = parseSortOrder(searchParams.get("sort_order"));
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setDraftBrand((prev) => {
      return areBrandFiltersEqual(prev, nextFilters.brand) ? prev : nextFilters.brand;
    });
    setDraftVendor((prev) => (prev === nextFilters.vendor ? prev : nextFilters.vendor));
    setDraftPo((prev) => (prev === nextFilters.po ? prev : nextFilters.po));
    setDraftFromDate((prev) => (prev === nextFilters.fromDate ? prev : nextFilters.fromDate));
    setDraftToDate((prev) => (prev === nextFilters.toDate ? prev : nextFilters.toDate));
    setAppliedFilters((prev) => {
      return areBrandFiltersEqual(prev.brand, nextFilters.brand)
        && prev.vendor === nextFilters.vendor
        && prev.po === nextFilters.po
        && prev.fromDate === nextFilters.fromDate
        && prev.toDate === nextFilters.toDate
          ? prev
          : nextFilters
    });
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = buildPackedGoodsSearchParams({
      appliedFilters,
      sortBy,
      sortOrder,
      page,
      limit,
    });

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    appliedFilters,
    limit,
    page,
    searchParams,
    setSearchParams,
    sortBy,
    sortOrder,
    syncedQuery,
  ]);

  const brandOptions = useMemo(
    () => normalizeDistinctValues(availableFilters.brands),
    [availableFilters.brands],
  );
  const availableDraftVendors = useMemo(
    () => normalizeDistinctValues(availableFilters.vendors),
    [availableFilters.vendors],
  );
  const availableDraftPos = useMemo(
    () => normalizeDistinctValues(availableFilters.order_ids),
    [availableFilters.order_ids],
  );

  const sortedRows = useMemo(
    () =>
      sortClientRows(allRows, {
        sortBy,
        sortOrder,
        getSortValue: (row, column) => {
          if (column === "po") return row?.order_id;
          if (column === "brand") return row?.brand;
          if (column === "vendor") return getOptionText(row?.vendor);
          if (column === "itemCode") return row?.item_code;
          if (column === "orderQuantity") return Number(row?.order_quantity || 0);
          if (column === "previouslyPackedQuantity") return Number(row?.previously_packed_quantity || 0);
          if (column === "periodPackedQuantity") return Number(row?.period_packed_quantity || 0);
          if (column === "totalPackedQuantity") return Number(row?.total_packed_quantity || 0);
          if (column === "shippedQuantity") return Number(row?.shipped_quantity || 0);
          if (column === "packedQuantity") return Number(row?.packed_quantity || 0);
          if (column === "totalCbm") return Number(row?.total_packed_cbm || 0);
          return "";
        },
      }),
    [allRows, sortBy, sortOrder],
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedRows.length / limit)),
    [sortedRows.length, limit],
  );

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const paginatedRows = useMemo(() => {
    const startIndex = (page - 1) * limit;
    return sortedRows.slice(startIndex, startIndex + limit);
  }, [limit, page, sortedRows]);

  const hasPendingFilterChanges =
    !areBrandFiltersEqual(draftBrand, appliedFilters.brand)
    || draftVendor !== appliedFilters.vendor
    || draftPo !== appliedFilters.po
    || draftFromDate !== appliedFilters.fromDate
    || draftToDate !== appliedFilters.toDate;

  const exportGeneratedAt = useMemo(
    () => new Date().toLocaleString(),
    [appliedFilters, sortedRows.length],
  );

  const handleOpenQcDetails = useCallback((row) => {
    const qcId = String(row?.qc_id || "").trim();
    if (qcId) {
      navigate(`/qc/${encodeURIComponent(qcId)}`);
    }
  }, [navigate]);

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        sortBy,
        sortOrder,
        column,
        defaultDirection,
      );
      setPage(1);
      setSortBy(nextSortState.sortBy);
      setSortOrder(nextSortState.sortOrder);
    },
    [sortBy, sortOrder],
  );

  const handleDraftBrandChange = useCallback((event) => {
    const value = event.target.value;
    const checked = event.target.checked;

    setDraftBrand((prev) => {
      let next = [...(Array.isArray(prev) ? prev : [prev])];

      if (value === "all") {
        next = DEFAULT_BRAND_FILTER;
      } else {
        if (checked) {
          next = next.filter((v) => v !== "all");
          if (!next.includes(value)) next.push(value);
        } else {
          next = next.filter((v) => v !== value);
        }
        if (next.length === 0) {
          next = DEFAULT_BRAND_FILTER;
        }
      }
      return normalizeBrandFilter(next);
    });

    setDraftVendor("all");
    setDraftPo("all");
  }, []);

  const handleDraftVendorChange = useCallback((event) => {
    setDraftVendor(event.target.value);
    setDraftPo("all");
  }, []);

  const handleApplyFilters = useCallback(() => {
    if (draftFromDate && draftToDate && draftFromDate > draftToDate) {
      setError("From date cannot be later than To date.");
      return;
    }
    setError("");
    setPage(1);
    setAppliedFilters({
      brand: normalizeBrandFilter(draftBrand),
      vendor: draftVendor,
      po: draftPo,
      fromDate: draftFromDate,
      toDate: draftToDate,
    });
  }, [draftBrand, draftFromDate, draftPo, draftToDate, draftVendor]);

  const handleClearFilters = useCallback(() => {
    const clearedFilters = { brand: DEFAULT_BRAND_FILTER, vendor: "all", po: "all", fromDate: "", toDate: "" };
    setPage(1);
    setDraftBrand(clearedFilters.brand);
    setDraftVendor(clearedFilters.vendor);
    setDraftPo(clearedFilters.po);
    setDraftFromDate("");
    setDraftToDate("");
    setAppliedFilters(clearedFilters);
  }, []);

  const handleExportXls = useCallback(async () => {
    if (sortedRows.length === 0) return;

    try {
      setExportingFormat("xls");
      const query = buildPackedGoodsApiQuery(appliedFilters);
      query.set("format", "xls");
      const response = await api.get(
        `/orders/packed-goods/export?${query.toString()}`,
        { responseType: "blob" },
      );
      downloadBlobResponse(
        response,
        `packed-goods-${new Date().toISOString().slice(0, 10)}.xls`,
        "application/vnd.ms-excel",
      );
    } catch (exportError) {
      console.error(exportError);
      alert("Failed to export packed goods as XLS.");
    } finally {
      setExportingFormat("");
    }
  }, [appliedFilters, sortedRows.length]);

  const handleExportPdf = useCallback(async () => {
    if (!reportRef.current || loading || sortedRows.length === 0) return;

    try {
      setExportingFormat("pdf");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await exportElementToPdf({
        element: reportRef.current,
        reportKey: "packed-goods",
        filename: `packed-goods-${new Date().toISOString().slice(0, 10)}.pdf`,
        landscape: true,
        repeatHeader: {
          title: "Packed Goods",
          subtitle: "Inspection-period packed quantities, shown as of the selected period end.",
        },
      });
    } catch (pdfError) {
      console.error(pdfError);
      alert("Failed to export packed goods PDF.");
    } finally {
      setExportingFormat("");
    }
  }, [loading, sortedRows.length]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h2 className="h4 mb-1">Packed Goods</h2>
            <p className="text-secondary mb-0">
              Inspection-period packed quantities, shown as of the selected period end.
            </p>
          </div>
          {canExportPackedGoods && (
            <div className="d-flex flex-wrap justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleExportPdf}
                disabled={loading || exportingFormat !== "" || sortedRows.length === 0}
              >
                {exportingFormat === "pdf" ? "Exporting..." : "Export PDF"}
              </button>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={handleExportXls}
                disabled={loading || exportingFormat !== "" || sortedRows.length === 0}
              >
                {exportingFormat === "xls" ? "Exporting..." : "Export XLS"}
              </button>
            </div>
          )}
        </div>
        <div className="d-flex flex-wrap gap-2 mb-3">
          <span className="om-summary-chip">Rows: {summary.total_rows}</span>
          <span className="om-summary-chip">
            Brands: {appliedFilters.brand && appliedFilters.brand.length > 0 && !appliedFilters.brand.includes("all") ? appliedFilters.brand.join(', ') : "All Brands"}
          </span>
          <span className="om-summary-chip">
            Previously Packed: {summary.previously_packed_quantity}
          </span>
          <span className="om-summary-chip">
            This Period Packed: {summary.period_packed_quantity}
          </span>
          <span className="om-summary-chip">
            Total Packed: {summary.total_packed_quantity}
          </span>
          <span className="om-summary-chip">
            Shipped Quantity: {summary.shipped_quantity}
          </span>
          <span className="om-summary-chip">
            Total Packed CBM: {formatCbm(summary.total_packed_cbm)}
          </span>
        </div>

        <ReportInfoBanner
          description="Shows remaining packed and shipped quantities for the selected inspection period."
          dataShown="PO, brand, vendor, item, ordered quantity, previously packed, this-period packed, total packed, shipped quantity, and total packed CBM."
          howItWorks="The backend filters inspection history by date, brand, vendor, and PO; explicit From and To dates are inclusive."
        />

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="packed-goods-filter-bar">
              <div className="packed-goods-filter-field packed-goods-filter-field--brand dropdown">
                <label className="form-label small mb-1">Brand</label>
                <button
                  type="button"
                  className="form-select form-select-sm packed-goods-filter-trigger"
                  role="button"
                  data-bs-toggle="dropdown"
                  data-bs-auto-close="outside"
                  aria-expanded="false"
                >
                  <div className="text-truncate">
                    {isAllBrandFilter(draftBrand) ? "All Brands" : draftBrand.join(", ")}
                  </div>
                </button>
                <ul className="dropdown-menu packed-goods-filter-menu shadow">
                  <li>
                    <label className="packed-goods-filter-option" htmlFor="brand-all">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="brand-all"
                        value="all"
                        checked={draftBrand.includes("all")}
                        onChange={handleDraftBrandChange}
                      />
                      <span className="packed-goods-filter-option-label">
                        All Brands
                      </span>
                    </label>
                  </li>
                  {brandOptions.map((brand) => (
                    <li key={brand}>
                      <label
                        className="packed-goods-filter-option"
                        htmlFor={`brand-${brand}`}
                      >
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`brand-${brand}`}
                          value={brand}
                          checked={draftBrand.includes(brand)}
                          onChange={handleDraftBrandChange}
                        />
                        <span className="packed-goods-filter-option-label">
                          {brand}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="packed-goods-filter-field">
                <label className="form-label small mb-1">Vendor</label>
                <select
                  className="form-select form-select-sm"
                  value={draftVendor}
                  onChange={handleDraftVendorChange}
                >
                  <option value="all">All Vendors</option>
                  {availableDraftVendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="packed-goods-filter-field packed-goods-filter-field--po">
                <label className="form-label small mb-1">PO</label>
                <select
                  className="form-select form-select-sm"
                  value={draftPo}
                  onChange={(event) => setDraftPo(event.target.value)}
                >
                  <option value="all">All POs</option>
                  {availableDraftPos.map((po) => (
                    <option key={po} value={po}>
                      {po}
                    </option>
                  ))}
                </select>
              </div>

              <div className="packed-goods-filter-field">
                <label className="form-label small mb-1">From</label>
                <input
                  className="form-control form-control-sm"
                  type="date"
                  value={draftFromDate}
                  max={draftToDate || undefined}
                  onChange={(event) => setDraftFromDate(event.target.value)}
                />
              </div>

              <div className="packed-goods-filter-field">
                <label className="form-label small mb-1">To</label>
                <input
                  className="form-control form-control-sm"
                  type="date"
                  value={draftToDate}
                  min={draftFromDate || undefined}
                  onChange={(event) => setDraftToDate(event.target.value)}
                />
              </div>

              <div className="packed-goods-filter-field packed-goods-filter-field--limit">
                <label className="form-label small mb-1">Rows</label>
                <select
                  className="form-select form-select-sm"
                  value={limit}
                  onChange={(event) => {
                    setLimit(parseLimit(event.target.value));
                    setPage(1);
                  }}
                  disabled={loading}
                >
                  {LIMIT_OPTIONS.map((limitOption) => (
                    <option key={limitOption} value={limitOption}>
                      {limitOption}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm packed-goods-filter-button"
                onClick={handleApplyFilters}
                disabled={loading || !hasPendingFilterChanges}
              >
                Apply Filters
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm packed-goods-filter-button"
                onClick={handleClearFilters}
                disabled={
                  loading
                  || (
                    isAllBrandFilter(draftBrand)
                    && draftVendor === "all"
                    && draftPo === "all"
                    && !draftFromDate
                    && !draftToDate
                    && isAllBrandFilter(appliedFilters.brand)
                    && appliedFilters.vendor === "all"
                    && appliedFilters.po === "all"
                    && !appliedFilters.fromDate
                    && !appliedFilters.toDate
                  )
                }
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="alert alert-warning mb-3" role="alert">
            {warnings.join(" ")}
          </div>
        )}

        {canExportPackedGoods && sortedRows.length > 0 && (
          <div className="packed-goods-pdf-surface" aria-hidden="true">
            <div ref={reportRef} className="packed-goods-pdf-report">
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h2 className="h4 mb-1">Packed Goods Report</h2>
                  <p className="text-secondary mb-0">Generated {exportGeneratedAt}</p>
                </div>
                <div className="d-flex flex-wrap justify-content-end gap-2">
                  <span className="om-summary-chip">
                    Brands: {appliedFilters.brand && appliedFilters.brand.length > 0 && !appliedFilters.brand.includes("all") ? appliedFilters.brand.join(', ') : "All Brands"}
                  </span>
                  <span className="om-summary-chip">
                    Vendor: {appliedFilters.vendor === "all" ? "All Vendors" : appliedFilters.vendor}
                  </span>
                  <span className="om-summary-chip">
                    PO: {appliedFilters.po === "all" ? "All POs" : appliedFilters.po}
                  </span>
                  <span className="om-summary-chip">From: {appliedFilters.fromDate}</span>
                  <span className="om-summary-chip">To: {appliedFilters.toDate}</span>
                </div>
              </div>

              <div className="d-flex flex-wrap gap-2 mb-3">
                <span className="om-summary-chip">Rows: {summary.total_rows}</span>
                <span className="om-summary-chip">
                  Previously Packed: {summary.previously_packed_quantity}
                </span>
                <span className="om-summary-chip">
                  This Period Packed: {summary.period_packed_quantity}
                </span>
                <span className="om-summary-chip">
                  Total Packed: {summary.total_packed_quantity}
                </span>
                <span className="om-summary-chip">
                  Shipped Quantity: {summary.shipped_quantity}
                </span>
                <span className="om-summary-chip">
                  Total Packed CBM: {formatCbm(summary.total_packed_cbm)}
                </span>
              </div>

              <div className="d-flex flex-wrap align-items-center gap-3 mb-3 px-1" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
                <span className="small text-secondary fw-semibold">Status Legend:</span>
                <div className="d-flex align-items-center gap-2 text-nowrap" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    className="d-inline-block rounded-circle"
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      minWidth: "12px",
                      minHeight: "12px",
                      flexShrink: 0,
                      borderRadius: "50%",
                      backgroundColor: "var(--om-color-packed-success-even, #b8d7a3)",
                      border: "1.5px solid var(--om-color-success, #5d7354)",
                    }}
                  />
                  <span className="small text-secondary fw-medium">Completely Packed PO</span>
                </div>
                <div className="d-flex align-items-center gap-2 text-nowrap" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    className="d-inline-block rounded-circle"
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      minWidth: "12px",
                      minHeight: "12px",
                      flexShrink: 0,
                      borderRadius: "50%",
                      backgroundColor: "var(--om-color-packed-warning-even, #f9da8f)",
                      border: "1.5px solid var(--om-color-warning, #8a6e4a)",
                    }}
                  />
                  <span className="small text-secondary fw-medium">Not Completely Packed PO</span>
                </div>
              </div>

              <div className="card om-card">
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table align-middle om-table mb-0">
                      <thead className="table-primary">
                        <tr>
                          <th>PO</th>
                          <th>Brand</th>
                          <th>Vendor</th>
                          <th>Item code</th>
                          <th>Order Quantity</th>
                          <th>Previously Packed Quantity</th>
                          <th>This Period Packed</th>
                          <th>Total Packed</th>
                          <th>Shipped Quantity</th>
                          <th>Total Packed CBM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((row) => (
                          <tr
                            key={`pdf-${row?.id || `${row?.order_id}-${row?.item_code}`}`}
                            className={row?.po_has_no_pending_quantity ? "om-report-success-row" : "om-report-warning-row"}
                          >
                            <td>{row?.order_id || "N/A"}</td>
                            <td>{row?.brand || "N/A"}</td>
                            <td>{getOptionText(row?.vendor) || "N/A"}</td>
                            <td>{row?.item_code || "N/A"}</td>
                            <td>{Number(row?.order_quantity || 0)}</td>
                            <td>{Number(row?.previously_packed_quantity || 0)}</td>
                            <td>{Number(row?.period_packed_quantity || 0)}</td>
                            <td>{Number(row?.total_packed_quantity || 0)}</td>
                            <td>{Number(row?.shipped_quantity || 0)}</td>
                            <td>{formatCbm(row?.total_packed_cbm)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && sortedRows.length > 0 && (
          <div className="d-flex flex-wrap align-items-center gap-3 mb-3 px-1" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px" }}>
            <span className="small text-secondary fw-semibold">Status Legend:</span>
            <div className="d-flex align-items-center gap-2 text-nowrap" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                className="d-inline-block rounded-circle shadow-sm"
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  minWidth: "12px",
                  minHeight: "12px",
                  flexShrink: 0,
                  borderRadius: "50%",
                  backgroundColor: "var(--om-color-packed-success-even, #b8d7a3)",
                  border: "1.5px solid var(--om-color-success, #5d7354)",
                }}
              />
              <span className="small text-secondary fw-medium">Completely Packed PO</span>
            </div>
            <div className="d-flex align-items-center gap-2 text-nowrap" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                className="d-inline-block rounded-circle shadow-sm"
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  minWidth: "12px",
                  minHeight: "12px",
                  flexShrink: 0,
                  borderRadius: "50%",
                  backgroundColor: "var(--om-color-packed-warning-even, #f9da8f)",
                  border: "1.5px solid var(--om-color-warning, #8a6e4a)",
                }}
              />
              <span className="small text-secondary fw-medium">Not Completely Packed PO</span>
            </div>
          </div>
        )}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>
                        <SortHeaderButton
                          label="PO"
                          isActive={sortBy === "po"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("po", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Brand"
                          isActive={sortBy === "brand"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("brand", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Vendor"
                          isActive={sortBy === "vendor"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendor", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Item code"
                          isActive={sortBy === "itemCode"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("itemCode", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Order Quantity"
                          isActive={sortBy === "orderQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("orderQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Previously Packed Quantity"
                          isActive={sortBy === "previouslyPackedQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("previouslyPackedQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="This Period Packed"
                          isActive={sortBy === "periodPackedQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("periodPackedQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Total Packed"
                          isActive={sortBy === "totalPackedQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("totalPackedQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Shipped Quantity"
                          isActive={sortBy === "shippedQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("shippedQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Total Packed CBM"
                          isActive={sortBy === "totalCbm"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("totalCbm", "desc")}
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="text-center py-4">
                          No packed goods found.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row) => (
                        <tr
                          key={row?.id || `${row?.order_id}-${row?.item_code}`}
                          className={`table-clickable ${row?.po_has_no_pending_quantity ? "om-report-success-row" : "om-report-warning-row"}`}
                          role="link"
                          tabIndex={0}
                          onClick={() => handleOpenQcDetails(row)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleOpenQcDetails(row);
                            }
                          }}
                        >
                          <td>{row?.order_id || "N/A"}</td>
                          <td>{row?.brand || "N/A"}</td>
                          <td>{getOptionText(row?.vendor) || "N/A"}</td>
                          <td>{row?.item_code || "N/A"}</td>
                          <td>{Number(row?.order_quantity || 0)}</td>
                          <td>{Number(row?.previously_packed_quantity || 0)}</td>
                          <td>{Number(row?.period_packed_quantity || 0)}</td>
                          <td>{Number(row?.total_packed_quantity || 0)}</td>
                          <td>{Number(row?.shipped_quantity || 0)}</td>
                          <td>{formatCbm(row?.total_packed_cbm)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!loading && sortedRows.length > 0 && (
            <div className="card-footer bg-transparent d-flex flex-wrap justify-content-between align-items-center gap-2">
              <span className="text-secondary small">
                Showing {(page - 1) * limit + 1}
                {" - "}
                {Math.min(page * limit, sortedRows.length)} of {sortedRows.length}
              </span>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <span className="small text-secondary">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default PackedGoods;
