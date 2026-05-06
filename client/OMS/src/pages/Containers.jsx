import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const normalizeSearchParam = (value) => String(value || "").trim();

const normalizeFilterParam = (value, fallback = "all") => {
  const cleaned = String(value || "").trim();
  if (!cleaned) return fallback;
  return cleaned;
};

const normalizeDateParam = (value) => toISODateString(value) || "";

const CHECKED_STATUS_SORT_ORDER = {
  Checked: 0,
  "Partially Checked": 1,
  "Checking Pending": 2,
};

const getCheckedStatusClassName = (status) => {
  if (status === "Checked") return "text-success fw-semibold";
  if (status === "Partially Checked") return "text-warning fw-semibold";
  return "text-secondary fw-semibold";
};

const Containers = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "containers-list");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [containerSearch, setContainerSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [draftContainerSearch, setDraftContainerSearch] = useState(() =>
    normalizeSearchParam(searchParams.get("container")),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [draftVendorFilter, setDraftVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [checkedStatusFilter, setCheckedStatusFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("checked_status"), "all"),
  );
  const [draftCheckedStatusFilter, setDraftCheckedStatusFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("checked_status"), "all"),
  );
  const [fromDateFilter, setFromDateFilter] = useState(() =>
    normalizeDateParam(searchParams.get("from_date") || searchParams.get("fromDate")),
  );
  const [draftFromDateFilter, setDraftFromDateFilter] = useState(() =>
    normalizeDateParam(searchParams.get("from_date") || searchParams.get("fromDate")),
  );
  const [toDateFilter, setToDateFilter] = useState(() =>
    normalizeDateParam(searchParams.get("to_date") || searchParams.get("toDate")),
  );
  const [draftToDateFilter, setDraftToDateFilter] = useState(() =>
    normalizeDateParam(searchParams.get("to_date") || searchParams.get("toDate")),
  );
  const [summary, setSummary] = useState({ total: 0 });
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [filterOptions, setFilterOptions] = useState({
    brands: [],
    vendors: [],
    containers: [],
  });
  const [sortBy, setSortBy] = useState("container");
  const [sortOrder, setSortOrder] = useState("asc");

  const fetchContainers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/orders/containers", {
        params: {
          container: containerSearch,
          vendor: vendorFilter,
          brand: brandFilter,
          checked_status: checkedStatusFilter,
          from_date: fromDateFilter,
          to_date: toDateFilter,
        },
      });

      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setSummary(response?.data?.summary || { total: 0 });
      setFilterOptions({
        brands: Array.isArray(response?.data?.filters?.brands)
          ? response.data.filters.brands
          : [],
        vendors: Array.isArray(response?.data?.filters?.vendors)
          ? response.data.filters.vendors
          : [],
        containers: Array.isArray(response?.data?.filters?.containers)
          ? response.data.filters.containers
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load containers.");
      setRows([]);
      setSummary({ total: 0 });
      setFilterOptions({
        brands: [],
        vendors: [],
        containers: [],
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, checkedStatusFilter, containerSearch, fromDateFilter, toDateFilter, vendorFilter]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextContainerSearch = normalizeSearchParam(searchParams.get("container"));
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextCheckedStatusFilter = normalizeFilterParam(searchParams.get("checked_status"), "all");
    const nextFromDateFilter = normalizeDateParam(
      searchParams.get("from_date") || searchParams.get("fromDate"),
    );
    const nextToDateFilter = normalizeDateParam(
      searchParams.get("to_date") || searchParams.get("toDate"),
    );

    setContainerSearch((prev) =>
      prev === nextContainerSearch ? prev : nextContainerSearch,
    );
    setDraftContainerSearch((prev) =>
      prev === nextContainerSearch ? prev : nextContainerSearch,
    );
    setVendorFilter((prev) =>
      prev === nextVendorFilter ? prev : nextVendorFilter,
    );
    setDraftVendorFilter((prev) =>
      prev === nextVendorFilter ? prev : nextVendorFilter,
    );
    setBrandFilter((prev) =>
      prev === nextBrandFilter ? prev : nextBrandFilter,
    );
    setDraftBrandFilter((prev) =>
      prev === nextBrandFilter ? prev : nextBrandFilter,
    );
    setCheckedStatusFilter((prev) =>
      prev === nextCheckedStatusFilter ? prev : nextCheckedStatusFilter,
    );
    setDraftCheckedStatusFilter((prev) =>
      prev === nextCheckedStatusFilter ? prev : nextCheckedStatusFilter,
    );
    setFromDateFilter((prev) =>
      prev === nextFromDateFilter ? prev : nextFromDateFilter,
    );
    setDraftFromDateFilter((prev) =>
      prev === nextFromDateFilter ? prev : nextFromDateFilter,
    );
    setToDateFilter((prev) =>
      prev === nextToDateFilter ? prev : nextToDateFilter,
    );
    setDraftToDateFilter((prev) =>
      prev === nextToDateFilter ? prev : nextToDateFilter,
    );
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const containerValue = normalizeSearchParam(containerSearch);

    if (containerValue) next.set("container", containerValue);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (checkedStatusFilter && checkedStatusFilter !== "all") next.set("checked_status", checkedStatusFilter);
    if (fromDateFilter) next.set("from_date", fromDateFilter);
    if (toDateFilter) next.set("to_date", toDateFilter);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    checkedStatusFilter,
    containerSearch,
    fromDateFilter,
    searchParams,
    setSearchParams,
    syncedQuery,
    toDateFilter,
    vendorFilter,
  ]);

  const handleOpenShipments = useCallback(
    (containerNumber) => {
      const normalizedContainer = String(containerNumber || "").trim();
      if (!normalizedContainer) return;

      navigate({
        pathname: "/shipments",
        search: `?container=${encodeURIComponent(normalizedContainer)}`,
      });
    },
    [navigate],
  );

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        sortBy,
        sortOrder,
        column,
        defaultDirection,
      );
      setSortBy(nextSortState.sortBy);
      setSortOrder(nextSortState.sortOrder);
    },
    [sortBy, sortOrder],
  );

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setContainerSearch(normalizeSearchParam(draftContainerSearch));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setCheckedStatusFilter(normalizeFilterParam(draftCheckedStatusFilter, "all"));
    setFromDateFilter(normalizeDateParam(draftFromDateFilter));
    setToDateFilter(normalizeDateParam(draftToDateFilter));
  };

  const handleClearFilters = () => {
    setDraftContainerSearch("");
    setDraftVendorFilter("all");
    setDraftBrandFilter("all");
    setDraftCheckedStatusFilter("all");
    setDraftFromDateFilter("");
    setDraftToDateFilter("");
    setContainerSearch("");
    setVendorFilter("all");
    setBrandFilter("all");
    setCheckedStatusFilter("all");
    setFromDateFilter("");
    setToDateFilter("");
  };

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (row, column) => {
          if (column === "container") return row?.container;
          if (column === "brand") return row?.brand;
          if (column === "vendor") return row?.vendor;
          if (column === "shippingDate") return new Date(row?.shipping_date || 0).getTime();
          if (column === "checkedStatus") {
            return CHECKED_STATUS_SORT_ORDER[row?.checked_status] ?? 99;
          }
          if (column === "itemCount") return Number(row?.item_count || 0);
          if (column === "totalQuantity") return Number(row?.total_quantity || 0);
          if (column === "totalCbm") return Number(row?.total_cbm || 0);
          return "";
        },
      }),
    [rows, sortBy, sortOrder],
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
          <h2 className="h4 mb-0">Containers</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={fetchContainers}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-2">
                <label className="form-label">Search by Container</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftContainerSearch}
                  list="containers-page-container-options"
                  onChange={(event) => setDraftContainerSearch(event.target.value)}
                  placeholder="Enter container number"
                />
                <datalist id="containers-page-container-options">
                  {filterOptions.containers.map((containerValue) => (
                    <option key={containerValue} value={containerValue} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-2">
                <label className="form-label">Filter by Vendor</label>
                <select
                  className="form-select"
                  value={draftVendorFilter}
                  onChange={(event) => setDraftVendorFilter(event.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filterOptions.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Filter by Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(event) => setDraftBrandFilter(event.target.value)}
                >
                  <option value="all">All Brands</option>
                  {filterOptions.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">Checked Status</label>
                <select
                  className="form-select"
                  value={draftCheckedStatusFilter}
                  onChange={(event) => setDraftCheckedStatusFilter(event.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="checked">Checked</option>
                  <option value="partially checked">Partially Checked</option>
                  <option value="checking pending">Checking Pending</option>
                </select>
              </div>
              <div className="col-md-2">
                <label className="form-label">From Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={draftFromDateFilter}
                  onChange={(event) =>
                    setDraftFromDateFilter(normalizeDateParam(event.target.value))
                  }
                />
              </div>
              <div className="col-md-2">
                <label className="form-label">To Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={draftToDateFilter}
                  onChange={(event) =>
                    setDraftToDateFilter(normalizeDateParam(event.target.value))
                  }
                />
              </div>
              <div className="col-md-2 d-flex gap-2">
                <button type="submit" className="btn btn-primary flex-fill">
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary flex-fill"
                  onClick={handleClearFilters}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Total Containers: {summary?.total ?? 0}</span>
            <span className="om-summary-chip">
              From: {fromDateFilter ? formatDateDDMMYYYY(fromDateFilter, fromDateFilter) : "all"}
            </span>
            <span className="om-summary-chip">
              To: {toDateFilter ? formatDateDDMMYYYY(toDateFilter, toDateFilter) : "all"}
            </span>
            <span className="om-summary-chip">Checked: {summary?.checked ?? 0}</span>
            <span className="om-summary-chip">
              Partially Checked: {summary?.partially_checked ?? 0}
            </span>
            <span className="om-summary-chip">
              Checking Pending: {summary?.checking_pending ?? 0}
            </span>
            <span className="om-summary-chip">Total CBM: {summary?.total_cbm ?? 0}</span>
            <span className="om-summary-chip">
              Showing: {rows.length} {rows.length === 1 ? "container" : "containers"}
            </span>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading...</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0">
                  <thead className="table-primary">
                    <tr>
                      <th>
                        <SortHeaderButton
                          label="Container"
                          isActive={sortBy === "container"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("container", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Brand"
                          isActive={sortBy === "brand"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("brand", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Vendor"
                          isActive={sortBy === "vendor"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendor", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Shipping Date"
                          isActive={sortBy === "shippingDate"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("shippingDate", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Checked Status"
                          isActive={sortBy === "checkedStatus"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("checkedStatus", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Item Count"
                          isActive={sortBy === "itemCount"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("itemCount", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Total Quantity"
                          isActive={sortBy === "totalQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("totalQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Total CBM"
                          isActive={sortBy === "totalCbm"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("totalCbm", "desc")}
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="text-center py-4">
                          No containers found
                        </td>
                      </tr>
                    ) : (
                      sortedRows.map((row) => (
                        <tr
                          key={row.container}
                          className="table-clickable"
                          onClick={() => handleOpenShipments(row.container)}
                          title="Open shipments filtered by this container"
                        >
                          <td>{row.container || "N/A"}</td>
                          <td>{row.brand || "N/A"}</td>
                          <td>{row.vendor || "N/A"}</td>
                          <td>{formatDateDDMMYYYY(row.shipping_date)}</td>
                          <td>
                            <span className={getCheckedStatusClassName(row.checked_status)}>
                              {row.checked_status || "Checking Pending"}
                            </span>
                          </td>
                          <td>{row.item_count ?? 0}</td>
                          <td>{row.total_quantity ?? 0}</td>
                          <td>{(Number(row.total_cbm) ?? 0).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Containers;
