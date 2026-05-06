import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { formatCbm, resolvePreferredCbm } from "../utils/cbm";
import "../App.css";

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
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));

const matchesBrandFilter = (rowBrandValue, brands = DEFAULT_BRAND_FILTER) => {
  const rowBrand = String(rowBrandValue || "").trim();
  return isAllBrandFilter(brands) || normalizeBrandFilter(brands).includes(rowBrand);
};

const matchesDraftFilters = (row = {}, brands = DEFAULT_BRAND_FILTER, vendor = "all") => {
  const rowBrand = String(row?.brand || "").trim();
  const rowVendor = String(row?.vendor || "").trim();
  if (!matchesBrandFilter(rowBrand, brands)) return false;
  if (vendor !== "all" && rowVendor !== vendor) return false;
  return true;
};

const parseSortBy = (value) => {
  const normalized = String(value || "").trim();
  const allowed = new Set([
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
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "packed-goods");
  const { hasPermission } = usePermissions();

  const initialFilters = buildFilterStateFromSearchParams(searchParams);
  const initialSortBy = parseSortBy(searchParams.get("sort_by"));
  const initialSortOrder = parseSortOrder(searchParams.get("sort_order"));
  const canExportPackedGoods = hasPermission("orders", "export");

  const [allRows, setAllRows] = useState([]);
  const [draftBrand, setDraftBrand] = useState(initialFilters.brand);
  const [draftVendor, setDraftVendor] = useState(initialFilters.vendor);
  const [draftPo, setDraftPo] = useState(initialFilters.po);
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

      const response = await api.get("/orders/packed-goods");
      setAllRows(Array.isArray(response?.data?.data) ? response.data.data : []);
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.message || "Failed to load packed goods.",
      );
      setAllRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
    setAppliedFilters((prev) => {
      return areBrandFiltersEqual(prev.brand, nextFilters.brand)
        && prev.vendor === nextFilters.vendor
        && prev.po === nextFilters.po
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
    () => normalizeDistinctValues(allRows.map((row) => row?.brand)),
    [allRows],
  );

  const availableDraftVendors = useMemo(
    () =>
      normalizeDistinctValues(
        allRows
          .filter((row) => matchesDraftFilters(row, draftBrand, "all"))
          .map((row) => row?.vendor),
      ),
    [allRows, draftBrand],
  );

  const availableDraftPos = useMemo(
    () =>
      normalizeDistinctValues(
        allRows
          .filter((row) => matchesDraftFilters(row, draftBrand, draftVendor))
          .map((row) => row?.order_id),
      ).sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [allRows, draftBrand, draftVendor],
  );

  const filteredRows = useMemo(
    () =>
      allRows.filter((row) => {
        const rowBrand = String(row?.brand || "").trim();
        const rowVendor = String(row?.vendor || "").trim();
        const rowPo = String(row?.order_id || "").trim();

        if (!matchesBrandFilter(rowBrand, appliedFilters.brand)) {
          return false;
        }
        if (appliedFilters.vendor !== "all" && rowVendor !== appliedFilters.vendor) {
          return false;
        }
        if (appliedFilters.po !== "all" && rowPo !== appliedFilters.po) {
          return false;
        }
        return true;
      }),
    [allRows, appliedFilters],
  );

  const summary = useMemo(
    () => ({
      total_rows: filteredRows.length,
      total_packed_quantity: filteredRows.reduce(
        (sum, row) => sum + Number(row?.packed_quantity || 0),
        0,
      ),
      total_cbm: filteredRows.reduce(
        (sum, row) =>
          sum
          + Number(
            resolvePreferredCbm(
              row?.total_cbm,
              row?.total_po_cbm,
              row?.top_po_cbm,
            ) || 0,
          ),
        0,
      ),
    }),
    [filteredRows],
  );

  const sortedRows = useMemo(
    () =>
      sortClientRows(filteredRows, {
        sortBy,
        sortOrder,
        getSortValue: (row, column) => {
          if (column === "po") return row?.order_id;
          if (column === "brand") return row?.brand;
          if (column === "vendor") return row?.vendor;
          if (column === "itemCode") return row?.item_code;
          if (column === "orderQuantity") return Number(row?.order_quantity || 0);
          if (column === "packedQuantity") return Number(row?.packed_quantity || 0);
          if (column === "totalCbm") return Number(row?.total_cbm || 0);
          return "";
        },
      }),
    [filteredRows, sortBy, sortOrder],
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
    || draftPo !== appliedFilters.po;

  const exportGeneratedAt = useMemo(
    () => new Date().toLocaleString(),
    [appliedFilters, sortedRows.length],
  );

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
    setPage(1);
    setAppliedFilters({
      brand: normalizeBrandFilter(draftBrand),
      vendor:
        draftVendor !== "all" && !availableDraftVendors.includes(draftVendor)
          ? "all"
          : draftVendor,
      po:
        draftPo !== "all" && !availableDraftPos.includes(draftPo)
          ? "all"
          : draftPo,
    });
  }, [availableDraftPos, availableDraftVendors, draftBrand, draftPo, draftVendor]);

  const handleClearFilters = useCallback(() => {
    const clearedFilters = { brand: DEFAULT_BRAND_FILTER, vendor: "all", po: "all" };
    setPage(1);
    setDraftBrand(clearedFilters.brand);
    setDraftVendor(clearedFilters.vendor);
    setDraftPo(clearedFilters.po);
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
      const target = reportRef.current;
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: Math.max(target.scrollWidth, target.clientWidth),
        windowHeight: Math.max(target.scrollHeight, target.clientHeight),
        scrollX: 0,
        scrollY: 0,
      });
      const imageData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const imageHeight = (canvas.height * printableWidth) / canvas.width;

      let remainingHeight = imageHeight;
      let yPosition = margin;
      pdf.addImage(imageData, "PNG", margin, yPosition, printableWidth, imageHeight);
      remainingHeight -= printableHeight;

      while (remainingHeight > 0) {
        pdf.addPage();
        yPosition = margin - (imageHeight - remainingHeight);
        pdf.addImage(imageData, "PNG", margin, yPosition, printableWidth, imageHeight);
        remainingHeight -= printableHeight;
      }

      pdf.save(`packed-goods-${new Date().toISOString().slice(0, 10)}.pdf`);
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
              Items inspected and packed, but not yet shipped.
            </p>
          </div>
          <div className="d-flex flex-column align-items-stretch align-items-md-end gap-2">
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
            <div className="d-flex flex-wrap justify-content-end gap-2">
              <span className="om-summary-chip">Rows: {summary.total_rows}</span>
              <span className="om-summary-chip">
                Brands: {appliedFilters.brand && appliedFilters.brand.length > 0 && !appliedFilters.brand.includes("all") ? appliedFilters.brand.join(', ') : "All Brands"}
              </span>
              <span className="om-summary-chip">
                Packed Qty: {summary.total_packed_quantity}
              </span>
              <span className="om-summary-chip">
                Total CBM: {formatCbm(summary.total_cbm)}
              </span>
            </div>
          </div>
        </div>

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
                    && isAllBrandFilter(appliedFilters.brand)
                    && appliedFilters.vendor === "all"
                    && appliedFilters.po === "all"
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
                </div>
              </div>

              <div className="d-flex flex-wrap gap-2 mb-3">
                <span className="om-summary-chip">Rows: {summary.total_rows}</span>
                <span className="om-summary-chip">
                  Packed Qty: {summary.total_packed_quantity}
                </span>
                <span className="om-summary-chip">
                  Total CBM: {formatCbm(summary.total_cbm)}
                </span>
              </div>

              <div className="card om-card">
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table table-striped align-middle om-table mb-0">
                      <thead className="table-primary">
                        <tr>
                          <th>PO</th>
                          <th>Brand</th>
                          <th>Vendor</th>
                          <th>Item code</th>
                          <th>Order Quantity</th>
                          <th>Packed Quantity</th>
                          <th>Total CBM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((row) => (
                          <tr
                            key={`pdf-${row?.id || `${row?.order_id}-${row?.item_code}`}`}
                            className={row?.po_has_no_pending_quantity ? "om-report-success-row" : ""}
                          >
                            <td>{row?.order_id || "N/A"}</td>
                            <td>{row?.brand || "N/A"}</td>
                            <td>{row?.vendor || "N/A"}</td>
                            <td>{row?.item_code || "N/A"}</td>
                            <td>{Number(row?.order_quantity || 0)}</td>
                            <td>{Number(row?.packed_quantity || 0)}</td>
                            <td>
                              {formatCbm(
                                resolvePreferredCbm(
                                  row?.total_cbm,
                                  row?.total_po_cbm,
                                  row?.top_po_cbm,
                                ),
                              )}
                            </td>
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

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
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
                          label="Packed Quantity"
                          isActive={sortBy === "packedQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("packedQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Total CBM"
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
                        <td colSpan={7} className="text-center py-4">
                          No packed goods found.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row) => (
                        <tr
                          key={row?.id || `${row?.order_id}-${row?.item_code}`}
                          className={row?.po_has_no_pending_quantity ? "om-report-success-row" : ""}
                        >
                          <td>{row?.order_id || "N/A"}</td>
                          <td>{row?.brand || "N/A"}</td>
                          <td>{row?.vendor || "N/A"}</td>
                          <td>{row?.item_code || "N/A"}</td>
                          <td>{Number(row?.order_quantity || 0)}</td>
                          <td>{Number(row?.packed_quantity || 0)}</td>
                          <td>
                            {formatCbm(
                              resolvePreferredCbm(
                                row?.total_cbm,
                                row?.total_po_cbm,
                                row?.top_po_cbm,
                              ),
                            )}
                          </td>
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
