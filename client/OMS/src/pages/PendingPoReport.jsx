import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  exportPendingPoReport,
  getPendingPoReport,
} from "../services/orders.service";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import "../App.css";

const DEFAULT_ENTITY_FILTER = "all";
const DEFAULT_LIMIT = 50;
const LIMIT_OPTIONS = [20, 50, 100, 200];

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const normalizeEntityFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_ENTITY_FILTER;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return DEFAULT_ENTITY_FILTER;
  }
  return normalized;
};

const normalizeSearchValue = (value) => String(value || "").trim();

const defaultReport = {
  filters: {
    brand: "",
    vendor: "",
    order_id: "",
    brand_options: [],
    vendor_options: [],
    po_options: [],
  },
  summary: {
    row_count: 0,
    po_count: 0,
    total_order_quantity: 0,
    total_pending_quantity: 0,
    total_inspection_pending_quantity: 0,
    total_shipping_pending_quantity: 0,
  },
  pagination: {
    page: 1,
    limit: DEFAULT_LIMIT,
    totalPages: 1,
    totalRecords: 0,
  },
  rows: [],
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

const PendingPoReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "pending-po-report");
  const reportRef = useRef(null);

  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("vendor")),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("vendor")),
  );
  const [poFilter, setPoFilter] = useState(() =>
    normalizeSearchValue(searchParams.get("order_id") || searchParams.get("po")),
  );
  const [draftPoFilter, setDraftPoFilter] = useState(() =>
    normalizeSearchValue(searchParams.get("order_id") || searchParams.get("po")),
  );
  const [loading, setLoading] = useState(true);
  const [exportingFormat, setExportingFormat] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("order_id");
  const [sortOrder, setSortOrder] = useState("asc");
  const [pagination, setPagination] = useState(() => ({
    page: parsePositiveInt(searchParams.get("page"), 1),
    limit: parseLimit(searchParams.get("limit")),
    totalPages: 1,
    totalRecords: 0,
  }));

  const canGoPrev = pagination.page > 1;
  const canGoNext = pagination.page < pagination.totalPages;

  const buildParams = useCallback(() => {
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      sort_by: sortBy,
      sort_order: sortOrder,
    };
    if (brandFilter !== DEFAULT_ENTITY_FILTER) params.brand = brandFilter;
    if (vendorFilter !== DEFAULT_ENTITY_FILTER) params.vendor = vendorFilter;
    if (poFilter) params.order_id = poFilter;
    return params;
  }, [
    brandFilter,
    pagination.limit,
    pagination.page,
    poFilter,
    sortBy,
    sortOrder,
    vendorFilter,
  ]);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await getPendingPoReport(buildParams());
      setReport({
        filters: {
          ...defaultReport.filters,
          ...(response?.filters || {}),
        },
        summary: {
          ...defaultReport.summary,
          ...(response?.summary || {}),
        },
        rows: Array.isArray(response?.rows) ? response.rows : [],
      });
      const nextTotalPages = Math.max(
        1,
        Number(response?.pagination?.totalPages || 1),
      );
      setPagination((prev) => ({
        ...prev,
        page: Math.min(
          Math.max(1, Number(response?.pagination?.page || prev.page || 1)),
          nextTotalPages,
        ),
        limit: parseLimit(response?.pagination?.limit || prev.limit),
        totalPages: nextTotalPages,
        totalRecords: Number(response?.pagination?.totalRecords || 0),
      }));
    } catch (err) {
      setReport(defaultReport);
      setPagination((prev) => ({
        ...prev,
        totalPages: 1,
        totalRecords: 0,
      }));
      setError(err?.response?.data?.message || "Failed to load pending PO report.");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    const nextVendorFilter = normalizeEntityFilter(searchParams.get("vendor"));
    const nextPoFilter = normalizeSearchValue(
      searchParams.get("order_id") || searchParams.get("po"),
    );
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setPoFilter((prev) => (prev === nextPoFilter ? prev : nextPoFilter));
    setDraftPoFilter((prev) => (prev === nextPoFilter ? prev : nextPoFilter));
    setPagination((prev) => ({
      ...prev,
      page: prev.page === nextPage ? prev.page : nextPage,
      limit: prev.limit === nextLimit ? prev.limit : nextLimit,
    }));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (brandFilter !== DEFAULT_ENTITY_FILTER) next.set("brand", brandFilter);
    if (vendorFilter !== DEFAULT_ENTITY_FILTER) next.set("vendor", vendorFilter);
    if (poFilter) next.set("order_id", poFilter);
    if (pagination.page > 1) next.set("page", String(pagination.page));
    if (pagination.limit !== DEFAULT_LIMIT) {
      next.set("limit", String(pagination.limit));
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    pagination.limit,
    pagination.page,
    poFilter,
    searchParams,
    setSearchParams,
    syncedQuery,
    vendorFilter,
  ]);

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );
  const summary = useMemo(
    () => ({
      ...defaultReport.summary,
      ...(report?.summary || {}),
    }),
    [report?.summary],
  );
  const sortedRows = useMemo(
    () =>
      sortClientRows(report.rows, {
        sortBy,
        sortOrder,
        getSortValue: (row, column) => {
          if (column === "order_id") return row?.order_id;
          if (column === "item_code") return row?.item_code;
          if (column === "description") return row?.description;
          if (column === "order_quantity") return Number(row?.order_quantity || 0);
          if (column === "inspection_pending_quantity") {
            return Number(row?.inspection_pending_quantity || 0);
          }
          if (column === "shipping_pending_quantity") {
            return Number(row?.shipping_pending_quantity || 0);
          }
          return "";
        },
      }),
    [report.rows, sortBy, sortOrder],
  );

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setBrandFilter(normalizeEntityFilter(draftBrandFilter));
    setVendorFilter(normalizeEntityFilter(draftVendorFilter));
    setPoFilter(normalizeSearchValue(draftPoFilter));
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [draftBrandFilter, draftPoFilter, draftVendorFilter]);

  const handleClearFilters = useCallback(() => {
    setDraftBrandFilter(DEFAULT_ENTITY_FILTER);
    setDraftVendorFilter(DEFAULT_ENTITY_FILTER);
    setDraftPoFilter("");
    setBrandFilter(DEFAULT_ENTITY_FILTER);
    setVendorFilter(DEFAULT_ENTITY_FILTER);
    setPoFilter("");
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, []);

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        sortBy,
        sortOrder,
        column,
        defaultDirection,
      );
      setSortBy(nextSortState.sortBy);
      setSortOrder(nextSortState.sortOrder);
      setPagination((prev) => ({ ...prev, page: 1 }));
    },
    [sortBy, sortOrder],
  );

  const handleExportFile = useCallback(
    async (format = "xlsx") => {
      try {
        setExportingFormat(format);
        const response = await exportPendingPoReport({
          ...buildParams(),
          format,
        });
        const resolvedFormat = format === "csv" ? "csv" : "xlsx";
        downloadBlobResponse(
          response,
          `pending-po-report-${new Date().toISOString().slice(0, 10)}.${resolvedFormat}`,
          resolvedFormat === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      } catch (err) {
        console.error(err);
        alert(`Failed to export pending PO report as ${String(format).toUpperCase()}.`);
      } finally {
        setExportingFormat("");
      }
    },
    [buildParams],
  );

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
        scrollY: -window.scrollY,
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

      pdf.save(`pending-po-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Failed to export pending PO report PDF.");
    } finally {
      setExportingFormat("");
    }
  }, [loading, sortedRows.length]);

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Pending PO Report</h2>
          <div className="d-flex gap-2">
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
              onClick={() => handleExportFile("xlsx")}
              disabled={loading || exportingFormat !== ""}
            >
              {exportingFormat === "xlsx" ? "Exporting..." : "Export XLSX"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => handleExportFile("csv")}
              disabled={loading || exportingFormat !== ""}
            >
              {exportingFormat === "csv" ? "Exporting..." : "Export CSV"}
            </button>
          </div>
        </div>

        <div className="card om-card mb-3">
          <form className="card-body d-flex flex-wrap gap-2 align-items-end" onSubmit={handleApplyFilters}>
            <div>
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={draftBrandFilter}
                onChange={(event) =>
                  setDraftBrandFilter(normalizeEntityFilter(event.target.value))
                }
              >
                <option value={DEFAULT_ENTITY_FILTER}>All Brands</option>
                {(Array.isArray(filters.brand_options) ? filters.brand_options : []).map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={draftVendorFilter}
                onChange={(event) =>
                  setDraftVendorFilter(normalizeEntityFilter(event.target.value))
                }
              >
                <option value={DEFAULT_ENTITY_FILTER}>All Vendors</option>
                {(Array.isArray(filters.vendor_options) ? filters.vendor_options : []).map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mb-1">PO</label>
              <input
                type="text"
                className="form-control"
                value={draftPoFilter}
                list="pending-po-options"
                onChange={(event) => setDraftPoFilter(event.target.value)}
                placeholder="Search PO"
              />
              <datalist id="pending-po-options">
                {(Array.isArray(filters.po_options) ? filters.po_options : []).map((po) => (
                  <option key={po} value={po} />
                ))}
              </datalist>
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
              {loading ? "Loading..." : "Apply"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleClearFilters}
              disabled={loading}
            >
              Clear
            </button>
          </form>
        </div>

        <div ref={reportRef}>
          <div className="card om-card mb-3">
            <div className="card-body d-flex flex-wrap gap-2">
              <span className="om-summary-chip">
                Brand: {brandFilter === DEFAULT_ENTITY_FILTER ? "all" : brandFilter}
              </span>
              <span className="om-summary-chip">
                Vendor: {vendorFilter === DEFAULT_ENTITY_FILTER ? "all" : vendorFilter}
              </span>
              <span className="om-summary-chip">
                PO: {poFilter || "all"}
              </span>
              <span className="om-summary-chip">POs: {summary.po_count ?? 0}</span>
              <span className="om-summary-chip">Rows: {summary.row_count ?? 0}</span>
              <span className="om-summary-chip">
                Showing: {sortedRows.length} of {pagination.totalRecords}
              </span>
              <span className="om-summary-chip">
                Order Qty: {summary.total_order_quantity ?? 0}
              </span>
              <span className="om-summary-chip">
                Inspection Pending: {summary.total_inspection_pending_quantity ?? 0}
              </span>
              <span className="om-summary-chip">
                Shipping Pending: {summary.total_shipping_pending_quantity ?? 0}
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
                <div className="text-center py-4">Loading...</div>
              ) : sortedRows.length === 0 ? (
                <div className="text-secondary p-3">
                  No pending PO rows found for the selected filters.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0 pending-po-report-table">
                    <thead>
                      <tr>
                        <th>
                          <SortHeaderButton
                            label="PO"
                            isActive={sortBy === "order_id"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("order_id", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Item Code"
                            isActive={sortBy === "item_code"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("item_code", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Description"
                            isActive={sortBy === "description"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("description", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Order Quantity"
                            isActive={sortBy === "order_quantity"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("order_quantity", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspection Pending"
                            isActive={sortBy === "inspection_pending_quantity"}
                            direction={sortOrder}
                            onClick={() =>
                              handleSortColumn("inspection_pending_quantity", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Shipping Pending"
                            isActive={sortBy === "shipping_pending_quantity"}
                            direction={sortOrder}
                            onClick={() =>
                              handleSortColumn("shipping_pending_quantity", "desc")}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row, index) => (
                        <tr key={`${row?._id || row?.order_id}-${row?.item_code}-${index}`}>
                          <td>{row?.order_id || "N/A"}</td>
                          <td>{row?.item_code || "N/A"}</td>
                          <td>{row?.description || "N/A"}</td>
                          <td>{row?.order_quantity ?? 0}</td>
                          <td>{row?.inspection_pending_quantity ?? 0}</td>
                          <td>{row?.shipping_pending_quantity ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="d-flex flex-wrap justify-content-center align-items-center gap-3 mt-3">
          <div className="d-flex align-items-center gap-2">
            <label htmlFor="pending-po-page-size" className="small fw-semibold mb-0">
              Rows per page
            </label>
            <select
              id="pending-po-page-size"
              className="form-select form-select-sm w-auto"
              value={pagination.limit}
              disabled={loading}
              onChange={(event) => {
                const nextLimit = parseLimit(event.target.value);
                setPagination((prev) => ({
                  ...prev,
                  page: 1,
                  limit: nextLimit,
                }));
              }}
            >
              {LIMIT_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!canGoPrev || loading}
            onClick={() =>
              setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!canGoNext || loading}
            onClick={() =>
              setPagination((prev) => ({
                ...prev,
                page: Math.min(prev.totalPages, prev.page + 1),
              }))}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};

export default PendingPoReport;
