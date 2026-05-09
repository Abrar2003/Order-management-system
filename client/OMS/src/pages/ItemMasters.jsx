import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  return cleaned || fallback;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const formatText = (value, fallback = "-") => {
  const cleaned = String(value || "").trim();
  return cleaned || fallback;
};

const getBrand = (item = {}) =>
  formatText(
    item?.brand_name ||
      item?.brand ||
      (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : ""),
  );

const getVendors = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.filter(Boolean).join(", ")
    : "-";

const getProductType = (item = {}) =>
  formatText(item?.product_type?.label || item?.product_type?.key || "");

const formatNumber = (value, decimals = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "-";
  return parsed.toFixed(decimals).replace(/\.?0+$/, "");
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatRemark = (entry = {}, fallback = "Entry") => {
  const raw = String(entry?.remark || entry?.box_type || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "base") return "Base";
  if (raw === "top") return "Top";
  if (raw === "inner") return "Inner Carton";
  if (raw === "master") return "Master Carton";
  return raw.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const formatBoxMode = (mode = "") => {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "carton") return "Inner + Master Carton";
  return "Individual Boxes";
};

const hasEntryValue = (entry = {}, weightKey = "") => {
  const hasSize =
    Number(entry?.L || 0) > 0 ||
    Number(entry?.B || 0) > 0 ||
    Number(entry?.H || 0) > 0;
  const hasWeight = weightKey ? Number(entry?.[weightKey] || 0) > 0 : false;
  const hasCount =
    Number(entry?.item_count_in_inner || 0) > 0 ||
    Number(entry?.box_count_in_master || 0) > 0;
  return hasSize || hasWeight || hasCount || Boolean(String(entry?.remark || "").trim());
};

const normalizeEntries = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry === "object")
    .filter((entry) => hasEntryValue(entry, weightKey));

const resolveItemSizeEntries = (item = {}) => {
  const masterEntries = normalizeEntries(item?.master_item_sizes, "net_weight");
  if (masterEntries.length > 0) return masterEntries;
  return normalizeEntries(item?.pis_item_sizes, "net_weight");
};

const resolveBoxSizeData = (item = {}) => {
  const masterEntries = normalizeEntries(item?.master_box_sizes, "gross_weight");
  if (masterEntries.length > 0) {
    return {
      entries: masterEntries,
      mode: item?.master_box_mode,
    };
  }

  return {
    entries: normalizeEntries(item?.pis_box_sizes, "gross_weight"),
    mode: item?.pis_box_mode,
  };
};

const renderSizeEntries = (entries = [], { weightKey = "", emptyLabel = "No master sizes saved" } = {}) => {
  const normalizedEntries = normalizeEntries(entries, weightKey);
  if (normalizedEntries.length === 0) {
    return <span className="text-secondary">{emptyLabel}</span>;
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0">
        <thead>
          <tr>
            <th>Part</th>
            <th>L x B x H</th>
            <th>Weight</th>
            <th>Counts</th>
          </tr>
        </thead>
        <tbody>
          {normalizedEntries.map((entry, index) => (
            <tr key={`${entry?.remark || entry?.box_type || "entry"}-${index}`}>
              <td>{formatRemark(entry, `Entry ${index + 1}`)}</td>
              <td>
                {formatNumber(entry?.L)} x {formatNumber(entry?.B)} x {formatNumber(entry?.H)}
              </td>
              <td>{formatNumber(entry?.[weightKey], 3)}</td>
              <td>
                {Number(entry?.item_count_in_inner || 0) > 0 && (
                  <span className="me-2">Inner: {formatNumber(entry.item_count_in_inner, 0)}</span>
                )}
                {Number(entry?.box_count_in_master || 0) > 0 && (
                  <span>Master: {formatNumber(entry.box_count_in_master, 0)}</span>
                )}
                {Number(entry?.item_count_in_inner || 0) <= 0 &&
                  Number(entry?.box_count_in_master || 0) <= 0 &&
                  "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ItemMasters = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "item-masters");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [draftSearchInput, setDraftSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });

  const fetchItemMasters = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/items/masters", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          page,
          limit,
        },
      });

      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setTotalPages(Number(response?.data?.pagination?.totalPages || 1));
      setTotalRecords(Number(response?.data?.pagination?.totalRecords || 0));
      setFilters({
        brands: Array.isArray(response?.data?.filters?.brands)
          ? response.data.filters.brands
          : [],
        vendors: Array.isArray(response?.data?.filters?.vendors)
          ? response.data.filters.vendors
          : [],
      });
    } catch (fetchError) {
      setError(fetchError?.response?.data?.message || "Failed to fetch item masters.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, limit, page, searchInput, vendorFilter]);

  useEffect(() => {
    fetchItemMasters();
  }, [fetchItemMasters]);

  useEffect(() => {
    const next = new URLSearchParams();
    const normalizedSearch = normalizeSearchParam(searchInput);
    if (normalizedSearch) next.set("search", normalizedSearch);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [brandFilter, limit, page, searchInput, searchParams, setSearchParams, vendorFilter]);

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
  }, [draftBrandFilter, draftSearchInput, draftVendorFilter]);

  const handleClearFilters = useCallback(() => {
    setPage(1);
    setSearchInput("");
    setDraftSearchInput("");
    setBrandFilter("all");
    setDraftBrandFilter("all");
    setVendorFilter("all");
    setDraftVendorFilter("all");
  }, []);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 className="h4 mb-1">Item Masters</h2>
            <div className="text-secondary small">
              {totalRecords} item records
            </div>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-lg-4 col-md-6">
                <label className="form-label">Search</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftSearchInput}
                  placeholder="Code, name, or description"
                  onChange={(event) => setDraftSearchInput(event.target.value)}
                />
              </div>

              <div className="col-lg-3 col-md-6">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                >
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-lg-3 col-md-6">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-lg-2 col-md-6 d-flex gap-2">
                <button type="submit" className="btn btn-primary flex-fill">
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={handleClearFilters}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Details</th>
                    <th>Item Sizes</th>
                    <th>Box Sizes</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="text-center text-secondary py-4">
                        Loading...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center text-secondary py-4">
                        No items found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((item) => {
                      const boxSizeData = resolveBoxSizeData(item);

                      return (
                        <tr key={item?._id || item?.code}>
                          <td>
                            <div className="fw-semibold">{formatText(item?.code)}</div>
                            <div className="small text-secondary">
                              {formatText(item?.description || item?.name)}
                            </div>
                          </td>
                          <td>
                            <div>{getBrand(item)}</div>
                            <div className="small text-secondary">{getVendors(item)}</div>
                            <div className="small text-secondary">
                              {getProductType(item)}
                              {item?.country_of_origin
                                ? ` - Origin: ${item.country_of_origin}`
                                : ""}
                            </div>
                            {item?.pis_checked_flag === true && (
                              <span className="badge text-bg-success mt-1">PIS Checked</span>
                            )}
                          </td>
                          <td>
                            {renderSizeEntries(resolveItemSizeEntries(item), {
                              weightKey: "net_weight",
                              emptyLabel: "No item sizes saved",
                            })}
                          </td>
                          <td>
                            <div className="small text-secondary mb-1">
                              {formatBoxMode(boxSizeData.mode)}
                            </div>
                            {renderSizeEntries(boxSizeData.entries, {
                              weightKey: "gross_weight",
                              emptyLabel: "No box sizes saved",
                            })}
                          </td>
                          <td>{formatDate(item?.updatedAt)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card-footer d-flex flex-wrap align-items-center justify-content-between gap-2">
            <div className="small text-secondary">
              Page {page} of {totalPages}
            </div>
            <div className="d-flex align-items-center gap-2">
              <select
                className="form-select form-select-sm"
                style={{ width: "auto" }}
                value={limit}
                onChange={(event) => {
                  setPage(1);
                  setLimit(parseLimit(event.target.value));
                }}
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option} / page
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages || loading}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ItemMasters;
