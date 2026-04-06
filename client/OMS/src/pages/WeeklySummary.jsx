import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatCbm } from "../utils/cbm";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_ENTITY_FILTER = "all";

const normalizeEntityFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_ENTITY_FILTER;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return DEFAULT_ENTITY_FILTER;
  }
  return normalized;
};

const getBrandKey = (value) => String(value || "").trim().toLowerCase();

const toBrandLogoDataUrl = (logoObj) => {
  if (typeof logoObj?.url === "string" && logoObj.url.trim()) {
    return logoObj.url.trim();
  }

  const raw = logoObj?.data?.data || logoObj?.data;
  if (!Array.isArray(raw) || raw.length === 0) return "";

  let binary = "";
  raw.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return `data:${logoObj?.contentType || "image/webp"};base64,${window.btoa(binary)}`;
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    if (!(blob instanceof Blob)) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read brand logo"));
    reader.readAsDataURL(blob);
  });

const waitForImageLoad = (image) =>
  new Promise((resolve) => {
    if (!image || image.complete) {
      resolve();
      return;
    }

    const handleDone = () => resolve();
    image.addEventListener("load", handleDone, { once: true });
    image.addEventListener("error", handleDone, { once: true });
  });

const waitForImagesToLoad = async (container) => {
  if (!container) return;
  const images = Array.from(container.querySelectorAll("img"));
  await Promise.all(images.map((image) => waitForImageLoad(image)));
};

const fetchRemoteLogoAsDataUrl = async (url) => {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return "";

  const response = await fetch(normalizedUrl, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Failed to fetch remote logo: ${response.status}`);
  }

  return blobToDataUrl(await response.blob());
};

const fetchBrandLogoFallback = async (brandName) => {
  const response = await api.get("/brands/");
  const brands = Array.isArray(response?.data?.data) ? response.data.data : [];
  const matchedBrand = brands.find(
    (brand) => getBrandKey(brand?.name) === getBrandKey(brandName),
  );
  const resolvedLogoSrc = toBrandLogoDataUrl(matchedBrand?.logo);
  if (!resolvedLogoSrc) return "";
  if (resolvedLogoSrc.startsWith("data:image/")) {
    return resolvedLogoSrc;
  }

  try {
    return await fetchRemoteLogoAsDataUrl(resolvedLogoSrc);
  } catch (error) {
    return resolvedLogoSrc;
  }
};

const toReportQuantity = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const toReportCbm = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const toDateInputValue = (date) => toISODateString(date);

const getDefaultWeeklySummaryRange = () => {
  const todayIso = toISODateString(new Date());
  const todayUtc = todayIso ? new Date(`${todayIso}T00:00:00Z`) : new Date();
  const toDate = new Date(todayUtc);
  toDate.setUTCDate(toDate.getUTCDate() - 1);
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 6);

  return {
    fromDate: toDateInputValue(fromDate),
    toDate: toDateInputValue(toDate),
  };
};

const toTimestamp = (value) => {
  if (!value) return 0;
  const asString = String(value).trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const [day, month, year] = asString.split(/[/-]/).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const isIsoDateWithinInclusiveRange = (
  isoDate = "",
  fromDate = "",
  toDate = "",
) => {
  const normalizedDate = String(isoDate || "").trim();
  const normalizedFrom = String(fromDate || "").trim();
  const normalizedTo = String(toDate || "").trim();

  if (!normalizedDate || !normalizedFrom || !normalizedTo) {
    return false;
  }

  return normalizedDate >= normalizedFrom && normalizedDate <= normalizedTo;
};

const getItemInspectionDateInRange = (item = {}) =>
  String(
    item?.last_inspection_date_in_range ||
      item?.goods_not_ready_inspection_date ||
      "",
  ).trim();

const getItemLatestOverallInspectionDate = (item = {}) =>
  String(item?.latest_overall_inspection_date || "").trim();

const isUnderInspectionStatus = (value) =>
  String(value || "").trim().toLowerCase() === "under inspection";

const buildVendorDisplayRows = (
  items = [],
  { fromDate = "", toDate = "" } = {},
) => {
  const poMap = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const orderId = String(item?.order_id || "").trim() || "N/A";
    if (!poMap.has(orderId)) {
      poMap.set(orderId, []);
    }
    poMap.get(orderId).push(item);
  }

  return Array.from(poMap.entries())
    .sort((left, right) => String(left[0] || "").localeCompare(String(right[0] || "")))
    .flatMap(([orderId, poItems]) => {
      const sortedItems = [...poItems].sort((left, right) =>
        String(left?.item_code || "").localeCompare(String(right?.item_code || "")),
      );
      const inspectedItemsInRange = sortedItems.filter((item) =>
        Boolean(item?.inspected_in_range),
      );
      const allItemsPacked =
        sortedItems.length > 0 &&
        sortedItems.every(
          (item) =>
            toReportQuantity(item?.pending) <= 0 &&
            !isUnderInspectionStatus(item?.order_status),
        );
      const latestOverallInspectionMeta = sortedItems.reduce(
        (latest, item) => {
          const inspectionDate = getItemLatestOverallInspectionDate(item);
          const inspectionTime = toTimestamp(inspectionDate);
          if (inspectionTime <= (latest?.inspectionTime || 0)) {
            return latest;
          }

          return {
            inspectionTime,
            inspectionDate,
            inspectorName: String(
              item?.latest_overall_inspector_name || "",
            ).trim(),
          };
        },
        {
          inspectionTime: 0,
          inspectionDate: "",
          inspectorName: "",
        },
      );

      if (sortedItems.length === 0 || inspectedItemsInRange.length === 0) {
        return [];
      }

      if (
        allItemsPacked &&
        isIsoDateWithinInclusiveRange(
          latestOverallInspectionMeta.inspectionDate,
          fromDate,
          toDate,
        )
      ) {
        return [{
          key: `${orderId}-packed`,
          po: orderId,
          itemLabel: "All items are packed",
          totalOrderQuantity: sortedItems.reduce(
            (sum, item) => sum + toReportQuantity(item?.total_order_quantity),
            0,
          ),
          quantityPassed: sortedItems.reduce(
            (sum, item) => sum + toReportQuantity(item?.quantity_passed),
            0,
          ),
          totalCbm: sortedItems.reduce(
            (sum, item) => sum + toReportCbm(item?.total_cbm),
            0,
          ),
          pending: 0,
          packedSummary: true,
          lastInspector: latestOverallInspectionMeta.inspectorName,
          lastInspectionDate: latestOverallInspectionMeta.inspectionDate,
        }];
      }

      return inspectedItemsInRange.map((item, index) => ({
        key: `${orderId}-${item?.item_code || "item"}-${index}`,
        po: orderId,
        itemLabel: item?.item_code || "N/A",
        totalOrderQuantity: toReportQuantity(item?.total_order_quantity),
        quantityPassed: toReportQuantity(item?.quantity_passed),
        totalCbm: toReportCbm(item?.total_cbm),
        pending: toReportQuantity(item?.pending),
        goodsNotReady: Boolean(item?.goods_not_ready),
        goodsNotReadyReason: String(item?.goods_not_ready_reason || "").trim(),
        goodsNotReadyInspectionDate: String(item?.goods_not_ready_inspection_date || "").trim(),
        lastInspector:
          item?.last_inspector_name_in_range
          || item?.latest_overall_inspector_name
          || "",
        lastInspectionDate: getItemInspectionDateInRange(item),
        packedSummary: false,
      }));
    });
};

const defaultReport = {
  filters: {
    period: "rolling_week_until_yesterday",
    period_label: "Yesterday - 6 days to Yesterday",
    from_date: "",
    to_date: "",
    brand: "",
    brand_options: [],
  },
  vendors: [],
};

const WeeklySummary = () => {
  const navigate = useNavigate();
  const reportRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "weekly-order-summary");
  const defaultDateRange = useMemo(() => getDefaultWeeklySummaryRange(), []);

  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [fromDateFilter, setFromDateFilter] = useState(() =>
    String(
      searchParams.get("from_date")
      || searchParams.get("fromDate")
      || defaultDateRange.fromDate,
    ).trim(),
  );
  const [toDateFilter, setToDateFilter] = useState(() =>
    String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || defaultDateRange.toDate,
    ).trim(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [brandLogoSrc, setBrandLogoSrc] = useState("");
  const [brandLogoLoading, setBrandLogoLoading] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = {};
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }
      if (fromDateFilter) {
        params.from_date = fromDateFilter;
      }
      if (toDateFilter) {
        params.to_date = toDateFilter;
      }

      const response = await api.get("/qc/reports/weekly-summary", { params });
      const responseData = response?.data || {};

      setReport({
        filters: {
          ...defaultReport.filters,
          ...(responseData?.filters || {}),
        },
        vendors: Array.isArray(responseData?.vendors) ? responseData.vendors : [],
      });
    } catch (err) {
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load weekly order summary.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, fromDateFilter, toDateFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    const nextFromDate = String(
      searchParams.get("from_date")
      || searchParams.get("fromDate")
      || defaultDateRange.fromDate,
    ).trim();
    const nextToDate = String(
      searchParams.get("to_date")
      || searchParams.get("toDate")
      || defaultDateRange.toDate,
    ).trim();

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setFromDateFilter((prev) => (prev === nextFromDate ? prev : nextFromDate));
    setToDateFilter((prev) => (prev === nextToDate ? prev : nextToDate));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [defaultDateRange.fromDate, defaultDateRange.toDate, searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (brandFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("brand", brandFilter);
    }
    if (fromDateFilter) {
      next.set("from_date", fromDateFilter);
    }
    if (toDateFilter) {
      next.set("to_date", toDateFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    fromDateFilter,
    searchParams,
    setSearchParams,
    syncedQuery,
    toDateFilter,
  ]);

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

  const visibleVendors = useMemo(
    () =>
      (Array.isArray(report?.vendors) ? report.vendors : [])
        .map((vendorEntry, index) => {
          const vendorDisplayRows = buildVendorDisplayRows(vendorEntry?.items, {
            fromDate: filters.from_date || fromDateFilter,
            toDate: filters.to_date || toDateFilter,
          });
          if (vendorDisplayRows.length === 0) {
            return null;
          }

          return {
            vendorKey: String(vendorEntry?.vendor || "").trim() || `vendor-${index}`,
            vendor: vendorEntry?.vendor || "N/A",
            vendorDisplayRows,
          };
        })
        .filter(Boolean),
    [filters.from_date, filters.to_date, fromDateFilter, report?.vendors, toDateFilter],
  );

  useEffect(() => {
    const brandName = brandFilter === DEFAULT_ENTITY_FILTER ? "" : String(brandFilter || "").trim();
    if (!brandName) {
      setBrandLogoSrc("");
      setBrandLogoLoading(false);
      return undefined;
    }

    let cancelled = false;
    setBrandLogoSrc("");
    setBrandLogoLoading(true);

    const fetchBrandLogo = async () => {
      try {
        const response = await api.get(
          "/brands/logo",
          {
            params: { brand: brandName },
            responseType: "blob",
          },
        );
        const nextLogoSrc = await blobToDataUrl(response?.data);

        if (!cancelled) {
          setBrandLogoSrc(nextLogoSrc);
        }
      } catch (err) {
        try {
          const fallbackLogoSrc = await fetchBrandLogoFallback(brandName);
          if (!cancelled) {
            setBrandLogoSrc(fallbackLogoSrc);
          }
        } catch {
          if (!cancelled) {
            setBrandLogoSrc("");
          }
        }
      } finally {
        if (!cancelled) {
          setBrandLogoLoading(false);
        }
      }
    };

    fetchBrandLogo();

    return () => {
      cancelled = true;
    };
  }, [brandFilter]);

  const handleConfirmAndExport = useCallback(async () => {
    if (
      !reportRef.current
      || exportingPdf
      || loading
      || brandLogoLoading
      || visibleVendors.length === 0
    ) {
      return;
    }

    const confirmed = window.confirm(
      "Confirm export of this weekly order summary as PDF?",
    );
    if (!confirmed) return;

    try {
      setExportingPdf(true);
      const target = reportRef.current;
      await waitForImagesToLoad(target);
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

      const safeFromDate = String(filters.from_date || "from").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeToDate = String(filters.to_date || "to").replace(/[^a-zA-Z0-9_-]/g, "_");
      pdf.save(`weekly-order-summary-${safeFromDate}-to-${safeToDate}.pdf`);
    } catch (err) {
      console.error("Weekly order summary export failed:", err);
      alert("Failed to export weekly order summary PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [
    brandLogoLoading,
    exportingPdf,
    filters.from_date,
    filters.to_date,
    loading,
    visibleVendors.length,
  ]);

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
          <h2 className="h4 mb-0">Weekly Order Summary</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConfirmAndExport}
            disabled={loading || exportingPdf || brandLogoLoading || visibleVendors.length === 0}
          >
            {exportingPdf
              ? "Exporting..."
              : brandLogoLoading
              ? "Loading logo..."
              : "Confirm & Export PDF"}
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-end">
            <div>
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={brandFilter}
                onChange={(e) => setBrandFilter(normalizeEntityFilter(e.target.value))}
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
              <label className="form-label mb-1">From</label>
              <input
                type="date"
                className="form-control"
                value={fromDateFilter}
                onChange={(e) => setFromDateFilter(String(e.target.value || "").trim())}
              />
            </div>

            <div>
              <label className="form-label mb-1">To</label>
              <input
                type="date"
                className="form-control"
                value={toDateFilter}
                onChange={(e) => setToDateFilter(String(e.target.value || "").trim())}
              />
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={fetchReport}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div ref={reportRef} className="weekly-summary-export-surface d-grid gap-3">
          <div className="card om-card">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
                <div>
                  <h3 className="h5 mb-1">Weekly Order Summary</h3>
                  <div className="text-secondary small">
                    {formatDateDDMMYYYY(filters.from_date)} - {formatDateDDMMYYYY(filters.to_date)}
                  </div>
                </div>
                {brandLogoSrc ? (
                  <div className="weekly-summary-brand-panel">
                    <img
                      src={brandLogoSrc}
                      alt={`${brandFilter} logo`}
                      className="weekly-summary-brand-logo"
                    />
                  </div>
                ) : (
                  <span className="om-summary-chip">
                    {brandFilter === DEFAULT_ENTITY_FILTER ? "All Brands" : brandFilter}
                  </span>
                )}
              </div>
            </div>
          </div>

          {loading && visibleVendors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-center py-4">Loading...</div>
            </div>
          ) : visibleVendors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No item rows found for the selected range.
              </div>
            </div>
          ) : (
            visibleVendors.map((vendorEntry) => {
              const { vendorKey, vendor, vendorDisplayRows } = vendorEntry;

              return (
                <div key={vendorKey} className="card om-card">
                  <div className="card-body p-0">
                    <div className="weekly-summary-vendor-header px-3 py-3 border-bottom">
                      <div className="h5 mb-0">{vendor}</div>
                    </div>

                    <div className="table-responsive">
                      <table className="table table-sm table-striped align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Last Inspection Date</th>
                            <th>PO</th>
                            <th>Item Code</th>
                            <th>Total Order Quantity</th>
                            <th>Packed</th>
                            <th>Total CBM</th>
                            <th>Open Quantity</th>
                            <th>Last Inspector</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorDisplayRows.map((row) => (
                            <tr
                              key={`${vendorKey}-${row.key}`}
                              className={
                                row.goodsNotReady
                                  ? "weekly-summary-warning-row"
                                  : row.packedSummary
                                  ? "weekly-summary-packed-row"
                                  : ""
                              }
                            >
                              <td>{row.lastInspectionDate ? formatDateDDMMYYYY(row.lastInspectionDate) : "-"}</td>
                              <td>{row.po || ""}</td>
                              <td>
                                <div>{row.itemLabel || "N/A"}</div>
                                {/* {row.goodsNotReady ? (
                                  <div className="small fw-semibold">Goods Not Ready</div>
                                ) : null} */}
                              </td>
                              {row.goodsNotReady ? (
                                <>
                                  <td colSpan="1"></td>
                                  <td colSpan="3">
                                    <div className="fw-semibold">
                                      {row.goodsNotReadyReason || "Reason not provided"}
                                    </div>
                                  </td>
                                  <td>{row.lastInspector || "-"}</td>
                                </>
                              ) : (
                                <>
                                  <td>{row.totalOrderQuantity ?? 0}</td>
                                  <td>{row.quantityPassed ?? 0}</td>
                                  <td>{formatCbm(row.totalCbm ?? 0)}</td>
                                  <td>{row.pending ?? 0}</td>
                                  <td>{row.lastInspector || "-"}</td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default WeeklySummary;
