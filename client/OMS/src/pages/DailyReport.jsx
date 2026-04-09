import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  formatDateDDMMYYYY,
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { formatCbm, formatPositiveCbm } from "../utils/cbm";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_ALIGNED_SORT_BY = "request_date";
const DEFAULT_INSPECTION_SORT_BY = "inspection_date";

const normalizeQueryText = (value) => String(value || "").trim();
const getDefaultAlignedSortOrder = (sortBy) =>
  sortBy === "request_date" ? "desc" : "asc";
const getDefaultInspectionSortOrder = (sortBy) =>
  sortBy === "order_id" ? "asc" : "desc";

const parseAlignedSortBy = (value) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "vendor") return "vendor";
  if (
    normalized === "inspector_name"
    || normalized === "inspector"
    || normalized === "qc"
    || normalized === "qc_name"
  ) {
    return "inspector_name";
  }
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
  return sortBy === "inspection_date" || sortBy === "request_date"
    ? "desc"
    : "asc";
};

const normalizeInspectionStatus = (value) =>
  String(value || "").trim().toLowerCase();

const renderInspectionStatus = (value) => {
  const normalized = normalizeInspectionStatus(value);
  if (normalized === "transfered" || normalized === "transferred") {
    return <span className="text-warning fw-semibold">Transferred</span>;
  }
  if (normalized === "goods not ready") {
    return <span className="text-danger fw-semibold">Goods Not Ready</span>;
  }
  if (normalized === "inspection done") {
    return <span className="text-success fw-semibold">Inspection Done</span>;
  }
  return <span className="text-danger fw-semibold">Pending</span>;
};

const getAlignedRequestRowClassName = (request) => {
  if (request?.request_pending_action) return "om-report-danger-row";
  const normalizedStatus = normalizeInspectionStatus(request?.inspection_status);
  if (normalizedStatus === "transfered" || normalizedStatus === "transferred") {
    return "weekly-summary-warning-row";
  }
  if (normalizedStatus === "goods not ready") return "weekly-summary-warning-row";
  if (normalizedStatus === "inspection done") return "om-report-success-row";
  return "";
};

const renderResolvedCbm = (value) => formatPositiveCbm(value, "N/A");

const renderResolvedCbmTotal = (value) => {
  if (value === null || value === undefined || value === "") return "N/A";
  return formatCbm(value);
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState("");
  const [alignedSortBy, setAlignedSortBy] = useState(initialAlignedSortBy);
  const [alignedSortOrder, setAlignedSortOrder] = useState(initialAlignedSortOrder);
  const [inspectionSortBy, setInspectionSortBy] = useState(initialInspectionSortBy);
  const [inspectionSortOrder, setInspectionSortOrder] = useState(initialInspectionSortOrder);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const reportRef = useRef(null);
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

  const handleInspectionSort = (column, defaultDirection = "asc") => {
    if (inspectionSortBy === column) {
      setInspectionSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setInspectionSortBy(column);
    setInspectionSortOrder(defaultDirection);
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
      console.log("Fetched daily report:", res.data);
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
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

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
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const dateValue = normalizeQueryText(selectedDate);

    if (dateValue) next.set("date", dateValue);
    if (alignedSortBy !== DEFAULT_ALIGNED_SORT_BY) {
      next.set("aligned_sort_by", alignedSortBy);
    }
    if (alignedSortOrder !== getDefaultAlignedSortOrder(alignedSortBy)) {
      next.set("aligned_sort_order", alignedSortOrder);
    }
    if (inspectionSortBy !== DEFAULT_INSPECTION_SORT_BY) {
      next.set("inspection_sort_by", inspectionSortBy);
    }
    if (inspectionSortOrder !== getDefaultInspectionSortOrder(inspectionSortBy)) {
      next.set("inspection_sort_order", inspectionSortOrder);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
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
    syncedQuery,
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

  const handleExportPdf = useCallback(async () => {
    const hasReportData =
      report.aligned_requests.length > 0 || report.inspector_compiled.length > 0;
    if (!reportRef.current || loading || exportingPdf || !hasReportData) {
      return;
    }

    const confirmed = window.confirm(
      "Confirm export of this daily inspection report as PDF?",
    );
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

      const safeDate = String(toISODateString(report?.date) || "daily-inspection-report")
        .replace(/[^a-zA-Z0-9_-]/g, "_");
      pdf.save(`daily-inspection-report-${safeDate}.pdf`);
    } catch (err) {
      console.error("Daily inspection report export failed:", err);
      alert("Failed to export daily inspection report PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [
    exportingPdf,
    loading,
    report?.date,
    report.aligned_requests.length,
    report.inspector_compiled.length,
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
          <h2 className="h4 mb-0">Daily Inspection Reports</h2>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={handleExportPdf}
            disabled={
              loading
              || exportingPdf
              || (
                report.aligned_requests.length === 0
                && report.inspector_compiled.length === 0
              )
            }
          >
            {exportingPdf ? "Exporting..." : "Export PDF"}
          </button>
        </div>

        <div ref={reportRef}>
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
                Total CBM: {formatCbm(summary?.total_inspected_cbm)}
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
                <h3 className="h6 mb-0">Requests For Selected Date</h3>
              </div>
              <div className="table-responsive">
                <table className="table table-sm table-striped align-middle mb-0">
                  <thead>
                    <tr>
                      <th>
                        <SortHeaderButton
                          label="Request Date"
                          isActive={alignedSortBy === "request_date"}
                          direction={alignedSortOrder}
                          onClick={() => handleAlignedSort("request_date", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Order ID"
                          isActive={alignedSortBy === "order_id"}
                          direction={alignedSortOrder}
                          onClick={() => handleAlignedSort("order_id", "asc")}
                        />
                      </th>
                      <th>Item</th>
                      <th>
                        <SortHeaderButton
                          label="Vendor"
                          isActive={alignedSortBy === "vendor"}
                          direction={alignedSortOrder}
                          onClick={() => handleAlignedSort("vendor", "asc")}
                        />
                      </th>
                      <th>Brand</th>
                      <th>
                        <SortHeaderButton
                          label="QC"
                          isActive={alignedSortBy === "inspector_name"}
                          direction={alignedSortOrder}
                          onClick={() => handleAlignedSort("inspector_name", "asc")}
                        />
                      </th>
                      <th>Requested</th>
                      <th>Passed</th>
                      <th>Inspected/PIS CBM Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.aligned_requests.length === 0 && (
                      <tr>
                        <td colSpan="10" className="text-center py-3">
                          No requests found for the selected date.
                        </td>
                      </tr>
                    )}

                    {report.aligned_requests.map((request) => (
                      <tr
                        key={request.request_row_id || request.qc_id}
                        className={getAlignedRequestRowClassName(request)}
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/qc/${request.qc_id}`)}
                      >
                        <td>{formatDateDDMMYYYY(request.request_date)}</td>
                        <td>{request.order_id || "N/A"}</td>
                        <td>
                          <div>{request.item_code || "N/A"}</div>
                          {request?.is_transferred ? (
                            <div className="small fw-semibold">Transferred</div>
                          ) : null}
                          {request?.goods_not_ready ? (
                            <div className="small fw-semibold">Goods Not Ready</div>
                          ) : null}
                          {request?.transfer_note ? (
                            <div className="small">{request.transfer_note}</div>
                          ) : null}
                          {request?.goods_not_ready_reason ? (
                            <div className="small">{request.goods_not_ready_reason}</div>
                          ) : null}
                        </td>
                        <td>{request.vendor || "N/A"}</td>
                        <td>{request.brand || "N/A"}</td>
                        <td>{request?.inspector?.name || "Unassigned"}</td>
                        <td>{request.quantity_requested ?? 0}</td>
                        <td>{request.quantity_passed ?? 0}</td>
                        <td>{renderResolvedCbmTotal(request?.inspected_cbm_total)}</td>
                        <td>{renderInspectionStatus(request?.inspection_status)}</td>
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
                              <SortHeaderButton
                                label="Date"
                                isActive={inspectionSortBy === "inspection_date"}
                                direction={inspectionSortOrder}
                                onClick={() => handleInspectionSort("inspection_date", "desc")}
                              />
                            </th>
                            <th>
                              <SortHeaderButton
                                label="Order ID"
                                isActive={inspectionSortBy === "order_id"}
                                direction={inspectionSortOrder}
                                onClick={() => handleInspectionSort("order_id", "asc")}
                              />
                            </th>
                            <th>Item</th>
                            <th>Vendor</th>
                            <th>Brand</th>
                            <th>Requested</th>
                            <th>Inspected</th>
                            <th>Passed</th>
                            <th>Inspected/PIS CBM</th>
                            <th>Inspected/PIS CBM Total</th>
                            <th>Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(entry?.inspections || []).map((inspection) => (
                            <tr
                              key={inspection.inspection_id}
                              className={
                                inspection?.goods_not_ready || inspection?.is_transferred
                                  ? "weekly-summary-warning-row"
                                  : ""
                              }
                            >
                              <td>{formatDateDDMMYYYY(inspection.inspection_date)}</td>
                              <td>{inspection.order_id || "N/A"}</td>
                              <td>
                                <div>{inspection.item_code || "N/A"}</div>
                                {inspection?.is_transferred ? (
                                  <div className="small fw-semibold">Transferred</div>
                                ) : null}
                                {inspection?.goods_not_ready ? (
                                  <div className="small fw-semibold">Goods Not Ready</div>
                                ) : null}
                              </td>
                              <td>{inspection.vendor || "N/A"}</td>
                              <td>{inspection.brand || "N/A"}</td>
                              <td>{inspection.vendor_requested ?? 0}</td>
                              <td>{inspection.inspected_quantity ?? 0}</td>
                              <td>{inspection.passed_quantity ?? 0}</td>
                              <td>{renderResolvedCbm(inspection?.report_cbm_per_unit)}</td>
                              <td>{renderResolvedCbmTotal(inspection?.report_cbm_total)}</td>
                              <td>
                                {inspection?.remarks
                                  || inspection?.transfer_note
                                  || inspection?.goods_not_ready_reason
                                  || "None"}
                              </td>
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
      </div>
    </>
  );
};

export default DailyReport;
