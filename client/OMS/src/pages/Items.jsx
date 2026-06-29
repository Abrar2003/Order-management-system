import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import CreateItemModal from "../components/CreateItemModal";
import AddComplaintModal from "../components/complaints/AddComplaintModal";
import SampleModal from "../components/SampleModal";
import EditItemModal from "../components/EditItemModal";
import ItemOrderPresenceTooltip from "../components/ItemOrderPresenceTooltip";
import ProductImageThumbnail from "../components/ProductImageThumbnail";
import SortHeaderButton from "../components/SortHeaderButton";
import { usePermissions } from "../auth/PermissionContext";
import { isManagerLikeRole } from "../auth/permissions";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { createComplaint } from "../services/complaints.service";
import {
  buildItemFileUploadRequest,
  DEFAULT_ITEM_FILE_TYPE,
  ITEM_FILE_UPLOAD_OPTIONS,
  ITEM_FILE_OPTIONS_BY_VALUE,
  getItemFileValues,
  isItemFileOptionAvailableForItem,
} from "../constants/itemFiles";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatCbm } from "../utils/cbm";
import { formatFixedNumber } from "../utils/measurementDisplay";
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

const normalizeMeasurementEntries = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const L = Number(entry?.L || 0);
      const B = Number(entry?.B || 0);
      const H = Number(entry?.H || 0);
      const weight = Number(weightKey ? entry?.[weightKey] : 0);
      return {
        remark: String(entry?.remark || entry?.type || "").trim(),
        L: Number.isFinite(L) ? L : 0,
        B: Number.isFinite(B) ? B : 0,
        H: Number.isFinite(H) ? H : 0,
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    .filter((entry) => entry.L > 0 && entry.B > 0 && entry.H > 0)
    .slice(0, 3);
const getPrimaryMeasurementLbh = (entries = []) =>
  normalizeMeasurementEntries(entries)[0] || {};
const sumMeasurementWeights = (entries = [], weightKey = "") =>
  normalizeMeasurementEntries(entries, weightKey).reduce(
    (sum, entry) => sum + (Number(entry?.weight || 0) || 0),
    0,
  );

const formatMeasurementPartLabel = (remark = "", fallback = "Item") => {
  const normalized = String(remark || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "top") return "Top";
  if (normalized === "base" || normalized === "bottom") return "Base";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};

const formatSizeTableNumber = (value, decimals = 2) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "-";
  return parsed.toFixed(decimals).replace(/\.?0+$/, "");
};

const getInspectedWeight = (item, key) => {
  const weightKey = key === "net" ? "net_weight" : "gross_weight";
  return key === "net"
    ? sumMeasurementWeights(item?.inspected_item_sizes, weightKey)
    : sumMeasurementWeights(item?.inspected_box_sizes, weightKey);
};

const getPisWeight = (item, key) => {
  const weightKey = key === "net" ? "net_weight" : "gross_weight";
  return key === "net"
    ? sumMeasurementWeights(item?.pis_item_sizes, weightKey)
    : sumMeasurementWeights(item?.pis_box_sizes, weightKey);
};

const getInspectedItemLbh = (item) =>
  getPrimaryMeasurementLbh(item?.inspected_item_sizes);
const getInspectedBoxLbh = (item) =>
  getPrimaryMeasurementLbh(item?.inspected_box_sizes);
const getPisItemLbh = (item) =>
  getPrimaryMeasurementLbh(item?.pis_item_sizes);
const getPisBoxLbh = (item) =>
  getPrimaryMeasurementLbh(item?.pis_box_sizes);
const getCalculatedInspectedCbm = (item) =>
  item?.cbm?.calculated_inspected_total
  ?? item?.cbm?.inspected_total
  ?? item?.cbm?.calculated_total
  ?? item?.cbm?.qc_total
  ?? item?.cbm?.total
  ?? "0";

const buildInspectedSizeRows = (item = {}) => {
  const itemEntries = normalizeMeasurementEntries(
    item?.inspected_item_sizes,
    "net_weight",
  );
  const boxEntries = normalizeMeasurementEntries(
    item?.inspected_box_sizes,
    "gross_weight",
  );
  const fallbackItemLbh = getInspectedItemLbh(item);
  const fallbackBoxLbh = getInspectedBoxLbh(item);
  const normalizedItemEntries =
    itemEntries.length > 0
      ? itemEntries
      : fallbackItemLbh?.L && fallbackItemLbh?.B && fallbackItemLbh?.H
        ? [
            {
              ...fallbackItemLbh,
              remark: "item",
              weight: getInspectedWeight(item, "net"),
            },
          ]
        : [];
  const normalizedBoxEntries =
    boxEntries.length > 0
      ? boxEntries
      : fallbackBoxLbh?.L && fallbackBoxLbh?.B && fallbackBoxLbh?.H
        ? [
            {
              ...fallbackBoxLbh,
              remark: "box",
              weight: getInspectedWeight(item, "gross"),
            },
          ]
        : [];

  return [
    ...normalizedItemEntries.map((entry, index) => ({
      ...entry,
      groupLabel: "Item",
      partLabel: formatMeasurementPartLabel(entry?.remark, index === 0 ? "Item" : `Entry ${index + 1}`),
      weightLabel: "Net",
    })),
    ...normalizedBoxEntries.map((entry, index) => ({
      ...entry,
      groupLabel: "Box",
      partLabel: formatMeasurementPartLabel(entry?.remark, index === 0 ? "Box" : `Entry ${index + 1}`),
      weightLabel: "Gross",
    })),
  ];
};

const InspectedSizeCell = ({ item }) => {
  const entries = buildInspectedSizeRows(item);

  if (entries.length === 0) {
    return <span className="text-secondary">No size data</span>;
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0 om-size-data-table items-size-data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Part</th>
            <th>L x B x H</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={`${entry.groupLabel}-${entry?.remark || "entry"}-${index}`}>
              <td>{entry.groupLabel}</td>
              <td>{entry.partLabel}</td>
              <td>
                {formatSizeTableNumber(entry?.L)} x {formatSizeTableNumber(entry?.B)} x{" "}
                {formatSizeTableNumber(entry?.H)}
              </td>
              <td>
                {formatSizeTableNumber(entry?.weight)}
                <span className="items-size-weight-label"> {entry.weightLabel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const hasItemQcRecord = (item = {}) =>
  Boolean(
    String(
      item?.latest_inspection_report_qc_id
      || item?.qc?._id
      || item?.qc?.id
      || "",
    ).trim(),
  );

const getVendorNames = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.filter(Boolean).join(", ")
    : "N/A";

const normalizeTextOptions = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

const getPrimaryBrand = (item = {}) =>
  String(
    item?.brand_name ||
      (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "") ||
      item?.brand ||
      "",
  ).trim();

const getPrimaryVendor = (item = {}) =>
  String(Array.isArray(item?.vendors) && item.vendors.length > 0 ? item.vendors[0] : "").trim();

const formatClaimPercentage = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toFixed(2).replace(/\.?0+$/, "");
};

const hasUploadedItemFile = (item, option) =>
  getItemFileValues(item, option).length > 0;

const ClaimPercentageModal = ({
  item,
  onClose,
  onSaved,
}) => {
  const [value, setValue] = useState(() => String(Number(item?.claim_percentage || 0)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 100) {
      setError("Enter a percentage between 0 and 100.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const response = await api.patch(`/items/${encodeURIComponent(item._id)}`, {
        claim_percentage: parsedValue,
      });
      onSaved(response?.data?.data || {
        ...item,
        claim_percentage: parsedValue,
      });
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message
        || saveError?.message
        || "Failed to save claim percentage.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered" role="document">
        <form className="modal-content" onSubmit={handleSubmit}>
          <div className="modal-header">
            <div>
              <h5 className="modal-title">Claim Percentage</h5>
              <div className="small text-secondary">
                Item {item?.code || "N/A"}
              </div>
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onClose}
            />
          </div>
          <div className="modal-body">
            <label className="form-label" htmlFor="item-claim-percentage">
              Claim percentage
            </label>
            <div className="input-group">
              <input
                id="item-claim-percentage"
                type="number"
                className="form-control"
                min="0"
                max="100"
                step="0.01"
                value={value}
                autoFocus
                onChange={(event) => setValue(event.target.value)}
              />
              <span className="input-group-text">%</span>
            </div>
            {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save percentage"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Items = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "items");
  const { canEditPis, hasPermission, role } = usePermissions();
  const canSyncItems = hasPermission("items", "sync");
  const canEditItems = hasPermission("items", "edit");
  const canCreateItems = hasPermission("items", "create") && canEditPis;
  const canUploadItemFiles = hasPermission("images_documents", "upload");
  const canCreateComplaints =
    hasPermission("complaints", "create") && isManagerLikeRole(role);

  const [rows, setRows] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [claimPercentageItem, setClaimPercentageItem] = useState(null);
  const [complaintItem, setComplaintItem] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateSampleModal, setShowCreateSampleModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingComplaint, setSavingComplaint] = useState(false);
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
  const [complaintBrandOptions, setComplaintBrandOptions] = useState([]);
  const [complaintVendorOptions, setComplaintVendorOptions] = useState([]);
  const [loadingComplaintOptions, setLoadingComplaintOptions] = useState(false);
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
          include_product_image_thumbnail: true,
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
    if (!canCreateComplaints) return undefined;
    let cancelled = false;

    const loadComplaintOptions = async () => {
      try {
        setLoadingComplaintOptions(true);
        const response = await api.get("/orders/brands-and-vendors");
        if (cancelled) return;
        setComplaintBrandOptions(normalizeTextOptions(response?.data?.brands));
        setComplaintVendorOptions(normalizeTextOptions(response?.data?.vendors));
      } catch {
        if (!cancelled) {
          setComplaintBrandOptions([]);
          setComplaintVendorOptions([]);
        }
      } finally {
        if (!cancelled) setLoadingComplaintOptions(false);
      }
    };

    loadComplaintOptions();
    return () => {
      cancelled = true;
    };
  }, [canCreateComplaints]);

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
          if (column === "vendor") return getVendorNames(item);
          if (column === "cbm") return Number(getCalculatedInspectedCbm(item) || 0);
          if (column === "inspectedSize") {
            const firstSizeRow = buildInspectedSizeRows(item)[0] || {};
            return [
              firstSizeRow?.L || 0,
              firstSizeRow?.B || 0,
              firstSizeRow?.H || 0,
              firstSizeRow?.weight || 0,
            ];
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

  const navigateToItemDetails = useCallback(
    (item) => {
      const itemCode = String(item?.code || "").trim();
      if (!itemCode) return;
      navigate(`/items/${encodeURIComponent(itemCode)}/details`, {
        state: {
          fromItems: `${location.pathname}${location.search}`,
        },
      });
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

  const complaintInitialValues = useMemo(
    () => ({
      brand: getPrimaryBrand(complaintItem),
      vendor: getPrimaryVendor(complaintItem),
      item_code: String(complaintItem?.code || "").trim(),
      po: "",
      first_comment: "",
    }),
    [complaintItem],
  );

  const handleOpenComplaintModal = useCallback((item) => {
    setError("");
    setSuccess("");
    setComplaintItem(item);
  }, []);

  const handleCreateComplaint = useCallback(async (formData) => {
    try {
      setSavingComplaint(true);
      setError("");
      setSuccess("");
      await createComplaint(formData);
      setComplaintItem(null);
      setSuccess("Complain created successfully.");
    } catch (createError) {
      setError(createError?.response?.data?.message || "Failed to create complain.");
    } finally {
      setSavingComplaint(false);
    }
  }, []);

  const activeItemFilePickerConfig = useMemo(
    () =>
      ITEM_FILE_OPTIONS_BY_VALUE[itemFilePickerContext?.fileType]
      || ITEM_FILE_UPLOAD_OPTIONS[0],
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
      const availableOptions = ITEM_FILE_UPLOAD_OPTIONS.filter((option) =>
        isItemFileOptionAvailableForItem(option, item),
      );
      const storedFileType = getSelectedItemFileType(itemId);
      const fileType = availableOptions.some((option) => option.value === storedFileType)
        ? storedFileType
        : availableOptions[0]?.value || DEFAULT_ITEM_FILE_TYPE;
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
    const selectedFiles = Array.from(inputElement?.files || []);
    const uploadContext = itemFilePickerContext;
    const fileConfig =
      ITEM_FILE_OPTIONS_BY_VALUE[uploadContext?.fileType]
      || ITEM_FILE_UPLOAD_OPTIONS[0];

    if (selectedFiles.length === 0 || !uploadContext?.itemId) {
      if (inputElement) inputElement.value = "";
      return;
    }

    try {
      setError("");
      setSuccess("");
      setUploadingItemId(uploadContext.itemId);

      for (const selectedFile of selectedFiles) {
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
      }

      const uploadRequest = buildItemFileUploadRequest({
        itemId: uploadContext.itemId,
        fileType: uploadContext.fileType,
        files: fileConfig.supportsMultiple ? selectedFiles : selectedFiles.slice(0, 1),
      });

      const response = await api.post(
        uploadRequest.path,
        uploadRequest.formData,
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
          multiple={Boolean(activeItemFilePickerConfig.supportsMultiple)}
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
                <table className="table table-striped table-hover align-middle om-table items-table mb-0">
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
                      <th>Image</th>
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
                          label="Vendor Name"
                          isActive={sortBy === "vendor"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("vendor", "asc")}
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
                      <th className="items-size-column">
                        <SortHeaderButton
                          label="Inspected Size"
                          isActive={sortBy === "inspectedSize"}
                          direction={sortOrder}
                          onClick={() => handleSortColumn("inspectedSize", "asc")}
                        />
                      </th>
                      <th className="items-action-column">Actions</th>
                      {/* <th>Source</th> */}
                      {/* <th>Updated At</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.length === 0 && (
                      <tr>
                        <td colSpan="8" className="text-center py-4">
                          No items found
                        </td>
                      </tr>
                    )}
                    {sortedRows.map((item) => {
                      const itemId = String(item?._id || "").trim();
                      const availableItemFileOptions = ITEM_FILE_UPLOAD_OPTIONS.filter((option) =>
                        isItemFileOptionAvailableForItem(option, item),
                      );
                      const storedSelectedFileType = getSelectedItemFileType(itemId);
                      const selectedFileType = availableItemFileOptions.some(
                        (option) => option.value === storedSelectedFileType,
                      )
                        ? storedSelectedFileType
                        : availableItemFileOptions[0]?.value || DEFAULT_ITEM_FILE_TYPE;
                      const isUploadingThisItem = uploadingItemId === itemId;
                      const isQcImageLocked =
                        selectedFileType === "qc_images" && !hasItemQcRecord(item);

                      return (
                        <tr key={item?._id || item?.code}>
                          <td>
                            {item?.code ? (
                              <ItemOrderPresenceTooltip
                                itemCode={item.code}
                                onClick={() => navigateToItemOrdersHistory(item)}
                                buttonClassName="p-0"
                              />
                            ) : (
                              "N/A"
                            )}
                          </td>
                          <td>
                            <ProductImageThumbnail
                              src={item?.product_image_url}
                              originalName={item?.product_image?.originalName}
                              alt={`${item?.code || "Item"} product image`}
                              size="sm"
                            />
                          </td>
                          <td>{item?.name || "N/A"}</td>
                          <td>
                            {item?.brand_name
                              || (Array.isArray(item?.brands) && item.brands.length > 0
                                ? item.brands[0]
                                : "N/A")}
                          </td>
                          <td>{getVendorNames(item)}</td>
                          <td>{formatCbm(getCalculatedInspectedCbm(item))}</td>
                          <td className="items-size-column">
                            <InspectedSizeCell item={item} />
                          </td>
                          <td className="items-action-column">
                            <div className="items-row-actions" aria-label={`Actions for ${item?.code || "item"}`}>
                              <button
                                type="button"
                                className="items-action-btn"
                                onClick={() => navigateToItemDetails(item)}
                                disabled={!item?.code}
                                title="Open item details"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                className="items-action-btn"
                                onClick={() => navigateToLatestInspectionReport(item)}
                                disabled={!item?.latest_inspection_report_qc_id}
                                title={
                                  item?.latest_inspection_report_qc_id
                                    ? "Open latest inspection report"
                                    : "No inspection report available yet"
                                }
                              >
                                Report
                              </button>
                              {canEditItems && (
                                <button
                                  type="button"
                                  className={
                                    Number(item?.claim_percentage || 0) > 3
                                      ? "items-action-btn items-action-btn-danger"
                                      : "items-action-btn"
                                  }
                                  onClick={() => setClaimPercentageItem(item)}
                                  title="Set item claim percentage"
                                >
                                  Claim {formatClaimPercentage(item?.claim_percentage)}%
                                </button>
                              )}
                              {canEditItems && (
                                <button
                                  type="button"
                                  className="items-action-btn"
                                  onClick={() => setSelectedItem(item)}
                                  title="Edit item"
                                >
                                  Edit
                                </button>
                              )}
                              {canCreateComplaints && (
                                <button
                                  type="button"
                                  className="items-action-btn items-action-btn-danger"
                                  onClick={() => handleOpenComplaintModal(item)}
                                  disabled={savingComplaint}
                                  title="Create complain"
                                >
                                  Complain
                                </button>
                              )}
                              {canUploadItemFiles && itemId && (
                                <div className="items-upload-action">
                                  <select
                                    className="form-select form-select-sm items-upload-select"
                                    value={selectedFileType}
                                    disabled={Boolean(uploadingItemId)}
                                    onChange={(e) =>
                                      handleItemFileTypeChange(itemId, e.target.value)
                                    }
                                  >
                                    {availableItemFileOptions.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                        {hasUploadedItemFile(item, option) ? " (Uploaded)" : ""}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="items-action-btn items-upload-btn"
                                    onClick={() => handleOpenItemFilePicker(item)}
                                    disabled={Boolean(uploadingItemId) || isQcImageLocked}
                                    title={
                                      isQcImageLocked
                                        ? "QC images can only be uploaded after a QC record exists for this item."
                                        : ""
                                    }
                                  >
                                    {isUploadingThisItem ? "Uploading..." : "Upload"}
                                  </button>
                                </div>
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

      {claimPercentageItem && canEditItems && (
        <ClaimPercentageModal
          item={claimPercentageItem}
          onClose={() => setClaimPercentageItem(null)}
          onSaved={(updatedItem) => {
            setRows((currentRows) =>
              currentRows.map((row) =>
                String(row?._id) === String(updatedItem?._id)
                  ? { ...row, ...updatedItem }
                  : row,
              ),
            );
            setClaimPercentageItem(null);
            setSuccess(
              `Claim percentage for item ${updatedItem?.code || ""} saved successfully.`,
            );
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

      {complaintItem && canCreateComplaints && (
        <AddComplaintModal
          brandOptions={complaintBrandOptions}
          initialValues={complaintInitialValues}
          itemCodeOptions={itemCodeOptions}
          loadingOptions={loadingComplaintOptions}
          onClose={() => setComplaintItem(null)}
          onSubmit={handleCreateComplaint}
          saving={savingComplaint}
          vendorOptions={complaintVendorOptions}
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
