import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getPoStatusReport } from "../services/orders.service";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const DEFAULT_ENTITY_FILTER = "all";
const DEFAULT_STATUS_FILTER = "Inspection Done";
const STATUS_OPTIONS_FALLBACK = [
  "Partially Inspected",
  "Inspection Done",
];

const normalizeEntityFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_ENTITY_FILTER;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return DEFAULT_ENTITY_FILTER;
  }
  return normalized;
};

const normalizeStatusFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_STATUS_FILTER;

  const matchedStatus = STATUS_OPTIONS_FALLBACK.find(
    (status) => status.toLowerCase() === normalized.toLowerCase(),
  );
  return matchedStatus || DEFAULT_STATUS_FILTER;
};

const normalizeStatusCounts = (value = {}) => ({
  pending: Number(value?.pending || 0),
  under_inspection: Number(value?.under_inspection || 0),
  inspection_done: Number(value?.inspection_done || 0),
  partially_shipped: Number(value?.partially_shipped || 0),
  shipped: Number(value?.shipped || 0),
});

const normalizeText = (value) => String(value || "").trim();

const formatPoTooltipQuantitySummary = (row = {}) => {
  const status = normalizeText(row?.status).toLowerCase();
  const totalQuantity = Number(row?.total_quantity || row?.order_quantity || 0);
  const openQuantity = Number(row?.open_quantity || 0);
  const shippedQuantity = Number(row?.shipped_quantity || 0);

  if (status === "under inspection") {
    return `Total: ${totalQuantity} | Open: ${openQuantity}`;
  }

  if (status === "partial shipped") {
    return `Shipped: ${shippedQuantity}`;
  }

  if (status === "shipped") {
    return `Shipped: ${shippedQuantity || totalQuantity}`;
  }

  return `Total: ${totalQuantity}`;
};

const defaultReport = {
  filters: {
    brand: "",
    vendor: "",
    status: DEFAULT_STATUS_FILTER,
    brand_options: [],
    vendor_options: [],
    status_options: STATUS_OPTIONS_FALLBACK,
  },
  summary: {
    vendors_count: 0,
    po_count: 0,
    pending_count: 0,
    under_inspection_count: 0,
    inspection_done_count: 0,
    partially_shipped_count: 0,
    shipped_count: 0,
    open_items_count: 0,
    progressed_items_count: 0,
  },
  vendors: [],
};

const InspectionDoneItemCounts = ({ counts }) => {
  const normalizedCounts = normalizeStatusCounts(counts);

  return (
    <div className="d-grid gap-1">
      <div>Inspection Done: {normalizedCounts.inspection_done}</div>
      <div>Partially Shipped: {normalizedCounts.partially_shipped}</div>
      <div>Shipped: {normalizedCounts.shipped}</div>
    </div>
  );
};

const PartiallyInspectedItemCounts = ({ counts }) => {
  const normalizedCounts = normalizeStatusCounts(counts);

  return (
    <div className="d-grid gap-1">
      <div>Pending: {normalizedCounts.pending}</div>
      <div>Under Inspection: {normalizedCounts.under_inspection}</div>
      <div>Inspection Done: {normalizedCounts.inspection_done}</div>
      <div>Partially Shipped: {normalizedCounts.partially_shipped}</div>
      <div>Shipped: {normalizedCounts.shipped}</div>
    </div>
  );
};

const PoStatusReport = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "po-status-report");

  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("vendor")),
  );
  const [statusFilter, setStatusFilter] = useState(() =>
    normalizeStatusFilter(searchParams.get("status")),
  );
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const reportRef = useRef(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = {
        status: statusFilter,
      };
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }
      if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
        params.vendor = vendorFilter;
      }

      const response = await getPoStatusReport(params);
      setReport({
        filters: {
          ...defaultReport.filters,
          ...(response?.filters || {}),
        },
        summary: {
          ...defaultReport.summary,
          ...(response?.summary || {}),
        },
        vendors: Array.isArray(response?.vendors) ? response.vendors : [],
      });
    } catch (err) {
      console.error(err);
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load PO status report.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, statusFilter, vendorFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    const nextVendorFilter = normalizeEntityFilter(searchParams.get("vendor"));
    const nextStatusFilter = normalizeStatusFilter(searchParams.get("status"));

    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (brandFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("brand", brandFilter);
    }
    if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("vendor", vendorFilter);
    }
    if (statusFilter !== DEFAULT_STATUS_FILTER) {
      next.set("status", statusFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    searchParams,
    setSearchParams,
    statusFilter,
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
  const statusOptions = useMemo(() => {
    const rawOptions = Array.isArray(filters.status_options)
      ? filters.status_options
      : STATUS_OPTIONS_FALLBACK;
    return Array.from(
      new Set(rawOptions.map((value) => String(value || "").trim()).filter(Boolean)),
    );
  }, [filters.status_options]);
  const isInspectionDoneMode = useMemo(
    () => normalizeStatusFilter(statusFilter) === "Inspection Done",
    [statusFilter],
  );

  const handleOpenOrder = useCallback(
    (orderId) => {
      const normalizedOrderId = String(orderId || "").trim();
      if (!normalizedOrderId) return;
      navigate(`/orders?order_id=${encodeURIComponent(normalizedOrderId)}`);
    },
    [navigate],
  );

  const handleOpenQcDetails = useCallback(
    (qcId, orderId) => {
      const normalizedQcId = String(qcId || "").trim();
      if (normalizedQcId) {
        navigate(`/qc/${encodeURIComponent(normalizedQcId)}`, {
          state: {
            fromQcList: `${location.pathname}${location.search}`,
          },
        });
        return;
      }

      handleOpenOrder(orderId);
    },
    [handleOpenOrder, location.pathname, location.search, navigate],
  );

  const handleOpenPoStatusTooltipItem = useCallback(
    (item) => {
      handleOpenQcDetails(item?.qc_id, item?.order_id);
    },
    [handleOpenQcDetails],
  );

  const handleExportPdf = useCallback(async () => {
    if (!reportRef.current || loading || exportingPdf || report.vendors.length === 0) {
      return;
    }

    const confirmed = window.confirm("Confirm export of this PO status report as PDF?");
    if (!confirmed) return;

    try {
      setExportingPdf(true);
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

      const safeStatus = String(statusFilter || "status").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeVendor = String(vendorFilter || "all-vendors").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeBrand = String(brandFilter || "all-brands").replace(/[^a-zA-Z0-9_-]/g, "_");
      pdf.save(`po-status-report-${safeStatus}-${safeVendor}-${safeBrand}.pdf`);
    } catch (err) {
      console.error("PO status report export failed:", err);
      alert("Failed to export PO status report PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [brandFilter, exportingPdf, loading, report.vendors.length, statusFilter, vendorFilter]);

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
          <h2 className="h4 mb-0">PO Status Report</h2>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={handleExportPdf}
            disabled={loading || exportingPdf || report.vendors.length === 0}
          >
            {exportingPdf ? "Exporting..." : "Export PDF"}
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-end">
            <div>
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={vendorFilter}
                onChange={(event) =>
                  setVendorFilter(normalizeEntityFilter(event.target.value))
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
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={brandFilter}
                onChange={(event) =>
                  setBrandFilter(normalizeEntityFilter(event.target.value))
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
              <label className="form-label mb-1">Status</label>
              <select
                className="form-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(normalizeStatusFilter(event.target.value))
                }
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
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

        <div ref={reportRef}>

          <div className="card om-card mb-3">
            <div className="card-body d-flex flex-wrap gap-2">
              {!exportingPdf && (
                <>
                  <span className="om-summary-chip">
                    Vendor: {vendorFilter === DEFAULT_ENTITY_FILTER ? "all" : vendorFilter}
                  </span>
                  <span className="om-summary-chip">
                    Brand: {brandFilter === DEFAULT_ENTITY_FILTER ? "all" : brandFilter}
                  </span>
                  <span className="om-summary-chip">
                    Status: {statusFilter}
                  </span>
                </>
              )}
              <span className="om-summary-chip">
                Vendors: {summary.vendors_count ?? 0}
              </span>
              <span className="om-summary-chip">
                POs: {summary.po_count ?? 0}
              </span>
              {!isInspectionDoneMode && (
                <>
                  <span className="om-summary-chip">
                    Pending: {summary.pending_count ?? 0}
                  </span>
                  <span className="om-summary-chip">
                    Under Inspection: {summary.under_inspection_count ?? 0}
                  </span>
                </>
              )}
              <span className="om-summary-chip">
                Inspection Done: {summary.inspection_done_count ?? 0}
              </span>
              <span className="om-summary-chip">
                Partially Shipped: {summary.partially_shipped_count ?? 0}
              </span>
              <span className="om-summary-chip">
                Shipped: {summary.shipped_count ?? 0}
              </span>
            </div>
          </div>

          {error && (
            <div className="alert alert-danger mb-3" role="alert">
              {error}
            </div>
          )}

          <div className="d-grid gap-3">
            {loading ? (
              <div className="card om-card">
                <div className="card-body text-center py-4">Loading...</div>
              </div>
            ) : report.vendors.length === 0 ? (
              <div className="card om-card">
                <div className="card-body text-secondary">
                  No rows found for the selected filters.
                </div>
              </div>
            ) : (
              report.vendors.map((vendorEntry, index) => {
                const pos = Array.isArray(vendorEntry?.pos) ? vendorEntry.pos : [];
                const vendorKey = String(vendorEntry?.vendor || "").trim() || `vendor-${index}`;
                const vendorCounts = normalizeStatusCounts(vendorEntry?.status_counts);

                return (
                  <div key={vendorKey} className="card om-card">
                    <div className="card-body p-0">
                      <div className="px-3 py-2 border-bottom d-flex flex-wrap gap-2">
                        <span className="fw-semibold">Vendor: {vendorEntry.vendor}</span>
                        <span className="om-summary-chip">
                          POs: {vendorEntry.po_count ?? pos.length}
                        </span>
                        {!isInspectionDoneMode && (
                          <>
                            <span className="om-summary-chip">
                              Pending: {vendorCounts.pending}
                            </span>
                            <span className="om-summary-chip">
                              Under Inspection: {vendorCounts.under_inspection}
                            </span>
                          </>
                        )}
                        <span className="om-summary-chip">
                          Inspection Done: {vendorCounts.inspection_done}
                        </span>
                        <span className="om-summary-chip">
                          Partially Shipped: {vendorCounts.partially_shipped}
                        </span>
                        <span className="om-summary-chip">
                          Shipped: {vendorCounts.shipped}
                        </span>
                      </div>

                      <div className="table-responsive">
                        {isInspectionDoneMode ? (
                          <table className="table table-sm table-striped align-middle mb-0">
                            <thead>
                              <tr>
                                <th>Brand</th>
                                <th>PO</th>
                                <th>Order Date</th>
                                <th>ETD</th>
                                <th>Item Count</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pos.length === 0 ? (
                                <tr>
                                  <td colSpan="5" className="text-center py-3">
                                    No POs for this vendor.
                                  </td>
                                </tr>
                              ) : (
                                pos.map((row) => (
                                  <tr
                                    key={`${vendorKey}-${row.key || row.order_id}`}
                                    className="table-clickable"
                                    onClick={() => handleOpenOrder(row.order_id)}
                                  >
                                    <td>{row.brand || "N/A"}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="btn btn-link p-0 align-baseline text-decoration-none"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleOpenOrder(row.order_id);
                                        }}
                                      >
                                        {row.order_id || "N/A"}
                                      </button>
                                    </td>
                                    <td>{formatDateDDMMYYYY(row.order_date)}</td>
                                    <td>{formatDateDDMMYYYY(row.effective_etd)}</td>
                                    <td>
                                      <PoStatusRowItemsTooltip
                                        items={
                                          Array.isArray(row?.status_items)
                                            ? row.status_items
                                            : row?.inspected_items
                                        }
                                        onOpenItem={handleOpenPoStatusTooltipItem}
                                      >
                                        <InspectionDoneItemCounts counts={row.item_counts} />
                                      </PoStatusRowItemsTooltip>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        ) : (
                          <table className="table table-sm table-striped align-middle mb-0">
                            <thead>
                              <tr>
                                <th>Brand</th>
                                <th>PO</th>
                                <th>Item Code</th>
                                <th>Order Date</th>
                                <th>ETD</th>
                                <th>Item Count / Order Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pos.length === 0 ? (
                                <tr>
                                  <td colSpan="6" className="text-center py-3">
                                    No partially inspected POs for this vendor.
                                  </td>
                                </tr>
                              ) : (
                                pos.map((row) => (
                                  <FragmentLikeGroup
                                    key={`${vendorKey}-${row.key || row.order_id}`}
                                    row={row}
                                    handleOpenOrder={handleOpenOrder}
                                    handleOpenQcDetails={handleOpenQcDetails}
                                    handleOpenPoStatusTooltipItem={handleOpenPoStatusTooltipItem}
                                  />
                                ))
                              )}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const PoStatusRowItemsTooltip = ({
  items = [],
  onOpenItem,
  children,
  title = "PO Item Status",
}) => {
  const visibleItems = Array.isArray(items) ? items.filter(Boolean) : [];

  return (
    <span className="om-item-order-presence">
      <span className="om-item-order-presence-label" tabIndex={0}>
        {children}
      </span>

      <span className="om-item-order-presence-panel" role="tooltip">
        <span className="om-item-order-presence-title">{title}</span>

        {visibleItems.length === 0 ? (
          <span className="om-item-order-presence-empty">
            No PO items found.
          </span>
        ) : (
          visibleItems.map((item) => {
            const tooltipKey = [
              normalizeText(item?._id),
              normalizeText(item?.item_code),
              normalizeText(item?.status),
            ]
              .filter(Boolean)
              .join("-");

            return (
              <span key={tooltipKey} className="om-item-order-presence-entry">
                {onOpenItem ? (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 text-start text-decoration-none fw-semibold"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenItem(item);
                    }}
                  >
                    Item: {normalizeText(item?.item_code) || "N/A"}
                  </button>
                ) : (
                  <span className="om-item-order-presence-po">
                    Item: {normalizeText(item?.item_code) || "N/A"}
                  </span>
                )}

                <span className="om-item-order-presence-row">
                  Status: {normalizeText(item?.status) || "N/A"}
                </span>
                <span className="om-item-order-presence-meta">
                  {formatPoTooltipQuantitySummary(item)}
                </span>
              </span>
            );
          })
        )}
      </span>
    </span>
  );
};

const FragmentLikeGroup = ({
  row,
  handleOpenOrder,
  handleOpenQcDetails,
  handleOpenPoStatusTooltipItem,
}) => {
  const statusItems = Array.isArray(row?.status_items)
    ? row.status_items
    : Array.isArray(row?.inspected_items)
      ? row.inspected_items
    : [];
  const inspectedItems = Array.isArray(row?.inspected_items)
    ? row.inspected_items
    : Array.isArray(row?.open_items)
      ? row.open_items
      : [];

  return (
    <>
      <tr
        className="table-active table-clickable"
        onClick={() => handleOpenOrder(row.order_id)}
      >
        <td>{row.brand || "N/A"}</td>
        <td>
          <button
            type="button"
            className="btn btn-link p-0 align-baseline text-decoration-none"
            onClick={(event) => {
              event.stopPropagation();
              handleOpenOrder(row.order_id);
            }}
          >
            {row.order_id || "N/A"}
          </button>
        </td>
        <td />
        <td>{formatDateDDMMYYYY(row.order_date)}</td>
        <td>{formatDateDDMMYYYY(row.effective_etd)}</td>
        <td>
          <PoStatusRowItemsTooltip
            items={statusItems}
            onOpenItem={handleOpenPoStatusTooltipItem}
          >
            <PartiallyInspectedItemCounts counts={row.item_counts} />
          </PoStatusRowItemsTooltip>
        </td>
      </tr>

      {inspectedItems.map((openItem) => (
        <tr
          key={`${row.key || row.order_id}-${openItem._id || openItem.item_code}`}
          className="table-clickable"
          onClick={() => handleOpenOrder(row.order_id)}
        >
          <td>{row.brand || "N/A"}</td>
          <td>{row.order_id || "N/A"}</td>
          <td>
            {openItem.qc_id ? (
              <button
                type="button"
                className="btn btn-link p-0 align-baseline text-decoration-none"
                onClick={(event) => {
                  event.stopPropagation();
                  handleOpenQcDetails(openItem.qc_id, row.order_id);
                }}
              >
                {openItem.item_code || "N/A"}
              </button>
            ) : (
              <div>{openItem.item_code || "N/A"}</div>
            )}
            <div className="small text-secondary">{openItem.status || "N/A"}</div>
          </td>
          <td>{formatDateDDMMYYYY(row.order_date)}</td>
          <td>{formatDateDDMMYYYY(row.effective_etd)}</td>
          <td>{openItem.order_quantity ?? 0}</td>
        </tr>
      ))}
    </>
  );
};

export default PoStatusReport;
