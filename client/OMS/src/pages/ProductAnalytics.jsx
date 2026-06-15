import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import SortHeaderButton from "../components/SortHeaderButton";
import Tooltip from "../components/Tooltip";
import { formatDateDDMMYYYY } from "../utils/date";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
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

const hasFiniteNumber = (value) => {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
};

const formatWholeNumber = (value) =>
  hasFiniteNumber(value) ? Number(value).toLocaleString("en-IN") : "-";

const formatDays = (value, { maximumFractionDigits = 1 } = {}) => {
  if (!hasFiniteNumber(value)) return "-";
  const rounded = Number(value);
  const formatted = rounded.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
  return `${formatted} ${Math.abs(rounded) === 1 ? "day" : "days"}`;
};

const formatPercent = (value) =>
  hasFiniteNumber(value) ? Number(value).toFixed(2) : "-";

const HEADER_FORMULAS = Object.freeze({
  poCount: {
    title: "PO Count",
    lines: [
      "Formula: PO Count = count of POs grouped under the same item code.",
      "Expand the item row to view each PO included in this count.",
    ],
  },
  itemCode: {
    title: "Item Code",
    lines: [
      "Direct value from the linked order item: order.item.item_code.",
      "This column is an identifier, so there is no derived formula.",
    ],
  },
  orderQuantity: {
    title: "Order Qty",
    lines: [
      "Formula: Order Qty = order.quantity.",
      "This is taken directly from the order quantity stored on the order row.",
    ],
  },
  passedQuantity: {
    title: "Passed",
    lines: [
      "Formula: Passed = sum of passed quantities from all linked inspections.",
      "Calculation: inspections.reduce((sum, inspection) => sum + inspection.passed, 0).",
    ],
  },
  inspectionTimeDays: {
    title: "Inspection Time (days)",
    lines: [
      "Formula: (last inspection createdAt - first inspection createdAt) / (1000 x 60 x 60 x 24).",
      "This value is only calculated when at least 2 inspection records exist, then rounded to 2 decimals in the API.",
    ],
  },
  rejectionPercent: {
    title: "Average Rejection (%)",
    lines: [
      "Start with remaining = order quantity.",
      "For each inspection: rejected = remaining - passed, rejection % = (rejected / remaining) x 100.",
      "Average Rejection (%) = average of the non-zero rejection percentages collected across inspections.",
    ],
  },
  avgShippingTimeDays: {
    title: "Avg Shipping Time (days)",
    lines: [
      "Formula: average of fully shipped PO shipping times for this item.",
      "PO shipping time = latest shipment stuffing date - order date.",
      "POs with pending shipment quantity or invalid dates are not counted.",
    ],
  },
});

const HeaderFormulaTooltip = ({ column, children }) => {
  const formula = HEADER_FORMULAS[column];

  if (!formula) return children;

  return (
    <Tooltip
      openOnFocus={false}
      content={(
        <div>
          <div className="tooltip-title">{formula.title}</div>
          {formula.lines.map((line) => (
            <div key={`${column}-${line}`} className="tooltip-detail">
              {line}
            </div>
          ))}
        </div>
      )}
    >
      {children}
    </Tooltip>
  );
};

const ProductAnalytics = () => {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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
  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
  });
  const [sortBy, setSortBy] = useState("itemCode");
  const [sortOrder, setSortOrder] = useState("asc");
  const [expandedRowIds, setExpandedRowIds] = useState(() => new Set());

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/items/product-analytics", {
        params: {
          search: searchInput,
          brand: brandFilter,
          vendor: vendorFilter,
          page,
          limit,
        },
      });

      setRows(Array.isArray(res?.data?.data) ? res.data.data : []);
      setTotalPages(Number(res?.data?.pagination?.totalPages || 1));
      setTotalRecords(Number(res?.data?.pagination?.totalRecords || 0));
      setFilters({
        brands: Array.isArray(res?.data?.filters?.brands)
          ? res.data.filters.brands
          : [],
        vendors: Array.isArray(res?.data?.filters?.vendors)
          ? res.data.filters.vendors
          : [],
      });
    } catch (err) {
      setError(
        err?.response?.data?.message || "Failed to load product analytics",
      );
      setRows([]);
      setTotalPages(1);
      setTotalRecords(0);
      setFilters({
        brands: [],
        vendors: [],
      });
    } finally {
      setLoading(false);
    }
  }, [brandFilter, limit, page, searchInput, vendorFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApplyFilters = (event) => {
    event?.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
  };

  const handleClearFilters = () => {
    setPage(1);
    setDraftSearchInput("");
    setDraftBrandFilter("all");
    setDraftVendorFilter("all");
    setSearchInput("");
    setBrandFilter("all");
    setVendorFilter("all");
    setSuccess("");
  };

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

  const toggleRow = useCallback((rowId) => {
    setExpandedRowIds((previous) => {
      const next = new Set(previous);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (row, column) => {
          if (column === "poCount") return Number(row?.poCount || 0);
          if (column === "itemCode") return row?.itemCode;
          if (column === "orderQuantity") return Number(row?.orderQuantity || 0);
          if (column === "passedQuantity") {
            return row?.passedQuantity == null ? null : Number(row.passedQuantity);
          }
          if (column === "inspectionTimeDays") {
            return Number.isFinite(Number(row?.inspectionTimeDays))
              ? Number(row.inspectionTimeDays)
              : null;
          }
          if (column === "rejectionPercent") {
            return Number.isFinite(Number(row?.rejectionPercent))
              ? Number(row.rejectionPercent)
              : null;
          }
          if (column === "avgShippingTimeDays") {
            return Number.isFinite(Number(row?.avgShippingTimeDays))
              ? Number(row.avgShippingTimeDays)
              : null;
          }
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
          <h2 className="h4 mb-0">Product Analytics</h2>
          <span className="d-none d-md-inline" />
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-4">
                <label className="form-label">Search Item Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftSearchInput}
                  placeholder="Search item code or PO"
                  onChange={(e) => setDraftSearchInput(e.target.value)}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={draftBrandFilter}
                  onChange={(e) => setDraftBrandFilter(e.target.value)}
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
                  value={draftVendorFilter}
                  onChange={(e) => setDraftVendorFilter(e.target.value)}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
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

        {success && (
          <div className="alert alert-success mb-3" role="alert">
            {success}
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
                        <HeaderFormulaTooltip column="poCount">
                          <SortHeaderButton
                            label="PO Count"
                            isActive={sortBy === "poCount"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("poCount", "desc")}
                            showNativeTitle={false}
                          />
                        </HeaderFormulaTooltip>
                      </th>
                      <th>
                        <HeaderFormulaTooltip column="itemCode">
                          <SortHeaderButton
                            label="Item Code"
                            isActive={sortBy === "itemCode"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("itemCode", "asc")}
                            showNativeTitle={false}
                          />
                        </HeaderFormulaTooltip>
                      </th>
                      <th>
                        <HeaderFormulaTooltip column="orderQuantity">
                          <SortHeaderButton
                            label="Order Qty"
                            isActive={sortBy === "orderQuantity"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("orderQuantity", "desc")}
                            showNativeTitle={false}
                          />
                        </HeaderFormulaTooltip>
                      </th>
                      <th>
                        <HeaderFormulaTooltip column="passedQuantity">
                          <SortHeaderButton
                            label="Passed"
                            isActive={sortBy === "passedQuantity"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("passedQuantity", "desc")}
                            showNativeTitle={false}
                          />
                        </HeaderFormulaTooltip>
                      </th>
                      <th>
                        <HeaderFormulaTooltip column="inspectionTimeDays">
                          <SortHeaderButton
                            label="Inspection Time (days)"
                            isActive={sortBy === "inspectionTimeDays"}
                            direction={sortOrder}
                            onClick={() =>
                              handleSortColumn("inspectionTimeDays", "desc")
                            }
                            showNativeTitle={false}
                          />
                        </HeaderFormulaTooltip>
                      </th>
                      <th>
                        <HeaderFormulaTooltip column="rejectionPercent">
                          <SortHeaderButton
                            label="Average Rejection (%)"
                            isActive={sortBy === "rejectionPercent"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("rejectionPercent", "desc")}
                            showNativeTitle={false}
                          />
                        </HeaderFormulaTooltip>
                      </th>
                      <th>
                        <HeaderFormulaTooltip column="avgShippingTimeDays">
                          <SortHeaderButton
                            label="Avg Shipping Time"
                            isActive={sortBy === "avgShippingTimeDays"}
                            direction={sortOrder}
                            onClick={() => handleSortColumn("avgShippingTimeDays", "desc")}
                            showNativeTitle={false}
                          />
                        </HeaderFormulaTooltip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan="7" className="text-center py-4">
                          No data found
                        </td>
                      </tr>
                    )}
                    {sortedRows.map((row) => {
                      const rowId = String(row?.id || row?.itemId || row?.itemCode || "");
                      const isExpanded = expandedRowIds.has(rowId);
                      const childRows = Array.isArray(row?.orders) ? row.orders : [];

                      return (
                        <Fragment key={rowId}>
                          <tr
                            key={`${rowId}-parent`}
                            className="product-analytics-parent-row"
                            onClick={() => toggleRow(rowId)}
                          >
                            <td>
                              <button
                                type="button"
                                className="product-analytics-toggle"
                                aria-label={isExpanded ? "Collapse PO rows" : "Expand PO rows"}
                                aria-expanded={isExpanded}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleRow(rowId);
                                }}
                              >
                                {isExpanded ? "-" : "+"}
                              </button>
                              <span className="fw-semibold">
                                {formatWholeNumber(row?.poCount)} {Number(row?.poCount) === 1 ? "PO" : "POs"}
                              </span>
                            </td>
                            <td>
                              <div className="fw-semibold">{row?.itemCode || "-"}</div>
                              {row?.itemName ? (
                                <div className="text-secondary small product-analytics-item-name">
                                  {row.itemName}
                                </div>
                              ) : null}
                            </td>
                            <td>{formatWholeNumber(row?.orderQuantity)}</td>
                            <td>{formatWholeNumber(row?.passedQuantity)}</td>
                            <td>{formatDays(row?.inspectionTimeDays, { maximumFractionDigits: 0 })}</td>
                            <td>{formatPercent(row?.rejectionPercent)}</td>
                            <td>{formatDays(row?.avgShippingTimeDays)}</td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${rowId}-children`} className="product-analytics-detail-row">
                              <td colSpan="7">
                                <div className="product-analytics-detail-wrap">
                                  <table className="table table-sm align-middle mb-0 product-analytics-detail-table">
                                    <thead>
                                      <tr>
                                        <th>PO</th>
                                        <th>Order Date</th>
                                        <th>Shipping Date</th>
                                        <th>Shipping Time</th>
                                        <th>Order Qty</th>
                                        <th>Passed</th>
                                        <th>Inspection Time</th>
                                        <th>Average Rejection (%)</th>
                                        <th>Brand</th>
                                        <th>Vendor</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {childRows.length === 0 ? (
                                        <tr>
                                          <td colSpan="10" className="text-center text-secondary py-3">
                                            No PO details found
                                          </td>
                                        </tr>
                                      ) : childRows.map((poRow) => (
                                        <tr key={`${rowId}-${poRow?.orderId}`}>
                                          <td>{poRow?.orderId || "-"}</td>
                                          <td>{poRow?.orderDate ? formatDateDDMMYYYY(poRow.orderDate, "-") : "-"}</td>
                                          <td>{poRow?.shippingDate ? formatDateDDMMYYYY(poRow.shippingDate, "-") : "-"}</td>
                                          <td>
                                            {poRow?.isFullyShipped
                                              ? formatDays(poRow?.shippingTimeDays)
                                              : "-"}
                                          </td>
                                          <td>{formatWholeNumber(poRow?.orderQuantity)}</td>
                                          <td>{formatWholeNumber(poRow?.passedQuantity)}</td>
                                          <td>{formatDays(poRow?.inspectionTimeDays, { maximumFractionDigits: 0 })}</td>
                                          <td>{formatPercent(poRow?.rejectionPercent)}</td>
                                          <td>{poRow?.brand || "-"}</td>
                                          <td>{poRow?.vendor || "-"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
              onChange={(e) => {
                setPage(1);
                setLimit(Number(e.target.value));
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>
    </>
  );
};

export default ProductAnalytics;
