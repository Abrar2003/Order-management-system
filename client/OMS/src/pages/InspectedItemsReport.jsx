import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_FILTER = "all";
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [20, 50, 100];

const CRITERIA_OPTIONS = [
  { value: DEFAULT_FILTER, label: "All Criteria" },
  { value: "inspected", label: "Inspected Items" },
  { value: "cad", label: "CAD Uploaded" },
  { value: "pis", label: "PIS Uploaded" },
  { value: "assembly", label: "Assembly Uploaded" },
  { value: "mounting_file", label: "Mounting File Uploaded" },
  { value: "packaging_ppt", label: "Packaging PPT Uploaded" },
  { value: "product_image", label: "Product Image Uploaded" },
  { value: "finish", label: "Finish Uploaded" },
  { value: "shipping_marks", label: "Shipping Marks Uploaded" },
];

const STATUS_OPTIONS = [
  { value: DEFAULT_FILTER, label: "All" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const SUMMARY_KEYS = [
  "inspected",
  "cad",
  "pis",
  "assembly",
  "mounting_file",
  "packaging_ppt",
  "product_image",
  "finish",
  "shipping_marks",
];

const normalizeText = (value) => String(value || "").trim();
const normalizeFilter = (value, fallback = DEFAULT_FILTER) => {
  const normalized = normalizeText(value);
  return normalized || fallback;
};
const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};
const getFlagBadgeClass = (value) => (value ? "text-bg-success" : "text-bg-secondary");
const downloadBlobResponse = (response, fallbackName, fallbackType) => {
  const disposition = String(response?.headers?.["content-disposition"] || "");
  const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  const fileName = match?.[1]
    ? decodeURIComponent(match[1].trim())
    : fallbackName;
  const blob = new Blob([response.data], {
    type: response?.headers?.["content-type"] || fallbackType,
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

const SummaryPill = ({ entry }) => (
  <div className="inspected-items-report-pill">
    <div className="small text-secondary">{entry?.label || "Metric"}</div>
    <div className="fw-semibold">
      {Number(entry?.count || 0)} / {Number(entry?.total || 0)}
    </div>
  </div>
);

const FlagBadge = ({ value, applicable = true }) => (
  <span className={`badge ${applicable ? getFlagBadgeClass(value) : "text-bg-light text-secondary"}`}>
    {applicable ? (value ? "Yes" : "No") : "N/A"}
  </span>
);

const InspectedItemsReport = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "inspected-items-report");

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total_items: 0 });
  const [filters, setFilters] = useState({ brand_options: [], vendor_options: [] });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(() => normalizeText(searchParams.get("search")));
  const [draftSearchInput, setDraftSearchInput] = useState(() => normalizeText(searchParams.get("search")));
  const [brandFilter, setBrandFilter] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [draftBrandFilter, setDraftBrandFilter] = useState(() => normalizeFilter(searchParams.get("brand")));
  const [vendorFilter, setVendorFilter] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [draftVendorFilter, setDraftVendorFilter] = useState(() => normalizeFilter(searchParams.get("vendor")));
  const [criterionFilter, setCriterionFilter] = useState(() => normalizeFilter(searchParams.get("criterion")));
  const [draftCriterionFilter, setDraftCriterionFilter] = useState(() => normalizeFilter(searchParams.get("criterion")));
  const [statusFilter, setStatusFilter] = useState(() => normalizeFilter(searchParams.get("status")));
  const [draftStatusFilter, setDraftStatusFilter] = useState(() => normalizeFilter(searchParams.get("status")));
  const [fromDate, setFromDate] = useState(() => toISODateString(searchParams.get("from_date")));
  const [draftFromDate, setDraftFromDate] = useState(() => toISODateString(searchParams.get("from_date")));
  const [toDate, setToDate] = useState(() => toISODateString(searchParams.get("to_date")));
  const [draftToDate, setDraftToDate] = useState(() => toISODateString(searchParams.get("to_date")));
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const summaryEntries = useMemo(
    () => SUMMARY_KEYS.map((key) => summary?.[key]).filter(Boolean),
    [summary],
  );

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/reports/inspected-items", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          criterion: criterionFilter,
          status: statusFilter,
          from_date: fromDate,
          to_date: toDate,
          page,
          limit,
        },
      });

      setRows(Array.isArray(response?.data?.rows) ? response.data.rows : []);
      setSummary(response?.data?.summary || { total_items: 0 });
      setFilters(response?.data?.filters || { brand_options: [], vendor_options: [] });
      setTotalRecords(Number(response?.data?.pagination?.total || 0));
      setTotalPages(Number(response?.data?.pagination?.totalPages || 1));
    } catch (fetchError) {
      setRows([]);
      setError(fetchError?.response?.data?.message || "Failed to fetch inspected items report.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, criterionFilter, fromDate, limit, page, searchInput, statusFilter, toDate, vendorFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (searchInput) nextParams.set("search", searchInput);
    if (brandFilter !== DEFAULT_FILTER) nextParams.set("brand", brandFilter);
    if (vendorFilter !== DEFAULT_FILTER) nextParams.set("vendor", vendorFilter);
    if (criterionFilter !== DEFAULT_FILTER) nextParams.set("criterion", criterionFilter);
    if (statusFilter !== DEFAULT_FILTER) nextParams.set("status", statusFilter);
    if (fromDate) nextParams.set("from_date", fromDate);
    if (toDate) nextParams.set("to_date", toDate);
    if (page > 1) nextParams.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) nextParams.set("limit", String(limit));

    if (!areSearchParamsEquivalent(searchParams, nextParams)) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    brandFilter,
    criterionFilter,
    fromDate,
    limit,
    page,
    searchInput,
    searchParams,
    setSearchParams,
    statusFilter,
    toDate,
    vendorFilter,
  ]);

  const applyFilters = (event) => {
    event.preventDefault();
    setSearchInput(normalizeText(draftSearchInput));
    setBrandFilter(draftBrandFilter);
    setVendorFilter(draftVendorFilter);
    setCriterionFilter(draftCriterionFilter);
    setStatusFilter(draftStatusFilter);
    setFromDate(toISODateString(draftFromDate));
    setToDate(toISODateString(draftToDate));
    setPage(1);
  };

  const resetFilters = () => {
    setDraftSearchInput("");
    setDraftBrandFilter(DEFAULT_FILTER);
    setDraftVendorFilter(DEFAULT_FILTER);
    setDraftCriterionFilter(DEFAULT_FILTER);
    setDraftStatusFilter(DEFAULT_FILTER);
    setDraftFromDate("");
    setDraftToDate("");
    setSearchInput("");
    setBrandFilter(DEFAULT_FILTER);
    setVendorFilter(DEFAULT_FILTER);
    setCriterionFilter(DEFAULT_FILTER);
    setStatusFilter(DEFAULT_FILTER);
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const handleExportXls = useCallback(async () => {
    try {
      setExporting(true);
      const response = await api.get("/reports/inspected-items/export", {
        responseType: "blob",
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          criterion: criterionFilter,
          status: statusFilter,
          from_date: fromDate,
          to_date: toDate,
        },
      });
      downloadBlobResponse(
        response,
        `inspected-items-report-${new Date().toISOString().slice(0, 10)}.xls`,
        "application/vnd.ms-excel",
      );
    } catch (exportError) {
      console.error(exportError);
      alert("Failed to export inspected items report as XLS.");
    } finally {
      setExporting(false);
    }
  }, [brandFilter, criterionFilter, fromDate, searchInput, statusFilter, toDate, vendorFilter]);

  return (
    <>
      <Navbar />
      <div className="container-fluid py-4 om-page inspected-items-report-page">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
          <div>
            <h2 className="h4 mb-1">Inspected Items Report</h2>
            <div className="text-secondary small">
              Showing {totalRecords} item{totalRecords === 1 ? "" : "s"} after filters
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={handleExportXls}
            disabled={exporting || loading || totalRecords === 0}
          >
            {exporting ? "Exporting..." : "Export XLS"}
          </button>
        </div>

        <div className="inspected-items-report-pill-row mb-4">
          {summaryEntries.map((entry) => (
            <SummaryPill key={entry.key} entry={entry} />
          ))}
        </div>

        <div className="card om-card mb-4">
          <div className="card-body">
            <form className="row g-3 align-items-end" onSubmit={applyFilters}>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Search</label>
                <input
                  className="form-control"
                  value={draftSearchInput}
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                  placeholder="Item code, brand, description"
                />
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                >
                  <option value={DEFAULT_FILTER}>All Brands</option>
                  {(filters.brand_options || []).map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value={DEFAULT_FILTER}>All Vendors</option>
                  {(filters.vendor_options || []).map((vendor) => (
                    <option key={vendor} value={vendor}>{vendor}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-2 col-md-6">
                <label className="form-label">Criteria</label>
                <select
                  className="form-select"
                  value={draftCriterionFilter}
                  onChange={(event) => setDraftCriterionFilter(event.target.value)}
                >
                  {CRITERIA_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-1 col-md-4">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={draftStatusFilter}
                  onChange={(event) => setDraftStatusFilter(event.target.value)}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-2 col-md-4">
                <label className="form-label">Last Inspected From</label>
                <input
                  type="date"
                  className="form-control"
                  value={draftFromDate}
                  max={draftToDate || undefined}
                  onChange={(event) => setDraftFromDate(toISODateString(event.target.value))}
                />
              </div>
              <div className="col-lg-2 col-md-4">
                <label className="form-label">Last Inspected To</label>
                <input
                  type="date"
                  className="form-control"
                  value={draftToDate}
                  min={draftFromDate || undefined}
                  onChange={(event) => setDraftToDate(toISODateString(event.target.value))}
                />
              </div>
              <div className="col-lg-1 col-md-4">
                <label className="form-label">Rows</label>
                <select
                  className="form-select"
                  value={limit}
                  onChange={(event) => {
                    setLimit(parseLimit(event.target.value));
                    setPage(1);
                  }}
                >
                  {LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="col-lg-1 col-md-4 d-grid">
                <button type="submit" className="btn btn-primary">Apply</button>
              </div>
              <div className="col-md-2 d-grid">
                <button type="button" className="btn btn-outline-secondary" onClick={resetFilters}>
                  Reset Filters
                </button>
              </div>
            </form>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0 inspected-items-report-table">
                  <thead className="table-primary">
                    <tr>
                      <th>Item Code</th>
                      <th>Description</th>
                      <th>Brand</th>
                      <th>Vendors</th>
                      <th>Inspected</th>
                      <th>CAD</th>
                      <th>PIS</th>
                      <th>Assembly</th>
                      <th>Mounting File</th>
                      <th>Packaging PPT</th>
                      <th>Product Image</th>
                      <th>Finish</th>
                      <th>Shipping Marks</th>
                      <th>Last Inspected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id || row.code}>
                        <td className="fw-semibold">{row.code || "N/A"}</td>
                        <td>{row.description || row.name || "N/A"}</td>
                        <td>{row.brand || (row.brands || []).join(", ") || "N/A"}</td>
                        <td>{(row.vendors || []).join(", ") || "N/A"}</td>
                        <td><FlagBadge value={row.flags?.inspected} /></td>
                        <td><FlagBadge value={row.flags?.cad} /></td>
                        <td><FlagBadge value={row.flags?.pis} /></td>
                        <td>
                          <FlagBadge
                            value={row.flags?.assembly}
                            applicable={row.requirements?.assembly === true}
                          />
                        </td>
                        <td>
                          <FlagBadge
                            value={row.flags?.mounting_file}
                            applicable={row.requirements?.mounting_file === true}
                          />
                        </td>
                        <td><FlagBadge value={row.flags?.packaging_ppt} /></td>
                        <td><FlagBadge value={row.flags?.product_image} /></td>
                        <td>
                          <FlagBadge value={row.flags?.finish} />
                          {Number(row.files?.finish_count || 0) > 0 && (
                            <div className="small text-secondary mt-1">
                              {row.files.finish_count} finish{row.files.finish_count === 1 ? "" : "es"}
                            </div>
                          )}
                        </td>
                        <td><FlagBadge value={row.flags?.shipping_marks} /></td>
                        <td>{row.last_inspected_date ? formatDateDDMMYYYY(row.last_inspected_date) : "N/A"}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={14} className="text-center py-4">
                          No items found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span className="text-secondary small">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
};

export default InspectedItemsReport;
