import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import {
  formatDateDDMMYYYY,
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import "../App.css";

const DEFAULT_ALIGNED_SORT_BY = "request_date";
const DEFAULT_INSPECTION_SORT_BY = "inspection_date";

const normalizeQueryText = (value) => String(value || "").trim();

const parseAlignedSortBy = (value) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "order_id") return "order_id";
  if (normalized === "request_date") return "request_date";
  return DEFAULT_ALIGNED_SORT_BY;
};

const parseInspectionSortBy = (value) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "order_id") return "order_id";
  if (normalized === "inspection_date") return "inspection_date";
  return DEFAULT_INSPECTION_SORT_BY;
};

const parseSortOrder = (value, sortBy) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === "order_id" ? "asc" : "desc";
};

const formatCbm = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

const DailyReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "daily-report");
  const initialSelectedDate = toDDMMYYYYInputValue(
    normalizeQueryText(searchParams.get("date")),
    getTodayDDMMYYYY(),
  );
  const initialAlignedSortBy = parseAlignedSortBy(
    searchParams.get("aligned_sort_by"),
  );
  const initialAlignedSortOrder = parseSortOrder(
    searchParams.get("aligned_sort_order"),
    initialAlignedSortBy,
  );
  const initialInspectionSortBy = parseInspectionSortBy(
    searchParams.get("inspection_sort_by"),
  );
  const initialInspectionSortOrder = parseSortOrder(
    searchParams.get("inspection_sort_order"),
    initialInspectionSortBy,
  );

  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alignedSortBy, setAlignedSortBy] = useState(initialAlignedSortBy);
  const [alignedSortOrder, setAlignedSortOrder] = useState(initialAlignedSortOrder);
  const [inspectionSortBy, setInspectionSortBy] = useState(initialInspectionSortBy);
  const [inspectionSortOrder, setInspectionSortOrder] = useState(initialInspectionSortOrder);
  const [report, setReport] = useState({
    date: getTodayDDMMYYYY(),
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

  const handleAlignedSort = (column, defaultDirection = "asc") => {
    if (alignedSortBy === column) {
      setAlignedSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setAlignedSortBy(column);
    setAlignedSortOrder(defaultDirection);
  };

  const alignedSortIndicator = (column) => {
    if (alignedSortBy !== column) return "";
    return alignedSortOrder === "asc" ? " (asc)" : " (desc)";
  };

  const handleInspectionSort = (column, defaultDirection = "asc") => {
    if (inspectionSortBy === column) {
      setInspectionSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setInspectionSortBy(column);
    setInspectionSortOrder(defaultDirection);
  };

  const inspectionSortIndicator = (column) => {
    if (inspectionSortBy !== column) return "";
    return inspectionSortOrder === "asc" ? " (asc)" : " (desc)";
  };

  const fetchDailyReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const reportDateIso = toISODateString(selectedDate);
      if (!reportDateIso || !isValidDDMMYYYY(selectedDate)) {
        setError("Report date must be in DD/MM/YYYY format.");
        setReport((prev) => ({
          ...prev,
          aligned_requests: [],
          inspector_compiled: [],
        }));
        return;
      }

      const res = await api.get("/qc/daily-report", {
        params: {
          date: reportDateIso,
          aligned_sort_by: alignedSortBy,
          aligned_sort_order: alignedSortOrder,
          inspection_sort_by: inspectionSortBy,
          inspection_sort_order: inspectionSortOrder,
        },
      });

      setReport({
        date: toDDMMYYYYInputValue(res?.data?.date || selectedDate, selectedDate),
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
  }, [
    selectedDate,
    alignedSortBy,
    alignedSortOrder,
    inspectionSortBy,
    inspectionSortOrder,
  ]);

  useEffect(() => {
    fetchDailyReport();
  }, [fetchDailyReport]);

  useEffect(() => {
    const nextSelectedDate = toDDMMYYYYInputValue(
      normalizeQueryText(searchParams.get("date")),
      getTodayDDMMYYYY(),
    );
    const nextAlignedSortBy = parseAlignedSortBy(
      searchParams.get("aligned_sort_by"),
    );
    const nextAlignedSortOrder = parseSortOrder(
      searchParams.get("aligned_sort_order"),
      nextAlignedSortBy,
    );
    const nextInspectionSortBy = parseInspectionSortBy(
      searchParams.get("inspection_sort_by"),
    );
    const nextInspectionSortOrder = parseSortOrder(
      searchParams.get("inspection_sort_order"),
      nextInspectionSortBy,
    );

    setSelectedDate((prev) => (prev === nextSelectedDate ? prev : nextSelectedDate));
    setAlignedSortBy((prev) => (prev === nextAlignedSortBy ? prev : nextAlignedSortBy));
    setAlignedSortOrder((prev) => (prev === nextAlignedSortOrder ? prev : nextAlignedSortOrder));
    setInspectionSortBy((prev) => (prev === nextInspectionSortBy ? prev : nextInspectionSortBy));
    setInspectionSortOrder((prev) => (
      prev === nextInspectionSortOrder ? prev : nextInspectionSortOrder
    ));
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    const dateValue = normalizeQueryText(selectedDate);

    if (dateValue) next.set("date", dateValue);
    if (alignedSortBy !== DEFAULT_ALIGNED_SORT_BY) {
      next.set("aligned_sort_by", alignedSortBy);
    }
    if (alignedSortOrder !== parseSortOrder("", alignedSortBy)) {
      next.set("aligned_sort_order", alignedSortOrder);
    }
    if (inspectionSortBy !== DEFAULT_INSPECTION_SORT_BY) {
      next.set("inspection_sort_by", inspectionSortBy);
    }
    if (inspectionSortOrder !== parseSortOrder("", inspectionSortBy)) {
      next.set("inspection_sort_order", inspectionSortOrder);
    }

    const nextQuery = next.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      setSearchParams(next, { replace: true });
    }
  }, [
    alignedSortBy,
    alignedSortOrder,
    inspectionSortBy,
    inspectionSortOrder,
    searchParams,
    selectedDate,
    setSearchParams,
  ]);

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
                lang="en-GB"
                className="form-control"
                value={toISODateString(selectedDate)}
                onChange={(e) =>
                  setSelectedDate(toDDMMYYYYInputValue(e.target.value, ""))
                }
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
            <span className="om-summary-chip">Date: {formatDateDDMMYYYY(report?.date)}</span>
            <span className="om-summary-chip">
              Aligned Requests: {summary?.aligned_requests_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Inspectors: {summary?.inspectors_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Inspections: {summary?.inspections_count ?? 0}
            </span>
            <span className="om-summary-chip">
              Total Inspected Qty: {summary?.total_inspected_quantity ?? 0}
            </span>
            <span className="om-summary-chip">
              Total CBM: {formatCbm(summary?.total_inspected_cbm * summary?.total_inspected_quantity)}
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
                    <th>
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        onClick={() => handleAlignedSort("request_date", "desc")}
                      >
                        Request Date{alignedSortIndicator("request_date")}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        onClick={() => handleAlignedSort("order_id", "asc")}
                      >
                        Order ID{alignedSortIndicator("order_id")}
                      </button>
                    </th>
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
                      <td colSpan="8" className="text-center py-3">
                        No aligned requests found for this date.
                      </td>
                    </tr>
                  )}

                  {report.aligned_requests.map((request) => (
                    <tr key={request.qc_id} style={{ cursor: "pointer"}} onClick={ () => navigate(`/qc/${request.qc_id}`)}>
                      <td>{formatDateDDMMYYYY(request.request_date)}</td>
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
                          <th>
                            <button
                              type="button"
                              className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                              onClick={() => handleInspectionSort("inspection_date", "desc")}
                            >
                              Date{inspectionSortIndicator("inspection_date")}
                            </button>
                          </th>
                          <th>
                            <button
                              type="button"
                              className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                              onClick={() => handleInspectionSort("order_id", "asc")}
                            >
                              Order ID{inspectionSortIndicator("order_id")}
                            </button>
                          </th>
                          <th>Item</th>
                          <th>Inspected</th>
                          <th>Passed</th>
                          <th>CBM</th>
                          <th>CBM Total</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(entry?.inspections || []).map((inspection) => (
                          <tr key={inspection.inspection_id}>
                            <td>{formatDateDDMMYYYY(inspection.inspection_date)}</td>
                            <td>{inspection.order_id || "N/A"}</td>
                            <td>{inspection.item_code || "N/A"}</td>
                            <td>{inspection.inspected_quantity ?? 0}</td>
                            <td>{inspection.passed_quantity ?? 0}</td>
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
