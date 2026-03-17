import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
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
  const raw = logoObj?.data?.data || logoObj?.data;
  if (!Array.isArray(raw) || raw.length === 0) return "";

  let binary = "";
  raw.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return `data:image/webp;base64,${window.btoa(binary)}`;
};

const toReportQuantity = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

const isCompletelyPendingItem = (item) => {
  if (Boolean(item?.goods_not_ready)) {
    return false;
  }

  const totalOrderQuantity = toReportQuantity(item?.total_order_quantity);
  const quantityPassed = toReportQuantity(item?.quantity_passed);
  const pending = toReportQuantity(item?.pending);

  if (pending <= 0 || quantityPassed > 0) {
    return false;
  }

  if (totalOrderQuantity <= 0) {
    return true;
  }

  return pending >= totalOrderQuantity;
};

const buildVendorDisplayRows = (items = []) => {
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
      const visibleItems = sortedItems.filter((item) => !isCompletelyPendingItem(item));
      const allItemsPacked =
        sortedItems.length > 0 &&
        sortedItems.every((item) => toReportQuantity(item?.pending) <= 0);

      if (visibleItems.length === 0) {
        return [];
      }

      if (allItemsPacked) {
        return [{
          key: `${orderId}-packed`,
          po: orderId,
          itemLabel: "All items are packed",
          totalOrderQuantity: visibleItems.reduce(
            (sum, item) => sum + toReportQuantity(item?.total_order_quantity),
            0,
          ),
          quantityPassed: visibleItems.reduce(
            (sum, item) => sum + toReportQuantity(item?.quantity_passed),
            0,
          ),
          pending: 0,
          packedSummary: true,
          lastInspector: "",
          lastInspectionDate: "",
        }];
      }

      return visibleItems.map((item, index) => ({
        key: `${orderId}-${item?.item_code || "item"}-${index}`,
        po: index === 0 ? orderId : "",
        itemLabel: item?.item_code || "N/A",
        totalOrderQuantity: toReportQuantity(item?.total_order_quantity),
        quantityPassed: toReportQuantity(item?.quantity_passed),
        pending: toReportQuantity(item?.pending),
        goodsNotReady: Boolean(item?.goods_not_ready),
        goodsNotReadyReason: String(item?.goods_not_ready_reason || "").trim(),
        goodsNotReadyInspectionDate: String(item?.goods_not_ready_inspection_date || "").trim(),
        lastInspector: item?.last_inspector_name || "",
        lastInspectionDate: item?.last_inspection_date || "",
        packedSummary: false,
      }));
    });
};

const defaultReport = {
  filters: {
    period: "rolling_week_until_yesterday",
    period_label: "Yesterday - 7 days to Yesterday",
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

  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [brandLogoSrc, setBrandLogoSrc] = useState("");

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = {};
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
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
  }, [brandFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (brandFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("brand", brandFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [brandFilter, searchParams, setSearchParams, syncedQuery]);

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

  const visibleVendors = useMemo(
    () =>
      (Array.isArray(report?.vendors) ? report.vendors : [])
        .map((vendorEntry, index) => {
          const vendorDisplayRows = buildVendorDisplayRows(vendorEntry?.items);
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
    [report?.vendors],
  );

  useEffect(() => {
    const brandName = brandFilter === DEFAULT_ENTITY_FILTER ? "" : String(brandFilter || "").trim();
    if (!brandName) {
      setBrandLogoSrc("");
      return undefined;
    }

    let cancelled = false;

    const fetchBrandLogo = async () => {
      try {
        const response = await api.get("/brands/");
        const brands = Array.isArray(response?.data?.data) ? response.data.data : [];
        const matchedBrand = brands.find(
          (brand) => getBrandKey(brand?.name) === getBrandKey(brandName),
        );

        if (!cancelled) {
          setBrandLogoSrc(toBrandLogoDataUrl(matchedBrand?.logo));
        }
      } catch (err) {
        if (!cancelled) {
          setBrandLogoSrc("");
        }
      }
    };

    fetchBrandLogo();

    return () => {
      cancelled = true;
    };
  }, [brandFilter]);

  const handleConfirmAndExport = useCallback(async () => {
    if (!reportRef.current || exportingPdf || loading || visibleVendors.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Confirm export of this weekly order summary as PDF?",
    );
    if (!confirmed) return;

    try {
      setExportingPdf(true);
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
  }, [exportingPdf, filters.from_date, filters.to_date, loading, visibleVendors.length]);

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
            disabled={loading || exportingPdf || visibleVendors.length === 0}
          >
            {exportingPdf ? "Exporting..." : "Confirm & Export PDF"}
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
                                <td colSpan="5">
                                  <div className="fw-semibold">
                                    {row.goodsNotReadyReason || "Reason not provided"}
                                  </div>
                                </td>
                                </>
                              ) : (
                                <>
                                  <td>{row.totalOrderQuantity ?? 0}</td>
                                  <td>{row.quantityPassed ?? 0}</td>
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
