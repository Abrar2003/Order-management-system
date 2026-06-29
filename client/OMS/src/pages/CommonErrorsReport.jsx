import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import ReportInfoBanner from "../components/ReportInfoBanner";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { exportHtmlToPdf } from "../services/pdfExport.service";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_FILTER = "all";
const DEFAULT_LIMIT = 20;

const normalizeText = (value) => String(value ?? "").trim();
const normalizeFilter = (value) => normalizeText(value) || DEFAULT_FILTER;
const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const formatNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toFixed(2).replace(/\.?0+$/, "")
    : "-";
};
const formatRemark = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "base2") return "Base 2";
  if (normalized === "pedestal") return "Pedestal";
  return normalized
    ? normalized.replace(/([a-z]+)(\d+)/i, (_, word, number) =>
        `${word.charAt(0).toUpperCase()}${word.slice(1)} ${number}`)
    : "Entry";
};
const formatSizes = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const size = `${formatNumber(entry?.L)} × ${formatNumber(entry?.B)} × ${formatNumber(entry?.H)}`;
      const weight = Number(entry?.[weightKey] || 0);
      return `${formatRemark(entry?.remark)}: ${size}${weight > 0 ? ` | ${formatNumber(weight)} kg` : ""}`;
    });
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const CommonErrorsReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "common-errors-report");

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filterOptions, setFilterOptions] = useState({
    brand_options: [],
    vendor_options: [],
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState(() => normalizeText(searchParams.get("search")));
  const [draftSearch, setDraftSearch] = useState(() => normalizeText(searchParams.get("search")));
  const [brand, setBrand] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [draftBrand, setDraftBrand] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [vendor, setVendor] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [draftVendor, setDraftVendor] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [errorType, setErrorType] = useState(() => normalizeFilter(searchParams.get("error_type")));
  const [draftErrorType, setDraftErrorType] = useState(() => normalizeFilter(searchParams.get("error_type")));
  const [fromDate, setFromDate] = useState(() => toISODateString(searchParams.get("from_date")));
  const [draftFromDate, setDraftFromDate] = useState(() => toISODateString(searchParams.get("from_date")));
  const [toDate, setToDate] = useState(() => toISODateString(searchParams.get("to_date")));
  const [draftToDate, setDraftToDate] = useState(() => toISODateString(searchParams.get("to_date")));
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });

  const requestParams = useMemo(() => ({
    search,
    brand: brand === DEFAULT_FILTER ? "" : brand,
    vendor: vendor === DEFAULT_FILTER ? "" : vendor,
    error_type: errorType === DEFAULT_FILTER ? "" : errorType,
    from_date: fromDate,
    to_date: toDate,
  }), [brand, errorType, fromDate, search, toDate, vendor]);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/common-errors", {
        params: { ...requestParams, page, limit: DEFAULT_LIMIT },
      });
      setRows(Array.isArray(response?.data?.rows) ? response.data.rows : []);
      setSummary(response?.data?.summary || {});
      setFilterOptions(response?.data?.filters || {});
      setPagination(response?.data?.pagination || { page: 1, total: 0, totalPages: 1 });
    } catch (fetchError) {
      setRows([]);
      setError(fetchError?.response?.data?.message || "Failed to load Common Errors report.");
    } finally {
      setLoading(false);
    }
  }, [page, requestParams]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (brand !== DEFAULT_FILTER) next.set("brand", brand);
    if (vendor !== DEFAULT_FILTER) next.set("vendor", vendor);
    if (errorType !== DEFAULT_FILTER) next.set("error_type", errorType);
    if (fromDate) next.set("from_date", fromDate);
    if (toDate) next.set("to_date", toDate);
    if (page > 1) next.set("page", String(page));
    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [brand, errorType, fromDate, page, search, searchParams, setSearchParams, toDate, vendor]);

  const applyFilters = (event) => {
    event.preventDefault();
    setSearch(normalizeText(draftSearch));
    setBrand(normalizeFilter(draftBrand));
    setVendor(normalizeFilter(draftVendor));
    setErrorType(normalizeFilter(draftErrorType));
    setFromDate(toISODateString(draftFromDate));
    setToDate(toISODateString(draftToDate));
    setPage(1);
  };

  const resetFilters = () => {
    setDraftSearch("");
    setDraftBrand(DEFAULT_FILTER);
    setDraftVendor(DEFAULT_FILTER);
    setDraftErrorType(DEFAULT_FILTER);
    setDraftFromDate("");
    setDraftToDate("");
    setSearch("");
    setBrand(DEFAULT_FILTER);
    setVendor(DEFAULT_FILTER);
    setErrorType(DEFAULT_FILTER);
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const exportXls = async () => {
    try {
      setExporting("xls");
      const response = await api.get("/reports/common-errors/export", {
        params: requestParams,
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: response?.headers?.["content-type"] || "application/vnd.ms-excel",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `common-errors-${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError?.response?.data?.message || "Failed to export XLS.");
    } finally {
      setExporting("");
    }
  };

  const exportPdf = async () => {
    try {
      setExporting("pdf");
      const response = await api.get("/reports/common-errors", {
        params: { ...requestParams, page: 1, limit: 5000 },
      });
      const exportRows = Array.isArray(response?.data?.rows) ? response.data.rows : [];
      const body = exportRows.flatMap((row) =>
        row.errors.map((entry) => `
          <tr>
            <td>${escapeHtml(row.order_id)}</td>
            <td>${escapeHtml(row.item_code)}</td>
            <td>${escapeHtml(row.brand)}</td>
            <td>${escapeHtml(row.vendor)}</td>
            <td>${escapeHtml(row.inspector_name)}</td>
            <td>${escapeHtml(formatDateDDMMYYYY(row.inspection_date, ""))}</td>
            <td>${escapeHtml(entry.label)}</td>
            <td>${escapeHtml(entry.formula)}</td>
            <td>${escapeHtml(formatNumber(entry.actual))}</td>
            <td>${escapeHtml(formatNumber(entry.expected))}</td>
            <td>${escapeHtml(formatNumber(entry.difference))}</td>
          </tr>
        `),
      ).join("");
      await exportHtmlToPdf({
        reportKey: "common-errors-report",
        filename: `common-errors-${new Date().toISOString().slice(0, 10)}.pdf`,
        landscape: true,
        repeatHeader: {
          inTable: true,
          title: "Common Errors",
          subtitle: `${response?.data?.summary?.inspection_count || 0} inspection records with errors`,
        },
        html: `
          <table class="table table-sm">
            <thead><tr>
              <th>PO</th><th>Item</th><th>Brand</th><th>Vendor</th><th>Inspector</th>
              <th>Date</th><th>Error</th><th>Formula</th><th>Calculated</th>
              <th>Recorded</th><th>Difference</th>
            </tr></thead>
            <tbody>${body || '<tr><td colspan="11">No common errors found.</td></tr>'}</tbody>
          </table>
        `,
      });
    } catch (exportError) {
      setError(exportError?.response?.data?.message || "Failed to export PDF.");
    } finally {
      setExporting("");
    }
  };

  return (
    <>
      <Navbar />
      <div className="page-shell om-report-page py-3">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>
            Back
          </button>
          <div className="text-center">
            <div className="text-uppercase small text-secondary">Inspection validation</div>
            <h1 className="h3 mb-0">Common Errors</h1>
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={exportXls} disabled={Boolean(exporting)}>
              {exporting === "xls" ? "Exporting..." : "Export XLS"}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={exportPdf} disabled={Boolean(exporting)}>
              {exporting === "pdf" ? "Exporting..." : "Export PDF"}
            </button>
          </div>
        </div>

        <ReportInfoBanner
          description="Finds inspection records with common weight and component-height calculation errors."
          dataShown="PO, item, inspector, inspection date, inspected item and carton sizes, formulas, recorded values, calculated values, and differences."
          howItWorks="Flags net weight × pieces per inner × inner boxes per master when it is greater than or equal to master gross weight, and flags only when Top H + Base H + optional Pedestal H is less than Item H. Equal or greater combined height is accepted."
        />

        <form className="card om-card p-3 my-3 common-errors-filter-card" onSubmit={applyFilters}>
          <div className="common-errors-filter-primary">
            <div>
              <label className="form-label">Search</label>
              <input className="form-control" value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder="PO, item, inspector" />
            </div>
            <div>
              <label className="form-label">Brand</label>
              <select className="form-select" value={draftBrand} onChange={(e) => setDraftBrand(e.target.value)}>
                <option value={DEFAULT_FILTER}>All Brands</option>
                {(filterOptions.brand_options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Vendor</label>
              <select className="form-select" value={draftVendor} onChange={(e) => setDraftVendor(e.target.value)}>
                <option value={DEFAULT_FILTER}>All Vendors</option>
                {(filterOptions.vendor_options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Error Type</label>
              <select className="form-select" value={draftErrorType} onChange={(e) => setDraftErrorType(e.target.value)}>
                <option value={DEFAULT_FILTER}>All Errors</option>
                <option value="weight">Weight</option>
                <option value="height">Height</option>
              </select>
            </div>
          </div>

          <div className="common-errors-filter-footer">
            <fieldset className="common-errors-date-range">
              <legend>Inspection date</legend>
              <div className="common-errors-date-fields">
                <div>
                  <label className="form-label" htmlFor="common-errors-from-date">From</label>
                  <input
                    id="common-errors-from-date"
                    type="date"
                    className="form-control"
                    value={draftFromDate}
                    onChange={(e) => setDraftFromDate(e.target.value)}
                  />
                </div>
                <span className="common-errors-date-separator" aria-hidden="true">→</span>
                <div>
                  <label className="form-label" htmlFor="common-errors-to-date">To</label>
                  <input
                    id="common-errors-to-date"
                    type="date"
                    className="form-control"
                    value={draftToDate}
                    onChange={(e) => setDraftToDate(e.target.value)}
                  />
                </div>
              </div>
            </fieldset>

            <div className="common-errors-filter-actions">
              <button type="button" className="btn btn-outline-secondary" onClick={resetFilters}>
                Reset filters
              </button>
              <button type="submit" className="btn btn-primary">
                Apply filters
              </button>
            </div>
          </div>
        </form>

        <div className="row g-3 mb-3">
          {[
            ["Inspection Records", summary.inspection_count],
            ["Total Errors", summary.error_count],
            ["Weight Errors", summary.weight_errors],
            ["Height Errors", summary.height_errors],
          ].map(([label, value]) => (
            <div key={label} className="col-6 col-lg-3">
              <div className="card om-card h-100 p-3">
                <div className="small text-secondary">{label}</div>
                <div className="h4 mb-0">{Number(value || 0)}</div>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        <div className="card om-card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Inspection</th><th>Error</th><th>Calculation</th>
                  <th>Item Sizes</th><th>Box Sizes</th><th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan="6" className="text-center py-5">Loading common errors...</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan="6" className="text-center py-5">No common errors found.</td></tr>}
                {!loading && rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="fw-semibold">{row.order_id || "N/A"} · {row.item_code || "N/A"}</div>
                      <div className="small">{row.item_description || ""}</div>
                      <div className="small text-secondary">{row.brand} · {row.vendor}</div>
                      <div className="small text-secondary">{row.inspector_name} · {formatDateDDMMYYYY(row.inspection_date)}</div>
                    </td>
                    <td>
                      {row.errors.map((entry) => <div key={entry.type} className="badge text-bg-danger d-block mb-1 text-wrap">{entry.label}</div>)}
                    </td>
                    <td>
                      {row.errors.map((entry) => (
                        <div key={entry.type} className="small mb-2">
                          <div>{entry.formula} = <strong>{formatNumber(entry.actual)}</strong></div>
                          <div className="text-secondary">Recorded: {formatNumber(entry.expected)}</div>
                        </div>
                      ))}
                    </td>
                    <td>{formatSizes(row.item_sizes, "net_weight").map((line) => <div key={line} className="small mb-1">{line}</div>)}</td>
                    <td>{formatSizes(row.box_sizes, "gross_weight").map((line) => <div key={line} className="small mb-1">{line}</div>)}</td>
                    <td>
                      {row.errors.map((entry) => (
                        <div key={entry.type} className={Number(entry.difference) >= 0 ? "text-danger fw-semibold" : "text-warning fw-semibold"}>
                          {Number(entry.difference) > 0 ? "+" : ""}{formatNumber(entry.difference)}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="d-flex justify-content-between align-items-center p-3 border-top">
            <span className="small text-secondary">{pagination.total || 0} records</span>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary btn-sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
              <span className="small align-self-center">Page {pagination.page || 1} of {pagination.totalPages || 1}</span>
              <button className="btn btn-outline-secondary btn-sm" disabled={page >= (pagination.totalPages || 1) || loading} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CommonErrorsReport;
