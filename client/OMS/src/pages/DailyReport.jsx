import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import "../App.css";

const getTodayDateInput = () => {
  const today = new Date();
  const offsetMs = today.getTimezoneOffset() * 60000;
  return new Date(today.getTime() - offsetMs).toISOString().slice(0, 10);
};

const formatDateLabel = (value) => {
  if (!value) return "N/A";
  const asString = String(value).trim();
  if (!asString) return "N/A";
  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return asString;
  return parsed.toLocaleDateString();
};

const formatCbm = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

const DailyReport = () => {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(getTodayDateInput());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState({
    date: getTodayDateInput(),
    summary: {
      aligned_requests_count: 0,
      inspectors_count: 0,
      inspections_count: 0,
      total_inspected_quantity: 0,
      total_inspected_cbm: 0,
    },
    aligned_requests: [],
    inspector_compiled: [],
  });

  const fetchDailyReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/qc/daily-report", {
        params: { date: selectedDate },
      });

      setReport({
        date: res?.data?.date || selectedDate,
        summary: res?.data?.summary || {
          aligned_requests_count: 0,
          inspectors_count: 0,
          inspections_count: 0,
          total_inspected_quantity: 0,
          total_inspected_cbm: 0,
        },
        aligned_requests: Array.isArray(res?.data?.aligned_requests)
          ? res.data.aligned_requests
          : [],
        inspector_compiled: Array.isArray(res?.data?.inspector_compiled)
          ? res.data.inspector_compiled
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load daily report.");
      setReport((prev) => ({
        ...prev,
        aligned_requests: [],
        inspector_compiled: [],
      }));
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchDailyReport();
  }, [fetchDailyReport]);

  const summary = useMemo(
    () =>
      report?.summary || {
        aligned_requests_count: 0,
        inspectors_count: 0,
        inspections_count: 0,
        total_inspected_quantity: 0,
        total_inspected_cbm: 0,
      },
    [report?.summary],
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
          <h2 className="h4 mb-0">Daily Reports</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2 align-items-end">
            <div>
              <label className="form-label mb-1">Report Date</label>
              <input
                type="date"
                className="form-control"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={fetchDailyReport}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <span className="om-summary-chip">Date: {formatDateLabel(report?.date)}</span>
            <span className="om-summary-chip">
              Aligned Requests: {summary.aligned_requests_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Inspectors: {summary.inspectors_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Inspections: {summary.inspections_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Total Inspected Qty: {summary.total_inspected_quantity ?? 0}
            </span>
            <span className="om-summary-chip">
              Total CBM: {formatCbm(summary.total_inspected_cbm * summary.total_inspected_quantity ?? 0)}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="card om-card mb-3">
          <div className="card-body p-0">
            <div className="px-3 py-2 border-bottom">
              <h3 className="h6 mb-0">Requests Aligned For Selected Date</h3>
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th>Request Date</th>
                    <th>Order ID</th>
                    <th>Item</th>
                    <th>Vendor</th>
                    <th>Brand</th>
                    <th>Inspector</th>
                    <th>Requested</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.aligned_requests.length === 0 && (
                    <tr>
                      <td colSpan="11" className="text-center py-3">
                        No aligned requests found for this date.
                      </td>
                    </tr>
                  )}

                  {report.aligned_requests.map((request) => (
                    <tr key={request.qc_id}>
                      <td>{formatDateLabel(request.request_date)}</td>
                      <td>{request.order_id || "N/A"}</td>
                      <td>{request.item_code || "N/A"}</td>
                      <td>{request.vendor || "N/A"}</td>
                      <td>{request.brand || "N/A"}</td>
                      <td>{request?.inspector?.name || "Unassigned"}</td>
                      <td>{request.quantity_requested ?? 0}</td>
                      <td>{request.order_status || "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="d-grid gap-3">
          {report.inspector_compiled.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No inspection activity found for this date.
              </div>
            </div>
          ) : (
            report.inspector_compiled.map((entry) => (
              <div className="card om-card" key={entry?.inspector?._id || entry?.inspector?.name}>
                <div className="card-body p-0">
                  <div className="px-3 py-2 border-bottom d-flex flex-wrap gap-2">
                    <span className="fw-semibold">
                      Inspector: {entry?.inspector?.name || "Unassigned"}
                    </span>
                    <span className="om-summary-chip">
                      Total Inspected Qty: {entry?.total_inspected_quantity ?? 0}
                    </span>
                    <span className="om-summary-chip">
                      Inspections: {entry?.inspections_count ?? 0}
                    </span>
                  </div>

                  <div className="table-responsive">
                    <table className="table table-sm table-striped align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Order ID</th>
                          <th>Item</th>
                          <th>Inspected</th>
                          <th>Passed</th>
                          <th>Rejected</th>
                            <th>CBM</th>
                          <th>CBM Total</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(entry?.inspections || []).map((inspection) => (
                          <tr key={inspection.inspection_id}>
                            <td>{formatDateLabel(inspection.inspection_date)}</td>
                            <td>{inspection.order_id || "N/A"}</td>
                            <td>{inspection.item_code || "N/A"}</td>
                            <td>{inspection.inspected_quantity ?? 0}</td>
                            <td>{inspection.passed_quantity ?? 0}</td>
                            <td>{inspection.rejected_quantity ?? 0}</td>
                            <td>{inspection?.cbm?.total || "0"}</td>
                            <td>{inspection?.cbm?.total * inspection?.inspected_quantity || "0"}</td>
                            <td>{inspection?.remarks || "None"}</td>
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

export default DailyReport;
