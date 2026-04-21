import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import { formatCbm } from "../utils/cbm";
import "../App.css";

const DEFAULT_SORT_BY = "po";
const DEFAULT_SORT_ORDER = "asc";
const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const normalizeFilterValue = (value, fallback = "all") => {
  const normalized = String(value || "").trim();
  return normalized || fallback;
};

const parseSortBy = (value) => {
  const normalized = String(value || "").trim();
  const allowed = new Set([
    "po",
    "brand",
    "vendor",
    "itemCode",
    "orderQuantity",
    "packedQuantity",
    "totalCbm",
  ]);
  return allowed.has(normalized) ? normalized : DEFAULT_SORT_BY;
};

const parseSortOrder = (value) =>
  String(value || "").trim().toLowerCase() === "desc" ? "desc" : "asc";

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const buildFilterStateFromSearchParams = (params) => ({
  brand: normalizeFilterValue(params.get("brand")),
  vendor: normalizeFilterValue(params.get("vendor")),
  po: normalizeFilterValue(params.get("po")),
});

const PackedGoods = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "packed-goods");

  const initialFilters = buildFilterStateFromSearchParams(searchParams);
  const initialSortBy = parseSortBy(searchParams.get("sort_by"));
  const initialSortOrder = parseSortOrder(searchParams.get("sort_order"));

  const [rows, setRows] = useState([]);
  const [filterOptions, setFilterOptions] = useState({
    brands: [],
    vendors: [],
    order_ids: [],
  });
  const [summary, setSummary] = useState({
    total_rows: 0,
    total_packed_quantity: 0,
    total_cbm: 0,
  });
  const [draftBrand, setDraftBrand] = useState(initialFilters.brand);
  const [draftVendor, setDraftVendor] = useState(initialFilters.vendor);
  const [draftPo, setDraftPo] = useState(initialFilters.po);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() =>
    parseLimit(searchParams.get("limit")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncedQuery, setSyncedQuery] = useState(null);

  const fetchPackedGoods = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/orders/packed-goods", {
        params: {
          brand: appliedFilters.brand === "all" ? "" : appliedFilters.brand,
          vendor: appliedFilters.vendor === "all" ? "" : appliedFilters.vendor,
          order_id: appliedFilters.po === "all" ? "" : appliedFilters.po,
        },
      });

      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setFilterOptions({
        brands: Array.isArray(response?.data?.filters?.brands)
          ? response.data.filters.brands
          : [],
        vendors: Array.isArray(response?.data?.filters?.vendors)
          ? response.data.filters.vendors
          : [],
        order_ids: Array.isArray(response?.data?.filters?.order_ids)
          ? response.data.filters.order_ids
          : [],
      });
      setSummary({
        total_rows: Number(response?.data?.summary?.total_rows || 0),
        total_packed_quantity: Number(
          response?.data?.summary?.total_packed_quantity || 0,
        ),
        total_cbm: Number(response?.data?.summary?.total_cbm || 0),
      });
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.message || "Failed to load packed goods.",
      );
      setRows([]);
      setFilterOptions({ brands: [], vendors: [], order_ids: [] });
      setSummary({
        total_rows: 0,
        total_packed_quantity: 0,
        total_cbm: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [appliedFilters.brand, appliedFilters.po, appliedFilters.vendor]);

  useEffect(() => {
    fetchPackedGoods();
  }, [fetchPackedGoods]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    const nextFilters = buildFilterStateFromSearchParams(searchParams);
    const nextSortBy = parseSortBy(searchParams.get("sort_by"));
    const nextSortOrder = parseSortOrder(searchParams.get("sort_order"));
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setDraftBrand((prev) => (prev === nextFilters.brand ? prev : nextFilters.brand));
    setDraftVendor((prev) => (prev === nextFilters.vendor ? prev : nextFilters.vendor));
    setDraftPo((prev) => (prev === nextFilters.po ? prev : nextFilters.po));
    setAppliedFilters((prev) =>
      prev.brand === nextFilters.brand &&
      prev.vendor === nextFilters.vendor &&
      prev.po === nextFilters.po
        ? prev
        : nextFilters,
    );
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (appliedFilters.brand !== "all") next.set("brand", appliedFilters.brand);
    if (appliedFilters.vendor !== "all") next.set("vendor", appliedFilters.vendor);
    if (appliedFilters.po !== "all") next.set("po", appliedFilters.po);
    if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
    if (sortOrder !== DEFAULT_SORT_ORDER) next.set("sort_order", sortOrder);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    appliedFilters.brand,
    appliedFilters.po,
    appliedFilters.vendor,
    searchParams,
    setSearchParams,
    sortBy,
    sortOrder,
    page,
    limit,
    syncedQuery,
  ]);

  const availableDraftVendors = useMemo(() => {
    if (draftBrand === "all") {
      return filterOptions.vendors;
    }

    return Array.from(
      new Set(
        rows
          .filter((row) => String(row?.brand || "").trim() === draftBrand)
          .map((row) => String(row?.vendor || "").trim())
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }, [draftBrand, filterOptions.vendors, rows]);

  const availableDraftPos = useMemo(() => {
    if (
      draftBrand === appliedFilters.brand &&
      draftVendor === appliedFilters.vendor
    ) {
      return [...filterOptions.order_ids].sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
      );
    }

    const matchesDraftFilters = (row) => {
      const rowBrand = String(row?.brand || "").trim();
      const rowVendor = String(row?.vendor || "").trim();
      if (draftBrand !== "all" && rowBrand !== draftBrand) return false;
      if (draftVendor !== "all" && rowVendor !== draftVendor) return false;
      return true;
    };

    const rowOptions = Array.from(
      new Set(
        rows
          .filter(matchesDraftFilters)
          .map((row) => String(row?.order_id || "").trim())
          .filter(Boolean),
      ),
    );

    const sourceOptions = rowOptions.length > 0 ? rowOptions : filterOptions.order_ids;

    return [...sourceOptions].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [
    appliedFilters.brand,
    appliedFilters.vendor,
    draftBrand,
    draftVendor,
    filterOptions.order_ids,
    rows,
  ]);

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (row, column) => {
          if (column === "po") return row?.order_id;
          if (column === "brand") return row?.brand;
          if (column === "vendor") return row?.vendor;
          if (column === "itemCode") return row?.item_code;
          if (column === "orderQuantity") return Number(row?.order_quantity || 0);
          if (column === "packedQuantity") return Number(row?.packed_quantity || 0);
          if (column === "totalCbm") return Number(row?.total_cbm || 0);
          return "";
        },
      }),
    [rows, sortBy, sortOrder],
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedRows.length / limit)),
    [sortedRows.length, limit],
  );

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const paginatedRows = useMemo(() => {
    const startIndex = (page - 1) * limit;
    return sortedRows.slice(startIndex, startIndex + limit);
  }, [limit, page, sortedRows]);

  const hasPendingFilterChanges =
    draftBrand !== appliedFilters.brand ||
    draftVendor !== appliedFilters.vendor ||
    draftPo !== appliedFilters.po;

  const handleSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        sortBy,
        sortOrder,
        column,
        defaultDirection,
      );
      setPage(1);
      setSortBy(nextSortState.sortBy);
      setSortOrder(nextSortState.sortOrder);
    },
    [sortBy, sortOrder],
  );

  const handleDraftBrandChange = useCallback((event) => {
    setDraftBrand(event.target.value);
    setDraftVendor("all");
    setDraftPo("all");
  }, []);

  const handleDraftVendorChange = useCallback((event) => {
    setDraftVendor(event.target.value);
    setDraftPo("all");
  }, []);

  const handleApplyFilters = useCallback(() => {
    setPage(1);
    setAppliedFilters({
      brand: draftBrand,
      vendor:
        draftVendor !== "all" && !availableDraftVendors.includes(draftVendor)
          ? "all"
          : draftVendor,
      po:
        draftPo !== "all" && !availableDraftPos.includes(draftPo)
          ? "all"
          : draftPo,
    });
  }, [availableDraftPos, availableDraftVendors, draftBrand, draftPo, draftVendor]);

  const handleClearFilters = useCallback(() => {
    const clearedFilters = { brand: "all", vendor: "all", po: "all" };
    setPage(1);
    setDraftBrand(clearedFilters.brand);
    setDraftVendor(clearedFilters.vendor);
    setDraftPo(clearedFilters.po);
    setAppliedFilters(clearedFilters);
  }, []);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <div>
            <h2 className="h4 mb-1">Packed Goods</h2>
            <p className="text-secondary mb-0">
              Items inspected and packed, but not yet shipped.
            </p>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Rows: {summary.total_rows}</span>
            <span className="om-summary-chip">
              Packed Qty: {summary.total_packed_quantity}
            </span>
            <span className="om-summary-chip">
              Total CBM: {formatCbm(summary.total_cbm)}
            </span>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="packed-goods-filter-bar">
              <div className="packed-goods-filter-field">
                <label className="form-label small mb-1">Brand</label>
                <select
                  className="form-select form-select-sm"
                  value={draftBrand}
                  onChange={handleDraftBrandChange}
                >
                  <option value="all">All Brands</option>
                  {filterOptions.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="packed-goods-filter-field">
                <label className="form-label small mb-1">Vendor</label>
                <select
                  className="form-select form-select-sm"
                  value={draftVendor}
                  onChange={handleDraftVendorChange}
                >
                  <option value="all">All Vendors</option>
                  {availableDraftVendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="packed-goods-filter-field packed-goods-filter-field--po">
                <label className="form-label small mb-1">PO</label>
                <select
                  className="form-select form-select-sm"
                  value={draftPo}
                  onChange={(event) => setDraftPo(event.target.value)}
                >
                  <option value="all">All POs</option>
                  {availableDraftPos.map((po) => (
                    <option key={po} value={po}>
                      {po}
                    </option>
                  ))}
                </select>
              </div>

              <div className="packed-goods-filter-field packed-goods-filter-field--limit">
                <label className="form-label small mb-1">Rows</label>
                <select
                  className="form-select form-select-sm"
                  value={limit}
                  onChange={(event) => {
                    setLimit(parseLimit(event.target.value));
                    setPage(1);
                  }}
                  disabled={loading}
                >
                  {LIMIT_OPTIONS.map((limitOption) => (
                    <option key={limitOption} value={limitOption}>
                      {limitOption}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-sm packed-goods-filter-button"
                onClick={handleApplyFilters}
                disabled={loading || !hasPendingFilterChanges}
              >
                Apply Filters
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm packed-goods-filter-button"
                onClick={handleClearFilters}
                disabled={
                  loading
                  || (
                    draftBrand === "all"
                    && draftVendor === "all"
                    && draftPo === "all"
                    && appliedFilters.brand === "all"
                    && appliedFilters.vendor === "all"
                    && appliedFilters.po === "all"
                  )
                }
              >
                Clear Filters
              </button>
            </div>
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
                          label="PO"
                          isActive={sortBy === "po"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("po", "asc")}
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
                          label="Item code"
                          isActive={sortBy === "itemCode"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("itemCode", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Order Quantity"
                          isActive={sortBy === "orderQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("orderQuantity", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Packed Quantity"
                          isActive={sortBy === "packedQuantity"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("packedQuantity", "desc")}
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
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-4">
                          No packed goods found.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row) => (
                        <tr
                          key={row?.id || `${row?.order_id}-${row?.item_code}`}
                          className={row?.po_has_no_pending_quantity ? "om-report-success-row" : ""}
                        >
                          <td>{row?.order_id || "N/A"}</td>
                          <td>{row?.brand || "N/A"}</td>
                          <td>{row?.vendor || "N/A"}</td>
                          <td>{row?.item_code || "N/A"}</td>
                          <td>{Number(row?.order_quantity || 0)}</td>
                          <td>{Number(row?.packed_quantity || 0)}</td>
                          <td>{formatCbm(row?.total_cbm)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!loading && sortedRows.length > 0 && (
            <div className="card-footer bg-transparent d-flex flex-wrap justify-content-between align-items-center gap-2">
              <span className="text-secondary small">
                Showing {(page - 1) * limit + 1}
                {" - "}
                {Math.min(page * limit, sortedRows.length)} of {sortedRows.length}
              </span>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </button>
                <span className="small text-secondary">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default PackedGoods;
