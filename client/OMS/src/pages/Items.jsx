import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import CreateItemModal from "../components/CreateItemModal";
import SampleModal from "../components/SampleModal";
import EditItemModal from "../components/EditItemModal";
import ItemOrderPresenceTooltip from "../components/ItemOrderPresenceTooltip";
import SortHeaderButton from "../components/SortHeaderButton";
import { getUserFromToken } from "../auth/auth.utils";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatCbm } from "../utils/cbm";
import { formatFixedNumber, formatLbhValue } from "../utils/measurementDisplay";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];
const ITEM_FILE_OPTIONS = Object.freeze([
  {
    value: "product_image",
    label: "Product Image",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    extensions: [".jpg", ".jpeg", ".png"],
    mimeTypes: ["image/jpeg", "image/png"],
    invalidMessage:
      "Only JPG, JPEG, or PNG files are allowed for product images.",
  },
  {
    value: "cad_file",
    label: "CAD File",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for CAD files.",
  },
  {
    value: "pis_file",
    label: "PIS",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for PIS.",
  },
  {
    value: "assembly_file",
    label: "Assembly",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for Assembly.",
  },
]);
const ITEM_FILE_OPTIONS_BY_VALUE = Object.freeze(
  ITEM_FILE_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option;
    return acc;
  }, {}),
);
const DEFAULT_ITEM_FILE_TYPE = ITEM_FILE_OPTIONS[0]?.value || "product_image";

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

const normalizeMeasurementEntries = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const L = Number(entry?.L || 0);
      const B = Number(entry?.B || 0);
      const H = Number(entry?.H || 0);
      const weight = Number(weightKey ? entry?.[weightKey] : 0);
      return {
        L: Number.isFinite(L) ? L : 0,
        B: Number.isFinite(B) ? B : 0,
        H: Number.isFinite(H) ? H : 0,
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    .filter((entry) => entry.L > 0 && entry.B > 0 && entry.H > 0)
    .slice(0, 3);
const getPrimaryMeasurementLbh = (entries = [], fallback = {}) =>
  normalizeMeasurementEntries(entries)[0] || fallback || {};
const sumMeasurementWeights = (entries = [], weightKey = "") =>
  normalizeMeasurementEntries(entries, weightKey).reduce(
    (sum, entry) => sum + (Number(entry?.weight || 0) || 0),
    0,
  );

const getWeightValue = (weight = {}, key = "") => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return 0;

  const weightKeyMap = {
    net: "total_net",
    gross: "total_gross",
  };
  const resolvedKey = weightKeyMap[normalizedKey] || normalizedKey;
  const legacyFallbackByKey = {
    total_net: "net",
    total_gross: "gross",
  };
  const rawValue =
    weight?.[resolvedKey]
    ?? (legacyFallbackByKey[resolvedKey] ? weight?.[legacyFallbackByKey[resolvedKey]] : undefined)
    ?? 0;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getInspectedWeight = (item, key) => {
  const weightKey = key === "net" ? "net_weight" : "gross_weight";
  const sizeEntryWeight =
    key === "net"
      ? sumMeasurementWeights(item?.inspected_item_sizes, weightKey)
      : sumMeasurementWeights(item?.inspected_box_sizes, weightKey);
  return sizeEntryWeight || getWeightValue(item?.inspected_weight, key) || getWeightValue(item?.weight, key);
};

const getPisWeight = (item, key) => {
  const weightKey = key === "net" ? "net_weight" : "gross_weight";
  const sizeEntryWeight =
    key === "net"
      ? sumMeasurementWeights(item?.pis_item_sizes, weightKey)
      : sumMeasurementWeights(item?.pis_box_sizes, weightKey);
  return sizeEntryWeight || getWeightValue(item?.pis_weight, key);
};

const getInspectedItemLbh = (item) =>
  getPrimaryMeasurementLbh(item?.inspected_item_sizes, item?.inspected_item_LBH || item?.item_LBH || {});
const getInspectedBoxLbh = (item) =>
  getPrimaryMeasurementLbh(item?.inspected_box_sizes, item?.inspected_box_LBH || item?.box_LBH || {});
const getPisItemLbh = (item) =>
  getPrimaryMeasurementLbh(item?.pis_item_sizes, item?.pis_item_LBH || {});
const getPisBoxLbh = (item) =>
  getPrimaryMeasurementLbh(item?.pis_box_sizes, item?.pis_box_LBH || {});
const getCalculatedInspectedCbm = (item) =>
  item?.cbm?.calculated_inspected_total
  ?? item?.cbm?.inspected_total
  ?? item?.cbm?.calculated_total
  ?? item?.cbm?.qc_total
  ?? item?.cbm?.total
  ?? "0";

const hasItemQcRecord = (item = {}) =>
  Boolean(
    String(
      item?.latest_inspection_report_qc_id
      || item?.qc?._id
      || item?.qc?.id
      || "",
    ).trim(),
  );

const Items = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "items");
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const canSyncItems = ["admin", "manager", "dev"].includes(normalizedRole);
  const canEditItems = ["admin", "manager", "dev"].includes(normalizedRole);
  const canCreateItems = ["admin", "manager", "dev"].includes(normalizedRole);
  const canUploadItemFiles = ["admin", "manager"].includes(normalizedRole);

  const [rows, setRows] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateSampleModal, setShowCreateSampleModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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
  const [filters, setFilters] = useState({
    brands: [],
    vendors: [],
    item_codes: [],
  });
  const [syncedQuery, setSyncedQuery] = useState(null);
  const [selectedItemFileTypes, setSelectedItemFileTypes] = useState({});
  const [uploadingItemId, setUploadingItemId] = useState("");
  const [itemFilePickerContext, setItemFilePickerContext] = useState(null);
  const itemFileInputRef = useRef(null);
  const [sortBy, setSortBy] = useState("code");
  const [sortOrder, setSortOrder] = useState("asc");

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await api.get("/items", {
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
        item_codes: Array.isArray(res?.data?.filters?.item_codes)
          ? res.data.filters.item_codes
          : [],
      });
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load items.");
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
  }, [brandFilter, limit, page, searchInput, vendorFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    const currentQuery = searchParams.toString();
    if (syncedQuery === currentQuery) return;

    const nextSearchInput = normalizeSearchParam(searchParams.get("search"));
    const nextBrandFilter = normalizeFilterParam(searchParams.get("brand"), "all");
    const nextVendorFilter = normalizeFilterParam(searchParams.get("vendor"), "all");
    const nextPage = parsePositiveInt(searchParams.get("page"), 1);
    const nextLimit = parseLimit(searchParams.get("limit"));

    setSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setDraftSearchInput((prev) => (prev === nextSearchInput ? prev : nextSearchInput));
    setBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setDraftBrandFilter((prev) => (prev === nextBrandFilter ? prev : nextBrandFilter));
    setVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
    setDraftVendorFilter((prev) => (prev === nextVendorFilter ? prev : nextVendorFilter));
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

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError("");
      setSuccess("");

      const res = await api.post("/items/sync");
      const totalItems = Number(res?.data?.summary?.total_items || 0);
      const orderCreated = Number(res?.data?.summary?.order_sync?.created || 0);
      const orderUpdated = Number(res?.data?.summary?.order_sync?.updated || 0);
      const qcCreated = Number(res?.data?.summary?.qc_sync?.created || 0);
      const qcUpdated = Number(res?.data?.summary?.qc_sync?.updated || 0);
      const qcCbmUpdated = Number(res?.data?.summary?.qc_cbm_sync?.updated || 0);
      const inspectionCbmUpdated = Number(
        res?.data?.summary?.inspection_cbm_sync?.updated || 0,
      );
      const derivedUpdated = Number(res?.data?.summary?.derived_sync?.updated || 0);

      setSuccess(
        `Item sync complete. Total Items: ${totalItems}. QC CBM updated: ${qcCbmUpdated}. Inspection CBM updated: ${inspectionCbmUpdated}. Orders created/updated: ${orderCreated}/${orderUpdated}. QC created/updated: ${qcCreated}/${qcUpdated}. Derived fields updated: ${derivedUpdated}.`,
      );
      await fetchItems();
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to sync items.");
    } finally {
      setSyncing(false);
    }
  };

  const handleApplyFilters = useCallback((event) => {
    event?.preventDefault();
    setPage(1);
    setSearchInput(normalizeSearchParam(draftSearchInput));
    setBrandFilter(normalizeFilterParam(draftBrandFilter, "all"));
    setVendorFilter(normalizeFilterParam(draftVendorFilter, "all"));
    setSuccess("");
  }, [draftBrandFilter, draftSearchInput, draftVendorFilter]);

  const handleClearFilters = useCallback(() => {
    setPage(1);
    setDraftSearchInput("");
    setDraftBrandFilter("all");
    setDraftVendorFilter("all");
    setSearchInput("");
    setBrandFilter("all");
    setVendorFilter("all");
    setSuccess("");
  }, []);

  const itemCodeOptions = useMemo(
    () => (Array.isArray(filters.item_codes) ? filters.item_codes : []),
    [filters.item_codes],
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

  const sortedRows = useMemo(
    () =>
      sortClientRows(rows, {
        sortBy,
        sortOrder,
        getSortValue: (item, column) => {
          if (column === "code") return item?.code;
          if (column === "name") return item?.name;
          if (column === "brand") return item?.brand_name || item?.brand;
          if (column === "netWeight") return getInspectedWeight(item, "net");
          if (column === "grossWeight") return getInspectedWeight(item, "gross");
          if (column === "cbm") return Number(getCalculatedInspectedCbm(item) || 0);
          if (column === "itemLbh") {
            const value = getInspectedItemLbh(item);
            return [value?.L || 0, value?.B || 0, value?.H || 0];
          }
          if (column === "boxLbh") {
            const value = getInspectedBoxLbh(item);
            return [value?.L || 0, value?.B || 0, value?.H || 0];
          }
          return "";
        },
      }),
    [rows, sortBy, sortOrder],
  );

  const navigateToItemOrdersHistory = useCallback(
    (item) => {
      const itemCode = String(item?.code || "").trim();
      if (!itemCode) return;
      navigate(
        `/items/${encodeURIComponent(itemCode)}/orders-history`,
        {
          state: {
            fromItems: `${location.pathname}${location.search}`,
          },
        },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const navigateToLatestInspectionReport = useCallback(
    (item) => {
      const qcId = String(item?.latest_inspection_report_qc_id || "").trim();
      if (!qcId) return;

      navigate(`/qc/${encodeURIComponent(qcId)}/inspection-report`, {
        state: {
          fromPreviousPage: `${location.pathname}${location.search}`,
        },
      });
    },
    [location.pathname, location.search, navigate],
  );

  const activeItemFilePickerConfig = useMemo(
    () =>
      ITEM_FILE_OPTIONS_BY_VALUE[itemFilePickerContext?.fileType]
      || ITEM_FILE_OPTIONS[0],
    [itemFilePickerContext?.fileType],
  );

  const getSelectedItemFileType = useCallback(
    (itemId) => {
      const normalizedItemId = String(itemId || "").trim();
      const selectedType = String(
        selectedItemFileTypes[normalizedItemId] || DEFAULT_ITEM_FILE_TYPE,
      ).trim();
      return ITEM_FILE_OPTIONS_BY_VALUE[selectedType]
        ? selectedType
        : DEFAULT_ITEM_FILE_TYPE;
    },
    [selectedItemFileTypes],
  );

  const handleItemFileTypeChange = useCallback((itemId, nextFileType) => {
    const normalizedItemId = String(itemId || "").trim();
    const normalizedFileType = String(nextFileType || "").trim();
    if (!normalizedItemId || !ITEM_FILE_OPTIONS_BY_VALUE[normalizedFileType]) {
      return;
    }

    setSelectedItemFileTypes((prev) => ({
      ...prev,
      [normalizedItemId]: normalizedFileType,
    }));
  }, []);

  const handleOpenItemFilePicker = useCallback(
    (item) => {
      if (!canUploadItemFiles || uploadingItemId) return;

      const itemId = String(item?._id || "").trim();
      if (!itemId) return;
      const fileType = getSelectedItemFileType(itemId);
      if (fileType === "qc_images" && !hasItemQcRecord(item)) {
        setSuccess("");
        setError("QC images can only be uploaded after a QC record exists for this item.");
        return;
      }

      setItemFilePickerContext({
        itemId,
        fileType,
      });

      window.setTimeout(() => {
        itemFileInputRef.current?.click();
      }, 0);
    },
    [canUploadItemFiles, getSelectedItemFileType, uploadingItemId],
  );

  const handleItemFileChange = useCallback(async (event) => {
    const inputElement = event.target;
    const selectedFile = inputElement?.files?.[0];
    const uploadContext = itemFilePickerContext;
    const fileConfig =
      ITEM_FILE_OPTIONS_BY_VALUE[uploadContext?.fileType]
      || ITEM_FILE_OPTIONS[0];

    if (!selectedFile || !uploadContext?.itemId) {
      if (inputElement) inputElement.value = "";
      return;
    }

    try {
      setError("");
      setSuccess("");
      setUploadingItemId(uploadContext.itemId);

      const normalizedName = String(selectedFile.name || "").toLowerCase();
      const normalizedType = String(selectedFile.type || "").toLowerCase();
      const hasAllowedExtension = fileConfig.extensions.some((extension) =>
        normalizedName.endsWith(extension)
      );
      const hasAllowedMimeType =
        !normalizedType || fileConfig.mimeTypes.includes(normalizedType);

      if (!hasAllowedExtension || !hasAllowedMimeType) {
        throw new Error(fileConfig.invalidMessage);
      }

      const formData = new FormData();
      formData.append("file_type", uploadContext.fileType);
      formData.append("file", selectedFile);

      const response = await api.post(
        `/items/${encodeURIComponent(uploadContext.itemId)}/files`,
        formData,
      );

      setSuccess(
        response?.data?.message || `${fileConfig.label} uploaded successfully.`,
      );
      await fetchItems();
    } catch (err) {
      setError(
        err?.response?.data?.message
          || err?.message
          || `Failed to upload ${fileConfig.label}.`,
      );
    } finally {
      setUploadingItemId("");
      setItemFilePickerContext(null);
      if (inputElement) inputElement.value = "";
    }
  }, [fetchItems, itemFilePickerContext]);

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <input
          ref={itemFileInputRef}
          type="file"
          className="d-none"
          accept={activeItemFilePickerConfig.accept}
          disabled={!canUploadItemFiles || Boolean(uploadingItemId)}
          onChange={handleItemFileChange}
        />

        <div className="d-flex justify-content-between align-items-center mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => navigate(-1)}
          >
            Back
          </button>
          <h2 className="h4 mb-0">Items</h2>
          {canSyncItems || canCreateItems ? (
            <div className="d-flex gap-2">
              {canCreateItems && (
                <>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => {
                      setError("");
                      setSuccess("");
                      setShowCreateModal(true);
                    }}
                  >
                    Create Item
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => {
                      setError("");
                      setSuccess("");
                      setShowCreateSampleModal(true);
                    }}
                  >
                    Create Sample
                  </button>
                </>
              )}
              {canSyncItems && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={syncing}
                  onClick={handleSync}
                >
                  {syncing ? "Syncing..." : "Sync Items"}
                </button>
              )}
            </div>
          ) : (
            <span className="d-none d-md-inline" />
          )}
        </div>

        <div className="card om-card mb-3">
          <div className="card-body">
            <form className="row g-2 align-items-end" onSubmit={handleApplyFilters}>
              <div className="col-md-4">
                <label className="form-label">Search (Code / Name / Description)</label>
                <input
                  type="text"
                  className="form-control"
                  value={draftSearchInput}
                  list="item-code-options"
                  placeholder="Search items"
                  onChange={(e) => setDraftSearchInput(e.target.value)}
                />
                <datalist id="item-code-options">
                  {itemCodeOptions.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
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
              <div className="col-md-2 d-grid gap-2">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={handleClearFilters}
                  disabled={loading}
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
                        <SortHeaderButton
                          label="Item Code"
                          isActive={sortBy === "code"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("code", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Name"
                          isActive={sortBy === "name"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("name", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Brand Name"
                          isActive={sortBy === "brand"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("brand", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Net Weight"
                          isActive={sortBy === "netWeight"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("netWeight", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Gross Weight"
                          isActive={sortBy === "grossWeight"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("grossWeight", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="CBM"
                          isActive={sortBy === "cbm"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("cbm", "desc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Item LBH"
                          isActive={sortBy === "itemLbh"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("itemLbh", "asc")}
                        />
                      </th>
                      <th>
                        <SortHeaderButton
                          label="Box LBH"
                          isActive={sortBy === "boxLbh"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("boxLbh", "asc")}
                        />
                      </th>
                      <th>Action</th>
                      {/* <th>Source</th> */}
                      {/* <th>Updated At</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan="9" className="text-center py-4">
                          No items found
                        </td>
                      </tr>
                    )}
                    {sortedRows.map((item) => {
                      const itemId = String(item?._id || "").trim();
                      const selectedFileType = getSelectedItemFileType(itemId);
                      const isUploadingThisItem = uploadingItemId === itemId;
                      const isQcImageLocked =
                        selectedFileType === "qc_images" && !hasItemQcRecord(item);

                      return (
                        <tr key={item?._id || item?.code}>
                          <td
                            style={{ cursor: item?.code ? "pointer" : "default" }}
                            onClick={
                              item?.code
                                ? () => navigateToItemOrdersHistory(item)
                                : undefined
                            }
                          >
                            {item?.code || "N/A"}
                          </td>
                          <td>{item?.name || "N/A"}</td>
                          <td>
                            {item?.brand_name
                              || (Array.isArray(item?.brands) && item.brands.length > 0
                                ? item.brands[0]
                                : "N/A")}
                          </td>
                          {/* <td>{Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands.join(", ") : "N/A"}</td>
                          <td>{Array.isArray(item?.vendors) && item.vendors.length > 0 ? item.vendors.join(", ") : "N/A"}</td> */}
                          <td>{formatFixedNumber(getInspectedWeight(item, "net"))}</td>
                          <td>{formatFixedNumber(getInspectedWeight(item, "gross"))}</td>
                          <td>{formatCbm(getCalculatedInspectedCbm(item))}</td>
                          <td>{formatLbhValue(getInspectedItemLbh(item), { fallback: "0.00 x 0.00 x 0.00" })}</td>
                          <td>{formatLbhValue(getInspectedBoxLbh(item), { fallback: "0.00 x 0.00 x 0.00" })}</td>
                          <td>
                            <div className="d-flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => navigateToLatestInspectionReport(item)}
                                disabled={!item?.latest_inspection_report_qc_id}
                                title={
                                  item?.latest_inspection_report_qc_id
                                    ? "Open latest inspection report"
                                    : "No inspection report available yet"
                                }
                              >
                                View Item
                              </button>
                              {canEditItems && (
                                <button
                                  type="button"
                                  className="btn btn-outline-primary btn-sm"
                                  onClick={() => setSelectedItem(item)}
                                >
                                  Edit
                                </button>
                              )}
                              {canUploadItemFiles && itemId && (
                                <>
                                  <select
                                    className="form-select form-select-sm"
                                    style={{ width: "140px" }}
                                    value={selectedFileType}
                                    disabled={Boolean(uploadingItemId)}
                                    onChange={(e) =>
                                      handleItemFileTypeChange(itemId, e.target.value)
                                    }
                                  >
                                    {ITEM_FILE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm"
                                    onClick={() => handleOpenItemFilePicker(item)}
                                    disabled={Boolean(uploadingItemId) || isQcImageLocked}
                                    title={
                                      isQcImageLocked
                                        ? "QC images can only be uploaded after a QC record exists for this item."
                                        : ""
                                    }
                                  >
                                    {isUploadingThisItem ? "Uploading..." : "Upload Files"}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                          {/* <td>
                            {item?.source?.from_orders ? "Orders" : ""}
                            {item?.source?.from_orders && item?.source?.from_qc ? " + " : ""}
                            {item?.source?.from_qc ? "QC" : ""}
                            {!item?.source?.from_orders && !item?.source?.from_qc ? "N/A" : ""}
                          </td> */}
                          {/* <td>{formatDateLabel(item?.updatedAt)}</td> */}
                        </tr>
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

      {selectedItem && canEditItems && (
        <EditItemModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={() => {
            setSelectedItem(null);
            fetchItems();
          }}
        />
      )}

      {showCreateModal && canCreateItems && (
        <CreateItemModal
          brandOptions={Array.isArray(filters.brands) ? filters.brands : []}
          vendorOptions={Array.isArray(filters.vendors) ? filters.vendors : []}
          onClose={() => setShowCreateModal(false)}
          onCreated={(createdItem) => {
            setShowCreateModal(false);
            const createdCode = String(createdItem?.code || "").trim();
            setSuccess(
              createdCode
                ? `Item ${createdCode} created successfully.`
                : "Item created successfully.",
            );
            fetchItems();
          }}
        />
      )}

      {showCreateSampleModal && canCreateItems && (
        <SampleModal
          mode="create"
          brandOptions={Array.isArray(filters.brands) ? filters.brands : []}
          vendorOptions={Array.isArray(filters.vendors) ? filters.vendors : []}
          onClose={() => setShowCreateSampleModal(false)}
          onCreated={(createdSample) => {
            setShowCreateSampleModal(false);
            const createdCode = String(createdSample?.code || "").trim();
            setSuccess(
              createdCode
                ? `Sample ${createdCode} created successfully.`
                : "Sample created successfully.",
            );
          }}
        />
      )}
    </>
  );
};

export default Items;
