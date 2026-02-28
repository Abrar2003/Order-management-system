import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_TIMELINE = "1m";
const DEFAULT_CUSTOM_DAYS = 30;

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

const defaultReport = {
  filters: {
    timeline: DEFAULT_TIMELINE,
    custom_days: null,
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
    average_delay_days_delayed_only: 0,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(defaultReport);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const params = { timeline };
      if (timeline === "custom") {
        params.custom_days = customDays;
      }

      const response = await api.get("/qc/reports/vendors", { params });
      const responseData = response?.data || {};

      setReport({
        filters: responseData?.filters || defaultReport.filters,
        summary: responseData?.summary || defaultReport.summary,
        vendors: Array.isArray(responseData?.vendors) ? responseData.vendors : [],
      });
    } catch (err) {
      setReport(defaultReport);
      setError(err?.response?.data?.message || "Failed to load vendor reports.");
    } finally {
      setLoading(false);
    }
  }, [customDays, timeline]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    const nextTimeline = normalizeTimeline(searchParams.get("timeline"));
    const nextCustomDays = parseCustomDays(searchParams.get("custom_days"));

    setTimeline((prev) => (prev === nextTimeline ? prev : nextTimeline));
    setCustomDays((prev) => (prev === nextCustomDays ? prev : nextCustomDays));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (timeline !== DEFAULT_TIMELINE) {
      next.set("timeline", timeline);
    }
    if (timeline === "custom") {
      next.set("custom_days", String(customDays));
    }
    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [customDays, searchParams, setSearchParams, timeline]);

  const summary = useMemo(
    () => report?.summary || defaultReport.summary,
    [report?.summary],
  );

  const filters = useMemo(
    () => report?.filters || defaultReport.filters,
    [report?.filters],
  );

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
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
            <span className="om-summary-chip">
              Avg Delay (Delayed Only): {summary.average_delay_days_delayed_only ?? 0} days
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
            report.vendors.map((vendorEntry) => (
              <div key={vendorEntry.vendor} className="card om-card">
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
                    <span className="om-summary-chip">
                      Avg Delay (Delayed): {vendorEntry.average_delay_days_delayed_only ?? 0} days
                    </span>
                  </div>

                  <div className="table-responsive">
                    <table className="table table-sm table-striped align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Brand</th>
                          <th>Status</th>
                          <th>Order Date</th>
                          <th>Planned ETD</th>
                          <th>Latest Shipment</th>
                          <th>Delay (Days)</th>
                          <th>Item Count</th>
                          <th>Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(vendorEntry.orders) ? vendorEntry.orders : []).length === 0 && (
                          <tr>
                            <td colSpan="9" className="text-center py-3">
                              No orders for this vendor.
                            </td>
                          </tr>
                        )}
                        {(Array.isArray(vendorEntry.orders) ? vendorEntry.orders : []).map((orderRow) => (
                          <tr key={`${vendorEntry.vendor}-${orderRow.order_id}-${orderRow.brand}`}>
                            <td>{orderRow.order_id || "N/A"}</td>
                            <td>{orderRow.brand || "N/A"}</td>
                            <td>{orderRow.status || "N/A"}</td>
                            <td>{formatDateDDMMYYYY(orderRow.order_date)}</td>
                            <td>{formatDateDDMMYYYY(orderRow.planned_etd)}</td>
                            <td>{formatDateDDMMYYYY(orderRow.latest_shipment_date)}</td>
                            <td>
                              {Number.isFinite(orderRow.delay_days)
                                ? orderRow.delay_days
                                : "N/A"}
                            </td>
                            <td>{orderRow.item_count ?? 0}</td>
                            <td>{orderRow.quantity_total ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default VendorReports;
