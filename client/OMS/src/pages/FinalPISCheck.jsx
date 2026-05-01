import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import EditPisModal from "../components/EditPisModal";
import { usePermissions } from "../auth/PermissionContext";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const DEFAULT_SORT_BY = "updated_at";
const DEFAULT_SORT_ORDER = "desc";
const SORT_BY_OPTIONS = [
  { value: "updated_at", label: "Updated Date" },
  { value: "code", label: "Item Code" },
  { value: "description", label: "Description" },
  { value: "brand", label: "Brand" },
  { value: "diff_count", label: "Difference Count" },
  { value: "detail_count", label: "Detail Rows" },
];
const SORT_ORDER_OPTIONS = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
];

const buildEmptyReportData = () => ({
  rows: [],
  summary: {
    checked_diff_items: 0,
    detailed_difference_rows: 0,
    unique_brands: [],
    unique_vendors: [],
    diff_field_counts: {},
  },
  filters: {
    search: "",
    brand: "",
    vendor: "",
    diff_field: "",
  },
  pagination: {
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 1,
  },
  generated_at: new Date().toISOString(),
});

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  return cleaned || fallback;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const normalizeSortBy = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return SORT_BY_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_SORT_BY;
};

const normalizeSortOrder = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "asc" ? "asc" : DEFAULT_SORT_ORDER;
};

const toFilenameSegment = (value, fallback = "report") => {
  const normalized = String(value ?? "").trim();
  return (normalized || fallback).replace(/[^a-zA-Z0-9_-]+/g, "_");
};

const formatPreviewDateTime = (value) => {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const formatPreviewList = (values = []) =>
  Array.isArray(values) && values.length > 0 ? values.join(", ") : "All";

const waitForFontsReady = async () => {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
};

const FinalPisCheckReport = ({
  report,
  reportRef = null,
  title = "Final PIS Check",
  eyebrow = "Final PIS Audit",
  showHeader = true,
  showOverviewGrids = true,
  showBrandVendorMeta = true,
  canEditPis = false,
  onEditPis = null,
  activeEditCode = "",
}) => {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const summary = report?.summary || {};
  const filters = report?.filters || {};

  return (
    <div className="pis-diff-pdf-report" ref={reportRef}>
      {showHeader && (
        <header className="pis-diff-report-header">
          <div>
            <div className="pis-diff-report-eyebrow">{eyebrow}</div>
            <h2 className="pis-diff-report-title">{title}</h2>
            <div className="pis-diff-report-subtitle">
              Checked PIS items still having differences
            </div>
            <div className="pis-diff-report-subtitle">
              Generated {formatPreviewDateTime(report?.generated_at)}
            </div>
          </div>
          <div className="pis-diff-report-count">
            <strong>{Number(summary?.checked_diff_items || rows.length)}</strong>
            <span>Items</span>
          </div>
        </header>
      )}

      {showOverviewGrids && (
        <>
          <section className="pis-diff-report-filter-grid pis-diff-report-grid-4">
            <div>
              <span>Search</span>
              <strong>{filters.search || "All"}</strong>
            </div>
            <div>
              <span>Brand</span>
              <strong>{filters.brand || "All"}</strong>
            </div>
            <div>
              <span>Vendor</span>
              <strong>{filters.vendor || "All"}</strong>
            </div>
            <div>
              <span>Difference Field</span>
              <strong>{filters.diff_field || "All"}</strong>
            </div>
          </section>

          <section className="pis-diff-report-summary-grid pis-diff-report-grid-4">
            <div>
              <span>Items With Difference</span>
              <strong>{Number(summary?.checked_diff_items || 0)}</strong>
            </div>
            <div>
              <span>Detailed Difference Rows</span>
              <strong>{Number(summary?.detailed_difference_rows || 0)}</strong>
            </div>
            <div>
              <span>Brands</span>
              <strong>{formatPreviewList(summary?.unique_brands)}</strong>
            </div>
            <div>
              <span>Vendors</span>
              <strong>{formatPreviewList(summary?.unique_vendors)}</strong>
            </div>
          </section>
        </>
      )}

      <div className="pis-diff-report-items">
        {rows.length === 0 ? (
          <section className="pis-diff-report-item">
            <div className="p-4 text-center text-secondary">
              No checked PIS items with remaining differences were found for the current filters.
            </div>
          </section>
        ) : (
          rows.map((row, rowIndex) => {
            const measurements = row?.measurements || {};
            const differences = Array.isArray(row?.differences) ? row.differences : [];
            const measurementCards = [
              {
                label: "Inspected Item",
                size: measurements?.inspected_item?.sizeDisplay,
                weightLabel: "Net",
                weight: measurements?.inspected_item?.weightDisplay,
              },
              {
                label: "PIS Item",
                size: measurements?.pis_item?.sizeDisplay,
                weightLabel: "Net",
                weight: measurements?.pis_item?.weightDisplay,
              },
              {
                label: "Inspected Box",
                size: measurements?.inspected_box?.sizeDisplay,
                weightLabel: "Gross",
                weight: measurements?.inspected_box?.weightDisplay,
              },
              {
                label: "PIS Box",
                size: measurements?.pis_box?.sizeDisplay,
                weightLabel: "Gross",
                weight: measurements?.pis_box?.weightDisplay,
              },
            ];

            return (
              <section
                className="pis-diff-report-item"
                key={row?.id || row?.code || `final-pis-check-row-${rowIndex}`}
              >
                <div className="pis-diff-report-item-head">
                  <div>
                    <div className="pis-diff-report-code">{row?.code || "N/A"}</div>
                    <div className="pis-diff-report-description">
                      {row?.description || row?.name || "N/A"}
                    </div>
                    {showBrandVendorMeta && (
                      <div className="pis-diff-report-meta">
                        <span>{row?.brand || "N/A"}</span>
                        <span>{row?.vendors || "N/A"}</span>
                        {row?.updated_at && <span>Updated {row.updated_at}</span>}
                      </div>
                    )}
                    {!showBrandVendorMeta && row?.updated_at && (
                      <div className="pis-diff-report-meta">
                        <span>Updated {row.updated_at}</span>
                      </div>
                    )}
                  </div>
                  <div className="d-flex flex-column align-items-end gap-2">
                    <div className="pis-diff-report-badges">
                      {row?.inspection_report_mismatch && (
                        <span className="text-bg-danger">Inspection report mismatch</span>
                      )}
                      {(Array.isArray(row?.diff_fields) ? row.diff_fields : []).map((field) => (
                        <span key={`${row?.code}-${field}`}>{field}</span>
                      ))}
                    </div>
                    {canEditPis && typeof onEditPis === "function" && (
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => onEditPis(row)}
                        disabled={activeEditCode === row?.code}
                      >
                        {activeEditCode === row?.code ? "Loading..." : "Update PIS"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="pis-diff-report-measure-grid">
                  {measurementCards.map((entry) => (
                    <div key={`${row?.code}-${entry.label}`}>
                      <span>{entry.label}</span>
                      <strong>Size: {entry.size || "Not Set"}</strong>
                      <strong>{entry.weightLabel}: {entry.weight || "Not Set"}</strong>
                    </div>
                  ))}
                </div>

                <div className="table-responsive">
                  <table className="table table-sm pis-diff-detail-table mb-0">
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Measurement</th>
                        <th>Inspected</th>
                        <th>PIS</th>
                        <th>Difference</th>
                        <th>Remark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {differences.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-secondary">
                            No detailed comparison rows available.
                          </td>
                        </tr>
                      ) : (
                        differences.map((difference, index) => (
                          <tr key={difference?.key || `${row?.code}-diff-${index}`}>
                            <td>{difference?.section || "Difference"}</td>
                            <td>
                              <div className="fw-semibold">
                                {difference?.segment || "Value"}
                              </div>
                              <div className="small text-secondary">
                                {difference?.attribute || "-"}
                              </div>
                            </td>
                            <td>{difference?.inspected || "Not Set"}</td>
                            <td>{difference?.pis || "Not Set"}</td>
                            <td>
                              <span className="pis-diff-delta-badge">
                                {difference?.delta || "Mismatch"}
                              </span>
                            </td>
                            <td>{difference?.note || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};

const FinalPISCheck = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "final-pis-check");
  const pdfReportRef = useRef(null);
  const { canEditPis } = usePermissions();

  const [reportData, setReportData] = useState(() => buildEmptyReportData());
  const [options, setOptions] = useState({
    brands: [],
    vendors: [],
    diff_fields: [],
  });
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeEditCode, setActiveEditCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewData, setPdfPreviewData] = useState(null);
  const [pdfPreviewError, setPdfPreviewError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [searchInput, setSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [draftSearchInput, setDraftSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [diffFieldFilter, setDiffFieldFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("diff_field"), "all"),
  );
  const [draftDiffFieldFilter, setDraftDiffFieldFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("diff_field"), "all"),
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [sortBy, setSortBy] = useState(() =>
    normalizeSortBy(searchParams.get("sortBy")),
  );
  const [draftSortBy, setDraftSortBy] = useState(() =>
    normalizeSortBy(searchParams.get("sortBy")),
  );
  const [sortOrder, setSortOrder] = useState(() =>
    normalizeSortOrder(searchParams.get("sortOrder")),
  );
  const [draftSortOrder, setDraftSortOrder] = useState(() =>
    normalizeSortOrder(searchParams.get("sortOrder")),
  );
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchOptions = useCallback(async () => {
    try {
      setOptionsLoading(true);
      const response = await api.get("/items/final-pis-check/options");
      setOptions({
        brands: Array.isArray(response?.data?.data?.brands)
          ? response.data.data.brands
          : [],
        vendors: Array.isArray(response?.data?.data?.vendors)
          ? response.data.data.vendors
          : [],
        diff_fields: Array.isArray(response?.data?.data?.diff_fields)
          ? response.data.data.diff_fields
          : [],
      });
    } catch (optionsError) {
      console.error("Failed to fetch Final PIS Check options:", optionsError);
      setOptions({
        brands: [],
        vendors: [],
        diff_fields: [],
      });
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  const fetchFinalPisCheckRows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/items/final-pis-check", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          diff_field: diffFieldFilter,
          page,
          limit,
          sortBy,
          sortOrder,
        },
      });

      const nextData = response?.data || buildEmptyReportData();
      setReportData({
        ...buildEmptyReportData(),
        ...nextData,
      });
      setPage(Number(nextData?.pagination?.page || 1));
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.message
          || "Failed to load Final PIS Check items.",
      );
      setReportData(buildEmptyReportData());
    } finally {
      setLoading(false);
    }
  }, [brandFilter, diffFieldFilter, limit, page, searchInput, sortBy, sortOrder, vendorFilter]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  useEffect(() => {
    fetchFinalPisCheckRows();
  }, [fetchFinalPisCheckRows]);

  useEffect(() => {
    if (!pdfPreviewOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !exportingPdf) {
        setPdfPreviewOpen(false);
      }
    };

    document.body.classList.add("modal-open");
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [exportingPdf, pdfPreviewOpen]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSearchInput = normalizeSearchParam(searchParams.get("search"));
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextDiffFieldFilter = normalizeFilterParam(searchParams.get("diff_field"), "all");
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));
    const nextSortBy = normalizeSortBy(searchParams.get("sortBy"));
    const nextSortOrder = normalizeSortOrder(searchParams.get("sortOrder"));

    setSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setDraftSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDiffFieldFilter((prev) => (prev === nextDiffFieldFilter ? prev : nextDiffFieldFilter));
    setDraftDiffFieldFilter((prev) =>
      prev === nextDiffFieldFilter ? prev : nextDiffFieldFilter,
    );
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setDraftSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setDraftSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const normalizedSearch = normalizeSearchParam(searchInput);

    if (normalizedSearch) next.set("search", normalizedSearch);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (diffFieldFilter && diffFieldFilter !== "all") {
      next.set("diff_field", diffFieldFilter);
    }
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
    if (sortBy !== DEFAULT_SORT_BY) next.set("sortBy", sortBy);
    if (sortOrder !== DEFAULT_SORT_ORDER) next.set("sortOrder", sortOrder);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    diffFieldFilter,
    limit,
    page,
    searchInput,
    searchParams,
    setSearchParams,
    sortBy,
    sortOrder,
    syncedQuery,
    vendorFilter,
  ]);

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
    setDiffFieldFilter(normalizeFilterParam(draftDiffFieldFilter, "all"));
    setSortBy(normalizeSortBy(draftSortBy));
    setSortOrder(normalizeSortOrder(draftSortOrder));
  }, [
    draftBrandFilter,
    draftDiffFieldFilter,
    draftSearchInput,
    draftSortBy,
    draftSortOrder,
    draftVendorFilter,
  ]);

  const handleClearFilters = useCallback(() => {
    setPage(1);
    setSearchInput("");
    setDraftSearchInput("");
    setBrandFilter("all");
    setDraftBrandFilter("all");
    setVendorFilter("all");
    setDraftVendorFilter("all");
    setDiffFieldFilter("all");
    setDraftDiffFieldFilter("all");
    setSortBy(DEFAULT_SORT_BY);
    setDraftSortBy(DEFAULT_SORT_BY);
    setSortOrder(DEFAULT_SORT_ORDER);
    setDraftSortOrder(DEFAULT_SORT_ORDER);
  }, []);

  const handlePisUpdated = useCallback(() => {
    setSelectedItem(null);
    fetchFinalPisCheckRows();
  }, [fetchFinalPisCheckRows]);

  const handleOpenEditPis = useCallback(async (row = {}) => {
    const targetCode = String(row?.code || "").trim();
    if (!targetCode) {
      setError("Unable to open PIS editor for this item.");
      return;
    }

    try {
      setActiveEditCode(targetCode);
      setError("");

      const response = await api.get("/items", {
        params: {
          search: targetCode,
          page: 1,
          limit: 25,
        },
      });

      const items = Array.isArray(response?.data?.data) ? response.data.data : [];
      const matchedItem = items.find(
        (item) => String(item?.code || "").trim().toLowerCase() === targetCode.toLowerCase(),
      );

      if (!matchedItem) {
        setError(`Item ${targetCode} could not be loaded for PIS update.`);
        return;
      }

      setSelectedItem(matchedItem);
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.message
          || `Failed to load item ${targetCode} for PIS update.`,
      );
    } finally {
      setActiveEditCode("");
    }
  }, []);

  const handleExportReport = useCallback(async () => {
    try {
      setExporting(true);
      setError("");

      const response = await api.get("/items/final-pis-check/export", {
        responseType: "blob",
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          diff_field: diffFieldFilter,
          sortBy,
          sortOrder,
        },
      });

      const disposition = String(response?.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
      const fallbackName = `final-pis-check-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const fileName = match?.[1]
        ? decodeURIComponent(match[1].trim())
        : fallbackName;

      const blob = new Blob([response.data], {
        type:
          response?.headers?.["content-type"]
          || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      let nextMessage = "Failed to export Final PIS Check report.";
      const blobLike = exportError?.response?.data;
      if (blobLike instanceof Blob) {
        try {
          const text = await blobLike.text();
          const parsed = JSON.parse(text);
          nextMessage = parsed?.message || nextMessage;
        } catch {
          nextMessage = nextMessage;
        }
      } else if (exportError?.response?.data?.message) {
        nextMessage = exportError.response.data.message;
      }
      setError(nextMessage);
    } finally {
      setExporting(false);
    }
  }, [brandFilter, diffFieldFilter, searchInput, sortBy, sortOrder, vendorFilter]);

  const handlePreviewPdfReport = useCallback(async () => {
    try {
      setPdfPreviewOpen(true);
      setPdfPreviewLoading(true);
      setPdfPreviewError("");
      setPdfPreviewData(null);
      setError("");

      const response = await api.get("/items/final-pis-check/export-preview", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          diff_field: diffFieldFilter,
          sortBy,
          sortOrder,
        },
      });

      setPdfPreviewData(response?.data?.data || null);
    } catch (previewError) {
      setPdfPreviewError(
        previewError?.response?.data?.message
          || "Failed to load Final PIS Check PDF preview.",
      );
    } finally {
      setPdfPreviewLoading(false);
    }
  }, [brandFilter, diffFieldFilter, searchInput, sortBy, sortOrder, vendorFilter]);

  const handleClosePdfPreview = useCallback(() => {
    if (exportingPdf) return;
    setPdfPreviewOpen(false);
  }, [exportingPdf]);

  const handleExportPdfReport = useCallback(async () => {
    if (!pdfReportRef.current || !pdfPreviewData || exportingPdf) return;

    const target = pdfReportRef.current;
    const scrollContainer = target.closest(".pis-diff-pdf-preview-scroll");
    const previousScrollStyles = scrollContainer
      ? {
          maxHeight: scrollContainer.style.maxHeight,
          overflow: scrollContainer.style.overflow,
        }
      : null;

    try {
      setExportingPdf(true);
      await waitForFontsReady();

      if (scrollContainer) {
        scrollContainer.style.maxHeight = "none";
        scrollContainer.style.overflow = "visible";
      }

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

      const fileDate = new Date().toISOString().slice(0, 10);
      const filterName = toFilenameSegment(
        [brandFilter, vendorFilter, diffFieldFilter, searchInput]
          .filter(Boolean)
          .join("_"),
        "final-pis-check",
      );
      pdf.save(`final-pis-check-${filterName}-${fileDate}.pdf`);
    } catch (pdfError) {
      console.error("Final PIS Check PDF export failed:", pdfError);
      setPdfPreviewError("Failed to export Final PIS Check PDF.");
    } finally {
      if (scrollContainer && previousScrollStyles) {
        scrollContainer.style.maxHeight = previousScrollStyles.maxHeight;
        scrollContainer.style.overflow = previousScrollStyles.overflow;
      }
      setExportingPdf(false);
    }
  }, [brandFilter, diffFieldFilter, exportingPdf, pdfPreviewData, searchInput, vendorFilter]);

  const totalPages = Number(reportData?.pagination?.totalPages || 1);
  const totalRecords = Number(reportData?.pagination?.total || 0);
  const rowsOnPage = Array.isArray(reportData?.rows) ? reportData.rows.length : 0;

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-lg-3 col-md-6">
                <label className="form-label">Search</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftSearchInput}
                  placeholder="Code, name, or description"
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                />
              </div>

              <div className="col-lg-2 col-md-6">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                  disabled={optionsLoading}
                >
                  <option value="all">All Brands</option>
                  {options.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-lg-2 col-md-6">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                  disabled={optionsLoading}
                >
                  <option value="all">All Vendors</option>
                  {options.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-lg-2 col-md-6">
                <label className="form-label">Difference Field</label>
                <select
                  className="form-select"
                  value={draftDiffFieldFilter}
                  onChange={(event) => setDraftDiffFieldFilter(event.target.value)}
                  disabled={optionsLoading}
                >
                  <option value="all">All Fields</option>
                  {options.diff_fields.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-lg-1 col-md-6">
                <label className="form-label">Sort</label>
                <select
                  className="form-select"
                  value={draftSortBy}
                  onChange={(event) => setDraftSortBy(event.target.value)}
                >
                  {SORT_BY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-lg-1 col-md-6">
                <label className="form-label">Order</label>
                <select
                  className="form-select"
                  value={draftSortOrder}
                  onChange={(event) => setDraftSortOrder(event.target.value)}
                >
                  {SORT_ORDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-12 d-flex flex-wrap justify-content-end gap-2 mt-2">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={handleExportReport}
                  disabled={exporting || loading}
                >
                  {exporting ? "Exporting..." : "Export XLSX"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handlePreviewPdfReport}
                  disabled={pdfPreviewLoading || loading}
                >
                  {pdfPreviewLoading ? "Loading Preview..." : "Preview PDF"}
                </button>
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
                  Apply
                </button>
              </div>
            </form>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="card om-card">
            <div className="card-body text-center py-5">Loading Final PIS Check...</div>
          </div>
        ) : (
          <>
            <div className="small text-secondary mb-2">
              Showing {rowsOnPage} of {totalRecords} items. Sorted by{" "}
              {SORT_BY_OPTIONS.find((option) => option.value === sortBy)?.label || "Updated Date"}.
            </div>
            <FinalPisCheckReport
              report={reportData}
              showHeader={false}
              showOverviewGrids={false}
              showBrandVendorMeta={false}
              canEditPis={canEditPis}
              onEditPis={handleOpenEditPis}
              activeEditCode={activeEditCode}
            />
          </>
        )}

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </button>
        </div>

        <div className="d-flex justify-content-end mt-3">
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
        </div>
      </div>

      {pdfPreviewOpen && (
        <div
          className="modal d-block om-modal-backdrop"
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
          onClick={handleClosePdfPreview}
        >
          <div
            className="modal-dialog modal-dialog-centered modal-xl pis-diff-preview-dialog"
            role="document"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <div>
                  <h5 className="modal-title">Final PIS Check PDF Preview</h5>
                  <div className="small text-muted">
                    Review the report exactly as it will be exported.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={handleClosePdfPreview}
                  disabled={exportingPdf}
                />
              </div>

              <div className="modal-body p-0">
                {pdfPreviewLoading ? (
                  <div className="text-center py-5">Preparing preview...</div>
                ) : pdfPreviewError ? (
                  <div className="p-4">
                    <div className="alert alert-danger mb-0">{pdfPreviewError}</div>
                  </div>
                ) : pdfPreviewData ? (
                  <div className="pis-diff-pdf-preview-scroll">
                    <FinalPisCheckReport
                      report={pdfPreviewData}
                      reportRef={pdfReportRef}
                      title="Final PIS Check Report"
                      eyebrow="Final PIS Check"
                      showHeader
                      showOverviewGrids
                      showBrandVendorMeta
                      activeEditCode=""
                    />
                  </div>
                ) : (
                  <div className="text-center py-5 text-secondary">
                    No preview data available.
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={handleClosePdfPreview}
                  disabled={exportingPdf}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleExportPdfReport}
                  disabled={exportingPdf || pdfPreviewLoading || !pdfPreviewData}
                >
                  {exportingPdf ? "Exporting..." : "Export PDF"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedItem && canEditPis && (
        <EditPisModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={handlePisUpdated}
        />
      )}
    </>
  );
};

export default FinalPISCheck;
