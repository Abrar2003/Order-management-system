import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SampleCreateModal from "../components/samples/SampleCreateModal";
import { listSampleWorkflows } from "../services/sampleWorkflow.service";
import { usePermissions } from "../auth/PermissionContext";
import { normalizeUserRole } from "../auth/permissions";
import { formatDateDDMMYYYY } from "../utils/date";
import { normalizeTextOptions } from "../utils/optionText";
import "../App.css";

const DEFAULT_LIMIT = 10;
const LIMIT_OPTIONS = [5, 10, 20, 50];
const clean = (value) => String(value || "").trim();
const positiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const getVendorText = (record = {}) => normalizeTextOptions([
  ...(Array.isArray(record?.vendors) ? record.vendors : []),
  ...(Array.isArray(record?.vendor) ? record.vendor : [record?.vendor]),
]).join(", ");

const SampleWorkflowPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { role } = usePermissions();
  const canCreate = useMemo(() => [
    "admin",
    "super_admin",
    "inspection_manager",
    "product_manager",
  ].includes(normalizeUserRole(role)), [role]);
  const [records, setRecords] = useState([]);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(() => positiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => {
    const value = positiveInt(searchParams.get("limit"), DEFAULT_LIMIT);
    return LIMIT_OPTIONS.includes(value) ? value : DEFAULT_LIMIT;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [query, setQuery] = useState({
    search: clean(searchParams.get("search")),
    brand: clean(searchParams.get("brand")) || "all",
    vendor: clean(searchParams.get("vendor")) || "all",
  });
  const [draft, setDraft] = useState(query);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await listSampleWorkflows({
        page,
        limit,
        search: query.search || undefined,
        brand: query.brand === "all" ? undefined : query.brand,
        vendor: query.vendor === "all" ? undefined : query.vendor,
      });
      const body = response?.data || {};
      const nextRecords = Array.isArray(body.data) ? body.data : [];
      setRecords(nextRecords);
      setFilters(body.filters || { brands: [], vendors: [] });
      setTotalPages(Number(body.pagination?.totalPages || 1));
      setTotalRecords(Number(body.pagination?.totalRecords || 0));
      setSelected((current) =>
        nextRecords.find((record) => record._id === current?._id) || nextRecords[0] || null);
    } catch (loadError) {
      setError(loadError?.response?.data?.message || "Failed to load sample workflows.");
    } finally {
      setLoading(false);
    }
  }, [limit, page, query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
    if (query.search) next.set("search", query.search);
    if (query.brand !== "all") next.set("brand", query.brand);
    if (query.vendor !== "all") next.set("vendor", query.vendor);
    setSearchParams(next, { replace: true });
  }, [limit, page, query, setSearchParams]);

  return (
    <>
      <Navbar />
      <main className="container-fluid py-3 sample-workflow-page">
        <div className="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
          <div>
            <h2 className="mb-0">Sample Workflow Tracker</h2>
            <div className="text-secondary small">View independently stored sample records.</div>
          </div>
          {canCreate && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              Create Sample Workflow
            </button>
          )}
        </div>

        <form className="card om-card mb-3" onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(draft);
        }}>
          <div className="card-body row g-2 align-items-end">
            <div className="col-md-3">
              <label className="form-label small fw-semibold">Search</label>
              <input className="form-control form-control-sm" value={draft.search} onChange={(event) => setDraft((value) => ({ ...value, search: event.target.value }))} />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-semibold">Brand</label>
              <select className="form-select form-select-sm" value={draft.brand} onChange={(event) => setDraft((value) => ({ ...value, brand: event.target.value }))}>
                <option value="all">All Brands</option>
                {(filters.brands || []).map((brand) => <option key={brand}>{brand}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-semibold">Vendor</label>
              <select className="form-select form-select-sm" value={draft.vendor} onChange={(event) => setDraft((value) => ({ ...value, vendor: event.target.value }))}>
                <option value="all">All Vendors</option>
                {(filters.vendors || []).map((vendor) => <option key={vendor}>{vendor}</option>)}
              </select>
            </div>
            <div className="col-md-3 d-flex gap-2">
              <button className="btn btn-primary btn-sm flex-grow-1">Apply</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => {
                const cleared = { search: "", brand: "all", vendor: "all" };
                setDraft(cleared);
                setQuery(cleared);
                setPage(1);
              }}>Clear</button>
            </div>
          </div>
        </form>

        {error && <div className="alert alert-danger">{error}</div>}
        <div className="row g-3">
          <div className="col-md-5">
            <div className="card om-card">
              <div className="card-header">Sample records ({totalRecords})</div>
              <div className="list-group list-group-flush">
                {loading && <div className="p-4 text-center text-secondary">Loading...</div>}
                {!loading && records.length === 0 && <div className="p-4 text-center text-secondary">No records found.</div>}
                {records.map((record) => (
                  <button key={record._id} type="button" className={`list-group-item list-group-item-action text-start ${selected?._id === record._id ? "active" : ""}`} onClick={() => setSelected(record)}>
                    <strong>{record.code}</strong>
                    <div className="small">{record.name || record.description || "No description"}</div>
                    <small>{record.brand} · {getVendorText(record) || "No vendor"}</small>
                  </button>
                ))}
              </div>
              <div className="card-footer d-flex gap-2 align-items-center">
                <button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
                <span className="small flex-grow-1 text-center">Page {page} of {totalPages}</span>
                <select className="form-select form-select-sm w-auto" value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }}>
                  {LIMIT_OPTIONS.map((value) => <option key={value}>{value}</option>)}
                </select>
                <button className="btn btn-outline-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
              </div>
            </div>
          </div>
          <div className="col-md-7">
            <div className="card om-card h-100">
              <div className="card-body">
                {selected ? (
                  <>
                    <h3>{selected.code}</h3>
                    <dl className="row mb-0">
                      <dt className="col-sm-4">Name</dt><dd className="col-sm-8">{selected.name || "—"}</dd>
                      <dt className="col-sm-4">Brand</dt><dd className="col-sm-8">{selected.brand || "—"}</dd>
                      <dt className="col-sm-4">Vendors</dt><dd className="col-sm-8">{getVendorText(selected) || "—"}</dd>
                      <dt className="col-sm-4">Estimated CBM</dt><dd className="col-sm-8">{Number(selected.cbm || 0).toFixed(2)}</dd>
                      <dt className="col-sm-4">Description</dt><dd className="col-sm-8">{selected.description || "—"}</dd>
                      <dt className="col-sm-4">Last updated</dt><dd className="col-sm-8">{formatDateDDMMYYYY(selected.updatedAt)}</dd>
                    </dl>
                  </>
                ) : <div className="text-center text-secondary py-5">Select a sample record.</div>}
              </div>
            </div>
          </div>
        </div>
      </main>
      {showCreate && (
        <SampleCreateModal
          isWorkflow
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
    </>
  );
};

export default SampleWorkflowPage;
