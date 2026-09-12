import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import ProductAnalyticsTable from "../components/ProductAnalyticsTable";
import ReportInfoBanner from "../components/ReportInfoBanner";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const parseLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};
const normalizeFilterParam = (value, fallback = "all") => String(value || "").trim() || fallback;
const normalizeSearchParam = (value) => String(value || "").trim();

const ProductAnalytics = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [draftSearchInput, setDraftSearchInput] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [draftBrandFilter, setDraftBrandFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [draftVendorFilter, setDraftVendorFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/items/product-analytics", {
        params: { search: searchInput, brand: brandFilter, vendor: vendorFilter, page, limit },
      });
      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setTotalPages(Number(response?.data?.pagination?.totalPages || 1));
      setTotalRecords(Number(response?.data?.pagination?.totalRecords || 0));
      setFilters({
        brands: Array.isArray(response?.data?.filters?.brands) ? response.data.filters.brands : [],
        vendors: Array.isArray(response?.data?.filters?.vendors) ? response.data.filters.vendors : [],
      });
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Failed to load product analytics");
      setRows([]);
      setTotalPages(1);
      setTotalRecords(0);
      setFilters({ brands: [], vendors: [] });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, limit, page, searchInput, vendorFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter));
    setVendorFilter(normalizeFilterParam(draftVendorFilter));
  };
  const clearFilters = () => {
    setPage(1);
    setDraftSearchInput("");
    setDraftBrandFilter("all");
    setDraftVendorFilter("all");
    setSearchInput("");
    setBrandFilter("all");
    setVendorFilter("all");
  };

  return <>
    <Navbar />
    <div className="page-shell py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>Back</button>
        <h2 className="h4 mb-0">Product Analytics</h2>
        <span className="d-none d-md-inline" />
      </div>
      <ReportInfoBanner
        description="Evaluates historical item performance based on order quantities, inspection times, rejection rates, and shipping times."
        dataShown="Item codes, PO counts, order/passed quantities, average inspection duration, average rejection rate, and average shipping lead times."
        howItWorks="Compiles analytical metrics grouped by item code. Filterable by search text, brand, and vendor. Rows expand to show PO-level details."
      />
      <div className="card om-card mb-3"><div className="card-body"><form className="row g-2 align-items-end" onSubmit={applyFilters}>
        <div className="col-md-4"><label className="form-label">Search Item Code</label><input type="text" className="form-control" value={draftSearchInput} placeholder="Search item code or PO" onChange={(event) => setDraftSearchInput(event.target.value)} /></div>
        <div className="col-md-3"><label className="form-label">Brand</label><select className="form-select" value={draftBrandFilter} onChange={(event) => setDraftBrandFilter(event.target.value)}><option value="all">All Brands</option>{filters.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></div>
        <div className="col-md-3"><label className="form-label">Vendor</label><select className="form-select" value={draftVendorFilter} onChange={(event) => setDraftVendorFilter(event.target.value)}><option value="all">All Vendors</option>{filters.vendors.map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select></div>
        <div className="col-md-2 d-flex gap-2"><button type="submit" className="btn btn-primary flex-fill">Apply</button><button type="button" className="btn btn-outline-secondary flex-fill" onClick={clearFilters}>Clear</button></div>
      </form></div></div>
      <div className="card om-card mb-3"><div className="card-body d-flex flex-wrap gap-2"><span className="om-summary-chip">Records: {totalRecords}</span><span className="om-summary-chip">Page: {page}</span><span className="om-summary-chip">Limit: {limit}</span></div></div>
      {error && <div className="alert alert-danger mb-3" role="alert">{error}</div>}
      <div className="card om-card"><div className="card-body p-0">{loading ? <div className="text-center py-4">Loading...</div> : <ProductAnalyticsTable rows={rows} />}</div></div>
      <div className="d-flex justify-content-center align-items-center gap-3 mt-3"><button type="button" className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Prev</button><span className="small fw-semibold">Page {page} of {totalPages}</span><button type="button" className="btn btn-outline-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button></div>
      <div className="d-flex justify-content-end mt-3"><div className="input-group om-limit-control"><span className="input-group-text">Limit</span><select className="form-select" value={limit} onChange={(event) => { setPage(1); setLimit(parseLimit(event.target.value)); }}>{LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div></div>
    </div>
  </>;
};

export default ProductAnalytics;
