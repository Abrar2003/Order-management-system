import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import UpdateQcModal from "../components/UpdateQcModal";
import ShippingModal from "../components/ShippingModal";
import EditOrderModal from "../components/EditOrderModal";
import EditInspectionRecordsModal from "../components/EditInspectionRecordsModal";
import GoodsNotReadyModal from "../components/GoodsNotReadyModal";
import PdfViewerModal from "../components/PdfViewerModal";
import { getUserFromToken } from "../auth/auth.utils";
import { formatDateDDMMYYYY, toISODateString } from "../utils/date";
import { formatPositiveCbm } from "../utils/cbm";
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

const formatLbhValue = (value) => {
  const length = Number(value?.L || 0);
  const breadth = Number(value?.B || 0);
  const height = Number(value?.H || 0);
  const safeLength = Number.isFinite(length) ? length : 0;
  const safeBreadth = Number.isFinite(breadth) ? breadth : 0;
  const safeHeight = Number.isFinite(height) ? height : 0;
  if (safeLength <= 0 && safeBreadth <= 0 && safeHeight <= 0) {
    return "Not Set";
  }
  return `${safeLength} x ${safeBreadth} x ${safeHeight}`;
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
        parts.push(`${weightLabel}: ${Number(entry.weight)}`);
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

const getUtcDayOffsetFromToday = (value) => {
  const isoDate = toISODateString(value);
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const targetUtc = Date.UTC(year, month - 1, day);
  const todayIso = toISODateString(new Date());
  if (!todayIso) return null;
  const [todayYear, todayMonth, todayDay] = todayIso.split("-").map(Number);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round((todayUtc - targetUtc) / oneDayMs);
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

const isShipmentEditableStatus = (statusValue) => {
  const normalized = String(statusValue || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "partial shipped"
    || normalized === "partially shipped"
    || normalized === "shipped"
  );
};

const RELATED_FILE_OPTIONS = Object.freeze([
  {
    value: "product_image",
    label: "Product Image",
    buttonLabel: "Item image",
    scope: "item_master",
    field: "image",
    previewMode: "image",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    extensions: [".jpg", ".jpeg", ".png"],
    mimeTypes: ["image/jpeg", "image/png"],
    invalidMessage:
      "Only JPG, JPEG, or PNG files are allowed for product images.",
  },
  {
    value: "cad_file",
    label: "CAD File",
    buttonLabel: "CAD file",
    scope: "item_master",
    field: "cad_file",
    previewMode: "pdf",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for CAD files.",
  },
  {
    value: "pis_file",
    label: "PIS",
    buttonLabel: "PIS",
    scope: "item_master",
    field: "pis_file",
    previewMode: "pdf",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for PIS.",
  },
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
const MAX_QC_IMAGE_UPLOAD_COUNT = 60;

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

const QcDetails = () => {
  const { id } = useParams();
  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [relatedFileType, setRelatedFileType] = useState("product_image");
  const [qcImageUploadMode, setQcImageUploadMode] = useState("single");
  const [qcSingleImageComment, setQcSingleImageComment] = useState("");
  const [uploadingRelatedFile, setUploadingRelatedFile] = useState(false);
  const [openingRelatedFileType, setOpeningRelatedFileType] = useState("");
  const [pdfViewerFile, setPdfViewerFile] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showEditShippingModal, setShowEditShippingModal] = useState(false);
  const [showEditInspectionModal, setShowEditInspectionModal] = useState(false);
  const [showGoodsNotReadyModal, setShowGoodsNotReadyModal] = useState(false);
  const [showQcImageGallery, setShowQcImageGallery] = useState(false);
  const [activeQcImageIndex, setActiveQcImageIndex] = useState(0);
  const [deletingInspectionId, setDeletingInspectionId] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const relatedFileInputRef = useRef(null);
  const relatedFileUploadInFlightRef = useRef(false);
  const user = getUserFromToken();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const currentUserId = String(user?.id || user?._id || "").trim();
  const isQcUser = normalizedRole === "qc";
  const isAdmin = normalizedRole === "admin" || normalizedRole === "manager";
  const isOnlyAdmin = normalizedRole === "admin";
  const canFinalizeShipping = ["admin", "manager", "dev"].includes(
    normalizedRole,
  );
  const hasShippingRecords =
    Array.isArray(qc?.order?.shipment) && qc.order.shipment.length > 0;
  const canShowEditShippingButton =
    isOnlyAdmin &&
    (hasShippingRecords || isShipmentEditableStatus(qc?.order?.status));

  const isInspectionDone = qc?.order?.status === "Inspection Done";
  const pendingAlignmentInfo = useMemo(
    () => getQcPendingAlignmentInfo(qc),
    [qc],
  );
  const canUpdateQcByRole =
    isAdmin ||
    (!isInspectionDone &&
      normalizedRole === "qc");
  const alignedInspectorId = String(qc?.inspector?._id || qc?.inspector || "").trim();
  const isQcAlignedRecord = !isQcUser || (
    Boolean(currentUserId) &&
    Boolean(alignedInspectorId) &&
    alignedInspectorId === currentUserId
  );
  const inspectionDateForPermission = toISODateString(
    qc?.last_inspected_date || qc?.request_date || "",
  );
  const inspectionDateOffsetDays = getUtcDayOffsetFromToday(inspectionDateForPermission);
  const isQcInspectionDateAllowed = !isQcUser
    || (
      inspectionDateOffsetDays !== null
      && inspectionDateOffsetDays >= 0
      && inspectionDateOffsetDays <= 1
    );
  const isOneDayBackdatedForQc = isQcUser && inspectionDateOffsetDays === 1;
  const hasUsedOneDayBackdatedUpdate = Boolean(
    isOneDayBackdatedForQc
    && Array.isArray(qc?.inspection_record)
    && qc.inspection_record.some((record) => {
      const recordDate = toISODateString(record?.inspection_date || record?.createdAt || "");
      if (!recordDate || recordDate !== inspectionDateForPermission) return false;
      const recordInspectorId = String(record?.inspector?._id || record?.inspector || "").trim();
      if (!recordInspectorId || recordInspectorId !== currentUserId) return false;
      const checked = Number(record?.checked || 0);
      const passed = Number(record?.passed || 0);
      const offered = Number(record?.vendor_offered || 0);
      const labelsAddedCount = Array.isArray(record?.labels_added)
        ? record.labels_added.length
        : 0;
      return checked > 0 || passed > 0 || offered > 0 || labelsAddedCount > 0;
    })
  );
  const canUpdateQc =
    canUpdateQcByRole &&
    pendingAlignmentInfo.hasRequest &&
    isQcAlignedRecord;
  const activeRelatedFileConfig = useMemo(
    () =>
      RELATED_FILE_OPTIONS_BY_VALUE[relatedFileType]
      || RELATED_FILE_OPTIONS[0],
    [relatedFileType],
  );
  const canUploadRelatedFile = canUpdateQc;
  const canUploadActiveRelatedFile =
    canUploadRelatedFile &&
    (
      activeRelatedFileConfig?.scope === "qc" ||
      Boolean(qc?.item_master?._id)
    );
  const relatedFileUploadDisabledReason = !canUploadActiveRelatedFile
    ? activeRelatedFileConfig?.scope === "item_master" && !qc?.item_master?._id
      ? "Item master not found for this QC."
      : !pendingAlignmentInfo.hasRequest
      ? "QC is not requested yet. Align QC request before uploading."
      : !isQcAlignedRecord
      ? "QC can upload only records aligned to them."
      : isInspectionDone
      ? "After inspection is done, only admin can update this record."
      : !isQcInspectionDateAllowed
      ? "QC date rule will be validated while submitting."
      : hasUsedOneDayBackdatedUpdate
      ? "Backdated one-time rule will be validated while submitting."
      : "Only admin, manager, or aligned QC can upload related files."
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
  const barcodeValue = qc?.barcode > 0 ? String(qc.barcode) : "";

  const cbmData = useMemo(() => {
    if (!qc) return { top: "", bottom: "", total: "" };
    const cbmValue = qc.cbm;
    if (typeof cbmValue === "number" || typeof cbmValue === "string") {
      return { top: "", bottom: "", total: String(cbmValue) };
    }
    return {
      top: cbmValue?.top ?? "",
      bottom: cbmValue?.bottom ?? "",
      total: cbmValue?.total ?? "",
    };
  }, [qc]);
  const itemMasterDetails = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    const fallbackBrand = Array.isArray(itemMaster?.brands)
      ? itemMaster.brands.find((brand) => String(brand || "").trim())
      : "";
    const brandName = String(itemMaster?.brand_name || fallbackBrand || "").trim();
    const pisCbm = String(
      itemMaster?.cbm?.total
      ?? itemMaster?.cbm?.calculated_pis_total
      ?? "0",
    ).trim();
    const calculatedPisCbm = String(
      itemMaster?.cbm?.calculated_pis_total
      ?? itemMaster?.cbm?.total
      ?? "0",
    ).trim();
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
      weightNet: Number.isFinite(netWeight) ? netWeight : 0,
      weightGross: Number.isFinite(grossWeight) ? grossWeight : 0,
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
  const activeQcImage = qcImages[activeQcImageIndex] || null;

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
      uploadingRelatedFile ||
      relatedFileUploadInFlightRef.current
    ) {
      return;
    }
    relatedFileInputRef.current?.click();
  }, [canUploadActiveRelatedFile, uploadingRelatedFile]);

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

      if (fileConfig.previewMode === "pdf") {
        setPdfViewerFile({
          title: fileConfig.label,
          url: fileUrl,
          originalName:
            String(response?.data?.data?.file?.originalName || currentFile?.originalName || "").trim(),
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

 const handleRelatedFileChange = useCallback(async (event) => {
  const inputElement = event.target;
  const rawSelectedFiles = Array.from(inputElement?.files || []);
  if (rawSelectedFiles.length === 0) return;

  if (relatedFileUploadInFlightRef.current) {
    if (inputElement) inputElement.value = "";
    return;
  }

  const fileConfig =
    RELATED_FILE_OPTIONS_BY_VALUE[relatedFileType] ||
    RELATED_FILE_OPTIONS[0];
  const selectedFiles = Array.from(
    new Map(
      rawSelectedFiles.map((file) => [getSelectedFileSignature(file), file]),
    ).values(),
  );

  try {
    relatedFileUploadInFlightRef.current = true;
    setUploadingRelatedFile(true);

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
      if (selectedFiles.length > MAX_QC_IMAGE_UPLOAD_COUNT) {
        throw new Error(
          `You can upload up to ${MAX_QC_IMAGE_UPLOAD_COUNT} QC images at once.`,
        );
      }

      const formData = new FormData();

      formData.append("upload_mode", qcImageUploadMode);

      if (qcImageUploadMode === "single") {
        formData.append("comment", qcSingleImageComment);
      }

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      response = await api.post(
        `/qc/${encodeURIComponent(id)}/images`,
        formData
      );
    } else {
      if (!qc?.item_master?._id) {
        throw new Error("Item master record not found for this QC.");
      }

      const formData = new FormData();
      formData.append("file_type", relatedFileType);
      formData.append("file", selectedFiles[0]);

      response = await api.post(
        `/items/${encodeURIComponent(qc.item_master._id)}/files`,
        formData
      );
    }

    alert(
      response?.data?.message || `${fileConfig.label} uploaded successfully.`
    );

    if (fileConfig.value === "qc_images") {
      setQcSingleImageComment("");
    }

    await fetchQcDetails();
  } catch (error) {
    console.error(error);
    alert(
      error?.response?.data?.message ||
        error?.message ||
        `Failed to upload ${fileConfig.label}.`
    );
  } finally {
    relatedFileUploadInFlightRef.current = false;
    setUploadingRelatedFile(false);
    if (inputElement) inputElement.value = "";
  }
}, [
  fetchQcDetails,
  id,
  qc?.item_master?._id,
  qcImageUploadMode,
  qcSingleImageComment,
  relatedFileType,
]);

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

  useEffect(() => {
    if (qcImages.length === 0) {
      setShowQcImageGallery(false);
      setActiveQcImageIndex(0);
      return;
    }

    if (activeQcImageIndex > qcImages.length - 1) {
      setActiveQcImageIndex(0);
    }
  }, [activeQcImageIndex, qcImages.length]);

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
          <div className="d-flex align-items-center flex-wrap justify-content-end gap-2">
            <select
              className="form-select form-select-sm"
              style={{ width: "auto", minWidth: "160px" }}
              value={relatedFileType}
              onChange={(e) => setRelatedFileType(String(e.target.value || "product_image"))}
              disabled={!canUploadRelatedFile || uploadingRelatedFile}
              title={relatedFileUploadDisabledReason}
            >
              {RELATED_FILE_OPTIONS.map((option) => (
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
                  disabled={!canUploadActiveRelatedFile || uploadingRelatedFile}
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
                    disabled={!canUploadActiveRelatedFile || uploadingRelatedFile}
                  />
                )}
              </>
            )}

            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={handleOpenRelatedFilePicker}
              disabled={!canUploadActiveRelatedFile || uploadingRelatedFile}
              title={relatedFileUploadDisabledReason}
            >
              {uploadingRelatedFile ? "Uploading..." : "Upload Related File"}
            </button>

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
        </div>

        <div className="card om-card">
          <div className="card-body d-grid gap-4">
            <section>
              <h3 className="h6 mb-3">{`Order Information | ${qc.order.order_id} | ${qc.order.brand} | ${qc.order.vendor} |  Request Date: ${formatDateDDMMYYYY(qc.request_date)}`}</h3>
              <h3 className="h6 mb-3">{`Status: ${qc.order.status} | Inspector: ${qc?.inspector?.name}`}</h3>
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
                    Edit Records
                  </button>
                )}
              </div>
              {requestInspectionTimeline.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-sm table-striped align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Request Date</th>
                        <th>Inspection Date</th>
                        <th>Inspector</th>
                        <th>Requested</th>
                        <th>Offered</th>
                        <th>Inspected</th>
                        <th>Passed</th>
                        <th>CBM</th>
                        <th>Pending</th>
                        <th>Remarks</th>
                        {isOnlyAdmin && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {requestInspectionTimeline.map((row) => (
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
                          {isOnlyAdmin && (
                            <td>
                              {row.rowType === "Inspection" && row.recordId ? (
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
                        <th>Stuffing Date</th>
                        <th>Container Number</th>
                        <th>Invoice Number</th>
                        <th>Quantity</th>
                        <th>Remaining</th>
                        <th>Remaining Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qc.order.shipment.map((record) => (
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
                  <div className="qc-info-label">Barcode</div>
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
              </div>
            </section>

            <div className="d-flex justify-content-end flex-wrap gap-2">
              {canFinalizeShipping &&
                ["Inspection Done", "Partial Shipped"].includes(
                  qc?.order?.status,
                ) && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowShippingModal(true)}
                  >
                    Finalize Shipping
                  </button>
                )}

              <button
                type="button"
                className="btn btn-outline-danger"
                onClick={() => setShowGoodsNotReadyModal(true)}
                disabled={!canUpdateQc}
                title={
                  !canUpdateQc
                    ? !pendingAlignmentInfo.hasRequest
                      ? "QC is not requested yet. Align QC request before updating."
                      : !isQcAlignedRecord
                      ? "QC can update only records aligned to them."
                      : isInspectionDone
                      ? "After inspection is done, only admin can update this record."
                      : !isQcInspectionDateAllowed
                      ? "QC date rule will be validated while submitting."
                      : hasUsedOneDayBackdatedUpdate
                      ? "Backdated one-time rule will be validated while submitting."
                      : "Only admin, manager, or aligned QC can update this record."
                    : ""
                }
              >
                Goods Not Ready
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowUpdateModal(true)}
                disabled={!canUpdateQc}
                title={
                  !canUpdateQc
                    ? !pendingAlignmentInfo.hasRequest
                      ? "QC is not requested yet. Align QC request before updating."
                      : !isQcAlignedRecord
                      ? "QC can update only records aligned to them."
                      : isInspectionDone
                      ? "After inspection is done, only admin can update this record."
                      : !isQcInspectionDateAllowed
                      ? "QC date rule will be validated while submitting."
                      : hasUsedOneDayBackdatedUpdate
                      ? "Backdated one-time rule will be validated while submitting."
                      : "Only admin, manager, or aligned QC can update this record."
                    : ""
                }
              >
                Update QC Record
              </button>
            </div>
          </div>
        </div>
      </div>

      {showUpdateModal && (
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

      {showShippingModal && (
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

      {showEditInspectionModal && (
        <EditInspectionRecordsModal
          qc={qc}
          onClose={() => setShowEditInspectionModal(false)}
          onSuccess={() => {
            setShowEditInspectionModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {showGoodsNotReadyModal && (
        <GoodsNotReadyModal
          qc={qc}
          onClose={() => setShowGoodsNotReadyModal(false)}
          onSuccess={() => {
            setShowGoodsNotReadyModal(false);
            fetchQcDetails();
          }}
        />
      )}

      {pdfViewerFile && (
        <PdfViewerModal
          title={pdfViewerFile.title}
          url={pdfViewerFile.url}
          originalName={pdfViewerFile.originalName}
          onClose={() => setPdfViewerFile(null)}
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
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleCloseQcImageGallery}
              >
                Close
              </button>
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

                  return (
                    <button
                      key={String(
                        image?._id ||
                        image?.key ||
                        `${image?.originalName || "qc-image"}-${index}`,
                      )}
                      type="button"
                      className={`qc-image-gallery-thumb${isSelected ? " is-active" : ""}`}
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
