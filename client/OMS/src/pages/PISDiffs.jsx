import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import EditPisModal from "../components/EditPisModal";
import SortHeaderButton from "../components/SortHeaderButton";
import { getUserFromToken } from "../auth/auth.utils";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import {
  buildMeasuredSizeEntriesFromLegacy,
  getWeightValueFromModel,
  hasMeaningfulMeasuredSize,
} from "../utils/measuredSizeForm";
import { formatFixedNumber, formatLbhValue } from "../utils/measurementDisplay";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

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
  if (!cleaned) return fallback;
  return cleaned;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const getBrand = (item = {}) =>
  item?.brand_name
  || item?.brand
  || (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "N/A");

const getVendors = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.join(", ")
    : "N/A";

const isPisChecked = (item = {}) => item?.pis_checked_flag === true;

const formatRemarkLabel = (remark = "", fallback = "Value") => {
  const normalized = String(remark || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const buildMeasurementEntries = ({
  item = {},
  source = "pis",
  group = "item",
} = {}) => {
  const isPis = source === "pis";
  const isItemGroup = group === "item";
  const weight = isPis ? item?.pis_weight : item?.inspected_weight;

  return buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: isPis
      ? (isItemGroup ? item?.pis_item_sizes : item?.pis_box_sizes)
      : (isItemGroup ? item?.inspected_item_sizes : item?.inspected_box_sizes),
    singleLbh: isPis
      ? (isItemGroup ? item?.pis_item_LBH : item?.pis_box_LBH)
      : (isItemGroup
          ? item?.inspected_item_LBH
          : item?.inspected_box_LBH),
    topLbh: isPis
      ? (isItemGroup ? item?.pis_item_top_LBH : item?.pis_box_top_LBH)
      : (isItemGroup
          ? item?.inspected_item_top_LBH
          : item?.inspected_box_top_LBH || item?.inspected_top_LBH),
    bottomLbh: isPis
      ? (isItemGroup ? item?.pis_item_bottom_LBH : item?.pis_box_bottom_LBH)
      : (isItemGroup
          ? item?.inspected_item_bottom_LBH
          : item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH),
    totalWeight: getWeightValueFromModel(
      weight,
      isItemGroup ? "total_net" : "total_gross",
    ),
    topWeight: getWeightValueFromModel(
      weight,
      isItemGroup ? "top_net" : "top_gross",
    ),
    bottomWeight: getWeightValueFromModel(
      weight,
      isItemGroup ? "bottom_net" : "bottom_gross",
    ),
    weightKey: isItemGroup ? "net_weight" : "gross_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));
};

const formatMeasurementBlock = (entries = [], fallbackWeight = "Not Set") => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      sizeDisplay: "Not Set",
      weightDisplay: fallbackWeight,
    };
  }

  const sizeDisplay = entries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const sizeValue = formatLbhValue(entry, { fallback: "Not Set" });
      if (entries.length === 1 && !String(entry?.remark || "").trim()) {
        return sizeValue;
      }
      return `${label}: ${sizeValue}`;
    })
    .join(" | ");

  const weightDisplay = entries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const parsedWeight = Number(entry?.weight || 0);
      const weightValue =
        Number.isFinite(parsedWeight) && parsedWeight > 0
          ? formatFixedNumber(parsedWeight)
          : "Not Set";
      if (entries.length === 1 && !String(entry?.remark || "").trim()) {
        return weightValue;
      }
      return `${label}: ${weightValue}`;
    })
    .join(" | ");

  return {
    sizeDisplay,
    weightDisplay,
  };
};

const MeasurementCell = ({
  item,
  source,
  group,
  weightLabel,
}) => {
  const entries = buildMeasurementEntries({ item, source, group });
  const { sizeDisplay, weightDisplay } = formatMeasurementBlock(entries);

  return (
    <div className="d-flex flex-column gap-1">
      <span>Size: {sizeDisplay}</span>
      <span>{weightLabel}: {weightDisplay}</span>
    </div>
  );
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

const PisDiffPdfReport = ({ report, reportRef = null }) => {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const summary = report?.summary || {};
  const filters = report?.filters || {};

  return (
    <div className="pis-diff-pdf-report" ref={reportRef}>
      <header className="pis-diff-report-header">
        <div>
          <div className="pis-diff-report-eyebrow">Checked PIS Diffs</div>
          <h2 className="pis-diff-report-title">PIS vs Inspected Difference Report</h2>
          <div className="pis-diff-report-subtitle">
            Generated {formatPreviewDateTime(report?.generated_at)}
          </div>
        </div>
        <div className="pis-diff-report-count">
          <strong>{Number(summary?.checked_diff_items || rows.length)}</strong>
          <span>Items</span>
        </div>
      </header>

      <section className="pis-diff-report-filter-grid">
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
      </section>

      <section className="pis-diff-report-summary-grid">
        <div>
          <span>Detailed Rows</span>
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

      <div className="pis-diff-report-items">
        {rows.map((row, rowIndex) => {
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
              key={row?.id || row?.code || `pis-diff-row-${rowIndex}`}
            >
              <div className="pis-diff-report-item-head">
                <div>
                  <div className="pis-diff-report-code">{row?.code || "N/A"}</div>
                  <div className="pis-diff-report-description">
                    {row?.description || "N/A"}
                  </div>
                  <div className="pis-diff-report-meta">
                    <span>{row?.brand || "N/A"}</span>
                    <span>{row?.vendors || "N/A"}</span>
                    {row?.updated_at && <span>Updated {row.updated_at}</span>}
                  </div>
                </div>
                <div className="pis-diff-report-badges">
                  {row?.inspection_report_mismatch && (
                    <span className="text-bg-danger">Inspection report mismatch</span>
                  )}
                  {(Array.isArray(row?.diff_fields) ? row.diff_fields : []).map((field) => (
                    <span key={`${row?.code}-${field}`}>{field}</span>
                  ))}
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
        })}
      </div>
    </div>
  );
};

const PISDiffs = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "pis-diffs");
  const pdfReportRef = useRef(null);

  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const canEditPis = ["admin", "manager", "dev"].includes(normalizedRole);

  const [rows, setRows] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewData, setPdfPreviewData] = useState(null);
  const [pdfPreviewError, setPdfPreviewError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState("");
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
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
    item_codes: [],
  });
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("code");
  const [sortOrder, setSortOrder] = useState("asc");

  const fetchDiffItems = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/items/pis-diffs", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          page,
          limit,
        },
      });

      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setTotalPages(Number(response?.data?.pagination?.totalPages || 1));
      setTotalRecords(Number(response?.data?.pagination?.totalRecords || 0));
      setFilters({
        brands: Array.isArray(response?.data?.filters?.brands)
          ? response.data.filters.brands
          : [],
        vendors: Array.isArray(response?.data?.filters?.vendors)
          ? response.data.filters.vendors
          : [],
        item_codes: Array.isArray(response?.data?.filters?.item_codes)
          ? response.data.filters.item_codes
          : [],
      });
    } catch (fetchError) {
      setError(fetchError?.response?.data?.message || "Failed to load PIS diffs.");
      setRows([]);
      setTotalPages(1);
      setTotalRecords(0);
      setFilters({
        brands: [],
        vendors: [],
        item_codes: [],
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, limit, page, searchInput, vendorFilter]);

  useEffect(() => {
    fetchDiffItems();
  }, [fetchDiffItems]);

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
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setDraftSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const searchValue = normalizeSearchParam(searchInput);

    if (searchValue) next.set("search", searchValue);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    page,
    searchInput,
    searchParams,
    setSearchParams,
    syncedQuery,
    vendorFilter,
  ]);

  const itemCodeOptions = useMemo(
    () => (Array.isArray(filters.item_codes) ? filters.item_codes : []),
    [filters.item_codes],
  );

  const getMeasurementSortValue = useCallback((item, source, group) => {
    const { sizeDisplay, weightDisplay } = formatMeasurementBlock(
      buildMeasurementEntries({ item, source, group }),
    );
    return `${sizeDisplay} | ${weightDisplay}`;
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
    },
    [sortBy, sortOrder],
  );

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
  }, [draftBrandFilter, draftSearchInput, draftVendorFilter]);

  const handleClearFilters = useCallback(() => {
    setPage(1);
    setDraftSearchInput("");
    setDraftBrandFilter("all");
    setDraftVendorFilter("all");
    setSearchInput("");
    setBrandFilter("all");
    setVendorFilter("all");
  }, []);

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (item, column) => {
          if (column === "code") return item?.code;
          if (column === "description") return item?.description || item?.name;
          if (column === "brand") return getBrand(item);
          if (column === "vendors") return getVendors(item);
          if (column === "diffs") {
            const statusLabel = isPisChecked(item) ? "PIS Checked" : "Needs PIS Check";
            const diffFields = Array.isArray(item?.pis_diff?.fields)
              ? item.pis_diff.fields
              : [];
            return `${statusLabel} | ${diffFields.join(", ")}`;
          }
          if (column === "inspectedItem") {
            return getMeasurementSortValue(item, "inspected", "item");
          }
          if (column === "pisItem") return getMeasurementSortValue(item, "pis", "item");
          if (column === "inspectedBox") {
            return getMeasurementSortValue(item, "inspected", "box");
          }
          if (column === "pisBox") return getMeasurementSortValue(item, "pis", "box");
          return "";
        },
      }),
    [getMeasurementSortValue, rows, sortBy, sortOrder],
  );

  const checkedRowsCount = useMemo(
    () => rows.filter((item) => isPisChecked(item)).length,
    [rows],
  );

  const handlePisUpdated = useCallback(
    (updatedItem = {}) => {
      const nextItem = {
        ...(selectedItem || {}),
        ...(updatedItem && typeof updatedItem === "object" ? updatedItem : {}),
        pis_checked_flag: true,
      };
      const nextItemId = String(nextItem?._id || "");

      if (nextItemId) {
        setRows((prevRows) =>
          prevRows.map((row) =>
            String(row?._id || "") === nextItemId
              ? { ...row, ...nextItem, pis_checked_flag: true }
              : row,
          ),
        );
      }

      setSelectedItem(null);
      fetchDiffItems();
    },
    [fetchDiffItems, selectedItem],
  );

  const handleExportCheckedReport = useCallback(async () => {
    try {
      setExporting(true);
      setError("");

      const response = await api.get("/items/pis-diffs/export", {
        responseType: "blob",
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
        },
      });

      const disposition = String(
        response?.headers?.["content-disposition"] || "",
      );
      const match = disposition.match(
        /filename\*?=(?:UTF-8''|\"?)([^\";]+)/i,
      );
      const fallbackName = `pis-diffs-checked-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
      let nextMessage = "Failed to export checked PIS diff report.";
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
  }, [brandFilter, searchInput, vendorFilter]);

  const handlePreviewPdfReport = useCallback(async () => {
    try {
      setPdfPreviewOpen(true);
      setPdfPreviewLoading(true);
      setPdfPreviewError("");
      setPdfPreviewData(null);
      setError("");

      const response = await api.get("/items/pis-diffs/export-preview", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
        },
      });

      setPdfPreviewData(response?.data?.data || null);
    } catch (previewError) {
      setPdfPreviewError(
        previewError?.response?.data?.message
          || "Failed to load checked PIS diff PDF preview.",
      );
    } finally {
      setPdfPreviewLoading(false);
    }
  }, [brandFilter, searchInput, vendorFilter]);

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
        [brandFilter, vendorFilter, searchInput].filter(Boolean).join("_"),
        "checked",
      );
      pdf.save(`pis-diffs-${filterName}-${fileDate}.pdf`);
    } catch (pdfError) {
      console.error("PIS diff PDF export failed:", pdfError);
      setPdfPreviewError("Failed to export checked PIS diff PDF.");
    } finally {
      if (scrollContainer && previousScrollStyles) {
        scrollContainer.style.maxHeight = previousScrollStyles.maxHeight;
        scrollContainer.style.overflow = previousScrollStyles.overflow;
      }
      setExportingPdf(false);
    }
  }, [brandFilter, exportingPdf, pdfPreviewData, searchInput, vendorFilter]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h4 mb-0">PIS Diffs</h2>
          <div className="d-flex align-items-center gap-2">
            <span className="text-secondary small">
              Items where inspected measurements differ from PIS
            </span>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={handleExportCheckedReport}
              disabled={exporting || loading}
              title="Export a readable XLSX report for checked PIS diff items matching the current filters"
            >
              {exporting ? "Exporting..." : "Export XLSX"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handlePreviewPdfReport}
              disabled={pdfPreviewLoading || loading}
              title="Preview a PDF-ready checked PIS diff report before exporting"
            >
              {pdfPreviewLoading ? "Loading Preview..." : "Preview PDF"}
            </button>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-4">
                <label className="form-label">Search (Code / Name / Description)</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftSearchInput}
                  list="pis-diff-item-code-options"
                  placeholder="Search items"
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                />
                <datalist id="pis-diff-item-code-options">
                  {itemCodeOptions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>

              <div className="col-md-3">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                >
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-3">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-2 d-grid gap-2">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={handleClearFilters}
                  disabled={loading}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Records: {totalRecords}</span>
            <span className="om-summary-chip">Checked on Page: {checkedRowsCount}</span>
            <span className="om-summary-chip">Page: {page}</span>
            <span className="om-summary-chip">Limit: {limit}</span>
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
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>
                        <SortHeaderButton
                          label="Item Code"
                          isActive={sortBy === "code"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("code", "asc")}
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
                          label="Brand"
                          isActive={sortBy === "brand"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("brand", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Vendors"
                          isActive={sortBy === "vendors"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendors", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Diffs"
                          isActive={sortBy === "diffs"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("diffs", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Inspected Item"
                          isActive={sortBy === "inspectedItem"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("inspectedItem", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Item"
                          isActive={sortBy === "pisItem"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pisItem", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Inspected Box"
                          isActive={sortBy === "inspectedBox"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("inspectedBox", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Box"
                          isActive={sortBy === "pisBox"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pisBox", "asc")}
                        />
                      </th>
                      <th>Inspection Report</th>
                      {canEditPis && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan={canEditPis ? 11 : 10} className="text-center py-4">
                          No PIS diffs found
                        </td>
                      </tr>
                    )}

                    {sortedRows.map((item) => {
                      const isCheckedWithDiff = isPisChecked(item);

                      return (
                        <tr
                          key={item?._id || item?.code}
                          className={isCheckedWithDiff ? "table-danger" : ""}
                        >
                          <td>{item?.code || "N/A"}</td>
                          <td>{item?.description || item?.name || "N/A"}</td>
                          <td>{getBrand(item)}</td>
                          <td>{getVendors(item)}</td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              <span
                                className={`badge ${
                                  isCheckedWithDiff ? "text-bg-danger" : "text-bg-warning"
                                }`}
                              >
                                {isCheckedWithDiff ? "PIS Checked" : "Needs PIS Check"}
                              </span>
                              {(Array.isArray(item?.pis_diff?.fields) ? item.pis_diff.fields : []).map(
                                (field) => (
                                  <span key={field} className="badge text-bg-warning">
                                    {field}
                                  </span>
                                ),
                              )}
                            </div>
                          </td>
                          <td>
                            <MeasurementCell
                              item={item}
                              source="inspected"
                              group="item"
                              weightLabel="Net"
                            />
                          </td>
                          <td>
                            <MeasurementCell
                              item={item}
                              source="pis"
                              group="item"
                              weightLabel="Net"
                            />
                          </td>
                          <td>
                            <MeasurementCell
                              item={item}
                              source="inspected"
                              group="box"
                              weightLabel="Gross"
                            />
                          </td>
                          <td>
                            <MeasurementCell
                              item={item}
                              source="pis"
                              group="box"
                              weightLabel="Gross"
                            />
                          </td>
                          <td>
                            {item?.inspection_report_mismatch ? (
                              <span className="badge text-bg-danger">
                                Inspection report mismatch
                              </span>
                            ) : (
                              <span className="badge text-bg-light border text-secondary">
                                No mismatch
                              </span>
                            )}
                          </td>
                          {canEditPis && (
                            <td>
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => setSelectedItem(item)}
                              >
                                Update PIS
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1}
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
            disabled={page >= totalPages}
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
                  <h5 className="modal-title">PIS Diff PDF Preview</h5>
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
                    <div className="alert alert-danger mb-0">
                      {pdfPreviewError}
                    </div>
                  </div>
                ) : pdfPreviewData ? (
                  <div className="pis-diff-pdf-preview-scroll">
                    <PisDiffPdfReport
                      report={pdfPreviewData}
                      reportRef={pdfReportRef}
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

export default PISDiffs;
