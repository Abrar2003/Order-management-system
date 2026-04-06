import { useCallback, useEffect, useState } from "react";
import axios from "../api/axios";
import Navbar from "../components/Navbar";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import AlignQCModal from "../components/AlignQcModal";
import { getUserFromToken } from "../auth/auth.utils";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import {
  formatDateDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { formatPositiveCbm } from "../utils/cbm";
import "../App.css";

// small helper: debounce without extra libs
const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const isGoodsNotReady = (qc = {}) => Boolean(qc?.last_inspection?.goods_not_ready?.ready);

const getPendingAlignmentInfo = (qc = {}) => {
  const pendingQty = Math.max(
    0,
    toSafeNumber(
      qc?.quantities?.pending ??
        (toSafeNumber(qc?.quantities?.client_demand)
          - toSafeNumber(qc?.quantities?.qc_passed)),
    ),
  );
  const requestedQty = Math.max(0, toSafeNumber(qc?.quantities?.quantity_requested));
  const hasRequestHistory =
    Array.isArray(qc?.request_history) && qc.request_history.length > 0;
  const hasRequest = hasRequestHistory || requestedQty > 0;
  const isAligned = hasRequest && (pendingQty <= 0 || requestedQty >= pendingQty);

  if (!hasRequest) {
    return {
      pendingQty,
      requestedQty,
      isAligned: false,
      tooltip: "QC request is not aligned yet.",
    };
  }

  if (pendingQty <= 0) {
    return {
      pendingQty,
      requestedQty,
      isAligned: true,
      tooltip: "No pending quantity.",
    };
  }

  if (isAligned) {
    return {
      pendingQty,
      requestedQty,
      isAligned: true,
      tooltip: `QC aligned for pending quantity (requested ${requestedQty}, pending ${pendingQty}).`,
    };
  }

  return {
    pendingQty,
    requestedQty,
    isAligned: false,
    tooltip: `QC request is partial (requested ${requestedQty}, pending ${pendingQty}). Update is allowed; realign if needed.`,
  };
};

const DEFAULT_SORT_BY = "request_date";
const DEFAULT_PAGE = 1;
const TABLE_COLUMN_COUNT = 12;

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const normalizeQueryText = (value) => String(value || "").trim();

const parseSortBy = (value) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "order_id") return "order_id";
  if (normalized === "request_date") return "request_date";
  if (normalized === "createdat" || normalized === "created_at") return "createdAt";
  return DEFAULT_SORT_BY;
};

const parseSortOrder = (value, sortBy = DEFAULT_SORT_BY) => {
  const normalized = normalizeQueryText(value).toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return sortBy === "order_id" ? "asc" : "desc";
};

const QCPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "qc-list");
  const requestedItemCode = normalizeQueryText(searchParams.get("item_code"));
  const initialSearch = normalizeQueryText(searchParams.get("search")) || requestedItemCode;
  const initialSortBy = parseSortBy(
    searchParams.get("sort_by") ?? searchParams.get("sort"),
  );
  const initialSortOrder = parseSortOrder(
    searchParams.get("sort_order"),
    initialSortBy,
  );
  const [qcList, setQcList] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [itemCodes, setItemCodes] = useState([]);

  // header filters (excel-like)
  const [search, setSearch] = useState(initialSearch); // item_code search
  const [inspector, setInspector] = useState(
    normalizeQueryText(searchParams.get("inspector")),
  );
  const [vendor, setVendor] = useState(normalizeQueryText(searchParams.get("vendor")));
  const [from, setFrom] = useState(
    toDDMMYYYYInputValue(
      normalizeQueryText(searchParams.get("from")),
      normalizeQueryText(searchParams.get("from")),
    ),
  );
  const [to, setTo] = useState(
    toDDMMYYYYInputValue(
      normalizeQueryText(searchParams.get("to")),
      normalizeQueryText(searchParams.get("to")),
    ),
  );
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sortOrder, setSortOrder] = useState(initialSortOrder);
  const [order, setOrder] = useState(normalizeQueryText(searchParams.get("order")));

  const debouncedSearch = useDebouncedValue(search, 300);

  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE),
  );
  const [totalPages, setTotalPages] = useState(1);
  const [realignContext, setRealignContext] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncedQuery, setSyncedQuery] = useState(null);

  const token = localStorage.getItem("token");
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = getUserFromToken();
  const normalizedRole = String(currentUser?.role || "").trim().toLowerCase();
  const isQcUser = normalizedRole === "qc";
  const canRealign = ["admin", "manager"].includes(
    normalizedRole,
  );
  const canUseInspectorFilter = !isQcUser;
  const canExportQcList = ["admin", "manager", "dev", "user"].includes(normalizedRole);

  const fetchQC = useCallback(async () => {
    const fromIso = toISODateString(from);
    const toIso = toISODateString(to);

    setLoading(true);

    try {
      const res = await axios.get("/qc/list", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          order,
          page,
          limit: 20,
          search: debouncedSearch, // item_code
          inspector: canUseInspectorFilter ? inspector : "",
          vendor,
          from: fromIso || "",
          to: toIso || "",
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      });

      setQcList(res.data?.data || []);
      setTotalPages(res.data?.pagination?.totalPages || 1);

      const backendFilters = res.data?.filters || {};
      setVendors(Array.isArray(backendFilters.vendors) ? backendFilters.vendors : []);
      setOrders(Array.isArray(backendFilters.orders) ? backendFilters.orders : []);
      setItemCodes(Array.isArray(backendFilters.item_codes) ? backendFilters.item_codes : []);
    } catch (err) {
      console.error(err);
      setQcList([]);
      setTotalPages(1);
      setVendors([]);
      setOrders([]);
      setItemCodes([]);
    } finally {
      setLoading(false);
    }
  }, [
    token,
    page,
    debouncedSearch,
    inspector,
    vendor,
    from,
    to,
    sortBy,
    sortOrder,
    order,
    canUseInspectorFilter,
  ]);

  const fetchInspectors = useCallback(async () => {
    if (!canUseInspectorFilter) {
      setInspectors([]);
      return;
    }
    try {
      const res = await axios.get("/auth/?role=QC", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInspectors(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setInspectors([]);
    }
  }, [canUseInspectorFilter, token]);

  useEffect(() => {
    fetchQC();
  }, [fetchQC]);

  useEffect(() => {
    fetchInspectors();
  }, [fetchInspectors]);

  useEffect(() => {
    const nextRequestedItemCode = normalizeQueryText(searchParams.get("item_code"));
    const nextSearch = normalizeQueryText(searchParams.get("search")) || nextRequestedItemCode;
    const nextInspector = canUseInspectorFilter
      ? normalizeQueryText(searchParams.get("inspector"))
      : "";
    const nextVendor = normalizeQueryText(searchParams.get("vendor"));
    const nextFromRaw = normalizeQueryText(searchParams.get("from"));
    const nextToRaw = normalizeQueryText(searchParams.get("to"));
    const nextFrom = toDDMMYYYYInputValue(nextFromRaw, nextFromRaw);
    const nextTo = toDDMMYYYYInputValue(nextToRaw, nextToRaw);
    const nextSortBy = parseSortBy(
      searchParams.get("sort_by") ?? searchParams.get("sort"),
    );
    const nextSortOrder = parseSortOrder(
      searchParams.get("sort_order"),
      nextSortBy,
    );
    const nextOrder = normalizeQueryText(searchParams.get("order"));
    const nextPage = parsePositiveInt(searchParams.get("page"), DEFAULT_PAGE);
    const currentQuery = searchParams.toString();

    setSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    setInspector((prev) => (prev === nextInspector ? prev : nextInspector));
    setVendor((prev) => (prev === nextVendor ? prev : nextVendor));
    setFrom((prev) => (prev === nextFrom ? prev : nextFrom));
    setTo((prev) => (prev === nextTo ? prev : nextTo));
    setSortBy((prev) => (prev === nextSortBy ? prev : nextSortBy));
    setSortOrder((prev) => (prev === nextSortOrder ? prev : nextSortOrder));
    setOrder((prev) => (prev === nextOrder ? prev : nextOrder));
    setPage((prev) => (prev === nextPage ? prev : nextPage));
    setSyncedQuery((prev) => (prev === currentQuery ? prev : currentQuery));
  }, [canUseInspectorFilter, searchParams]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery !== currentQuery) return;

    const next = new URLSearchParams();
    if (normalizeQueryText(search)) next.set("search", normalizeQueryText(search));
    if (normalizeQueryText(order)) next.set("order", normalizeQueryText(order));
    if (canUseInspectorFilter && normalizeQueryText(inspector)) {
      next.set("inspector", normalizeQueryText(inspector));
    }
    if (normalizeQueryText(vendor)) next.set("vendor", normalizeQueryText(vendor));
    if (normalizeQueryText(from)) next.set("from", normalizeQueryText(from));
    if (normalizeQueryText(to)) next.set("to", normalizeQueryText(to));
    if (page > DEFAULT_PAGE) next.set("page", String(page));
    if (sortBy !== DEFAULT_SORT_BY) next.set("sort_by", sortBy);
    if (sortOrder !== parseSortOrder("", sortBy)) next.set("sort_order", sortOrder);

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    search,
    order,
    inspector,
    vendor,
    from,
    to,
    page,
    sortBy,
    sortOrder,
    syncedQuery,
    searchParams,
    setSearchParams,
    canUseInspectorFilter,
  ]);

  const handleDetailsClick = (qc) => {
    const qcId = String(qc?._id || "").trim();
    if (!qcId) return;

    const fromQcList = `${location.pathname}${location.search || ""}`;
    navigate(`/qc/${encodeURIComponent(qcId)}`, {
      state: { fromQcList },
    });
  };

  const openRealignModal = (qc) => {
    const orderId = qc?.order?._id || qc?.order;
    if (!orderId) {
      alert("Cannot realign this QC record because order data is missing.");
      return;
    }

    const orderForModal = {
      ...(qc?.order || {}),
      _id: orderId,
      order_id: qc?.order_meta?.order_id || qc?.order?.order_id || "",
      vendor: qc?.order_meta?.vendor || qc?.order?.vendor || "",
      brand: qc?.order_meta?.brand || qc?.order?.brand || "",
      item: {
        item_code: qc?.item?.item_code || qc?.order?.item?.item_code || "",
        description: qc?.item?.description || qc?.order?.item?.description || "",
      },
      quantity: toSafeNumber(
        qc?.quantities?.client_demand ?? qc?.order?.quantity ?? 0,
      ),
    };

    setRealignContext({
      order: orderForModal,
      initialInspector: String(qc?.inspector?._id || qc?.inspector || ""),
      initialQuantityRequested: toSafeNumber(
        qc?.quantities?.pending ?? orderForModal.quantity,
      ),
      initialRequestDate: qc?.request_date || "",
      initialRequestType: String(qc?.request_type || "FULL"),
      openQuantity: toSafeNumber(qc?.quantities?.pending ?? orderForModal.quantity),
    });
  };

  // keep filter controls consistent: when filter changes, reset page 1
  const resetToFirstPage = useCallback(() => setPage(1), []);

  const handleSortColumn = (column, defaultDirection = "asc") => {
    resetToFirstPage();
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortOrder(defaultDirection);
  };

  const sortIndicator = (column) => {
    if (sortBy !== column) return "";
    return sortOrder === "asc" ? " (asc)" : " (desc)";
  };

  const handleExport = useCallback(async (format = "xlsx") => {
    try {
      setExporting(true);
      const fromIso = toISODateString(from);
      const toIso = toISODateString(to);
      const response = await axios.get("/qc/export", {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
        params: {
          order,
          search: debouncedSearch,
          inspector,
          vendor,
          from: fromIso || "",
          to: toIso || "",
          sort_by: sortBy,
          sort_order: sortOrder,
          format,
        },
      });

      const disposition = String(response?.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
      const fallbackName = `qc-records-${new Date().toISOString().slice(0, 10)}.${format === "csv" ? "csv" : "xlsx"}`;
      const fileName = match?.[1]
        ? decodeURIComponent(match[1].trim())
        : fallbackName;

      const blob = new Blob(
        [response.data],
        {
          type:
            response?.headers?.["content-type"]
            || (format === "csv"
              ? "text/csv; charset=utf-8"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        },
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(`Failed to export QC records as ${String(format).toUpperCase()}.`);
    } finally {
      setExporting(false);
    }
  }, [
    from,
    debouncedSearch,
    inspector,
    order,
    sortBy,
    sortOrder,
    to,
    token,
    vendor,
  ]);

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
          <h2 className="h4 mb-0">QC Records</h2>
          {canExportQcList ? (
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => handleExport("xlsx")}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Export XLSX"}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => handleExport("csv")}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Export CSV"}
              </button>
            </div>
          ) : (
            <span className="d-none d-md-inline" />
          )}
        </div>

        {/* Removed the separate filter card UI? You asked filters in table head.
            If you want to keep the card too, we can keep it.
            For now: ONLY table head filters. */}

        <div className="card om-card">
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-striped table-hover align-middle om-table mb-0">
                <thead className="table-primary">
                  {/* Column titles */}
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        onClick={() => handleSortColumn("order_id", "asc")}
                      >
                        PO{sortIndicator("order_id")}
                      </button>
                    </th>
                    <th>Vendor</th>
                    <th>Item</th>
                    <th>
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none text-reset fw-semibold"
                        onClick={() => handleSortColumn("request_date", "desc")}
                      >
                        Request Date{sortIndicator("request_date")}
                      </button>
                    </th>
                    <th>Last Inspected Date</th>
                    <th>Order Quantity</th>
                    {/* <th>Requested</th>
                    <th>Offered</th> */}
                    {/* <th>Last Inspection (O/C/P)</th> */}
                    <th>Status</th>
                    <th>QC Passed</th>
                    <th>Pending</th>
                    <th>CBM</th>
                    <th>Inspector</th>
                    <th>Actions</th>
                  </tr>

                  {/* Excel-like filters row (same table classes) */}
                  <tr>
                    {/* PO search (item-like input + suggestions) */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="PO"
                        list="qc-po-options"
                        value={order}
                        onChange={(e) => {
                          resetToFirstPage();
                          setOrder(e.target.value);
                        }}
                      />
                      <datalist id="qc-po-options">
                        {orders.map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    </th>

                    {/* Vendor filter */}
                    <th>
                      <select
                        className="form-select form-select-sm"
                        value={vendor}
                        onChange={(e) => {
                          resetToFirstPage();
                          setVendor(e.target.value);
                        }}
                      >
                        <option value="">All</option>
                        {vendors.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </th>

                    {/* Item code search */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="Item code"
                        list="qc-item-code-options"
                        value={search}
                        onChange={(e) => {
                          resetToFirstPage();
                          setSearch(e.target.value);
                        }}
                      />
                      <datalist id="qc-item-code-options">
                        {itemCodes.map((itemCode) => (
                          <option key={itemCode} value={itemCode} />
                        ))}
                      </datalist>
                    </th>

                    {/* Request date range */}
                    <th>
                      <div className="d-flex flex-column gap-1 justify-right" style={{width: "60%"}} >
                        <div className="d-flex gap-1">
                          <label>From</label>
                          <input
                            type="date"
                            lang="en-GB"
                            className="form-control form-control-sm"
                            value={toISODateString(from)}
                            onChange={(e) => {
                              resetToFirstPage();
                              setFrom(toDDMMYYYYInputValue(e.target.value, ""));
                            }}
                          />
                        </div>
                        <div className="d-flex gap-1">
                          <label>To</label>
                          <input
                            type="date"
                            lang="en-GB"
                            className="form-control form-control-sm"
                            value={toISODateString(to)}
                            onChange={(e) => {
                              resetToFirstPage();
                              setTo(toDDMMYYYYInputValue(e.target.value, ""));
                            }}
                          />
                        </div>
                      </div>
                    </th>

                    {/* Non-filtered columns */}
                    {/* <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th> */}
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>
                    <th>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="-"
                        disabled
                      />
                    </th>

                    {/* Inspector filter */}
                    <th>
                      {canUseInspectorFilter ? (
                        <select
                          className="form-select form-select-sm"
                          value={inspector}
                          onChange={(e) => {
                            resetToFirstPage();
                            setInspector(e.target.value);
                          }}
                        >
                          <option value="">All</option>
                          {inspectors.map((qc) => (
                            <option key={qc._id} value={qc._id}>
                              {qc.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value="Self"
                          disabled
                          readOnly
                        />
                      )}
                    </th>

                    {/* Clear filters button area */}
                    <th>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm w-100"
                        onClick={() => {
                          setSearch("");
                          setInspector("");
                          setVendor("");
                          setOrder("");
                          setFrom("");
                          setTo("");
                          setSortBy("request_date");
                          setSortOrder("desc");
                          setPage(1);
                        }}
                      >
                        Clear
                      </button>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={TABLE_COLUMN_COUNT} className="text-center py-4">
                        Loading...
                      </td>
                    </tr>
                  ) : (
                    qcList.map((qc) => {
                      const pendingAlignmentInfo = getPendingAlignmentInfo(qc);

                      return (
                        <tr key={qc._id}>
                          {/* Prefer order.order_id if you populate order.
                              Vendor should come from order_meta now */}
                          <td>
                            {qc?.order_meta?.order_id ||
                              qc?.order?.order_id ||
                              "N/A"}
                          </td>
                          <td>
                            {qc?.order_meta?.vendor || qc?.order?.vendor || "N/A"}
                          </td>
                          <td>{qc?.item?.item_code || "N/A"}</td>
                          <td>{formatDateDDMMYYYY(qc?.request_date)}</td>
                          <td>{formatDateDDMMYYYY(qc?.last_inspected_date)}</td>
                          <td>{qc?.quantities?.client_demand ?? 0}</td>
                          {/* <td>{qc?.quantities?.quantity_requested ?? 0}</td>
                          <td>{toSafeNumber(qc?.last_inspection?.vendor_offered) ?? 0}</td> */}
                          {/* <td>
                            {qc?.last_inspection
                              ? `${toSafeNumber(qc.last_inspection.vendor_offered)} / ${toSafeNumber(qc.last_inspection.checked)} / ${toSafeNumber(qc.last_inspection.passed)}`
                              : "N/A"}
                          </td> */}
                          <td>
                            {isGoodsNotReady(qc) ? (
                              <span className="text-danger fw-semibold">
                                Goods Not Ready
                              </span>
                            ) : (
                              qc?.order?.status || "N/A"
                            )}
                          </td>
                          <td>{toSafeNumber(qc?.last_inspection?.passed) ?? 0}</td>
                          <td>
                            <span
                              className={[
                                "om-table-tooltip-trigger",
                                pendingAlignmentInfo.isAligned
                                  ? ""
                                  : "text-danger fw-semibold",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              data-tooltip={pendingAlignmentInfo.tooltip}
                              tabIndex={0}
                            >
                              {pendingAlignmentInfo.pendingQty}
                            </span>
                          </td>
                          <td>{formatPositiveCbm(qc?.cbm?.total, "NA")}</td>
                          <td>{qc?.inspector?.name || "N/A"}</td>
                          <td>
                            <div className="d-flex flex-column gap-2">
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleDetailsClick(qc);
                                }}
                              >
                                See Details
                              </button>
                              {canRealign &&
                                toSafeNumber(qc?.quantities?.pending) > 0 && (
                                  <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      openRealignModal(qc);
                                    }}
                                  >
                                    Realign QC
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {!loading && qcList.length === 0 && (
                    <tr>
                      <td colSpan={TABLE_COLUMN_COUNT} className="text-center py-4">
                        No QC records found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Prev
          </button>
          <span className="small fw-semibold">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={page === totalPages || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>

        {realignContext && (
          <AlignQCModal
            order={realignContext.order}
            initialInspector={realignContext.initialInspector}
            initialQuantityRequested={realignContext.initialQuantityRequested}
            initialRequestDate={realignContext.initialRequestDate}
            initialRequestType={realignContext.initialRequestType}
            openQuantity={realignContext.openQuantity}
            onClose={() => setRealignContext(null)}
            onSuccess={() => {
              setRealignContext(null);
              fetchQC();
            }}
          />
        )}
      </div>
    </>
  );
};

export default QCPage;
