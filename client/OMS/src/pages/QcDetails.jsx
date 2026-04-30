import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import UpdateQcModal from "../components/UpdateQcModal";
import ShippingModal from "../components/ShippingModal";
import EditOrderModal from "../components/EditOrderModal";
import EditInspectionRecordsModal from "../components/EditInspectionRecordsModal";
import GoodsNotReadyModal from "../components/GoodsNotReadyModal";
import RejectAllModal from "../components/RejectAllModal";
import FilePreviewModal from "../components/FilePreviewModal";
import SortHeaderButton from "../components/SortHeaderButton";
import TransferQcRequestModal from "../components/TransferQcRequestModal";
import TransferInspectionModal from "../components/TransferInspectionModal";
import { getUserFromToken } from "../auth/auth.utils";
import { isViewOnlyUser } from "../auth/permissions";
import {
  buildItemFileUploadRequest,
  ITEM_FILE_OPTIONS,
} from "../constants/itemFiles";
import {
  getNextClientSortState,
  sortClientRows,
} from "../utils/clientSort";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { formatPositiveCbm } from "../utils/cbm";
import { formatFixedNumber, formatLbhValue } from "../utils/measurementDisplay";
import {
  canTransferLatestRequestToday,
  getQcUserUpdateRequestAvailability,
  resolveLatestRequestEntry,
} from "../utils/qcRequests";
import useBulkQcImageUpload from "../hooks/useBulkQcImageUpload";
import {
  getDerivedOrderStatus,
  hasShipmentRecords as getHasShipmentRecords,
  hasShippableQuantity,
} from "../utils/orderStatus";
import { MAX_QC_IMAGE_UPLOAD_COUNT } from "../services/qcImages.service";
import Barcode from "react-barcode";
import "../App.css";

const normalizeLabels = (labels) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isFinite(label));
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

const toTimestamp = (value) => {
  if (!value) return 0;
  const asString = String(value).trim();
  if (!asString) return 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    const parsed = new Date(`${asString}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(asString)) {
    const [day, month, year] = asString.split(/[/-]/).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(asString);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const normalizeMeasurementEntries = (entries = [], weightKey = "") =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const L = Number(entry?.L || 0);
      const B = Number(entry?.B || 0);
      const H = Number(entry?.H || 0);
      const weight = Number(weightKey ? entry?.[weightKey] : 0);
      return {
        remark: String(entry?.remark || entry?.type || "").trim().toLowerCase(),
        L: Number.isFinite(L) ? L : 0,
        B: Number.isFinite(B) ? B : 0,
        H: Number.isFinite(H) ? H : 0,
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    .filter((entry) => entry.L > 0 && entry.B > 0 && entry.H > 0)
    .slice(0, 3);
const formatMeasurementRemark = (remark = "") => {
  const normalized = String(remark || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};
const formatMeasurementEntries = (
  entries = [],
  { weightLabel = "", fallback = "Not Set" } = {},
) => {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  if (normalizedEntries.length === 0) return fallback;
  return normalizedEntries
    .map((entry) => {
      const parts = [];
      const remarkLabel = formatMeasurementRemark(entry?.remark);
      if (remarkLabel) parts.push(remarkLabel);
      parts.push(formatLbhValue(entry));
      if (weightLabel && Number(entry?.weight || 0) > 0) {
        parts.push(`${weightLabel}: ${formatFixedNumber(entry.weight)}`);
      }
      return parts.join(" | ");
    })
    .join(" / ");
};
const sumMeasurementWeights = (entries = []) =>
  entries.reduce((sum, entry) => sum + (Number(entry?.weight || 0) || 0), 0);

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};
const getWeightValue = (weight = {}, key = "") => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return 0;

  const legacyFallbackByKey = {
    total_net: "net",
    total_gross: "gross",
  };
  const rawValue =
    weight?.[normalizedKey]
    ?? (legacyFallbackByKey[normalizedKey] ? weight?.[legacyFallbackByKey[normalizedKey]] : undefined)
    ?? 0;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getQcPendingAlignmentInfo = (qc = {}) => {
  const pendingQty = Math.max(
    0,
    toSafeNumber(
      qc?.quantities?.pending ??
        ((toSafeNumber(qc?.quantities?.client_demand, 0))
          - (toSafeNumber(qc?.quantities?.qc_passed, 0))),
      0,
    ),
  );
  const requestedQty = Math.max(
    0,
    toSafeNumber(qc?.quantities?.quantity_requested, 0),
  );
  const hasRequestHistory =
    Array.isArray(qc?.request_history) && qc.request_history.length > 0;
  const hasRequest = hasRequestHistory || requestedQty > 0;
  const isAligned = hasRequest && (pendingQty <= 0 || requestedQty >= pendingQty);

  if (!hasRequest) {
    return {
      hasRequest,
      isAligned,
      pendingQty,
      requestedQty,
      tooltip: "QC request is not aligned yet.",
    };
  }

  if (pendingQty <= 0) {
    return {
      hasRequest,
      isAligned,
      pendingQty,
      requestedQty,
      tooltip: "No pending quantity.",
    };
  }

  if (isAligned) {
    return {
      hasRequest,
      isAligned,
      pendingQty,
      requestedQty,
      tooltip: `QC aligned for pending quantity (requested ${requestedQty}, pending ${pendingQty}).`,
    };
  }

  return {
    hasRequest,
    isAligned,
    pendingQty,
    requestedQty,
    tooltip: `QC request is partial (requested ${requestedQty}, pending ${pendingQty}). Update is allowed; realign if needed.`,
  };
};

const InfoBox = ({ label, value, compact = false }) => (
  <div className={compact ? "qc-info-compact-item" : "col-md-3 col-lg-3"}>
    <div className="qc-info-label">{label}</div>
    <div className="qc-info-value" title={value ?? ""}>
      {value}
    </div>
  </div>
);

const RELATED_FILE_OPTIONS = Object.freeze([
  ...ITEM_FILE_OPTIONS.map((option) => ({
    ...option,
    scope: "item_master",
  })),
  {
    value: "qc_images",
    label: "QC Images",
    buttonLabel: "QC images",
    scope: "qc",
    previewMode: "image",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    extensions: [".jpg", ".jpeg", ".png"],
    mimeTypes: ["image/jpeg", "image/png"],
    invalidMessage:
      "Only JPG, JPEG, or PNG files are allowed for QC images.",
    supportsBulk: true,
  },
]);

const RELATED_FILE_OPTIONS_BY_VALUE = Object.freeze(
  RELATED_FILE_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option;
    return acc;
  }, {}),
);

const ITEM_MASTER_FILE_OPTIONS = Object.freeze(
  RELATED_FILE_OPTIONS.filter((option) => option.scope === "item_master"),
);

const hasStoredFile = (file = {}) =>
  Boolean(
    String(
      file?.key || file?.url || file?.link || file?.public_id || "",
    ).trim(),
  );

const getSelectedFileSignature = (file) =>
  [
    String(file?.name || "").trim().toLowerCase(),
    Number(file?.size || 0),
    Number(file?.lastModified || 0),
    String(file?.type || "").trim().toLowerCase(),
  ].join("__");

const getQcImageSelectionValue = (image) =>
  String(image?._id || image?.key || "").trim();

const isMongoObjectIdLike = (value) => /^[a-f0-9]{24}$/i.test(String(value || "").trim());

const buildSelectedFileBatchKey = ({
  qcId = "",
  fileType = "",
  uploadMode = "",
  comment = "",
  files = [],
} = {}) =>
  [
    String(qcId || "").trim(),
    String(fileType || "").trim().toLowerCase(),
    String(uploadMode || "").trim().toLowerCase(),
    String(comment || "").trim(),
    ...(
      Array.isArray(files)
        ? files.map((file) => getSelectedFileSignature(file)).sort()
        : []
    ),
  ].join("::");

const QcDetails = () => {
  const { id } = useParams();
  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [relatedFileType, setRelatedFileType] = useState(() => {
    const initialRole = String(getUserFromToken()?.role || "").trim().toLowerCase();
    return initialRole === "qc" ? "qc_images" : "product_image";
  });
  const [qcImageUploadMode, setQcImageUploadMode] = useState("single");
  const [qcSingleImageComment, setQcSingleImageComment] = useState("");
  const [uploadingRelatedFile, setUploadingRelatedFile] = useState(false);
  const [deletingRelatedFile, setDeletingRelatedFile] = useState(false);
  const [relatedFileUploadProgress, setRelatedFileUploadProgress] = useState(0);
  const [openingRelatedFileType, setOpeningRelatedFileType] = useState("");
  const [previewFile, setPreviewFile] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showEditShippingModal, setShowEditShippingModal] = useState(false);
  const [showEditInspectionModal, setShowEditInspectionModal] = useState(false);
  const [showGoodsNotReadyModal, setShowGoodsNotReadyModal] = useState(false);
  const [showRejectAllModal, setShowRejectAllModal] = useState(false);
  const [showTransferRequestModal, setShowTransferRequestModal] = useState(false);
  const [transferInspectionRecord, setTransferInspectionRecord] = useState(null);
  const [showQcImageGallery, setShowQcImageGallery] = useState(false);
  const [activeQcImageIndex, setActiveQcImageIndex] = useState(0);
  const [selectedQcImageIds, setSelectedQcImageIds] = useState([]);
  const [timelineSortBy, setTimelineSortBy] = useState("inspectionDate");
  const [timelineSortOrder, setTimelineSortOrder] = useState("desc");
  const [shippingSortBy, setShippingSortBy] = useState("stuffingDate");
  const [shippingSortOrder, setShippingSortOrder] = useState("desc");
  const [deletingQcImages, setDeletingQcImages] = useState(false);
  const [deletingInspectionId, setDeletingInspectionId] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const relatedFileInputRef = useRef(null);
  const relatedFileUploadInFlightRef = useRef(false);
  const relatedFileUploadBatchKeyRef = useRef("");
  const {
    state: qcImageUploadState,
    canRetryFailedFiles: canRetryQcImageUpload,
    selectFiles: selectQcImageFiles,
    startUpload: startQcImageUpload,
    retryFailedFiles: retryFailedQcImageFiles,
    reset: resetQcImageUpload,
  } = useBulkQcImageUpload({ qcId: id });
  const user = getUserFromToken();
  const isViewOnly = isViewOnlyUser(user);
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const currentUserId = String(user?.id || user?._id || "").trim();
  const isQcUser = normalizedRole === "qc";
  const isAdmin = normalizedRole === "admin" || normalizedRole === "manager";
  const isOnlyAdmin = normalizedRole === "admin";
  const canTransferInspectionRecords = isAdmin;
  const showInspectionActions = canTransferInspectionRecords || isOnlyAdmin;
  const canFinalizeShipping = ["admin", "manager", "dev"].includes(
    normalizedRole,
  );
  const derivedOrderStatus = useMemo(
    () => getDerivedOrderStatus({ order: qc?.order || {}, qc }),
    [qc],
  );
  const hasShippingRecords = getHasShipmentRecords(qc?.order || {});
  const canFinalizeMoreShipping = hasShippableQuantity({
    order: qc?.order || {},
    qc,
  });
  const canShowEditShippingButton =
    isOnlyAdmin && hasShippingRecords;

  const pendingAlignmentInfo = useMemo(
    () => getQcPendingAlignmentInfo(qc),
    [qc],
  );
  const canShowTransferRequest = canTransferLatestRequestToday(qc);
  const canUpdateQcByRole =
    isAdmin ||
    normalizedRole === "qc";
  const latestRequestEntry = useMemo(
    () => resolveLatestRequestEntry(qc?.request_history),
    [qc],
  );
  const qcUserRequestAvailability = useMemo(
    () => getQcUserUpdateRequestAvailability(qc, { currentUserId }),
    [qc, currentUserId],
  );
  const alignedInspectorId = String(
    latestRequestEntry?.inspector?._id ||
      latestRequestEntry?.inspector ||
      qc?.inspector?._id ||
      qc?.inspector ||
      "",
  ).trim();
  const isQcAlignedRecord = !isQcUser || (
    Boolean(currentUserId) &&
    Boolean(alignedInspectorId) &&
    alignedInspectorId === currentUserId
  );
  const canUpdateQc =
    canUpdateQcByRole &&
    pendingAlignmentInfo.hasRequest &&
    isQcAlignedRecord &&
    (!isQcUser || qcUserRequestAvailability.isAvailable);
  const qcUpdateDisabledReason = !canUpdateQc
    ? !pendingAlignmentInfo.hasRequest
      ? "QC is not requested yet. Align QC request before updating."
      : isQcUser && !qcUserRequestAvailability.isAvailable
      ? qcUserRequestAvailability.reason
      : !isQcAlignedRecord
      ? "Only the inspector assigned to this QC request can update it."
      : "Only admin, manager, or aligned QC can update this record."
    : "";
  const availableRelatedFileOptions = useMemo(
    () =>
      isQcUser
        ? RELATED_FILE_OPTIONS.filter((option) => option.scope === "qc")
        : RELATED_FILE_OPTIONS,
    [isQcUser],
  );
  const activeRelatedFileConfig = useMemo(
    () =>
      RELATED_FILE_OPTIONS_BY_VALUE[relatedFileType]
      || availableRelatedFileOptions[0]
      || RELATED_FILE_OPTIONS[0],
    [availableRelatedFileOptions, relatedFileType],
  );
  const canUploadQcImages = isAdmin || isQcUser;
  const canUploadItemMasterFiles = isAdmin && canUpdateQc;
  const canUploadRelatedFile =
    activeRelatedFileConfig?.scope === "qc"
      ? canUploadQcImages
      : canUploadItemMasterFiles;
  const canManageQcImages = isAdmin;
  const canUploadActiveRelatedFile =
    canUploadRelatedFile &&
    (
      activeRelatedFileConfig?.scope === "qc" ||
      Boolean(qc?.item_master?._id)
    );
  const isQcImageUploadType = activeRelatedFileConfig?.value === "qc_images";
  const isRelatedUploadBusy = uploadingRelatedFile || qcImageUploadState.isUploading;
  const activeRelatedUploadProgress = isQcImageUploadType
    ? qcImageUploadState.progressPercent
    : relatedFileUploadProgress;
  const hasQueuedQcImageFiles = qcImageUploadState.selectedFiles.length > 0;
  const showQcImageUploadPanel =
    isQcImageUploadType &&
    (
      hasQueuedQcImageFiles ||
      qcImageUploadState.batchStatuses.length > 0 ||
      Boolean(qcImageUploadState.summary) ||
      Boolean(qcImageUploadState.selectionMessage)
    );
  const relatedFileUploadDisabledReason = !canUploadActiveRelatedFile
    ? activeRelatedFileConfig?.scope === "item_master" && !qc?.item_master?._id
      ? "Item master not found for this QC."
      : activeRelatedFileConfig?.scope === "item_master" && !isAdmin
      ? "Only admin or manager can upload item related files."
      : activeRelatedFileConfig?.scope === "qc"
      ? "Only admin, manager, or QC can upload QC images."
      : "Only admin or manager can upload item related files."
    : "";

  const sortedLabels = useMemo(() => normalizeLabels(qc?.labels), [qc?.labels]);
  const backTarget = useMemo(() => {
    const fromQcList = String(location.state?.fromQcList || "").trim();
    if (
      fromQcList &&
      fromQcList.startsWith("/qc") &&
      !fromQcList.startsWith("/qc/")
    ) {
      return fromQcList;
    }
    return "/qc";
  }, [location.state]);
  const hasQcListBackState = useMemo(() => {
    const fromQcList = String(location.state?.fromQcList || "").trim();
    return (
      Boolean(fromQcList) &&
      fromQcList.startsWith("/qc") &&
      !fromQcList.startsWith("/qc/")
    );
  }, [location.state]);

  const handleBackNavigation = useCallback(() => {
    if (hasQcListBackState) {
      navigate(-1);
      return;
    }
    navigate(backTarget, { replace: true });
  }, [backTarget, hasQcListBackState, navigate]);

  const labelRange = sortedLabels.length
    ? `${sortedLabels[0]} - ${sortedLabels[sortedLabels.length - 1]}`
    : "None";
  const labelRangesText = useMemo(() => {
    const ranges = [];
    const seen = new Set();

    (qc?.inspection_record || []).forEach((record) => {
      (record?.label_ranges || []).forEach((range) => {
        const start = Number(range?.start);
        const end = Number(range?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;

        const key = `${start}-${end}`;
        if (seen.has(key)) return;
        seen.add(key);
        ranges.push(key);
      });
    });

    return ranges.length > 0 ? ranges.join(" | ") : "None";
  }, [qc?.inspection_record]);
  const barcodeValue =
    (qc?.master_barcode || qc?.barcode) > 0
      ? String(qc?.master_barcode || qc?.barcode)
      : "";
  const innerBarcodeValue =
    qc?.inner_barcode > 0 ? String(qc.inner_barcode) : "";

  const cbmData = useMemo(() => {
    if (!qc) return { top: "", bottom: "", total: "" };
    const cbmValue = qc.cbm;
    if (typeof cbmValue === "number" || typeof cbmValue === "string") {
      return { top: "", bottom: "", total: toSafeNumber(cbmValue, 0) };
    }
    return {
      top: toSafeNumber(cbmValue?.top ?? cbmValue?.box1, 0),
      bottom: toSafeNumber(cbmValue?.bottom ?? cbmValue?.box2, 0),
      total: toSafeNumber(cbmValue?.total, 0),
    };
  }, [qc]);
  const itemMasterDetails = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    const fallbackBrand = Array.isArray(itemMaster?.brands)
      ? itemMaster.brands.find((brand) => String(brand || "").trim())
      : "";
    const brandName = String(itemMaster?.brand_name || fallbackBrand || "").trim();
    const pisCbm =
      itemMaster?.cbm?.total
      ?? itemMaster?.cbm?.calculated_pis_total
      ?? 0;
    const calculatedPisCbm =
      itemMaster?.cbm?.calculated_pis_total
      ?? itemMaster?.cbm?.total
      ?? 0;
    const pisItemSizeEntries = normalizeMeasurementEntries(
      itemMaster?.pis_item_sizes,
      "net_weight",
    );
    const pisBoxSizeEntries = normalizeMeasurementEntries(
      itemMaster?.pis_box_sizes,
      "gross_weight",
    );
    const netWeight = Number(
      (pisItemSizeEntries.length > 0
        ? sumMeasurementWeights(pisItemSizeEntries)
        : 0)
      || getWeightValue(itemMaster?.pis_weight, "total_net")
      || itemMaster?.weight?.net
      || 0,
    );
    const grossWeight = Number(
      (pisBoxSizeEntries.length > 0
        ? sumMeasurementWeights(pisBoxSizeEntries)
        : 0)
      || getWeightValue(itemMaster?.pis_weight, "total_gross")
      || itemMaster?.weight?.gross
      || 0,
    );
    const itemLbhSource = itemMaster?.pis_item_LBH || itemMaster?.item_LBH;
    const boxLbhSource = itemMaster?.pis_box_LBH || itemMaster?.box_LBH;

    return {
      code: String(itemMaster?.code || qc?.item?.item_code || "N/A").trim() || "N/A",
      description:
        String(itemMaster?.description || itemMaster?.name || "N/A").trim() || "N/A",
      brandName: brandName || "N/A",
      weightNet: formatFixedNumber(Number.isFinite(netWeight) ? netWeight : 0),
      weightGross: formatFixedNumber(Number.isFinite(grossWeight) ? grossWeight : 0),
      itemLbh:
        pisItemSizeEntries.length > 0
          ? formatMeasurementEntries(pisItemSizeEntries, { weightLabel: "Net" })
          : formatLbhValue(itemLbhSource),
      boxLbh:
        pisBoxSizeEntries.length > 0
          ? formatMeasurementEntries(pisBoxSizeEntries, { weightLabel: "Gross" })
          : formatLbhValue(boxLbhSource),
      pisCbm: formatPositiveCbm(pisCbm, "Not Set"),
      calculatedPisCbm: formatPositiveCbm(calculatedPisCbm, "Not Set"),
    };
  }, [qc]);
  const finishRows = useMemo(() => {
    const finishEntries = Array.isArray(qc?.item_master?.finish)
      ? qc.item_master.finish
      : [];

    return finishEntries
      .map((entry, index) => ({
        key: String(entry?.finish_id || entry?.unique_code || `finish-${index}`),
        uniqueCode: String(entry?.unique_code || "").trim() || "N/A",
        vendor: String(entry?.vendor || "").trim() || "N/A",
        vendorCode: String(entry?.vendor_code || "").trim() || "N/A",
        color: String(entry?.color || "").trim() || "N/A",
        colorCode: String(entry?.color_code || "").trim() || "N/A",
        imageUrl: String(entry?.image?.url || entry?.image?.link || "").trim(),
      }))
      .sort((left, right) => left.uniqueCode.localeCompare(right.uniqueCode));
  }, [qc?.item_master?.finish]);
  const itemMasterFiles = useMemo(
    () =>
      ITEM_MASTER_FILE_OPTIONS.map((option) => ({
        ...option,
        file: qc?.item_master?.[option.field] || null,
      })),
    [qc?.item_master],
  );
  const hasAnyItemMasterFile = useMemo(
    () => itemMasterFiles.some((entry) => hasStoredFile(entry.file)),
    [itemMasterFiles],
  );
  const qcImages = useMemo(
    () => (Array.isArray(qc?.qc_images) ? qc.qc_images : []),
    [qc?.qc_images],
  );
  const activeRelatedStoredFile = useMemo(
    () => (
      activeRelatedFileConfig?.scope === "item_master" && activeRelatedFileConfig?.field
        ? qc?.item_master?.[activeRelatedFileConfig.field] || null
        : null
    ),
    [activeRelatedFileConfig, qc?.item_master],
  );
  const canDeleteActiveRelatedFile = useMemo(
    () => (
      activeRelatedFileConfig?.scope === "item_master"
      && isAdmin
      && hasStoredFile(activeRelatedStoredFile)
    ),
    [activeRelatedFileConfig, activeRelatedStoredFile, isAdmin],
  );
  const relatedFileDeleteDisabledReason = useMemo(() => {
    if (activeRelatedFileConfig?.scope === "qc") {
      return "Only admin or manager can delete QC images in the gallery.";
    }
    if (!isAdmin) {
      return "Only admin or manager can delete related files.";
    }
    if (!canUploadActiveRelatedFile) {
      return relatedFileUploadDisabledReason || "Only admin or manager can delete related files.";
    }
    if (!hasStoredFile(activeRelatedStoredFile)) {
      return `${activeRelatedFileConfig?.label || "Selected file"} is not uploaded yet.`;
    }
    return "";
  }, [
    activeRelatedFileConfig,
    activeRelatedStoredFile,
    canUploadActiveRelatedFile,
    relatedFileUploadDisabledReason,
  ]);
  const activeQcImage = qcImages[activeQcImageIndex] || null;
  const selectedQcImages = useMemo(
    () => qcImages.filter((image) => selectedQcImageIds.includes(getQcImageSelectionValue(image))),
    [qcImages, selectedQcImageIds],
  );

  const requestInspectionTimeline = useMemo(() => {
    const requestHistory = Array.isArray(qc?.request_history)
      ? qc.request_history
      : [];
    const inspectionHistory = Array.isArray(qc?.inspection_record)
      ? qc.inspection_record
      : [];

    const requestSnapshotsAsc = [...requestHistory]
      .map((request) => {
        const requestTime = Math.max(
          toTimestamp(request?.request_date),
          toTimestamp(request?.createdAt),
        );
        return {
          ...request,
          __requestTime: requestTime,
        };
      })
      .sort((a, b) => a.__requestTime - b.__requestTime);

    const resolveRequestForInspection = (inspectionDate, createdAt) => {
      if (requestSnapshotsAsc.length === 0) return null;
      const inspectionTime = Math.max(
        toTimestamp(inspectionDate),
        toTimestamp(createdAt),
      );

      if (!inspectionTime) {
        return requestSnapshotsAsc[requestSnapshotsAsc.length - 1];
      }

      let matched = null;
      for (const request of requestSnapshotsAsc) {
        if (request.__requestTime <= inspectionTime) {
          matched = request;
        }
      }

      return matched || requestSnapshotsAsc[0];
    };

    // const requestRows = requestSnapshotsAsc.map((request, index) => ({
    //   key: `request-${request?._id || index}`,
    //   rowType: "Request",
    //   sortTime: request.__requestTime || 0,
    //   requestDate: request?.request_date || "",
    //   inspectionDate: "",
    //   inspectorName: request?.inspector?.name || "N/A",
    //   requestedQty: request?.quantity_requested ?? 0,
    //   offeredQty: "-",
    //   inspectedQty: "-",
    //   passedQty: "-",
    //   cbmTotal: "-",
    //   pendingAfter: "-",
    //   remarks: request?.remarks || "QC aligned",
    // }));

    const inspectionRows = inspectionHistory.map((record, index) => {
      const linkedRequest = resolveRequestForInspection(
        record?.inspection_date,
        record?.createdAt,
      );
      const inspectionCbm = record?.cbm?.total;
      const cbmValue = formatPositiveCbm(inspectionCbm, "Not Set");

      return {
        key: `inspection-${record?._id || index}`,
        recordId: record?._id || null,
        inspectionRecord: record,
        rowType: "Inspection",
        sortTime:
          toTimestamp(record?.inspection_date) ||
          toTimestamp(record?.createdAt),
        requestDate: record?.requested_date || linkedRequest?.request_date || "",
        inspectionDate: record?.inspection_date || record?.createdAt || "",
        inspectorName: record?.inspector?.name || "N/A",
        requestedQty:record?.vendor_requested ??
          linkedRequest?.quantity_requested ??  0,
        offeredQty: record?.vendor_offered ?? 0,
        inspectedQty: record?.checked ?? 0,
        passedQty: record?.passed ?? 0,
        cbmTotal: cbmValue,
        pendingAfter: record?.pending_after ?? 0,
        remarks: record?.remarks || "None",
      };
    });

    return [ ...inspectionRows].sort(
      (a, b) => (b.sortTime || 0) - (a.sortTime || 0),
    );
  }, [qc?.request_history, qc?.inspection_record]);

  const handleTimelineSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        timelineSortBy,
        timelineSortOrder,
        column,
        defaultDirection,
      );
      setTimelineSortBy(nextSortState.sortBy);
      setTimelineSortOrder(nextSortState.sortOrder);
    },
    [timelineSortBy, timelineSortOrder],
  );

  const sortedRequestInspectionTimeline = useMemo(
    () =>
      sortClientRows(requestInspectionTimeline, {
        sortBy: timelineSortBy,
        sortOrder: timelineSortOrder,
        getSortValue: (row, column) => {
          if (column === "requestDate") return toTimestamp(row?.requestDate);
          if (column === "inspectionDate") return toTimestamp(row?.inspectionDate);
          if (column === "inspector") return row?.inspectorName;
          if (column === "requested") return Number(row?.requestedQty || 0);
          if (column === "offered") return Number(row?.offeredQty || 0);
          if (column === "inspected") return Number(row?.inspectedQty || 0);
          if (column === "passed") return Number(row?.passedQty || 0);
          if (column === "cbm") return row?.cbmTotal;
          if (column === "pending") return Number(row?.pendingAfter || 0);
          if (column === "remarks") return row?.remarks;
          return "";
        },
      }),
    [requestInspectionTimeline, timelineSortBy, timelineSortOrder],
  );

  const handleShippingSortColumn = useCallback(
    (column, defaultDirection = "asc") => {
      const nextSortState = getNextClientSortState(
        shippingSortBy,
        shippingSortOrder,
        column,
        defaultDirection,
      );
      setShippingSortBy(nextSortState.sortBy);
      setShippingSortOrder(nextSortState.sortOrder);
    },
    [shippingSortBy, shippingSortOrder],
  );

  const sortedShippingRecords = useMemo(
    () =>
      sortClientRows(Array.isArray(qc?.order?.shipment) ? qc.order.shipment : [], {
        sortBy: shippingSortBy,
        sortOrder: shippingSortOrder,
        getSortValue: (record, column) => {
          if (column === "stuffingDate") {
            return toTimestamp(record?.stuffing_date || record?.createdAt);
          }
          if (column === "container") return record?.container;
          if (column === "invoice") return record?.invoice_number;
          if (column === "quantity") return Number(record?.quantity || 0);
          if (column === "remaining") return Number(record?.pending || 0);
          if (column === "remarks") return record?.remaining_remarks;
          return "";
        },
      }),
    [qc?.order?.shipment, shippingSortBy, shippingSortOrder],
  );

  const fetchQcDetails = useCallback(async () => {
    try {
      const res = await api.get(`/qc/${id}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      setQc(res.data.data);
    } catch (err) {
      console.error(err);
      alert("Failed to load QC details");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleOpenRelatedFilePicker = useCallback(() => {
    if (
      !canUploadActiveRelatedFile ||
      isRelatedUploadBusy ||
      relatedFileUploadInFlightRef.current
    ) {
      return;
    }
    relatedFileInputRef.current?.click();
  }, [canUploadActiveRelatedFile, isRelatedUploadBusy]);

  const handleOpenRelatedFile = useCallback(async (fileType) => {
    const fileConfig =
      RELATED_FILE_OPTIONS_BY_VALUE[String(fileType || "").trim().toLowerCase()];
    if (!fileConfig || fileConfig.scope !== "item_master" || !qc?.item_master?._id) return;

    const currentFile = qc?.item_master?.[fileConfig.field];
    if (!hasStoredFile(currentFile)) {
      alert(`${fileConfig.label} is not uploaded yet.`);
      return;
    }

    try {
      setOpeningRelatedFileType(fileConfig.value);
      const response = await api.get(
        `/items/${encodeURIComponent(qc.item_master._id)}/files/${encodeURIComponent(fileConfig.value)}/url`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );

      const fileUrl = String(response?.data?.data?.url || "").trim();
      if (!fileUrl) {
        throw new Error(`${fileConfig.label} URL is not available.`);
      }

      if (fileConfig.previewMode === "pdf" || fileConfig.previewMode === "image" || fileConfig.previewMode === "office") {
        setPreviewFile({
          title: fileConfig.label,
          url: fileUrl,
          originalName:
            String(response?.data?.data?.file?.originalName || currentFile?.originalName || "").trim(),
          previewMode: fileConfig.previewMode,
        });
      } else {
        window.open(fileUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      console.error(error);
      alert(
        error?.response?.data?.message
          || error?.message
          || `Failed to open ${fileConfig.label}.`,
      );
    } finally {
      setOpeningRelatedFileType("");
    }
  }, [qc?.item_master]);

  const handleRelatedFileUploadProgress = useCallback((progressEvent) => {
    const total = Number(progressEvent?.total || 0);
    const loaded = Number(progressEvent?.loaded || 0);

    if (total > 0 && loaded >= 0) {
      const percent = Math.round((loaded / total) * 100);
      setRelatedFileUploadProgress(Math.max(0, Math.min(percent, 95)));
      return;
    }

    setRelatedFileUploadProgress((current) => (current > 0 ? current : 10));
  }, []);

  const handleDeleteRelatedFile = useCallback(async () => {
    if (deletingRelatedFile) return;

    if (!isAdmin) {
      alert("Only admin or manager can delete related files.");
      return;
    }

    if (activeRelatedFileConfig?.scope === "qc") {
      alert("Only admin or manager can delete QC images in the gallery.");
      return;
    }

    if (!qc?.item_master?._id) {
      alert("Item master record not found for this QC.");
      return;
    }

    if (!hasStoredFile(activeRelatedStoredFile)) {
      alert(`${activeRelatedFileConfig?.label || "Selected file"} is not uploaded yet.`);
      return;
    }

    const confirmed = window.confirm(
      `Delete ${activeRelatedFileConfig?.label || "selected file"}?`,
    );
    if (!confirmed) return;

    try {
      setDeletingRelatedFile(true);
      const response = await api.delete(
        `/items/${encodeURIComponent(qc.item_master._id)}/files/${encodeURIComponent(activeRelatedFileConfig.value)}`,
      );

      alert(
        response?.data?.message ||
          `${activeRelatedFileConfig?.label || "Selected file"} deleted successfully.`,
      );
      await fetchQcDetails();
    } catch (error) {
      console.error(error);
      alert(
        error?.response?.data?.message ||
          error?.message ||
          `Failed to delete ${activeRelatedFileConfig?.label || "selected file"}.`,
      );
    } finally {
      setDeletingRelatedFile(false);
    }
  }, [
    activeRelatedFileConfig,
    activeRelatedStoredFile,
    deletingRelatedFile,
    fetchQcDetails,
    isAdmin,
    qc?.item_master?._id,
  ]);

  const handleRelatedFileChange = useCallback(async (event) => {
    const inputElement = event.target;
    const rawSelectedFiles = Array.from(inputElement?.files || []);
    if (rawSelectedFiles.length === 0) return;

    if (relatedFileUploadInFlightRef.current) {
      if (inputElement) inputElement.value = "";
      return;
    }

    const fileConfig = activeRelatedFileConfig || RELATED_FILE_OPTIONS[0];
    const selectedFiles = Array.from(
      new Map(
        rawSelectedFiles.map((file) => [getSelectedFileSignature(file), file]),
      ).values(),
    );
    const batchKey = buildSelectedFileBatchKey({
      qcId: id,
      fileType: relatedFileType,
      uploadMode: qcImageUploadMode,
      comment: qcImageUploadMode === "single" ? qcSingleImageComment : "",
      files: selectedFiles,
    });

    try {
      if (
        relatedFileUploadInFlightRef.current ||
        relatedFileUploadBatchKeyRef.current === batchKey
      ) {
        if (inputElement) inputElement.value = "";
        return;
      }

      relatedFileUploadInFlightRef.current = true;
      relatedFileUploadBatchKeyRef.current = batchKey;
      setUploadingRelatedFile(true);
      setRelatedFileUploadProgress(0);

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

      let response;

      if (fileConfig.value === "qc_images") {
        relatedFileUploadInFlightRef.current = false;
        relatedFileUploadBatchKeyRef.current = "";
        setUploadingRelatedFile(false);
        setRelatedFileUploadProgress(0);
        selectQcImageFiles(selectedFiles, { uploadMode: qcImageUploadMode });
        return;
      } else {
        if (!qc?.item_master?._id) {
          throw new Error("Item master record not found for this QC.");
        }

        const uploadRequest = buildItemFileUploadRequest({
          itemId: qc.item_master._id,
          fileType: relatedFileType,
          file: selectedFiles[0],
        });

        response = await api.post(
          uploadRequest.path,
          uploadRequest.formData,
          {
            onUploadProgress: handleRelatedFileUploadProgress,
          },
        );
      }

      setRelatedFileUploadProgress(100);
      alert(
        response?.data?.message || `${fileConfig.label} uploaded successfully.`,
      );

      await fetchQcDetails();
    } catch (error) {
      console.error(error);
      alert(
        error?.response?.data?.message ||
          error?.message ||
          `Failed to upload ${fileConfig.label}.`,
      );
    } finally {
      relatedFileUploadInFlightRef.current = false;
      relatedFileUploadBatchKeyRef.current = "";
      setUploadingRelatedFile(false);
      setRelatedFileUploadProgress(0);
      if (inputElement) inputElement.value = "";
    }
  }, [
    fetchQcDetails,
    handleRelatedFileUploadProgress,
    id,
    qc?.item_master?._id,
    qcImageUploadMode,
    activeRelatedFileConfig,
    relatedFileType,
    selectQcImageFiles,
  ]);

  const handleStartQcImageUpload = useCallback(async () => {
    const result = await startQcImageUpload({
      uploadMode: qcImageUploadMode,
      comment: qcImageUploadMode === "single" ? qcSingleImageComment : "",
    });

    if (result?.uploadedCount > 0) {
      if (qcImageUploadMode === "single") {
        setQcSingleImageComment("");
      }
      await fetchQcDetails();
    }
  }, [
    fetchQcDetails,
    qcImageUploadMode,
    qcSingleImageComment,
    startQcImageUpload,
  ]);

  const handleRetryQcImageUpload = useCallback(async () => {
    const result = await retryFailedQcImageFiles({
      uploadMode: qcImageUploadMode,
      comment: qcImageUploadMode === "single" ? qcSingleImageComment : "",
    });

    if (result?.uploadedCount > 0) {
      if (qcImageUploadMode === "single") {
        setQcSingleImageComment("");
      }
      await fetchQcDetails();
    }
  }, [
    fetchQcDetails,
    qcImageUploadMode,
    qcSingleImageComment,
    retryFailedQcImageFiles,
  ]);

  const handleResetQcImageUpload = useCallback(() => {
    resetQcImageUpload();
    if (relatedFileInputRef.current) {
      relatedFileInputRef.current.value = "";
    }
  }, [resetQcImageUpload]);

  useEffect(() => {
    if (isQcImageUploadType) return;
    handleResetQcImageUpload();
  }, [handleResetQcImageUpload, isQcImageUploadType]);

  useEffect(() => {
    if (!isQcImageUploadType) return;
    handleResetQcImageUpload();
  }, [handleResetQcImageUpload, isQcImageUploadType, qcImageUploadMode]);

  const handleDeleteInspectionRecord = useCallback(
    async (recordId) => {
      if (!isOnlyAdmin || !recordId) return;

      const confirmed = window.confirm(
        "Are you sure you want to delete this inspection record?",
      );
      if (!confirmed) return;

      try {
        setDeletingInspectionId(String(recordId));
        const response = await api.delete(`/qc/${id}/inspection-record/${recordId}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });
        if (response?.data?.qc_deleted) {
          alert(
            response?.data?.message
            || "Last inspection record deleted. QC record removed and order moved to Pending.",
          );
          handleBackNavigation();
          return;
        }
        await fetchQcDetails();
      } catch (err) {
        console.error(err);
        alert(
          err?.response?.data?.message
            || "Failed to delete inspection record.",
        );
      } finally {
        setDeletingInspectionId("");
      }
    },
    [fetchQcDetails, handleBackNavigation, id, isOnlyAdmin],
  );

  const handleOpenQcImageGallery = useCallback((index = 0) => {
    if (qcImages.length === 0) return;
    const nextIndex = Math.min(
      Math.max(Number(index) || 0, 0),
      qcImages.length - 1,
    );
    setActiveQcImageIndex(nextIndex);
    setShowQcImageGallery(true);
  }, [qcImages.length]);

  const handleCloseQcImageGallery = useCallback(() => {
    setShowQcImageGallery(false);
  }, []);

  const handleToggleQcImageSelection = useCallback((image) => {
    const selectionValue = getQcImageSelectionValue(image);
    if (!selectionValue) return;

    setSelectedQcImageIds((previous) =>
      previous.includes(selectionValue)
        ? previous.filter((entry) => entry !== selectionValue)
        : [...previous, selectionValue],
    );
  }, []);

  const handleDeleteSelectedQcImages = useCallback(async () => {
    if (deletingQcImages || selectedQcImages.length === 0) return;

    const confirmed = window.confirm(
      `Delete ${selectedQcImages.length} selected QC image${selectedQcImages.length === 1 ? "" : "s"}?`,
    );
    if (!confirmed) return;

    const imageIds = selectedQcImages
      .map((image) => String(image?._id || "").trim())
      .filter((value) => isMongoObjectIdLike(value));
    const imageKeys = selectedQcImages
      .filter((image) => !isMongoObjectIdLike(String(image?._id || "").trim()))
      .map((image) => String(image?.key || "").trim())
      .filter(Boolean);

    try {
      setDeletingQcImages(true);
      const response = await api.delete(`/qc/${encodeURIComponent(id)}/images`, {
        data: {
          image_ids: imageIds,
          image_keys: imageKeys,
        },
      });

      alert(response?.data?.message || "Selected QC images deleted successfully.");
      setSelectedQcImageIds([]);
      await fetchQcDetails();
    } catch (error) {
      console.error(error);
      alert(
        error?.response?.data?.message ||
          error?.message ||
          "Failed to delete selected QC images.",
      );
    } finally {
      setDeletingQcImages(false);
    }
  }, [deletingQcImages, fetchQcDetails, id, selectedQcImages]);

  useEffect(() => {
    if (qcImages.length === 0) {
      setShowQcImageGallery(false);
      setActiveQcImageIndex(0);
      setSelectedQcImageIds([]);
      return;
    }

    if (activeQcImageIndex > qcImages.length - 1) {
      setActiveQcImageIndex(0);
    }
  }, [activeQcImageIndex, qcImages.length]);

  useEffect(() => {
    setSelectedQcImageIds((previous) =>
      previous.filter((selectionValue) =>
        qcImages.some((image) => getQcImageSelectionValue(image) === selectionValue)
      ),
    );
  }, [qcImages]);

  useEffect(() => {
    if (showQcImageGallery) return;
    setSelectedQcImageIds([]);
  }, [showQcImageGallery]);

  useEffect(() => {
    if (!showQcImageGallery) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setShowQcImageGallery(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showQcImageGallery]);

  useEffect(() => {
    fetchQcDetails();
  }, [fetchQcDetails]);

  useEffect(() => {
    if (
      availableRelatedFileOptions.some((option) => option.value === relatedFileType)
    ) {
      return;
    }

    setRelatedFileType(
      String(availableRelatedFileOptions[0]?.value || RELATED_FILE_OPTIONS[0]?.value || "qc_images"),
    );
  }, [availableRelatedFileOptions, relatedFileType]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-5 text-center">Loading...</div>
      </>
    );
  }

  if (!qc) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-5 text-center">No QC found</div>
      </>
    );
  }

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <input
          ref={relatedFileInputRef}
          type="file"
          className="d-none"
          disabled={!canUploadActiveRelatedFile || isRelatedUploadBusy}
          accept={activeRelatedFileConfig.accept}
          multiple={
            activeRelatedFileConfig?.value === "qc_images" &&
            qcImageUploadMode === "bulk"
          }
          onChange={handleRelatedFileChange}
        />

        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={handleBackNavigation}
          >
            Back
          </button>
          <h2 className="h4 mb-0">QC Details</h2>
          <div className="d-flex flex-column align-items-end gap-2">
            <div className="d-flex align-items-center flex-wrap justify-content-end gap-2">
              {!isViewOnly && (
                <>
                  <select
                    className="form-select form-select-sm"
                    style={{ width: "auto", minWidth: "160px" }}
                    value={relatedFileType}
                    onChange={(e) => setRelatedFileType(String(e.target.value || "product_image"))}
                    disabled={
                      !canUploadRelatedFile ||
                      isRelatedUploadBusy ||
                      deletingRelatedFile ||
                      availableRelatedFileOptions.length <= 1
                    }
                    title={relatedFileUploadDisabledReason}
                  >
                    {availableRelatedFileOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  {activeRelatedFileConfig?.value === "qc_images" && (
                    <>
                      <select
                        className="form-select form-select-sm"
                        style={{ width: "auto", minWidth: "140px" }}
                        value={qcImageUploadMode}
                        onChange={(e) => setQcImageUploadMode(String(e.target.value || "single"))}
                        disabled={!canUploadActiveRelatedFile || isRelatedUploadBusy || deletingRelatedFile}
                      >
                        <option value="single">Single Image</option>
                        <option value="bulk">Bulk Images</option>
                      </select>

                      {qcImageUploadMode === "single" && (
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          style={{ width: "220px" }}
                          value={qcSingleImageComment}
                          onChange={(e) => setQcSingleImageComment(String(e.target.value || ""))}
                          placeholder="Comment (optional)"
                          disabled={!canUploadActiveRelatedFile || isRelatedUploadBusy || deletingRelatedFile}
                        />
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={handleOpenRelatedFilePicker}
                    disabled={!canUploadActiveRelatedFile || isRelatedUploadBusy || deletingRelatedFile}
                    title={relatedFileUploadDisabledReason}
                  >
                    {isRelatedUploadBusy
                      ? "Uploading..."
                      : activeRelatedFileConfig?.value === "qc_images"
                      ? hasQueuedQcImageFiles
                        ? "Change Selection"
                        : "Select QC Images"
                      : "Upload Related File"}
                  </button>

                  {isQcImageUploadType && hasQueuedQcImageFiles && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleStartQcImageUpload}
                      disabled={!canUploadActiveRelatedFile || isRelatedUploadBusy || deletingRelatedFile}
                    >
                      {qcImageUploadState.isUploading ? "Uploading..." : "Start Upload"}
                    </button>
                  )}

                  {isQcImageUploadType && canRetryQcImageUpload && !qcImageUploadState.isUploading && (
                    <button
                      type="button"
                      className="btn btn-outline-warning btn-sm"
                      onClick={handleRetryQcImageUpload}
                      disabled={!canUploadActiveRelatedFile || deletingRelatedFile}
                    >
                      Retry Failed
                    </button>
                  )}

                  {isQcImageUploadType && showQcImageUploadPanel && !qcImageUploadState.isUploading && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={handleResetQcImageUpload}
                      disabled={deletingRelatedFile}
                    >
                      Clear
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={handleDeleteRelatedFile}
                      disabled={!canDeleteActiveRelatedFile || isRelatedUploadBusy || deletingRelatedFile}
                      title={relatedFileDeleteDisabledReason}
                    >
                      {deletingRelatedFile ? "Deleting..." : "Delete File"}
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() =>
                  navigate(`/qc/${encodeURIComponent(id)}/inspection-report`, {
                    state: { fromQcDetails: location.pathname + location.search },
                  })
                }
              >
                Export PDF
              </button>
            </div>

            {isRelatedUploadBusy && (
              <div
                className="d-flex flex-column align-items-end"
                style={{ width: "min(100%, 260px)" }}
              >
                <div
                  className="progress w-100"
                  role="progressbar"
                  aria-label="Related file upload progress"
                  aria-valuenow={Math.max(0, Math.min(100, activeRelatedUploadProgress))}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  style={{ height: "6px" }}
                >
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{
                      width: `${Math.max(3, Math.min(100, activeRelatedUploadProgress))}%`,
                    }}
                  />
                </div>
                <small className="text-muted mt-1">
                  Upload progress: {Math.max(0, Math.min(100, activeRelatedUploadProgress))}%
                </small>
              </div>
            )}
          </div>
        </div>

        {showQcImageUploadPanel && (
          <div className="card om-card mb-3">
            <div className="card-body d-grid gap-3">
              <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
                <div>
                  <h3 className="h6 mb-1">QC Image Batch Upload</h3>
                  <div className="small text-muted">
                    {qcImageUploadState.summary?.totalSelectedCount || qcImageUploadState.selectedFiles.length || 0} selected
                    {" | "}
                    {qcImageUploadMode === "single" ? "Single mode" : "Bulk mode"}
                    {" | "}
                    Up to {MAX_QC_IMAGE_UPLOAD_COUNT} images total, 10 per request
                  </div>
                </div>
                <div className="text-end small text-muted">
                  <div>
                    Batch {Math.max(0, qcImageUploadState.currentBatchIndex)} of {Math.max(0, qcImageUploadState.totalBatches)}
                  </div>
                  <div>
                    Uploaded {qcImageUploadState.uploadedCount}
                    {" | "}
                    Duplicates {qcImageUploadState.duplicateCount}
                    {" | "}
                    Failed {qcImageUploadState.failedCount}
                  </div>
                </div>
              </div>

              {qcImageUploadState.selectionMessage && (
                <div className="alert alert-secondary mb-0 py-2">
                  {qcImageUploadState.selectionMessage}
                </div>
              )}

              <div>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label="QC image upload progress"
                  aria-valuenow={Math.max(0, Math.min(100, qcImageUploadState.progressPercent))}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  style={{ height: "8px" }}
                >
                  <div
                    className={`progress-bar ${qcImageUploadState.isUploading ? "progress-bar-striped progress-bar-animated" : ""}`}
                    style={{
                      width: `${Math.max(3, Math.min(100, qcImageUploadState.progressPercent || 0))}%`,
                    }}
                  />
                </div>
                <div className="d-flex justify-content-between align-items-center mt-1 small text-muted flex-wrap gap-2">
                  <span>Overall progress: {Math.max(0, Math.min(100, qcImageUploadState.progressPercent))}%</span>
                  <span>
                    {qcImageUploadState.isUploading
                      ? `Uploading batch ${Math.max(1, qcImageUploadState.currentBatchIndex)} of ${Math.max(1, qcImageUploadState.totalBatches)}`
                      : "Ready for upload or retry"}
                  </span>
                </div>
              </div>

              {qcImageUploadState.batchStatuses.length > 0 && (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Status</th>
                        <th>Files</th>
                        <th>Progress</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qcImageUploadState.batchStatuses.map((batchStatus) => (
                        <tr key={batchStatus.batchId}>
                          <td>Batch {batchStatus.batchNumber}</td>
                          <td>
                            <span
                              className={`badge text-uppercase ${
                                batchStatus.status === "success"
                                  ? "bg-success"
                                  : batchStatus.status === "partial"
                                    ? "bg-warning text-dark"
                                    : batchStatus.status === "failed"
                                      ? "bg-danger"
                                      : batchStatus.status === "uploading"
                                        ? "bg-primary"
                                        : "bg-secondary"
                              }`}
                            >
                              {batchStatus.status}
                            </span>
                          </td>
                          <td>{batchStatus.fileCount}</td>
                          <td>{Math.max(0, Math.min(100, batchStatus.progressPercent || 0))}%</td>
                          <td className="small">
                            {batchStatus.uploadedCount} uploaded
                            {" | "}
                            {batchStatus.duplicateCount} duplicates
                            {" | "}
                            {batchStatus.failedCount} failed
                            {batchStatus.attempts > 1 && ` | retry ${batchStatus.attempts - 1}`}
                            {batchStatus.errorMessage && ` | ${batchStatus.errorMessage}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {qcImageUploadState.summary && (
                <div className="alert alert-info mb-0">
                  <div className="fw-semibold mb-1">Final Summary</div>
                  <div>{qcImageUploadState.summary.message}</div>
                  <div className="small mt-2">
                    Total selected: {qcImageUploadState.summary.totalSelectedCount}
                    {" | "}
                    Uploaded: {qcImageUploadState.summary.uploadedCount}
                    {" | "}
                    Duplicates skipped: {qcImageUploadState.summary.duplicateCount}
                    {" | "}
                    Failed: {qcImageUploadState.summary.failedCount}
                    {" | "}
                    Optimized: {qcImageUploadState.summary.optimizedCount}
                    {" | "}
                    Bytes saved: {qcImageUploadState.summary.bytesSaved}
                  </div>
                </div>
              )}

              {qcImageUploadState.failedFiles.length > 0 && (
                <div>
                  <div className="fw-semibold small mb-2">Failed Files</div>
                  <div className="border rounded p-2 bg-light" style={{ maxHeight: "180px", overflowY: "auto" }}>
                    <ul className="mb-0 small ps-3">
                      {qcImageUploadState.failedFiles.map((failure, index) => (
                        <li key={`${failure?.originalName || "failed-file"}-${index}`}>
                          <strong>{failure?.originalName || "Unknown file"}</strong>
                          {`: ${failure?.reason || "Upload failed"}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="card om-card">
          <div className="card-body d-grid gap-4">
            <section>
              <h3 className="h6 mb-3">{`Order Information | ${qc.order.order_id} | ${qc.order.brand} | ${qc.order.vendor} |  Request Date: ${formatDateDDMMYYYY(qc.request_date)}`}</h3>
              <h3 className="h6 mb-3">{`Status: ${derivedOrderStatus} | Inspector: ${qc?.inspector?.name}`}</h3>
              <div className="qc-order-inline-grid">
                <InfoBox compact label="Item Code" value={qc.item.item_code} />
                <InfoBox
                  compact
                  label="Description"
                  value={qc.item.description}
                />
                <InfoBox
                  compact
                  label="Order Quantity"
                  value={qc.quantities.client_demand}
                />
                <InfoBox
                  compact
                  label="Passed"
                  value={qc.quantities.qc_passed}
                />
                <InfoBox
                  compact
                  label="Pending"
                  value={qc.quantities.pending}
                />
              </div>
            </section>

            <section>
              <h3 className="h6 mb-3">Item Master Details</h3>
              <div className="row g-3">  
                <InfoBox label="Net Weight" value={itemMasterDetails.weightNet} />
                <InfoBox
                  label="Gross Weight"
                  value={itemMasterDetails.weightGross}
                />
                <InfoBox label="Item LBH" value={itemMasterDetails.itemLbh} />
                <InfoBox label="Box LBH" value={itemMasterDetails.boxLbh} />
                <InfoBox
                  label="PIS CBM"
                  value={itemMasterDetails.pisCbm}
                />
                <InfoBox
                  label="Calculated PIS CBM"
                  value={itemMasterDetails.calculatedPisCbm}
                />
              </div>
              <div className="d-flex flex-wrap gap-2 mt-3">
                {itemMasterFiles.map((entry) => {
                  const hasFile = hasStoredFile(entry.file);
                  const isOpening = openingRelatedFileType === entry.value;

                  return (
                    <button
                      key={entry.value}
                      type="button"
                      className="btn btn-outline-secondary btn-sm rounded-pill"
                      onClick={() => handleOpenRelatedFile(entry.value)}
                      disabled={!hasFile || isOpening}
                      title={
                        hasFile
                          ? entry.file?.originalName || `Open ${entry.label}`
                          : `${entry.label} is not uploaded yet.`
                      }
                    >
                      {isOpening ? "Opening..." : entry.buttonLabel}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm rounded-pill"
                  onClick={() => handleOpenQcImageGallery(0)}
                  disabled={qcImages.length === 0}
                  title={
                    qcImages.length > 0
                      ? `Open ${qcImages.length} QC image${qcImages.length === 1 ? "" : "s"}`
                      : "No QC images uploaded yet."
                  }
                >
                  QC images
                </button>
              </div>
              {!hasAnyItemMasterFile && (
                <div className="small text-muted mt-2">
                  No related item files uploaded yet.
                </div>
              )}
            </section>

            <section>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="h6 mb-0">Finish Details</h3>
                <span className="small text-secondary">
                  {finishRows.length} {finishRows.length === 1 ? "finish" : "finishes"}
                </span>
              </div>
              {finishRows.length === 0 ? (
                <div className="text-secondary small">
                  No finish details available for this item.
                </div>
              ) : (
                <div className="row g-3">
                  {finishRows.map((finish) => (
                    <div key={finish.key} className="col-md-6 col-xl-4">
                      <div className="card h-100 border-0 shadow-sm">
                        <div className="card-body d-grid gap-3">
                          {finish.imageUrl ? (
                            <button
                              type="button"
                              className="btn btn-link p-0 text-decoration-none"
                              onClick={() =>
                                window.open(
                                  finish.imageUrl,
                                  "_blank",
                                  "noopener,noreferrer",
                                )
                              }
                            >
                              <img
                                src={finish.imageUrl}
                                alt={`${finish.uniqueCode} finish`}
                                className="img-fluid rounded border"
                                style={{
                                  width: "100%",
                                  maxHeight: "220px",
                                  objectFit: "contain",
                                  backgroundColor: "#f8f9fa",
                                }}
                              />
                            </button>
                          ) : (
                            <div
                              className="border rounded d-flex align-items-center justify-content-center text-secondary small"
                              style={{
                                minHeight: "180px",
                                backgroundColor: "#f8f9fa",
                              }}
                            >
                              Finish image not available
                            </div>
                          )}

                          <div className="d-grid gap-2">
                            <div>
                              <div className="qc-info-label">Unique Code</div>
                              <div className="qc-info-value">{finish.uniqueCode}</div>
                            </div>
                            <div>
                              <div className="qc-info-label">Vendor</div>
                              <div className="qc-info-value">
                                {finish.vendor} ({finish.vendorCode})
                              </div>
                            </div>
                            <div>
                              <div className="qc-info-label">Color</div>
                              <div className="qc-info-value">
                                {finish.color} ({finish.colorCode})
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                <h3 className="h6 mb-0">QC Images</h3>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm rounded-pill"
                  onClick={() => handleOpenQcImageGallery(0)}
                  disabled={qcImages.length === 0}
                  title={
                    qcImages.length > 0
                      ? `Open ${qcImages.length} QC image${qcImages.length === 1 ? "" : "s"}`
                      : "No QC images uploaded yet."
                  }
                >
                  Open QC Image Gallery
                </button>
              </div>
              {qcImages.length > 0 ? (
                <div className="small text-muted">
                  {`${qcImages.length} QC image${qcImages.length === 1 ? "" : "s"} uploaded. Click the gallery button to browse them in grid view.`}
                </div>
              ) : (
                <div className="small text-muted">
                  No QC images uploaded yet.
                </div>
              )}
            </section>

            <section>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="h6 mb-0">Request And Inspection Records</h3>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setShowEditInspectionModal(true)}
                    disabled={!Array.isArray(qc?.inspection_record) || qc.inspection_record.length === 0}
                  >
                    Edit Records / Labels
                  </button>
                )}
              </div>
              {sortedRequestInspectionTimeline.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>
                          <SortHeaderButton
                            label="Request Date"
                            isActive={timelineSortBy === "requestDate"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("requestDate", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspection Date"
                            isActive={timelineSortBy === "inspectionDate"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("inspectionDate", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspector"
                            isActive={timelineSortBy === "inspector"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("inspector", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Requested"
                            isActive={timelineSortBy === "requested"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("requested", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Offered"
                            isActive={timelineSortBy === "offered"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("offered", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Inspected"
                            isActive={timelineSortBy === "inspected"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("inspected", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Passed"
                            isActive={timelineSortBy === "passed"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("passed", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="CBM"
                            isActive={timelineSortBy === "cbm"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("cbm", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Pending"
                            isActive={timelineSortBy === "pending"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("pending", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Remarks"
                            isActive={timelineSortBy === "remarks"}
                            direction={timelineSortOrder}
                            onClick={() => handleTimelineSortColumn("remarks", "asc")}
                          />
                        </th>
                        {showInspectionActions && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRequestInspectionTimeline.map((row) => (
                        <tr key={row.key}>
                          <td>{formatDateDDMMYYYY(row.requestDate)}</td>
                          <td>{formatDateDDMMYYYY(row.inspectionDate)}</td>
                          <td>{row.inspectorName}</td>
                          <td>{row.requestedQty}</td>
                          <td>{row.offeredQty}</td>
                          <td>{row.inspectedQty}</td>
                          <td>{row.passedQty}</td>
                          <td>{row.cbmTotal}</td>
                          <td>{row.pendingAfter}</td>
                          <td>{row.remarks}</td>
                          {showInspectionActions && (
                            <td>
                              {row.rowType === "Inspection" && row.recordId ? (
                                <div className="d-flex flex-wrap gap-2">
                                  {canTransferInspectionRecords && (
                                    <button
                                      type="button"
                                      className="btn btn-outline-primary btn-sm"
                                      disabled={Number(row?.passedQty || 0) <= 0}
                                      title={
                                        Number(row?.passedQty || 0) <= 0
                                          ? "Only inspection rows with passed quantity can be transferred."
                                          : "Transfer this inspection record"
                                      }
                                      onClick={() => setTransferInspectionRecord(row.inspectionRecord)}
                                    >
                                      Transfer
                                    </button>
                                  )}
                                  {isOnlyAdmin && (
                                    <button
                                      type="button"
                                      className="btn btn-outline-danger btn-sm"
                                      disabled={deletingInspectionId === String(row.recordId)}
                                      onClick={() => handleDeleteInspectionRecord(row.recordId)}
                                    >
                                      {deletingInspectionId === String(row.recordId)
                                        ? "Deleting..."
                                        : "Delete"}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-secondary small">N/A</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-secondary small">
                  No request or inspection records yet.
                </div>
              )}
            </section>



            <section>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h3 className="h6 mb-0">Shipping Details</h3>
                {canShowEditShippingButton && (
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => setShowEditShippingModal(true)}
                  >
                    Edit Shipping
                  </button>
                )}
              </div>
              {!hasShippingRecords ? (
                <div className="alert alert-success py-2 mb-0">
                  Shipping Pending
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>
                          <SortHeaderButton
                            label="Stuffing Date"
                            isActive={shippingSortBy === "stuffingDate"}
                            direction={shippingSortOrder}
                            onClick={() => handleShippingSortColumn("stuffingDate", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Container Number"
                            isActive={shippingSortBy === "container"}
                            direction={shippingSortOrder}
                            onClick={() => handleShippingSortColumn("container", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Invoice Number"
                            isActive={shippingSortBy === "invoice"}
                            direction={shippingSortOrder}
                            onClick={() => handleShippingSortColumn("invoice", "asc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Quantity"
                            isActive={shippingSortBy === "quantity"}
                            direction={shippingSortOrder}
                            onClick={() => handleShippingSortColumn("quantity", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Remaining"
                            isActive={shippingSortBy === "remaining"}
                            direction={shippingSortOrder}
                            onClick={() => handleShippingSortColumn("remaining", "desc")}
                          />
                        </th>
                        <th>
                          <SortHeaderButton
                            label="Remaining Remarks"
                            isActive={shippingSortBy === "remarks"}
                            direction={shippingSortOrder}
                            onClick={() => handleShippingSortColumn("remarks", "asc")}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedShippingRecords.map((record) => (
                        <tr key={record._id}>
                          <td>
                            {formatDateDDMMYYYY(
                              record?.stuffing_date || record?.createdAt,
                            )}
                          </td>
                          <td>{record?.container || "N/A"}</td>
                          <td>{record?.invoice_number || "N/A"}</td>
                          <td>{record?.quantity ?? 0}</td>
                          <td>{ record?.pending ?? 0}</td>
                          <td>{ record?.remaining_remarks ?? "None"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">QC Notes</h3>
              <div className="row g-3">
                <InfoBox label="Labels" value={labelRange} />
                <InfoBox label="Label Ranges" value={labelRangesText} />
                <InfoBox label="Remarks" value={qc.remarks || "None"} />
              </div>
              {qc?.rejected_image?.url && (
                <div className="mt-3">
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={() =>
                      window.open(
                        qc.rejected_image.url,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    View Rejected Image
                  </button>
                </div>
              )}
            </section>

            <section>
              <h3 className="h6 mb-3">QC Attributes</h3>
              <div className="row g-3 mb-3">
                <InfoBox
                  label="CBM Total"
                  value={formatPositiveCbm(cbmData.total, "Not Set")}
                />
                <InfoBox
                  label="Packed Size"
                  value={qc.packed_size ? "Yes" : "No"}
                />
                <InfoBox
                  label="Finishing"
                  value={qc.finishing ? "Yes" : "No"}
                />
                <InfoBox label="Branding" value={qc.branding ? "Yes" : "No"} />
              </div>

              <div className="row g-3">
                <div className="col-lg-6">
                  <div className="qc-info-label">Master Barcode</div>
                  <div className="qc-info-value">
                    {barcodeValue || "Not Set"}
                  </div>
                </div>
                {barcodeValue && (
                  <div className="col-lg-6">
                    <div className="qc-barcode-wrapper">
                      <Barcode value={barcodeValue} />
                    </div>
                  </div>
                )}
                {innerBarcodeValue && (
                  <div className="col-lg-6">
                    <div className="qc-info-label">Inner Carton Barcode</div>
                    <div className="qc-info-value">{innerBarcodeValue}</div>
                  </div>
                )}
              </div>
            </section>

            {!isViewOnly && (
              <div className="d-flex justify-content-end flex-wrap gap-2">
                {canFinalizeShipping &&
                  canFinalizeMoreShipping && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => setShowShippingModal(true)}
                    >
                      Finalize Shipping
                    </button>
                  )}

                {isAdmin && canShowTransferRequest && (
                  <button
                    type="button"
                    className="btn btn-outline-warning"
                    onClick={() => setShowTransferRequestModal(true)}
                  >
                    Transfer Request
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-outline-danger"
                  onClick={() => setShowGoodsNotReadyModal(true)}
                  disabled={!canUpdateQc}
                  title={!canUpdateQc ? qcUpdateDisabledReason : ""}
                >
                  Goods Not Ready
                </button>

                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setShowRejectAllModal(true)}
                  disabled={!canUpdateQc}
                  title={!canUpdateQc ? qcUpdateDisabledReason : ""}
                >
                  Reject All
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowUpdateModal(true)}
                  disabled={!canUpdateQc}
                  title={!canUpdateQc ? qcUpdateDisabledReason : ""}
                >
                  Update QC Record
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showUpdateModal && !isViewOnly && canUpdateQc && (
        <UpdateQcModal
          qc={qc}
          isAdmin={isOnlyAdmin}
          onClose={() => setShowUpdateModal(false)}
          onUpdated={() => {
            setShowUpdateModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showShippingModal && canFinalizeShipping && !isViewOnly && (
        <ShippingModal
          order={qc?.order}
          onClose={() => setShowShippingModal(false)}
          onSuccess={() => {
            setShowShippingModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showEditShippingModal && canShowEditShippingButton && (
        <EditOrderModal
          order={qc?.order}
          onClose={() => setShowEditShippingModal(false)}
          onSuccess={() => {
            setShowEditShippingModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showEditInspectionModal && isAdmin && !isViewOnly && (
        <EditInspectionRecordsModal
          qc={qc}
          onClose={() => setShowEditInspectionModal(false)}
          onSuccess={() => {
            setShowEditInspectionModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showTransferRequestModal &&
        isAdmin &&
        canShowTransferRequest &&
        !isViewOnly && (
        <TransferQcRequestModal
          qc={qc}
          onClose={() => setShowTransferRequestModal(false)}
          onTransferred={() => {
            setShowTransferRequestModal(false);
            return fetchQcDetails();
          }}
        />
      )}

      {transferInspectionRecord &&
        canTransferInspectionRecords &&
        !isViewOnly && (
        <TransferInspectionModal
          qc={qc}
          inspectionRecord={transferInspectionRecord}
          onClose={() => setTransferInspectionRecord(null)}
          onTransferred={() => {
            setTransferInspectionRecord(null);
            return fetchQcDetails();
          }}
        />
      )}

      {showGoodsNotReadyModal && !isViewOnly && (
        <GoodsNotReadyModal
          qc={qc}
          onClose={() => setShowGoodsNotReadyModal(false)}
          onSuccess={() => {
            setShowGoodsNotReadyModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showRejectAllModal && !isViewOnly && (
        <RejectAllModal
          qc={qc}
          onClose={() => setShowRejectAllModal(false)}
          onSuccess={() => {
            setShowRejectAllModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {previewFile && (
        <FilePreviewModal
          title={previewFile.title}
          url={previewFile.url}
          originalName={previewFile.originalName}
          previewMode={previewFile.previewMode}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {showQcImageGallery && activeQcImage && (
        <div
          className="qc-image-gallery-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="QC image gallery"
          onClick={handleCloseQcImageGallery}
        >
          <div
            className="qc-image-gallery-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
              <div>
                <h3 className="h5 mb-1">QC Image Gallery</h3>
                <div className="small text-muted">
                  {`${qcImages.length} image${qcImages.length === 1 ? "" : "s"} available`}
                </div>
                {selectedQcImages.length > 0 && (
                  <div className="small text-muted">
                    {`${selectedQcImages.length} selected`}
                  </div>
                )}
              </div>
              <div className="d-flex flex-wrap align-items-center gap-2">
                {canManageQcImages && (
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={handleDeleteSelectedQcImages}
                    disabled={selectedQcImages.length === 0 || deletingQcImages}
                  >
                    {deletingQcImages
                      ? "Deleting..."
                      : `Delete Selected${selectedQcImages.length > 0 ? ` (${selectedQcImages.length})` : ""}`}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={handleCloseQcImageGallery}
                  disabled={deletingQcImages}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="qc-image-gallery-body">
              <div className="qc-image-gallery-preview mb-3">
                {String(activeQcImage?.url || "").trim() ? (
                  <img
                    src={activeQcImage.url}
                    alt={activeQcImage?.originalName || "QC image"}
                    className="qc-image-gallery-preview-image"
                  />
                ) : (
                  <div className="qc-image-gallery-preview-empty">
                    Preview unavailable
                  </div>
                )}
                <div className="qc-image-gallery-preview-meta">
                  <div className="fw-semibold">
                    {activeQcImage?.originalName || "QC image"}
                  </div>
                  <div className="small text-muted mt-1">
                    {String(activeQcImage?.uploaded_by?.name || "").trim()
                      ? `Uploaded by ${activeQcImage.uploaded_by.name}`
                      : "Uploaded image"}
                  </div>
                  {String(activeQcImage?.comment || "").trim() && (
                    <div className="small mt-3">
                      <strong>Comment:</strong> {String(activeQcImage.comment || "").trim()}
                    </div>
                  )}
                </div>
              </div>

              <div className="qc-image-gallery-grid">
                {qcImages.map((image, index) => {
                  const imageUrl = String(image?.url || "").trim();
                  const isSelected = index === activeQcImageIndex;
                  const selectionValue = getQcImageSelectionValue(image);
                  const isChecked =
                    selectionValue && selectedQcImageIds.includes(selectionValue);

                  return (
                    <div
                      className="qc-image-gallery-thumb-wrap"
                      key={String(
                        image?._id ||
                        image?.key ||
                        `${image?.originalName || "qc-image"}-${index}`,
                      )}
                    >
                      <button
                        type="button"
                        className={`qc-image-gallery-thumb${isSelected ? " is-active" : ""}${isChecked ? " is-marked" : ""}`}
                        onClick={() => setActiveQcImageIndex(index)}
                        title={image?.originalName || `QC image ${index + 1}`}
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={image?.originalName || `QC image ${index + 1}`}
                            className="qc-image-gallery-thumb-image"
                          />
                        ) : (
                          <span className="qc-image-gallery-thumb-empty">
                            Preview unavailable
                          </span>
                        )}
                      </button>

                      {canManageQcImages && (
                        <label
                          className="qc-image-gallery-thumb-check"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            className="form-check-input m-0"
                            checked={Boolean(isChecked)}
                            onChange={() => handleToggleQcImageSelection(image)}
                            disabled={deletingQcImages}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default QcDetails;
