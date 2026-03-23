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
    field: "pis_file",
    previewMode: "pdf",
    accept: ".pdf,application/pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    invalidMessage: "Only PDF files are allowed for PIS.",
  },
]);

const RELATED_FILE_OPTIONS_BY_VALUE = Object.freeze(
  RELATED_FILE_OPTIONS.reduce((acc, option) => {
    acc[option.value] = option;
    return acc;
  }, {}),
);

const hasStoredItemFile = (file = {}) =>
  Boolean(
    String(
      file?.key || file?.url || file?.link || file?.public_id || "",
    ).trim(),
  );

const QcDetails = () => {
  const { id } = useParams();
  const [qc, setQc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [relatedFileType, setRelatedFileType] = useState("product_image");
  const [uploadingRelatedFile, setUploadingRelatedFile] = useState(false);
  const [openingRelatedFileType, setOpeningRelatedFileType] = useState("");
  const [pdfViewerFile, setPdfViewerFile] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showEditShippingModal, setShowEditShippingModal] = useState(false);
  const [showEditInspectionModal, setShowEditInspectionModal] = useState(false);
  const [showGoodsNotReadyModal, setShowGoodsNotReadyModal] = useState(false);
  const [deletingInspectionId, setDeletingInspectionId] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const relatedFileInputRef = useRef(null);
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
  const canUploadRelatedFile = Boolean(qc?.item_master?._id) && canUpdateQc;
  const activeRelatedFileConfig = useMemo(
    () =>
      RELATED_FILE_OPTIONS_BY_VALUE[relatedFileType]
      || RELATED_FILE_OPTIONS[0],
    [relatedFileType],
  );

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
    const netWeight = Number(
      getWeightValue(itemMaster?.pis_weight, "total_net")
      || itemMaster?.weight?.net
      || 0,
    );
    const grossWeight = Number(
      getWeightValue(itemMaster?.pis_weight, "total_gross")
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
      itemLbh: formatLbhValue(itemLbhSource),
      boxLbh: formatLbhValue(boxLbhSource),
      pisCbm: formatPositiveCbm(pisCbm, "Not Set"),
      calculatedPisCbm: formatPositiveCbm(calculatedPisCbm, "Not Set"),
    };
  }, [qc]);
  const itemMasterFiles = useMemo(
    () =>
      RELATED_FILE_OPTIONS.map((option) => ({
        ...option,
        file: qc?.item_master?.[option.field] || null,
      })),
    [qc?.item_master],
  );
  const hasAnyItemMasterFile = useMemo(
    () => itemMasterFiles.some((entry) => hasStoredItemFile(entry.file)),
    [itemMasterFiles],
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
    if (!canUploadRelatedFile || uploadingRelatedFile) return;
    relatedFileInputRef.current?.click();
  }, [canUploadRelatedFile, uploadingRelatedFile]);

  const handleOpenRelatedFile = useCallback(async (fileType) => {
    const fileConfig =
      RELATED_FILE_OPTIONS_BY_VALUE[String(fileType || "").trim().toLowerCase()];
    if (!fileConfig || !qc?.item_master?._id) return;

    const currentFile = qc?.item_master?.[fileConfig.field];
    if (!hasStoredItemFile(currentFile)) {
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
    const selectedFile = event.target?.files?.[0];
    if (!selectedFile) return;

    const fileConfig =
      RELATED_FILE_OPTIONS_BY_VALUE[relatedFileType]
      || RELATED_FILE_OPTIONS[0];
    const normalizedName = String(selectedFile.name || "").toLowerCase();
    const normalizedType = String(selectedFile.type || "").toLowerCase();
    const hasAllowedExtension = fileConfig.extensions.some((extension) =>
      normalizedName.endsWith(extension),
    );
    const hasAllowedMimeType =
      !normalizedType || fileConfig.mimeTypes.includes(normalizedType);

    if (!hasAllowedExtension || !hasAllowedMimeType) {
      alert(fileConfig.invalidMessage);
      event.target.value = "";
      return;
    }

    if (!qc?.item_master?._id) {
      alert("Item master record not found for this QC.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingRelatedFile(true);
      const formData = new FormData();
      formData.append("file_type", relatedFileType);
      formData.append("file", selectedFile);

      const response = await api.post(
        `/items/${encodeURIComponent(qc.item_master._id)}/files`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );

      alert(response?.data?.message || `${fileConfig.label} uploaded successfully.`);
      await fetchQcDetails();
    } catch (error) {
      console.error(error);
      alert(
        error?.response?.data?.message || `Failed to upload ${fileConfig.label}.`,
      );
    } finally {
      setUploadingRelatedFile(false);
      event.target.value = "";
    }
  }, [fetchQcDetails, qc?.item_master?._id, relatedFileType]);

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
              title={!qc?.item_master?._id ? "Item master not found for this QC." : ""}
            >
              {RELATED_FILE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={handleOpenRelatedFilePicker}
              disabled={!canUploadRelatedFile || uploadingRelatedFile}
              title={
                !canUploadRelatedFile
                  ? !qc?.item_master?._id
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
                  : ""
              }
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
                  const hasFile = hasStoredItemFile(entry.file);
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
              </div>
              {!hasAnyItemMasterFile && (
                <div className="small text-muted mt-2">
                  No related item files uploaded yet.
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
    </>
  );
};

export default QcDetails;
