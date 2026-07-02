import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SampleCreateModal from "../components/samples/SampleCreateModal";
import { usePermissions } from "../auth/PermissionContext";
import { normalizeUserRole } from "../auth/permissions";
import { listSamples, uploadSampleImage } from "../services/samples.service";
import ProductImageThumbnail from "../components/ProductImageThumbnail";
import EditSampleModal from "../components/EditSampleModal";
import ConvertToItemModal from "../components/samples/ConvertToItemModal";
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

const Samples = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "samples");
  const { role, hasPermission } = usePermissions();
  const canMutate = MUTATION_ROLES.has(normalizeUserRole(role));
  const canUploadImage = canMutate && hasPermission("images_documents", "upload");
  const canConvert = canMutate && hasPermission("items", "create");

  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateWorkflowModal, setShowCreateWorkflowModal] = useState(false);
  const [editingSample, setEditingSample] = useState(null);
  const [convertingSample, setConvertingSample] = useState(null);
  const [uploadingSampleId, setUploadingSampleId] = useState("");
  const fileInputRef = useRef(null);

  const handleFileChange = async (event) => {
    const inputElement = event.target;
    const file = inputElement?.files?.[0];
    if (!file || !uploadingSampleId) {
      if (inputElement) inputElement.value = "";
      return;
    }

    const allowedExtensions = [".jpg", ".jpeg", ".png"];
    const allowedMimeTypes = ["image/jpeg", "image/png"];
    const normalizedName = String(file.name || "").toLowerCase();
    const normalizedType = String(file.type || "").toLowerCase();

    const hasAllowedExtension = allowedExtensions.some((ext) => normalizedName.endsWith(ext));
    const hasAllowedMimeType = allowedMimeTypes.includes(normalizedType);

    if (!hasAllowedExtension || !hasAllowedMimeType) {
      setError("Only JPG, JPEG, and PNG images are allowed.");
      if (inputElement) inputElement.value = "";
      setUploadingSampleId("");
      return;
    }

    try {
      setError("");
      setLoading(true);

      const formData = new FormData();
      formData.append("file_type", "product_image");
      formData.append("file", file);

      await uploadSampleImage(uploadingSampleId, formData);
      await fetchSamples();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to upload image.");
    } finally {
      setLoading(false);
      setUploadingSampleId("");
      if (inputElement) inputElement.value = "";
    }
  };

  const triggerImageUpload = (sampleId) => {
    setUploadingSampleId(sampleId);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 0);
  };
  const [page, setPage] = useState(() => positiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => limitValue(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [query, setQuery] = useState({
    search: clean(searchParams.get("search")),
    brand: clean(searchParams.get("brand")) || "all",
    vendor: clean(searchParams.get("vendor")) || "all",
    date_from: clean(searchParams.get("date_from")),
    date_to: clean(searchParams.get("date_to")),
  });
  const [draft, setDraft] = useState(query);

  const fetchSamples = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await listSamples({
        page,
        limit,
        search: query.search,
        brand: query.brand === "all" ? "" : query.brand,
        vendor: query.vendor === "all" ? "" : query.vendor,
        date_from: query.date_from,
        date_to: query.date_to,
        include_product_image_thumbnail: true,
      });
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
      date_from: clean(searchParams.get("date_from")),
      date_to: clean(searchParams.get("date_to")),
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
      if (!value || value === "all") return;
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
      date_from: "",
      date_to: "",
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
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                Create Sample
              </button>
              <button type="button" className="btn btn-success" onClick={() => setShowCreateWorkflowModal(true)}>
                Create Sample Workflow
              </button>
            </div>
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
                <label className="form-label">From</label>
                <input type="date" className="form-control" value={draft.date_from} onChange={(e) => setDraft((prev) => ({ ...prev, date_from: e.target.value }))} />
              </div>
              <div className="col-md-2">
                <label className="form-label">To</label>
                <input type="date" className="form-control" value={draft.date_to} onChange={(e) => setDraft((prev) => ({ ...prev, date_to: e.target.value }))} />
              </div>
              <div className="col-md-1">
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
                  <th>Image</th>
                  <th>Sample Code</th>
                  <th>Name / Description</th>
                  <th>Brand</th>
                  <th>Vendors</th>
                  <th>CBM</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="8" className="text-center py-4">Loading samples...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan="8" className="text-center py-4 text-secondary">No samples found.</td></tr>
                ) : rows.map((sample) => (
                  <tr key={sample._id}>
                    <td>
                      <ProductImageThumbnail
                        src={sample.product_image_url}
                        originalName={sample.product_image?.originalName}
                        alt={sample.code}
                        size="sm"
                      />
                    </td>
                    <td className="fw-semibold">{sample.code || "-"}</td>
                    <td>
                      <div>{sample.name || "-"}</div>
                      <div className="small text-secondary text-truncate sample-description-cell">{sample.description || ""}</div>
                    </td>
                    <td>{sample.brand || "-"}</td>
                    <td>{Array.isArray(sample.vendors) && sample.vendors.length ? sample.vendors.join(", ") : "-"}</td>
                    <td>{Number(sample.cbm || 0).toFixed(2)}</td>
                    <td>{formatDateDDMMYYYY(sample.updatedAt, "-")}</td>
                    <td className="text-nowrap">
                      <div className="d-flex align-items-center gap-2">
                        {sample.converted_item?.item && (
                          <span className="badge bg-success-subtle text-success border border-success-subtle d-inline-flex align-items-center">
                            Converted (
                            <a
                              href={`/items?search=${encodeURIComponent(sample.converted_item.code)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-decoration-none text-success fw-bold ms-1"
                            >
                              {sample.converted_item.code}
                            </a>
                            )
                          </span>
                        )}
                        {canMutate && (
                          <div className="dropdown">
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm dropdown-toggle"
                              data-bs-toggle="dropdown"
                              data-bs-popper-config='{"strategy":"fixed"}'
                              aria-expanded="false"
                            >
                              Actions
                            </button>
                            <ul className="dropdown-menu dropdown-menu-end shadow">
                              <li>
                                <button
                                  className="dropdown-item"
                                  type="button"
                                  onClick={() => setEditingSample(sample)}
                                >
                                  Edit
                                </button>
                              </li>
                              {canUploadImage && (
                                <li>
                                  <button
                                    className="dropdown-item"
                                    type="button"
                                    onClick={() => triggerImageUpload(sample._id)}
                                  >
                                    Upload Image
                                  </button>
                                </li>
                              )}
                              {!sample.converted_item?.item && canConvert && (
                                <li>
                                  <button
                                    className="dropdown-item"
                                    type="button"
                                    onClick={() => setConvertingSample(sample)}
                                  >
                                    Convert to Item
                                  </button>
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
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
      {showCreateWorkflowModal && (
        <SampleCreateModal
          isWorkflow={true}
          onClose={() => setShowCreateWorkflowModal(false)}
          onSaved={() => {
            setShowCreateWorkflowModal(false);
            fetchSamples();
          }}
        />
      )}
      {editingSample && (
        <EditSampleModal
          sample={editingSample}
          onClose={() => setEditingSample(null)}
          onSuccess={() => {
            setEditingSample(null);
            fetchSamples();
          }}
        />
      )}
      {convertingSample && (
        <ConvertToItemModal
          sample={convertingSample}
          onClose={() => setConvertingSample(null)}
          onConverted={() => {
            setConvertingSample(null);
            fetchSamples();
          }}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="d-none"
        accept=".jpg,.jpeg,.png"
        onChange={handleFileChange}
      />
    </>
  );
};

export default Samples;
