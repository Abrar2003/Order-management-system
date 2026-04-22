import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import {
  formatDateDDMMYYYY,
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_ENTITY_FILTER = "all";

const normalizeEntityFilter = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return DEFAULT_ENTITY_FILTER;
  const lowered = normalized.toLowerCase();
  if (lowered === "all" || lowered === "undefined" || lowered === "null") {
    return DEFAULT_ENTITY_FILTER;
  }
  return normalized;
};

const normalizeDateQueryText = (value) => String(value || "").trim();
const getBrandKey = (value) => String(value || "").trim().toLowerCase();
const getDefaultDailySummaryDate = () => {
  const todayIso = toISODateString(getTodayDDMMYYYY());
  if (!todayIso) return getTodayDDMMYYYY();

  const todayDate = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(todayDate.getTime())) return getTodayDDMMYYYY();

  todayDate.setDate(todayDate.getDate() - 1);
  return toDDMMYYYYInputValue(toISODateString(todayDate), getTodayDDMMYYYY());
};

const toBrandLogoDataUrl = (logoObj) => {
  if (typeof logoObj?.url === "string" && logoObj.url.trim()) {
    return logoObj.url.trim();
  }

  const raw = logoObj?.data?.data || logoObj?.data;
  if (!Array.isArray(raw) || raw.length === 0) return "";

  let binary = "";
  raw.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return `data:${logoObj?.contentType || "image/webp"};base64,${window.btoa(binary)}`;
};

const createDefaultReport = (dateValue = getDefaultDailySummaryDate()) => ({
  filters: {
    date: toISODateString(dateValue) || "",
    brand: "",
    brand_options: [],
  },
  summary: {
    vendors_count: 0,
    items_count: 0,
  },
  vendors: [],
});

const DailySummary = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "daily-summary");

  const initialSelectedDate = toDDMMYYYYInputValue(
    normalizeDateQueryText(searchParams.get("date")),
    getDefaultDailySummaryDate(),
  );

  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const [draftSelectedDate, setDraftSelectedDate] = useState(initialSelectedDate);
  const [brandFilter, setBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [draftBrandFilter, setDraftBrandFilter] = useState(() =>
    normalizeEntityFilter(searchParams.get("brand")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(() => createDefaultReport(initialSelectedDate));
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [brandLogoSrc, setBrandLogoSrc] = useState("");
  const [sortBy, setSortBy] = useState("inspectionDate");
  const [sortOrder, setSortOrder] = useState("desc");

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const reportDateIso = toISODateString(selectedDate);
      if (!reportDateIso || !isValidDDMMYYYY(selectedDate)) {
        setReport(createDefaultReport(selectedDate));
        setError("Report date must be in DD/MM/YYYY format.");
        return;
      }

      const params = { date: reportDateIso };
      if (brandFilter !== DEFAULT_ENTITY_FILTER) {
        params.brand = brandFilter;
      }

      const response = await api.get("/qc/reports/daily-summary", { params });
      const responseData = response?.data || {};

      setReport({
        filters: {
          ...createDefaultReport(reportDateIso).filters,
          ...(responseData?.filters || {}),
        },
        summary: {
          ...createDefaultReport(reportDateIso).summary,
          ...(responseData?.summary || {}),
        },
        vendors: Array.isArray(responseData?.vendors) ? responseData.vendors : [],
      });
    } catch (err) {
      setReport(createDefaultReport(selectedDate));
      setError(err?.response?.data?.message || "Failed to load daily summary.");
    } finally {
      setLoading(false);
    }
  }, [brandFilter, selectedDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSelectedDate = toDDMMYYYYInputValue(
      normalizeDateQueryText(searchParams.get("date")),
      getDefaultDailySummaryDate(),
    );
    const nextBrandFilter = normalizeEntityFilter(searchParams.get("brand"));

    setSelectedDate((prev) => (prev === nextSelectedDate ? prev : nextSelectedDate));
    setDraftSelectedDate((prev) => (prev === nextSelectedDate ? prev : nextSelectedDate));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [searchParams, syncedQuery]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (selectedDate) {
      next.set("date", selectedDate);
    }
    if (brandFilter !== DEFAULT_ENTITY_FILTER) {
      next.set("brand", brandFilter);
    }

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [brandFilter, searchParams, selectedDate, setSearchParams, syncedQuery]);

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setSelectedDate(draftSelectedDate || getDefaultDailySummaryDate());
    setBrandFilter(normalizeEntityFilter(draftBrandFilter));
  };

  const handleClearFilters = () => {
    const defaultDate = getDefaultDailySummaryDate();
    setDraftSelectedDate(defaultDate);
    setDraftBrandFilter(DEFAULT_ENTITY_FILTER);
    setSelectedDate(defaultDate);
    setBrandFilter(DEFAULT_ENTITY_FILTER);
  };

  const filters = useMemo(
    () => report?.filters || createDefaultReport(selectedDate).filters,
    [report?.filters, selectedDate],
  );

  const summary = useMemo(
    () => report?.summary || createDefaultReport(selectedDate).summary,
    [report?.summary, selectedDate],
  );

  const brandOptions = useMemo(() => {
    const options = new Set(
      (Array.isArray(filters.brand_options) ? filters.brand_options : []).filter(Boolean),
    );
    if (brandFilter !== DEFAULT_ENTITY_FILTER) {
      options.add(brandFilter);
    }
    return [...options].sort((left, right) => left.localeCompare(right));
  }, [brandFilter, filters.brand_options]);

  const visibleVendors = useMemo(
    () =>
      (Array.isArray(report?.vendors) ? report.vendors : [])
        .map((vendorEntry, index) => ({
          vendorKey: String(vendorEntry?.vendor || "").trim() || `vendor-${index}`,
          vendor: vendorEntry?.vendor || "N/A",
          items: Array.isArray(vendorEntry?.items) ? vendorEntry.items : [],
        }))
        .filter((vendorEntry) => vendorEntry.items.length > 0),
    [report?.vendors],
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

  const sortedVisibleVendors = useMemo(
    () =>
      visibleVendors.map((vendorEntry) => ({
        ...vendorEntry,
        items: sortClientRows(vendorEntry.items, {
          sortBy,
          sortOrder,
          getSortValue: (row, column) => {
            if (column === "inspectionDate") {
              return new Date(row?.inspection_date || 0).getTime();
            }
            if (column === "orderId") return row?.order_id;
            if (column === "itemCode") return row?.item_code;
            if (column === "requested") return Number(row?.requested_quantity || 0);
            if (column === "passed") return Number(row?.passed_quantity || 0);
            if (column === "openQuantity") return Number(row?.open_quantity || 0);
            if (column === "inspector") return row?.inspector_name;
            if (column === "remarks") return row?.goods_not_ready_reason;
            return "";
          },
        }),
      })),
    [sortBy, sortOrder, visibleVendors],
  );

  useEffect(() => {
    const brandName = brandFilter === DEFAULT_ENTITY_FILTER ? "" : String(brandFilter || "").trim();
    if (!brandName) {
      setBrandLogoSrc("");
      return undefined;
    }

    let cancelled = false;

    const fetchBrandLogo = async () => {
      try {
        const response = await api.get("/brands/");
        const brands = Array.isArray(response?.data?.data) ? response.data.data : [];
        const matchedBrand = brands.find(
          (brand) => getBrandKey(brand?.name) === getBrandKey(brandName),
        );

        if (!cancelled) {
          setBrandLogoSrc(toBrandLogoDataUrl(matchedBrand?.logo));
        }
      } catch (err) {
        if (!cancelled) {
          setBrandLogoSrc("");
        }
      }
    };

    fetchBrandLogo();

    return () => {
      cancelled = true;
    };
  }, [brandFilter]);

  return (
    <>
      <Navbar />

      <div className="page-shell om-report-page py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Daily Summary</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <form className="card-body d-flex flex-wrap gap-2 align-items-end" onSubmit={handleApplyFilters}>
            <div>
              <label className="form-label mb-1">Report Date</label>
              <input
                type="date"
                lang="en-GB"
                className="form-control"
                value={toISODateString(draftSelectedDate)}
                onChange={(e) => setDraftSelectedDate(toDDMMYYYYInputValue(e.target.value, ""))}
              />
            </div>

            <div>
              <label className="form-label mb-1">Brand</label>
              <select
                className="form-select"
                value={draftBrandFilter}
                onChange={(e) => setDraftBrandFilter(normalizeEntityFilter(e.target.value))}
              >
                <option value={DEFAULT_ENTITY_FILTER}>All Brands</option>
                {brandOptions.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={loading}
            >
              {loading ? "Loading..." : "Apply"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleClearFilters}
              disabled={loading}
            >
              Clear
            </button>

            <span className="om-summary-chip">Vendors: {summary?.vendors_count ?? 0}</span>
            <span className="om-summary-chip">Items: {summary?.items_count ?? 0}</span>
          </form>
        </div>

        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="weekly-summary-export-surface d-grid gap-3">
          <div className="card om-card">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
                <div>
                  <h3 className="h5 mb-1">Daily Summary</h3>
                  <div className="text-secondary small">
                    {formatDateDDMMYYYY(filters.date)}
                  </div>
                </div>
                {brandLogoSrc ? (
                  <div className="weekly-summary-brand-panel">
                    <img
                      src={brandLogoSrc}
                      alt={`${brandFilter} logo`}
                      className="weekly-summary-brand-logo"
                    />
                  </div>
                ) : (
                  <span className="om-summary-chip">
                    {brandFilter === DEFAULT_ENTITY_FILTER ? "All Brands" : brandFilter}
                  </span>
                )}
              </div>
            </div>
          </div>

          {loading && sortedVisibleVendors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-center py-4">Loading...</div>
            </div>
          ) : sortedVisibleVendors.length === 0 ? (
            <div className="card om-card">
              <div className="card-body text-secondary">
                No inspection rows found for the selected date.
              </div>
            </div>
          ) : (
            sortedVisibleVendors.map((vendorEntry) => (
              <div key={vendorEntry.vendorKey} className="card om-card">
                <div className="card-body p-0">
                  <div className="weekly-summary-vendor-header px-3 py-3 border-bottom">
                    <div className="h5 mb-0">{vendorEntry.vendor}</div>
                  </div>

                  <div className="table-responsive">
                    <table className="table table-sm table-striped align-middle mb-0">
                      <thead>
                        <tr>
                          <th>
                            <SortHeaderButton
                              label="Inspection Date"
                              isActive={sortBy === "inspectionDate"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("inspectionDate", "desc")}
                            />
                          </th>
                          <th>
                            <SortHeaderButton
                              label="PO"
                              isActive={sortBy === "orderId"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("orderId", "asc")}
                            />
                          </th>
                          <th>
                            <SortHeaderButton
                              label="Item Code"
                              isActive={sortBy === "itemCode"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("itemCode", "asc")}
                            />
                          </th>
                          <th>
                            <SortHeaderButton
                              label="Requested"
                              isActive={sortBy === "requested"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("requested", "desc")}
                            />
                          </th>
                          <th>
                            <SortHeaderButton
                              label="Passed"
                              isActive={sortBy === "passed"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("passed", "desc")}
                            />
                          </th>
                          <th>
                            <SortHeaderButton
                              label="Open Quantity"
                              isActive={sortBy === "openQuantity"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("openQuantity", "desc")}
                            />
                          </th>
                          <th>
                            <SortHeaderButton
                              label="Inspector"
                              isActive={sortBy === "inspector"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("inspector", "asc")}
                            />
                          </th>
                          <th>
                            <SortHeaderButton
                              label="Remarks"
                              isActive={sortBy === "remarks"}
                              direction={sortOrder}
                              onClick={() => handleSortColumn("remarks", "asc")}
                            />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorEntry.items.map((row, index) => (
                          <tr
                            key={`${vendorEntry.vendorKey}-${row?.inspection_id || row?.qc_id || index}`}
                            className={row?.goods_not_ready ? "weekly-summary-warning-row" : ""}
                          >
                            <td>
                              {row?.inspection_date
                                ? formatDateDDMMYYYY(row.inspection_date)
                                : "-"}
                            </td>
                            <td>{row?.order_id || "N/A"}</td>
                            <td>
                              <div>{row?.item_code || "N/A"}</div>
                              {row?.goods_not_ready ? (
                                <div className="small fw-semibold">Goods Not Ready</div>
                              ) : null}
                              
                            </td>
                            <td>{Number(row?.requested_quantity || 0)}</td>
                            <td>{Number(row?.passed_quantity || 0)}</td>
                            <td>{Number(row?.open_quantity || 0)}</td>
                            <td>{row?.inspector_name || "-"}</td>
                            <td>{row?.goods_not_ready_reason || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default DailySummary;
