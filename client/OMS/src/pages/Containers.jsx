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
import { getUserFromToken } from "../auth/auth.service";
import { hasShipmentEditRole } from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";
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

const CHECKED_STATUS_SUMMARY_FILTERS = [
  {
    label: "Checked",
    value: "checked",
    summaryKey: "checked",
  },
  {
    label: "Partially Checked",
    value: "partially checked",
    summaryKey: "partially_checked",
  },
  {
    label: "Checking Pending",
    value: "checking pending",
    summaryKey: "checking_pending",
  },
];

const getCheckedStatusClassName = (status) => {
  if (status === "Checked") return "text-success fw-semibold";
  if (status === "Partially Checked") return "text-warning fw-semibold";
  return "text-secondary fw-semibold";
};

const Containers = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "containers-list");
  const user = getUserFromToken();
  const { hasPermission } = usePermissions();
  const canUpdateContainers =
    hasPermission("containers", "edit") ||
    hasPermission("shipments", "edit") ||
    hasShipmentEditRole(user?.role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [containerUpdate, setContainerUpdate] = useState({
    container: "",
    invoice_number: "",
    stuffing_date: "",
    shipping_ETD: "",
    shipping_ETA: "",
  });
  const [updatingContainer, setUpdatingContainer] = useState(false);

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

  const handleOpenContainerUpdate = useCallback((row) => {
    setSelectedContainer(row);
    setContainerUpdate({
      container: String(row?.container || "").trim(),
      invoice_number: String(row?.invoice_number || "").trim(),
      stuffing_date: toISODateString(row?.common_shipping_date),
      shipping_ETD: toISODateString(row?.shipping_ETD),
      shipping_ETA: toISODateString(row?.shipping_ETA),
    });
  }, []);

  const handleUpdateContainer = async (event) => {
    event.preventDefault();
    const currentContainer = String(selectedContainer?.container || "").trim();
    const nextContainer = String(containerUpdate.container || "").trim();
    if (!currentContainer || !nextContainer) return;

    const payload = {
      current_container: currentContainer,
      container: nextContainer,
    };
    ["invoice_number", "stuffing_date", "shipping_ETD", "shipping_ETA"].forEach(
      (field) => {
        const value = String(containerUpdate[field] || "").trim();
        if (value) payload[field] = value;
      },
    );

    try {
      setUpdatingContainer(true);
      setError("");
      setSuccess("");
      const response = await api.patch("/orders/containers/update", payload);
      setSuccess(response?.data?.message || "Container updated successfully.");
      setSelectedContainer(null);
      await fetchContainers();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to update container.");
    } finally {
      setUpdatingContainer(false);
    }
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

  const handleSummaryStatusFilter = useCallback((statusValue) => {
    const nextStatus = normalizeFilterParam(statusValue, "all");

    setDraftCheckedStatusFilter(nextStatus);
    setCheckedStatusFilter(nextStatus);
  }, []);

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
          if (column === "shippingEtd") return new Date(row?.shipping_ETD || 0).getTime();
          if (column === "shippingEta") return new Date(row?.shipping_ETA || 0).getTime();
          if (column === "checkedStatus") {
            return CHECKED_STATUS_SORT_ORDER[row?.checked_status] ?? 99;
          }
          if (column === "itemCount") return Number(row?.item_count || 0);
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
            {CHECKED_STATUS_SUMMARY_FILTERS.map((statusFilter) => (
              <button
                key={statusFilter.value}
                type="button"
                className={`om-summary-chip om-summary-chip-button${
                  checkedStatusFilter === statusFilter.value ? " is-active" : ""
                }`}
                onClick={() => handleSummaryStatusFilter(statusFilter.value)}
                aria-pressed={checkedStatusFilter === statusFilter.value}
                title={`Filter containers by ${statusFilter.label}`}
              >
                {statusFilter.label}: {summary?.[statusFilter.summaryKey] ?? 0}
              </button>
            ))}
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
        {success && (
          <div className="alert alert-success mb-3" role="status">
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
                          label="ETD"
                          title="Estimated Time of Departure"
                          isActive={sortBy === "shippingEtd"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("shippingEtd", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="ETA"
                          title="Estimated Time of Arrival"
                          isActive={sortBy === "shippingEta"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("shippingEta", "asc")}
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
                          label="Total CBM"
                          isActive={sortBy === "totalCbm"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("totalCbm", "desc")}
                        />
                      </th>
                      {canUpdateContainers && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 ? (
                      <tr>
                        <td colSpan={canUpdateContainers ? "10" : "9"} className="text-center py-4">
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
                          <td>{formatDateDDMMYYYY(row.shipping_ETD)}</td>
                          <td>{formatDateDDMMYYYY(row.shipping_ETA)}</td>
                          <td>
                            <span className={getCheckedStatusClassName(row.checked_status)}>
                              {row.checked_status || "Checking Pending"}
                            </span>
                          </td>
                          <td>{row.item_count ?? 0}</td>
                          <td>{(Number(row.total_cbm) ?? 0).toFixed(2)}</td>
                          {canUpdateContainers && (
                            <td>
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenContainerUpdate(row);
                                }}
                              >
                                Update Container
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {selectedContainer && (
          <>
            <div
              className="modal fade show d-block"
              tabIndex="-1"
              role="dialog"
              aria-modal="true"
              aria-labelledby="update-container-title"
            >
              <div className="modal-dialog modal-dialog-centered" role="document">
                <form className="modal-content" onSubmit={handleUpdateContainer}>
                  <div className="modal-header">
                    <h3 id="update-container-title" className="modal-title fs-5">
                      Update Container
                    </h3>
                    <button
                      type="button"
                      className="btn-close"
                      aria-label="Close"
                      disabled={updatingContainer}
                      onClick={() => setSelectedContainer(null)}
                    />
                  </div>
                  <div className="modal-body">
                    <p className="text-secondary small">
                      Updates every order and sample shipment using {selectedContainer.container}.
                    </p>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="update-container-number">
                        Container Number
                      </label>
                      <input
                        id="update-container-number"
                        type="text"
                        className="form-control"
                        value={containerUpdate.container}
                        required
                        pattern="[A-Za-z]{4}-[0-9]{6}-[0-9]{1}"
                        title="Use the format AAAA-111111-2"
                        onChange={(event) =>
                          setContainerUpdate((current) => ({
                            ...current,
                            container: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="update-container-invoice">
                        Invoice Number
                      </label>
                      <input
                        id="update-container-invoice"
                        type="text"
                        className="form-control"
                        value={containerUpdate.invoice_number}
                        onChange={(event) =>
                          setContainerUpdate((current) => ({
                            ...current,
                            invoice_number: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="row g-3">
                      <div className="col-md-4">
                        <label className="form-label" htmlFor="update-container-shipping-date">
                          Shipping Date
                        </label>
                        <input
                          id="update-container-shipping-date"
                          type="date"
                          className="form-control"
                          value={containerUpdate.stuffing_date}
                          onChange={(event) =>
                            setContainerUpdate((current) => ({
                              ...current,
                              stuffing_date: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="col-md-4">
                        <label
                          className="form-label"
                          htmlFor="update-container-etd"
                          title="Estimated Time of Departure"
                        >
                          ETD
                        </label>
                        <input
                          id="update-container-etd"
                          type="date"
                          className="form-control"
                          value={containerUpdate.shipping_ETD}
                          onChange={(event) =>
                            setContainerUpdate((current) => ({
                              ...current,
                              shipping_ETD: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="col-md-4">
                        <label
                          className="form-label"
                          htmlFor="update-container-eta"
                          title="Estimated Time of Arrival"
                        >
                          ETA
                        </label>
                        <input
                          id="update-container-eta"
                          type="date"
                          className="form-control"
                          value={containerUpdate.shipping_ETA}
                          onChange={(event) =>
                            setContainerUpdate((current) => ({
                              ...current,
                              shipping_ETA: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={updatingContainer}
                      onClick={() => setSelectedContainer(null)}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={updatingContainer}>
                      {updatingContainer ? "Updating..." : "Update Container"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
            <div className="modal-backdrop fade show" />
          </>
        )}
      </div>
    </>
  );
};

export default Containers;
