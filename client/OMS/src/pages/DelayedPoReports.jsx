import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  exportDelayedPoReport,
  getDelayedPoReport,
} from "../services/orders.service";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const DEFAULT_BRANDS = ["all"];

const normalizeValues = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .flatMap((value) => String(value || "").split(","))
        .map((value) => value.trim())
        .filter((value) => value && !["all", "undefined", "null"].includes(value.toLowerCase())),
    ),
  ].sort((left, right) => left.localeCompare(right));

const normalizeBrands = (values) => {
  const normalized = normalizeValues(values);
  return normalized.length > 0 ? normalized : DEFAULT_BRANDS;
};
const isAllBrands = (values) => !Array.isArray(values) || values.includes("all");
const normalizeFilter = (value) => {
  const normalized = String(value || "").trim();
  return normalized && !["undefined", "null"].includes(normalized.toLowerCase())
    ? normalized
    : "all";
};
const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};
const sameBrands = (left, right) =>
  JSON.stringify(normalizeBrands(left)) === JSON.stringify(normalizeBrands(right));
const distinct = (values) =>
  [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const readFilters = (params) => ({
  brand: normalizeBrands(params.getAll("brand").length ? params.getAll("brand") : params.get("brand")),
  vendor: normalizeFilter(params.get("vendor")),
  po: normalizeFilter(params.get("po")),
});

const buildSearchParams = ({ filters, sortBy, sortOrder, page, limit }) => {
  const params = new URLSearchParams();
  if (!isAllBrands(filters.brand)) params.set("brand", filters.brand.join(","));
  if (filters.vendor !== "all") params.set("vendor", filters.vendor);
  if (filters.po !== "all") params.set("po", filters.po);
  if (sortBy !== "po") params.set("sort_by", sortBy);
  if (sortOrder !== "asc") params.set("sort_order", sortOrder);
  if (page > 1) params.set("page", String(page));
  if (limit !== DEFAULT_LIMIT) params.set("limit", String(limit));
  return params;
};

const buildApiParams = (filters) => {
  const params = {};
  if (!isAllBrands(filters.brand)) params.brand = filters.brand.join(",");
  if (filters.vendor !== "all") params.vendor = filters.vendor;
  if (filters.po !== "all") params.order_id = filters.po;
  return params;
};

const downloadBlob = (response) => {
  const disposition = String(response?.headers?.["content-disposition"] || "");
  const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  const fileName = match?.[1]
    ? decodeURIComponent(match[1].trim())
    : `delayed-po-report-${new Date().toISOString().slice(0, 10)}.xls`;
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

const QuantityTag = ({ type, label, value, hideWhenZero = false }) => {
  const quantity = Number(value || 0);
  if (hideWhenZero && quantity <= 0) return null;
  return (
    <span className={`delayed-po-quantity-tag is-${type}`}>
      {label}: {quantity}
    </span>
  );
};

const getDelayedPoPdfRowClass = (row = {}) => {
  const orderQuantity = Number(row?.order_quantity || 0);
  const shippedQuantity = Number(row?.shipped_quantity || 0);
  const passedQuantity = Number(row?.passed_quantity || 0);

  if (orderQuantity > 0 && shippedQuantity >= orderQuantity) {
    return "om-report-success-row";
  }
  if (shippedQuantity > 0 || passedQuantity > 0) {
    return "om-report-warning-row";
  }
  return "om-report-danger-row";
};

const DelayedPoReports = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "delayed-po-reports");

  const initialFilters = readFilters(searchParams);
  const [allRows, setAllRows] = useState([]);
  const [draftBrand, setDraftBrand] = useState(initialFilters.brand);
  const [draftVendor, setDraftVendor] = useState(initialFilters.vendor);
  const [draftPo, setDraftPo] = useState(initialFilters.po);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [sortBy, setSortBy] = useState(searchParams.get("sort_by") || "po");
  const [sortOrder, setSortOrder] = useState(
    searchParams.get("sort_order") === "desc" ? "desc" : "asc",
  );
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [summaryPage, setSummaryPage] = useState(1);
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [loading, setLoading] = useState(true);
  const [exportingFormat, setExportingFormat] = useState("");
  const [error, setError] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [syncedQuery, setSyncedQuery] = useState(null);
  const pdfReportRef = useRef(null);

  const fetchRows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await getDelayedPoReport();
      setAllRows(Array.isArray(response?.rows) ? response.rows : []);
      setReportDate(response?.filters?.report_date || "");
    } catch (fetchError) {
      setAllRows([]);
      setError(fetchError?.response?.data?.message || "Failed to load delayed PO report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextFilters = readFilters(searchParams);
    setDraftBrand((previous) => sameBrands(previous, nextFilters.brand) ? previous : nextFilters.brand);
    setDraftVendor(nextFilters.vendor);
    setDraftPo(nextFilters.po);
    setAppliedFilters((previous) =>
      sameBrands(previous.brand, nextFilters.brand)
      && previous.vendor === nextFilters.vendor
      && previous.po === nextFilters.po
        ? previous
        : nextFilters
    );
    setSortBy(searchParams.get("sort_by") || "po");
    setSortOrder(searchParams.get("sort_order") === "desc" ? "desc" : "asc");
    setPage(parsePositiveInt(searchParams.get("page"), 1));
    setLimit(parseLimit(searchParams.get("limit")));
    setSyncedQuery(currentQuery);
  }, [searchParams]);

  useEffect(() => {
    if (syncedQuery !== searchParams.toString()) return;
    const next = buildSearchParams({ filters: appliedFilters, sortBy, sortOrder, page, limit });
    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [appliedFilters, limit, page, searchParams, setSearchParams, sortBy, sortOrder, syncedQuery]);

  const brandOptions = useMemo(() => distinct(allRows.map((row) => row?.brand)), [allRows]);
  const vendorOptions = useMemo(
    () => distinct(
      allRows
        .filter((row) => isAllBrands(draftBrand) || draftBrand.includes(row?.brand))
        .map((row) => row?.vendor),
    ),
    [allRows, draftBrand],
  );
  const poOptions = useMemo(
    () => distinct(
      allRows
        .filter((row) => isAllBrands(draftBrand) || draftBrand.includes(row?.brand))
        .filter((row) => draftVendor === "all" || row?.vendor === draftVendor)
        .map((row) => row?.order_id),
    ),
    [allRows, draftBrand, draftVendor],
  );

  const filteredRows = useMemo(
    () => allRows.filter((row) => (
      (isAllBrands(appliedFilters.brand) || appliedFilters.brand.includes(row?.brand))
      && (appliedFilters.vendor === "all" || row?.vendor === appliedFilters.vendor)
      && (appliedFilters.po === "all" || row?.order_id === appliedFilters.po)
    )),
    [allRows, appliedFilters],
  );

  const sortedRows = useMemo(
    () => sortClientRows(filteredRows, {
      sortBy,
      sortOrder,
      getSortValue: (row, column) => {
        if (column === "po") return row?.order_id;
        if (column === "itemCode") return row?.item_code;
        if (column === "dates") return new Date(row?.etd || row?.po_etd || 0).getTime();
        if (column === "orderQuantity") return Number(row?.order_quantity || 0);
        if (column === "quantities") return Number(row?.pending_quantity || 0);
        return "";
      },
    }),
    [filteredRows, sortBy, sortOrder],
  );
  const poCount = useMemo(
    () => new Set(filteredRows.map((row) => `${row?.order_id}__${row?.brand}__${row?.vendor}`)).size,
    [filteredRows],
  );
  const poSummaryRows = useMemo(() => {
    const summaryMap = new Map();

    filteredRows.forEach((row) => {
      const key = `${row?.order_id}__${row?.brand}__${row?.vendor}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          order_id: row?.order_id || "N/A",
          brand: row?.brand || "N/A",
          vendor: row?.vendor || "N/A",
          order_date: row?.order_date || "",
          etd: row?.po_etd || row?.etd || "",
          item_count: 0,
          shipped_item_count: 0,
          inspected_item_count: 0,
          pending_item_count: 0,
          order_quantity: 0,
          shipped_quantity: 0,
          passed_quantity: 0,
          pending_quantity: 0,
        });
      }

      const summary = summaryMap.get(key);
      const currentOrderDate = new Date(summary.order_date || 0).getTime();
      const rowOrderDate = new Date(row?.order_date || 0).getTime();
      if (
        Number.isFinite(rowOrderDate)
        && (!Number.isFinite(currentOrderDate) || rowOrderDate < currentOrderDate)
      ) {
        summary.order_date = row.order_date;
      }
      summary.item_count += 1;
      if (
        Number(row?.order_quantity || 0) > 0
        && Number(row?.shipped_quantity || 0) >= Number(row?.order_quantity || 0)
      ) {
        summary.shipped_item_count += 1;
      } else if (Number(row?.passed_quantity || 0) > 0) {
        summary.inspected_item_count += 1;
      } else {
        summary.pending_item_count += 1;
      }
      summary.order_quantity += Number(row?.order_quantity || 0);
      summary.shipped_quantity += Number(row?.shipped_quantity || 0);
      summary.passed_quantity += Number(row?.passed_quantity || 0);
      summary.pending_quantity += Number(row?.pending_quantity || 0);
    });

    return Array.from(summaryMap.values()).sort((left, right) => {
      const etdCompare = String(left?.etd || "").localeCompare(String(right?.etd || ""));
      if (etdCompare !== 0) return etdCompare;
      return String(left?.order_id || "").localeCompare(
        String(right?.order_id || ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
    });
  }, [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / limit));
  const safePage = Math.min(page, totalPages);
  const paginatedRows = sortedRows.slice((safePage - 1) * limit, safePage * limit);
  const summaryTotalPages = Math.max(1, Math.ceil(poSummaryRows.length / limit));
  const safeSummaryPage = Math.min(summaryPage, summaryTotalPages);
  const paginatedPoSummaryRows = poSummaryRows.slice(
    (safeSummaryPage - 1) * limit,
    safeSummaryPage * limit,
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (summaryPage > summaryTotalPages) setSummaryPage(summaryTotalPages);
  }, [summaryPage, summaryTotalPages]);

  const handleBrandChange = (event) => {
    const { value, checked } = event.target;
    setDraftBrand((previous) => {
      if (value === "all") return DEFAULT_BRANDS;
      let next = normalizeBrands(previous).filter((entry) => entry !== "all");
      next = checked ? [...next, value] : next.filter((entry) => entry !== value);
      return normalizeBrands(next);
    });
    setDraftVendor("all");
    setDraftPo("all");
  };

  const applyFilters = () => {
    setPage(1);
    setSummaryPage(1);
    setAppliedFilters({
      brand: normalizeBrands(draftBrand),
      vendor: vendorOptions.includes(draftVendor) ? draftVendor : "all",
      po: poOptions.includes(draftPo) ? draftPo : "all",
    });
  };
  const clearFilters = () => {
    const cleared = { brand: DEFAULT_BRANDS, vendor: "all", po: "all" };
    setDraftBrand(cleared.brand);
    setDraftVendor(cleared.vendor);
    setDraftPo(cleared.po);
    setAppliedFilters(cleared);
    setPage(1);
    setSummaryPage(1);
  };
  const handleSort = (column, direction = "asc") => {
    const next = getNextClientSortState(sortBy, sortOrder, column, direction);
    setSortBy(next.sortBy);
    setSortOrder(next.sortOrder);
    setPage(1);
  };
  const handleExport = async () => {
    try {
      setExportingFormat("xls");
      const response = await exportDelayedPoReport(buildApiParams(appliedFilters));
      downloadBlob(response);
    } catch (exportError) {
      console.error(exportError);
      alert("Failed to export delayed PO report.");
    } finally {
      setExportingFormat("");
    }
  };

  const handleExportPdf = async () => {
    if (!pdfReportRef.current || loading || sortedRows.length === 0) return;

    try {
      setExportingFormat("pdf");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const target = pdfReportRef.current;
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
      const pdf = new jsPDF({
        orientation: "landscape",
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

      pdf.addImage(imageData, "PNG", margin, yPosition, printableWidth, imageHeight);
      remainingHeight -= printableHeight;

      while (remainingHeight > 0) {
        pdf.addPage();
        yPosition = margin - (imageHeight - remainingHeight);
        pdf.addImage(imageData, "PNG", margin, yPosition, printableWidth, imageHeight);
        remainingHeight -= printableHeight;
      }

      pdf.save(`delayed-po-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (pdfError) {
      console.error(pdfError);
      alert("Failed to export delayed PO report as PDF.");
    } finally {
      setExportingFormat("");
    }
  };

  return (
    <>
      <Navbar />
      <div className="page-shell py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
          <div>
            <button type="button" className="btn btn-link p-0 mb-2 text-decoration-none" onClick={() => navigate(-1)}>
              Back
            </button>
            <h2 className="h4 mb-1">Delayed PO Report</h2>
            <p className="text-secondary mb-0">
              POs past ETD with pending item quantities. Completely shipped POs are excluded.
            </p>
          </div>
          <div className="d-flex flex-column align-items-end gap-2">
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
                onClick={handleExport}
                disabled={loading || exportingFormat !== "" || sortedRows.length === 0}
              >
                {exportingFormat === "xls" ? "Exporting..." : "Export XLS"}
              </button>
            </div>
            <div className="d-flex flex-wrap justify-content-end gap-2">
              <span className="om-summary-chip">POs: {poCount}</span>
              <span className="om-summary-chip">Rows: {filteredRows.length}</span>
              <span className="om-summary-chip">Report Date: {formatDateDDMMYYYY(reportDate)}</span>
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
                  data-bs-toggle="dropdown"
                  data-bs-auto-close="outside"
                >
                  <div className="text-truncate">
                    {isAllBrands(draftBrand) ? "All Brands" : draftBrand.join(", ")}
                  </div>
                </button>
                <ul className="dropdown-menu packed-goods-filter-menu shadow">
                  <li>
                    <label className="packed-goods-filter-option">
                      <input type="checkbox" className="form-check-input" value="all" checked={isAllBrands(draftBrand)} onChange={handleBrandChange} />
                      <span className="packed-goods-filter-option-label">All Brands</span>
                    </label>
                  </li>
                  {brandOptions.map((brand) => (
                    <li key={brand}>
                      <label className="packed-goods-filter-option">
                        <input type="checkbox" className="form-check-input" value={brand} checked={draftBrand.includes(brand)} onChange={handleBrandChange} />
                        <span className="packed-goods-filter-option-label">{brand}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="packed-goods-filter-field">
                <label className="form-label small mb-1">Vendor</label>
                <select className="form-select form-select-sm" value={draftVendor} onChange={(event) => { setDraftVendor(event.target.value); setDraftPo("all"); }}>
                  <option value="all">All Vendors</option>
                  {vendorOptions.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
                </select>
              </div>
              <div className="packed-goods-filter-field packed-goods-filter-field--po">
                <label className="form-label small mb-1">PO</label>
                <select className="form-select form-select-sm" value={draftPo} onChange={(event) => setDraftPo(event.target.value)}>
                  <option value="all">All POs</option>
                  {poOptions.map((po) => <option key={po} value={po}>{po}</option>)}
                </select>
              </div>
              <div className="packed-goods-filter-field packed-goods-filter-field--limit">
                <label className="form-label small mb-1">Rows</label>
                <select className="form-select form-select-sm" value={limit} onChange={(event) => { setLimit(parseLimit(event.target.value)); setPage(1); setSummaryPage(1); }}>
                  {LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-primary btn-sm packed-goods-filter-button" onClick={applyFilters}>Apply Filters</button>
              <button type="button" className="btn btn-outline-secondary btn-sm packed-goods-filter-button" onClick={clearFilters}>Clear Filters</button>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {!loading && poSummaryRows.length > 0 && (
          <div className="card om-card mb-3">
            <div className="card-header bg-transparent">
              <h3 className="h6 mb-1">PO-wise Summary</h3>
              <div className="small text-secondary">
                Aggregated totals for the currently selected filters.
              </div>
              <div className="delayed-po-summary-legend mt-3">
                <span className="small text-secondary fw-semibold">Legend:</span>
                <span className="delayed-po-legend-entry">
                  <span className="delayed-po-legend-swatch is-completely-pending" />
                  Completely pending PO
                </span>
                <span className="delayed-po-legend-entry">
                  <span className="delayed-po-legend-swatch has-shipped-quantity" />
                  Has shipped quantity
                </span>
                <span className="delayed-po-legend-entry">
                  <span className="delayed-po-legend-swatch is-shipped-tag" />
                  Shipped items
                </span>
                <span className="delayed-po-legend-entry">
                  <span className="delayed-po-legend-swatch is-inspected-tag" />
                  Inspected items
                </span>
                <span className="delayed-po-legend-entry">
                  <span className="delayed-po-legend-swatch is-pending-tag" />
                  Pending items
                </span>
              </div>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover align-middle om-table mb-0 delayed-po-summary-table">
                  <thead className="table-primary">
                    <tr>
                      <th>PO</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Dates</th>
                      <th>Items</th>
                      <th>Order Qty</th>
                      <th>Quantities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPoSummaryRows.map((row) => (
                      <tr
                        key={`summary-${row.order_id}-${row.brand}-${row.vendor}`}
                        className={
                          row.pending_item_count === row.item_count
                            ? "delayed-po-summary-row is-completely-pending"
                            : row.shipped_quantity > 0
                              ? "delayed-po-summary-row has-shipped-quantity"
                              : ""
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="btn btn-link p-0 text-decoration-none fw-semibold"
                            onClick={() => navigate(`/orders?order_id=${encodeURIComponent(row.order_id || "")}`)}
                          >
                            {row.order_id}
                          </button>
                        </td>
                        <td>{row.brand}</td>
                        <td>{row.vendor}</td>
                        <td>
                          <div><span className="text-secondary small">Order:</span> {formatDateDDMMYYYY(row.order_date)}</div>
                          <div><span className="text-secondary small">ETD:</span> {formatDateDDMMYYYY(row.etd)}</div>
                        </td>
                        <td>
                          <div className="delayed-po-quantity-tags">
                            <QuantityTag type="shipped" label="Shipped" value={row.shipped_item_count} />
                            <QuantityTag type="passed" label="Inspected" value={row.inspected_item_count} />
                            <QuantityTag type="pending" label="Pending" value={row.pending_item_count} />
                          </div>
                        </td>
                        <td>{row.order_quantity}</td>
                        <td>
                          <div className="delayed-po-quantity-tags">
                            <QuantityTag type="shipped" label="Shipped" value={row.shipped_quantity} hideWhenZero />
                            <QuantityTag type="passed" label="Passed" value={row.passed_quantity} />
                            <QuantityTag type="pending" label="Pending" value={row.pending_quantity} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card-footer bg-transparent d-flex flex-wrap justify-content-between align-items-center gap-2">
              <span className="small text-secondary">
                Showing {(safeSummaryPage - 1) * limit + 1} - {Math.min(safeSummaryPage * limit, poSummaryRows.length)} of {poSummaryRows.length} POs
              </span>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={safeSummaryPage <= 1}
                  onClick={() => setSummaryPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </button>
                <span className="small text-secondary">
                  Page {safeSummaryPage} of {summaryTotalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={safeSummaryPage >= summaryTotalPages}
                  onClick={() => setSummaryPage((current) => Math.min(summaryTotalPages, current + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && sortedRows.length > 0 && (
          <div className="packed-goods-pdf-surface" aria-hidden="true">
            <div ref={pdfReportRef} className="packed-goods-pdf-report delayed-po-pdf-report">
              <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                <div>
                  <h2 className="h4 mb-1">Delayed PO Report</h2>
                  <p className="text-secondary mb-0">
                    Report date: {formatDateDDMMYYYY(reportDate)}
                  </p>
                </div>
                <div className="d-flex flex-wrap justify-content-end gap-2">
                  <span className="om-summary-chip">POs: {poCount}</span>
                  <span className="om-summary-chip">Rows: {sortedRows.length}</span>
                  <span className="om-summary-chip">
                    Brands: {isAllBrands(appliedFilters.brand) ? "All Brands" : appliedFilters.brand.join(", ")}
                  </span>
                  <span className="om-summary-chip">
                    Vendor: {appliedFilters.vendor === "all" ? "All Vendors" : appliedFilters.vendor}
                  </span>
                  <span className="om-summary-chip">
                    PO: {appliedFilters.po === "all" ? "All POs" : appliedFilters.po}
                  </span>
                </div>
              </div>
              <table className="table table-sm align-middle om-table mb-0 delayed-po-table">
                <thead className="table-primary">
                  <tr>
                    <th>PO</th>
                    <th>Item Code</th>
                    <th>Order Date</th>
                    <th>ETD</th>
                    <th>Order Qty</th>
                    <th>Shipped</th>
                    <th>Passed</th>
                    <th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr
                      key={`pdf-${row?.id || `${row?.order_id}-${row?.item_code}`}`}
                      className={getDelayedPoPdfRowClass(row)}
                    >
                      <td>{row?.order_id || "N/A"}</td>
                      <td>{row?.item_code || "N/A"}</td>
                      <td>{formatDateDDMMYYYY(row?.order_date)}</td>
                      <td>{formatDateDDMMYYYY(row?.etd || row?.po_etd)}</td>
                      <td>{Number(row?.order_quantity || 0)}</td>
                      <td>{Number(row?.shipped_quantity || 0)}</td>
                      <td>{Number(row?.passed_quantity || 0)}</td>
                      <td>{Number(row?.pending_quantity || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle om-table mb-0 delayed-po-table">
                  <thead className="table-primary">
                    <tr>
                      <th><SortHeaderButton label="PO" isActive={sortBy === "po"} direction={sortOrder} onClick={() => handleSort("po")} /></th>
                      <th><SortHeaderButton label="Item Code" isActive={sortBy === "itemCode"} direction={sortOrder} onClick={() => handleSort("itemCode")} /></th>
                      <th><SortHeaderButton label="Dates" isActive={sortBy === "dates"} direction={sortOrder} onClick={() => handleSort("dates", "desc")} /></th>
                      <th><SortHeaderButton label="Order Qty" isActive={sortBy === "orderQuantity"} direction={sortOrder} onClick={() => handleSort("orderQuantity", "desc")} /></th>
                      <th><SortHeaderButton label="Quantities" isActive={sortBy === "quantities"} direction={sortOrder} onClick={() => handleSort("quantities", "desc")} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-4">No delayed POs found.</td></tr>
                    ) : paginatedRows.map((row) => (
                      <tr key={row?.id || `${row?.order_id}-${row?.item_code}`}>
                        <td>
                          <button type="button" className="btn btn-link p-0 text-decoration-none fw-semibold" onClick={() => navigate(`/orders?order_id=${encodeURIComponent(row?.order_id || "")}`)}>
                            {row?.order_id || "N/A"}
                          </button>
                          <div className="small text-secondary">{row?.brand || "N/A"} · {row?.vendor || "N/A"}</div>
                        </td>
                        <td>{row?.item_code || "N/A"}</td>
                        <td>
                          <div><span className="text-secondary small">Order:</span> {formatDateDDMMYYYY(row?.order_date)}</div>
                          <div><span className="text-secondary small">ETD:</span> {formatDateDDMMYYYY(row?.etd || row?.po_etd)}</div>
                        </td>
                        <td>{Number(row?.order_quantity || 0)}</td>
                        <td>
                          <div className="delayed-po-quantity-tags">
                            <QuantityTag type="shipped" label="Shipped" value={row?.shipped_quantity} hideWhenZero />
                            <QuantityTag type="passed" label="Passed" value={row?.passed_quantity} />
                            <QuantityTag type="pending" label="Pending" value={row?.pending_quantity} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!loading && sortedRows.length > 0 && (
            <div className="card-footer bg-transparent d-flex justify-content-between align-items-center gap-2">
              <span className="small text-secondary">
                Showing {(safePage - 1) * limit + 1} - {Math.min(safePage * limit, sortedRows.length)} of {sortedRows.length}
              </span>
              <div className="d-flex align-items-center gap-2">
                <button type="button" className="btn btn-outline-secondary btn-sm" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                <span className="small text-secondary">Page {safePage} of {totalPages}</span>
                <button type="button" className="btn btn-outline-secondary btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  );
};

export default DelayedPoReports;
