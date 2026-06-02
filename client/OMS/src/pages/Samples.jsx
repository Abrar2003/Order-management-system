import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SampleCreateModal from "../components/samples/SampleCreateModal";
import { usePermissions } from "../auth/PermissionContext";
import { normalizeUserRole } from "../auth/permissions";
import {
  SAMPLE_STATUSES,
  listSamples,
  sampleStatusLabel,
} from "../services/samples.service";
import { formatDateDDMMYYYY } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const MUTATION_ROLES = new Set(["admin", "super_admin", "inspection_manager", "product_manager"]);

const clean = (value) => String(value || "").trim();
const positiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const limitValue = (value) => {
  const parsed = positiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const statusClass = (status = "") => {
  if (["completed", "shipped", "client_approved", "inspected"].includes(status)) return "text-bg-success";
  if (["cancelled"].includes(status)) return "text-bg-danger";
  if (["on_hold", "client_revision_requested"].includes(status)) return "text-bg-warning";
  return "text-bg-primary";
};

const Samples = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "samples");
  const { role } = usePermissions();
  const canMutate = MUTATION_ROLES.has(normalizeUserRole(role));

  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ brands: [], vendors: [], statuses: SAMPLE_STATUSES });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [page, setPage] = useState(() => positiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => limitValue(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [query, setQuery] = useState({
    search: clean(searchParams.get("search")),
    brand: clean(searchParams.get("brand")) || "all",
    vendor: clean(searchParams.get("vendor")) || "all",
    status: clean(searchParams.get("status")) || "all",
    date_from: clean(searchParams.get("date_from")),
    date_to: clean(searchParams.get("date_to")),
    archived: clean(searchParams.get("archived")) || "active",
  });
  const [draft, setDraft] = useState(query);

  const fetchSamples = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = {
        page,
        limit,
        search: query.search,
        brand: query.brand === "all" ? "" : query.brand,
        vendor: query.vendor === "all" ? "" : query.vendor,
        status: query.status === "all" ? "" : query.status,
        date_from: query.date_from,
        date_to: query.date_to,
        archived: query.archived === "archived" ? "true" : query.archived === "all" ? "all" : "",
      };
      const response = await listSamples(params);
      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setFilters((prev) => ({ ...prev, ...(response?.data?.filters || {}) }));
      setPage(Math.max(1, Number(response?.data?.pagination?.page || 1)));
      setTotalPages(Math.max(1, Number(response?.data?.pagination?.totalPages || 1)));
      setTotalRecords(Number(response?.data?.pagination?.totalRecords || 0));
    } catch (fetchError) {
      setRows([]);
      setError(fetchError?.response?.data?.message || "Failed to load samples.");
    } finally {
      setLoading(false);
    }
  }, [limit, page, query]);

  useEffect(() => {
    fetchSamples();
  }, [fetchSamples]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;
    const next = {
      search: clean(searchParams.get("search")),
      brand: clean(searchParams.get("brand")) || "all",
      vendor: clean(searchParams.get("vendor")) || "all",
      status: clean(searchParams.get("status")) || "all",
      date_from: clean(searchParams.get("date_from")),
      date_to: clean(searchParams.get("date_to")),
      archived: clean(searchParams.get("archived")) || "active",
    };
    setQuery(next);
    setDraft(next);
    setPage(positiveInt(searchParams.get("page"), 1));
    setLimit(limitValue(searchParams.get("limit")));
    setSyncedQuery(currentQuery);
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;
    const next = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (!value || value === "all" || (key === "archived" && value === "active")) return;
      next.set(key, value);
    });
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [limit, page, query, searchParams, setSearchParams, syncedQuery]);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setQuery({ ...draft });
  };

  const clearFilters = () => {
    const next = {
      search: "",
      brand: "all",
      vendor: "all",
      status: "all",
      date_from: "",
      date_to: "",
      archived: "active",
    };
    setPage(1);
    setDraft(next);
    setQuery(next);
  };

  const pageSummary = useMemo(() => {
    if (totalRecords === 0) return "No samples";
    const start = ((page - 1) * limit) + 1;
    const end = Math.min(totalRecords, page * limit);
    return `${start}-${end} of ${totalRecords}`;
  }, [limit, page, totalRecords]);

  return (
    <>
      <Navbar />
      <main className="container-fluid py-3 samples-page">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 className="mb-1">Samples</h2>
            <div className="text-secondary small">{pageSummary}</div>
          </div>
          {canMutate && (
            <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              Create Sample
            </button>
          )}
        </div>

        <form className="card om-card mb-3" onSubmit={applyFilters}>
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-3">
                <label className="form-label">Search</label>
                <input className="form-control" value={draft.search} onChange={(e) => setDraft((prev) => ({ ...prev, search: e.target.value }))} placeholder="Code, name, brand, vendor" />
              </div>
              <div className="col-md-2">
                <label className="form-label">Status</label>
                <select className="form-select" value={draft.status} onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="all">All Statuses</option>
                  {filters.statuses.map((status) => <option key={status} value={status}>{sampleStatusLabel(status)}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Brand</label>
                <select className="form-select" value={draft.brand} onChange={(e) => setDraft((prev) => ({ ...prev, brand: e.target.value }))}>
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Vendor</label>
                <select className="form-select" value={draft.vendor} onChange={(e) => setDraft((prev) => ({ ...prev, vendor: e.target.value }))}>
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Archive</label>
                <select className="form-select" value={draft.archived} onChange={(e) => setDraft((prev) => ({ ...prev, archived: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">From</label>
                <input type="date" className="form-control" value={draft.date_from} onChange={(e) => setDraft((prev) => ({ ...prev, date_from: e.target.value }))} />
              </div>
              <div className="col-md-2">
                <label className="form-label">To</label>
                <input type="date" className="form-control" value={draft.date_to} onChange={(e) => setDraft((prev) => ({ ...prev, date_to: e.target.value }))} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Rows</label>
                <select className="form-select" value={limit} onChange={(e) => { setPage(1); setLimit(limitValue(e.target.value)); }}>
                  {LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="col-md-4 d-flex gap-2">
                <button type="submit" className="btn btn-primary">Apply</button>
                <button type="button" className="btn btn-outline-secondary" onClick={clearFilters}>Clear</button>
              </div>
            </div>
          </div>
        </form>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0 samples-table">
              <thead>
                <tr>
                  <th>Sample Code</th>
                  <th>Name / Description</th>
                  <th>Brand</th>
                  <th>Vendors</th>
                  <th>Current Status</th>
                  <th>Expected Manufacturing</th>
                  <th>Inspection Status</th>
                  <th>Estimated Shipping</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="10" className="text-center py-4">Loading samples...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan="10" className="text-center py-4 text-secondary">No samples found.</td></tr>
                ) : rows.map((sample) => (
                  <tr key={sample._id}>
                    <td className="fw-semibold">{sample.code || "-"}</td>
                    <td>
                      <div>{sample.name || "-"}</div>
                      <div className="small text-secondary text-truncate sample-description-cell">{sample.description || ""}</div>
                    </td>
                    <td>{sample.brand || "-"}</td>
                    <td>{Array.isArray(sample.vendors) && sample.vendors.length ? sample.vendors.join(", ") : "-"}</td>
                    <td><span className={`badge ${statusClass(sample.current_status)}`}>{sampleStatusLabel(sample.current_status)}</span></td>
                    <td>{formatDateDDMMYYYY(sample.vendor_summary?.expected_manufacturing_date, "-")}</td>
                    <td>{sampleStatusLabel(sample.vendor_summary?.inspection_status || "not_requested")}</td>
                    <td>{formatDateDDMMYYYY(sample.vendor_summary?.estimated_shipping_date, "-")}</td>
                    <td>{formatDateDDMMYYYY(sample.updatedAt, "-")}</td>
                    <td>
                      <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => navigate(`/samples/${sample._id}`)}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer d-flex flex-wrap justify-content-between align-items-center gap-2">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1 || loading}>Previous</button>
            <span className="small text-secondary">Page {page} of {totalPages}</span>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages || loading}>Next</button>
          </div>
        </div>
      </main>
      {showCreateModal && (
        <SampleCreateModal
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false);
            fetchSamples();
          }}
        />
      )}
    </>
  );
};

export default Samples;
