import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import EditPisModal from "../components/EditPisModal";
import SortHeaderButton from "../components/SortHeaderButton";
import { getUserFromToken } from "../auth/auth.utils";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import {
  buildMeasuredSizeEntriesFromLegacy,
  getWeightValueFromModel,
  hasMeaningfulMeasuredSize,
} from "../utils/measuredSizeForm";
import { formatFixedNumber, formatLbhValue } from "../utils/measurementDisplay";
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
  if (!cleaned) return fallback;
  return cleaned;
};

const normalizeSearchParam = (value) => String(value || "").trim();

const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeoutId);
  }, [delay, value]);

  return debounced;
};

const getBrand = (item = {}) =>
  item?.brand_name
  || item?.brand
  || (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "N/A");

const getVendors = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.join(", ")
    : "N/A";

const formatRemarkLabel = (remark = "", fallback = "Value") => {
  const normalized = String(remark || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const buildMeasurementEntries = ({
  item = {},
  source = "pis",
  group = "item",
} = {}) => {
  const isPis = source === "pis";
  const isItemGroup = group === "item";
  const weight = isPis ? item?.pis_weight : item?.inspected_weight;

  return buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: isPis
      ? (isItemGroup ? item?.pis_item_sizes : item?.pis_box_sizes)
      : (isItemGroup ? item?.inspected_item_sizes : item?.inspected_box_sizes),
    singleLbh: isPis
      ? (isItemGroup ? item?.pis_item_LBH : item?.pis_box_LBH)
      : (isItemGroup
          ? item?.inspected_item_LBH
          : item?.inspected_box_LBH),
    topLbh: isPis
      ? (isItemGroup ? item?.pis_item_top_LBH : item?.pis_box_top_LBH)
      : (isItemGroup
          ? item?.inspected_item_top_LBH
          : item?.inspected_box_top_LBH || item?.inspected_top_LBH),
    bottomLbh: isPis
      ? (isItemGroup ? item?.pis_item_bottom_LBH : item?.pis_box_bottom_LBH)
      : (isItemGroup
          ? item?.inspected_item_bottom_LBH
          : item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH),
    totalWeight: getWeightValueFromModel(
      weight,
      isItemGroup ? "total_net" : "total_gross",
    ),
    topWeight: getWeightValueFromModel(
      weight,
      isItemGroup ? "top_net" : "top_gross",
    ),
    bottomWeight: getWeightValueFromModel(
      weight,
      isItemGroup ? "bottom_net" : "bottom_gross",
    ),
    weightKey: isItemGroup ? "net_weight" : "gross_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));
};

const formatMeasurementBlock = (entries = [], fallbackWeight = "Not Set") => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      sizeDisplay: "Not Set",
      weightDisplay: fallbackWeight,
    };
  }

  const sizeDisplay = entries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const sizeValue = formatLbhValue(entry, { fallback: "Not Set" });
      if (entries.length === 1 && !String(entry?.remark || "").trim()) {
        return sizeValue;
      }
      return `${label}: ${sizeValue}`;
    })
    .join(" | ");

  const weightDisplay = entries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      const parsedWeight = Number(entry?.weight || 0);
      const weightValue =
        Number.isFinite(parsedWeight) && parsedWeight > 0
          ? formatFixedNumber(parsedWeight)
          : "Not Set";
      if (entries.length === 1 && !String(entry?.remark || "").trim()) {
        return weightValue;
      }
      return `${label}: ${weightValue}`;
    })
    .join(" | ");

  return {
    sizeDisplay,
    weightDisplay,
  };
};

const MeasurementCell = ({
  item,
  source,
  group,
  weightLabel,
}) => {
  const entries = buildMeasurementEntries({ item, source, group });
  const { sizeDisplay, weightDisplay } = formatMeasurementBlock(entries);

  return (
    <div className="d-flex flex-column gap-1">
      <span>Size: {sizeDisplay}</span>
      <span>{weightLabel}: {weightDisplay}</span>
    </div>
  );
};

const PISDiffs = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "pis-diffs");

  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const canEditPis = ["admin", "manager", "dev"].includes(normalizedRole);

  const [rows, setRows] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState(() =>
    normalizeSearchParam(searchParams.get("search")),
  );
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("brand"), "all"),
  );
  const [vendorFilter, setVendorFilter] = useState(() =>
    normalizeFilterParam(searchParams.get("vendor"), "all"),
  );
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  );
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
    item_codes: [],
  });
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [sortBy, setSortBy] = useState("code");
  const [sortOrder, setSortOrder] = useState("asc");

  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const fetchDiffItems = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await api.get("/items/pis-diffs", {
        params: {
          search: debouncedSearch,
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
        item_codes: Array.isArray(response?.data?.filters?.item_codes)
          ? response.data.filters.item_codes
          : [],
      });
    } catch (fetchError) {
      setError(fetchError?.response?.data?.message || "Failed to load PIS diffs.");
      setRows([]);
      setTotalPages(1);
      setTotalRecords(0);
      setFilters({
        brands: [],
        vendors: [],
        item_codes: [],
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, debouncedSearch, limit, page, vendorFilter]);

  useEffect(() => {
    fetchDiffItems();
  }, [fetchDiffItems]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSearchInput = normalizeSearchParam(searchParams.get("search"));
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setLimit((prev) => (prev === nextLimit ? prev : nextLimit));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    const searchValue = normalizeSearchParam(searchInput);

    if (searchValue) next.set("search", searchValue);
    if (brandFilter && brandFilter !== "all") next.set("brand", brandFilter);
    if (vendorFilter && vendorFilter !== "all") next.set("vendor", vendorFilter);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    limit,
    page,
    searchInput,
    searchParams,
    setSearchParams,
    syncedQuery,
    vendorFilter,
  ]);

  const itemCodeOptions = useMemo(
    () => (Array.isArray(filters.item_codes) ? filters.item_codes : []),
    [filters.item_codes],
  );

  const getMeasurementSortValue = useCallback((item, source, group) => {
    const { sizeDisplay, weightDisplay } = formatMeasurementBlock(
      buildMeasurementEntries({ item, source, group }),
    );
    return `${sizeDisplay} | ${weightDisplay}`;
  }, []);

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

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (item, column) => {
          if (column === "code") return item?.code;
          if (column === "description") return item?.description || item?.name;
          if (column === "brand") return getBrand(item);
          if (column === "vendors") return getVendors(item);
          if (column === "diffs") {
            return (Array.isArray(item?.pis_diff?.fields) ? item.pis_diff.fields : []).join(", ");
          }
          if (column === "inspectedItem") {
            return getMeasurementSortValue(item, "inspected", "item");
          }
          if (column === "pisItem") return getMeasurementSortValue(item, "pis", "item");
          if (column === "inspectedBox") {
            return getMeasurementSortValue(item, "inspected", "box");
          }
          if (column === "pisBox") return getMeasurementSortValue(item, "pis", "box");
          return "";
        },
      }),
    [getMeasurementSortValue, rows, sortBy, sortOrder],
  );

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h4 mb-0">PIS Diffs</h2>
          <span className="text-secondary small">
            Items where inspected measurements differ from PIS
          </span>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-4">
                <label className="form-label">Search (Code / Name / Description)</label>
                <input
                  type="text"
                  className="form-control"
                  value={searchInput}
                  list="pis-diff-item-code-options"
                  placeholder="Search items"
                  onChange={(event) => {
                    setPage(1);
                    setSearchInput(event.target.value);
                  }}
                />
                <datalist id="pis-diff-item-code-options">
                  {itemCodeOptions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>

              <div className="col-md-3">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={brandFilter}
                  onChange={(event) => {
                    setPage(1);
                    setBrandFilter(event.target.value);
                  }}
                >
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-3">
                <label className="form-label">Vendor</label>
                <select
                  className="form-select"
                  value={vendorFilter}
                  onChange={(event) => {
                    setPage(1);
                    setVendorFilter(event.target.value);
                  }}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-2 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setPage(1);
                    setSearchInput("");
                    setBrandFilter("all");
                    setVendorFilter("all");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Records: {totalRecords}</span>
            <span className="om-summary-chip">Page: {page}</span>
            <span className="om-summary-chip">Limit: {limit}</span>
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
                          label="Item Code"
                          isActive={sortBy === "code"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("code", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Description"
                          isActive={sortBy === "description"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("description", "asc")}
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
                          label="Vendors"
                          isActive={sortBy === "vendors"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendors", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Diffs"
                          isActive={sortBy === "diffs"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("diffs", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Inspected Item"
                          isActive={sortBy === "inspectedItem"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("inspectedItem", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Item"
                          isActive={sortBy === "pisItem"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pisItem", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Inspected Box"
                          isActive={sortBy === "inspectedBox"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("inspectedBox", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="PIS Box"
                          isActive={sortBy === "pisBox"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("pisBox", "asc")}
                        />
                      </th>
                      {canEditPis && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan={canEditPis ? 10 : 9} className="text-center py-4">
                          No PIS diffs found
                        </td>
                      </tr>
                    )}

                    {sortedRows.map((item) => (
                      <tr key={item?._id || item?.code}>
                        <td>{item?.code || "N/A"}</td>
                        <td>{item?.description || item?.name || "N/A"}</td>
                        <td>{getBrand(item)}</td>
                        <td>{getVendors(item)}</td>
                        <td>
                          <div className="d-flex flex-wrap gap-1">
                            {(Array.isArray(item?.pis_diff?.fields) ? item.pis_diff.fields : []).map(
                              (field) => (
                                <span key={field} className="badge text-bg-warning">
                                  {field}
                                </span>
                              ),
                            )}
                          </div>
                        </td>
                        <td>
                          <MeasurementCell
                            item={item}
                            source="inspected"
                            group="item"
                            weightLabel="Net"
                          />
                        </td>
                        <td>
                          <MeasurementCell
                            item={item}
                            source="pis"
                            group="item"
                            weightLabel="Net"
                          />
                        </td>
                        <td>
                          <MeasurementCell
                            item={item}
                            source="inspected"
                            group="box"
                            weightLabel="Gross"
                          />
                        </td>
                        <td>
                          <MeasurementCell
                            item={item}
                            source="pis"
                            group="box"
                            weightLabel="Gross"
                          />
                        </td>
                        {canEditPis && (
                          <td>
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => setSelectedItem(item)}
                            >
                              Update PIS
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>
          <span className="small fw-semibold">
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

        <div className="d-flex justify-content-end mt-3">
          <div className="input-group om-limit-control">
            <span className="input-group-text">Limit</span>
            <select
              className="form-select"
              value={limit}
              onChange={(event) => {
                setPage(1);
                setLimit(Number(event.target.value));
              }}
            >
              {LIMIT_OPTIONS.map((limitOption) => (
                <option key={limitOption} value={limitOption}>
                  {limitOption}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selectedItem && canEditPis && (
        <EditPisModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => {
            setSelectedItem(null);
            fetchDiffItems();
          }}
        />
      )}
    </>
  );
};

export default PISDiffs;
