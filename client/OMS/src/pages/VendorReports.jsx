import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import OrderEtdWithHistory from "../components/OrderEtdWithHistory";
import SortHeaderButton from "../components/SortHeaderButton";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_TIMELINE = "1m";
const DEFAULT_CUSTOM_DAYS = 30;
const DEFAULT_ENTITY_FILTER = "all";
const DEFAULT_VENDOR_TABLE_SORT_FIELD = "latest_shipment_date";
const DEFAULT_VENDOR_TABLE_SORT_ORDER = "desc";
const normalizeTimeline = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "1m" || normalized === "3m" || normalized === "6m") {
    return normalized;
  }
  if (normalized === "custom") return "custom";
  return DEFAULT_TIMELINE;
};

const parseCustomDays = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CUSTOM_DAYS;
  return Math.min(parsed, 3650);
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

const normalizeShipmentSortOrder = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "asc" ? "asc" : "desc";
};

const normalizeVendorTableSortField = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = new Set(["order_date", "etd", "latest_shipment_date"]);
  return allowed.has(normalized) ? normalized : DEFAULT_VENDOR_TABLE_SORT_FIELD;
};

const toSortableDateValue = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  const ymdMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(normalized)) {
    const [day, month, year] = normalized.split(/[/-]/).map(Number);
    return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ) / (24 * 60 * 60 * 1000);
};

const getVendorOrderDifferenceInDays = (orderRow = {}) => {
  const effectiveEtdValue = toSortableDateValue(orderRow?.etd);
  if (effectiveEtdValue === null) return null;

  const latestShipmentValue = toSortableDateValue(orderRow?.latest_shipment_date);
  const isShipped = String(orderRow?.status || "").trim() === "Shipped";

  if (isShipped && latestShipmentValue !== null) {
    return latestShipmentValue - effectiveEtdValue;
  }

  const delayedDays = Number(orderRow?.delay_days);
  if (Number.isFinite(delayedDays) && delayedDays > 0) {
    return delayedDays;
  }

  return 0;
};

const getVendorOrderRowClassName = (orderRow = {}) => {
  const differenceInDays = getVendorOrderDifferenceInDays(orderRow);
  const isShipped = String(orderRow?.status || "").trim() === "Shipped";

  if (isShipped && Number.isFinite(differenceInDays) && differenceInDays < 0) {
    return "om-report-success-row";
  }

  if (Number.isFinite(differenceInDays) && differenceInDays > 0) {
    return "om-report-danger-row";
  }

  const delayedDays = Number(orderRow?.delay_days);
  if (!isShipped && Number.isFinite(delayedDays) && delayedDays > 0) {
    return "om-report-danger-row";
  }

  return "";
};

const formatVendorOrderDifferenceInDays = (differenceInDays) => {
  if (!Number.isFinite(differenceInDays)) return "N/A";

  const absoluteDays = Math.abs(differenceInDays);
  const dayLabel = absoluteDays === 1 ? "day" : "days";

  if (differenceInDays < 0) {
    return `${absoluteDays} ${dayLabel} Early`;
  }

  if (differenceInDays > 0) {
    return `${absoluteDays} ${dayLabel} Delayed`;
  }

  return `0 days`;
};

const defaultReport = {
  filters: {
    timeline: DEFAULT_TIMELINE,
    custom_days: null,
    brand: "",
    vendor: "",
    brand_options: [],
    vendor_options: [],
    from_date: "",
    to_date: "",
  },
  summary: {
    vendors_count: 0,
    orders_count: 0,
    delayed_orders_count: 0,
    orders_with_etd_count: 0,
    total_delay_days: 0,
    average_delay_days: 0,
  },
  vendors: [],
};

const VendorReports = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "vendor-reports");

  const [timeline, setTimeline] = useState(() =>
    normalizeTimeline(searchParams.get("timeline")),
  );
  const [customDays, setCustomDays] = useState(() =>
    parseCustomDays(searchParams.get("custom_days")),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("vendor")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [tableBrandFilters, setTableBrandFilters] = useState({});
  const [tableSortConfigs, setTableSortConfigs] = useState({});

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = { timeline };
      if (timeline === "custom") {
        params.custom_days = customDays;
      }
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }
      if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
        params.vendor = vendorFilter;
      }

      const response = await api.get("/qc/reports/vendors", { params });
      const responseData = response?.data || {};

      setReport({
        filters: {
          ...defaultReport.filters,
          ...(responseData?.filters || {}),
        },
        summary: responseData?.summary || defaultReport.summary,
        vendors: Array.isArray(responseData?.vendors) ? responseData.vendors : [],
      });
    } catch (err) {
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load vendor reports.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, customDays, timeline, vendorFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextTimeline = normalizeTimeline(searchParams.get("timeline"));
    const nextCustomDays = parseCustomDays(searchParams.get("custom_days"));
    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));
    const nextVendorFilter = normalizeEntityFilter(searchParams.get("vendor"));

    setTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (timeline !== DEFAULT_TIMELINE) {
      next.set("timeline", timeline);
    }
    if (timeline === "custom") {
      next.set("custom_days", String(customDays));
    }
    if (brandFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("brand", brandFilter);
    }
    if (vendorFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("vendor", vendorFilter);
    }
    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [brandFilter, customDays, searchParams, setSearchParams, syncedQuery, timeline, vendorFilter]);

  const summary = useMemo(
    () => report?.summary || defaultReport.summary,
    [report?.summary],
  );

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

  const handleOpenShipmentOrder = useCallback((orderId) => {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) return;

    navigate(`/shipments?order_id=${encodeURIComponent(normalizedOrderId)}`);
  }, [navigate]);

  const handleVendorTableBrandFilterChange = useCallback((vendorKey, nextBrand) => {
    setTableBrandFilters((prev) => ({
      ...prev,
      [vendorKey]: normalizeEntityFilter(nextBrand),
    }));
  }, []);

  const handleVendorTableSortToggle = useCallback((vendorKey, nextField) => {
    setTableSortConfigs((prev) => {
      const currentConfig = prev[vendorKey] || {};
      const currentField = normalizeVendorTableSortField(currentConfig.field);
      const currentOrder = normalizeShipmentSortOrder(currentConfig.order);
      return {
        ...prev,
        [vendorKey]: {
          field: nextField,
          order:
            currentField === nextField
              ? (currentOrder === "asc" ? "desc" : "asc")
              : DEFAULT_VENDOR_TABLE_SORT_ORDER,
        },
      };
    });
  }, []);

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
          <h2 className="h4 mb-0">Vendor Reports</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-end">
            <div>
              <label className="form-label mb-1">Timeline</label>
              <select
                className="form-select"
                value={timeline}
                onChange={(e) => setTimeline(normalizeTimeline(e.target.value))}
              >
                <option value="1m">Last 1 month</option>
                <option value="3m">Last 3 months</option>
                <option value="6m">Last 6 months</option>
                <option value="custom">Last custom days</option>
              </select>
            </div>

            {timeline === "custom" && (
              <div>
                <label className="form-label mb-1">Custom Days</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  className="form-control"
                  value={customDays}
                  onChange={(e) => setCustomDays(parseCustomDays(e.target.value))}
                />
              </div>
            )}

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
              <label className="form-label mb-1">Vendor</label>
              <select
                className="form-select"
                value={vendorFilter}
                onChange={(e) => setVendorFilter(normalizeEntityFilter(e.target.value))}
              >
                <option value={DEFAULT_ENTITY_FILTER}>All Vendors</option>
                {(Array.isArray(filters.vendor_options) ? filters.vendor_options : []).map((vendor) => (
                  <option key={vendor} value={vendor}>
                    {vendor}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={fetchReports}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">
              Range: {formatDateDDMMYYYY(filters.from_date)} - {formatDateDDMMYYYY(filters.to_date)}
            </span>
            <span className="om-summary-chip">
              Brand: {brandFilter === DEFAULT_ENTITY_FILTER ? "all" : brandFilter}
            </span>
            <span className="om-summary-chip">
              Vendor: {vendorFilter === DEFAULT_ENTITY_FILTER ? "all" : vendorFilter}
            </span>
            <span className="om-summary-chip">
              Vendors: {summary.vendors_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Orders: {summary.orders_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Delayed Orders: {summary.delayed_orders_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Avg Delay: {summary.average_delay_days ?? 0} days
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="d-grid gap-3">
          {report.vendors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No vendor records found for this range.
              </div>
            </div>
          ) : (
            report.vendors.map((vendorEntry, index) => {
              const vendorKey = String(vendorEntry?.vendor || "").trim() || `vendor-${index}`;
              const vendorOrders = Array.isArray(vendorEntry?.orders) ? vendorEntry.orders : [];
              const tableBrandOptions = [...new Set(
                vendorOrders
                  .map((orderRow) => String(orderRow?.brand || "").trim())
                  .filter(Boolean),
              )].sort((left, right) => left.localeCompare(right));
              const tableBrandFilter = normalizeEntityFilter(
                tableBrandFilters[vendorKey],
              );
              const tableSortConfig = tableSortConfigs[vendorKey] || {};
              const activeSortField = normalizeVendorTableSortField(
                tableSortConfig.field || DEFAULT_VENDOR_TABLE_SORT_FIELD,
              );
              const activeSortOrder = normalizeShipmentSortOrder(
                tableSortConfig.order || DEFAULT_VENDOR_TABLE_SORT_ORDER,
              );
              const filteredOrders = vendorOrders
                .filter((orderRow) => (
                  tableBrandFilter === DEFAULT_ENTITY_FILTER
                  || String(orderRow?.brand || "").trim() === tableBrandFilter
                ))
                .sort((left, right) => {
                  const leftDate = toSortableDateValue(left?.[activeSortField]);
                  const rightDate = toSortableDateValue(right?.[activeSortField]);

                  if (leftDate === null && rightDate === null) {
                    return String(left?.order_id || "").localeCompare(String(right?.order_id || ""));
                  }
                  if (leftDate === null) return 1;
                  if (rightDate === null) return -1;
                  if (leftDate !== rightDate) {
                    return activeSortOrder === "asc"
                      ? leftDate - rightDate
                      : rightDate - leftDate;
                  }
                  return String(left?.order_id || "").localeCompare(String(right?.order_id || ""));
                });

              return (
                <div key={vendorKey} className="card om-card">
                  <div className="card-body p-0">
                    <div className="px-3 py-2 border-bottom d-flex flex-wrap gap-2">
                      <span className="fw-semibold">Vendor: {vendorEntry.vendor}</span>
                      <span className="om-summary-chip">
                        Brands: {(Array.isArray(vendorEntry.brands) ? vendorEntry.brands : []).join(", ") || "N/A"}
                      </span>
                      <span className="om-summary-chip">
                        Orders: {vendorEntry.orders_count ?? 0}
                      </span>
                      <span className="om-summary-chip">
                        Delayed: {vendorEntry.delayed_orders_count ?? 0}
                      </span>
                      <span className="om-summary-chip">
                        Avg Delay: {vendorEntry.average_delay_days ?? 0} days
                      </span>
                    </div>

                    <div className="px-3 py-2 border-bottom bg-body-tertiary">
                      <div className="row g-2 align-items-end">
                        <div className="col-sm-6 col-md-4 col-lg-3">
                          <label className="form-label mb-1">Brand In Table</label>
                          <select
                            className="form-select form-select-sm"
                            value={tableBrandFilter}
                            onChange={(e) => handleVendorTableBrandFilterChange(vendorKey, e.target.value)}
                          >
                            <option value={DEFAULT_ENTITY_FILTER}>All Brands</option>
                            {tableBrandOptions.map((brand) => (
                              <option key={`${vendorKey}-${brand}`} value={brand}>
                                {brand}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-sm-6 col-md-4 col-lg-3">
                          <span className="om-summary-chip">
                            Showing Orders: {filteredOrders.length}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="table-responsive">
                      <table className="table table-sm table-striped align-middle mb-0 vendor-report-table">
                        <thead>
                          <tr>
                            <th>Order ID</th>
                            <th>Brand</th>
                            <th>Status</th>
                            <th>
                              <SortHeaderButton
                                label="Order Date"
                                isActive={activeSortField === "order_date"}
                                direction={activeSortOrder}
                                onClick={() => handleVendorTableSortToggle(vendorKey, "order_date")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="ETD"
                                isActive={activeSortField === "etd"}
                                direction={activeSortOrder}
                                onClick={() => handleVendorTableSortToggle(vendorKey, "etd")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Latest Shipment"
                                isActive={activeSortField === "latest_shipment_date"}
                                direction={activeSortOrder}
                                onClick={() => handleVendorTableSortToggle(vendorKey, "latest_shipment_date")}
                              />
                            </th>
                            <th>Difference in Days</th>
                            <th>Item Count</th>
                            <th>Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOrders.length === 0 && (
                            <tr>
                              <td colSpan="9" className="text-center py-3">
                                {tableBrandFilter === DEFAULT_ENTITY_FILTER
                                  ? "No orders for this vendor."
                                  : "No orders found for the selected brand."}
                              </td>
                            </tr>
                          )}
                          {filteredOrders.map((orderRow) => {
                            const differenceInDays = getVendorOrderDifferenceInDays(orderRow);
                            const rowClassName = getVendorOrderRowClassName(orderRow);

                            return (
                              <tr
                                key={`${vendorKey}-${orderRow.order_id}-${orderRow.brand}`}
                                className={rowClassName}
                              >
                                <td>
                                  {orderRow.order_id ? (
                                    <button
                                      type="button"
                                      className="btn btn-link p-0 align-baseline text-decoration-none"
                                      onClick={() => handleOpenShipmentOrder(orderRow.order_id)}
                                    >
                                      {orderRow.order_id}
                                    </button>
                                  ) : (
                                    "N/A"
                                  )}
                                </td>
                                <td>{orderRow.brand || "N/A"}</td>
                                <td>{orderRow.status || "N/A"}</td>
                                <td>{formatDateDDMMYYYY(orderRow.order_date)}</td>
                                <td>
                                  <OrderEtdWithHistory
                                    orderId={orderRow?.order_id}
                                    etd={orderRow?.etd}
                                    revisedEtd={orderRow?.effective_etd || orderRow?.revised_etd}
                                  />
                                </td>
                                <td>{formatDateDDMMYYYY(orderRow.latest_shipment_date)}</td>
                                <td>
                                  {formatVendorOrderDifferenceInDays(differenceInDays)}
                                </td>
                                <td>{orderRow.item_count ?? 0}</td>
                                <td>{orderRow.quantity_total ?? 0}</td>
                              </tr>
                            );
                          })}
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

export default VendorReports;
