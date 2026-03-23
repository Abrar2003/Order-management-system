import { useEffect, useRef, useState } from "react";
import api from "../api/axios";
import { getUserFromToken } from "../auth/auth.utils";
import {
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import "../App.css";
import AllocateLabelsModal from "./AllocateLabelsModal";

const NON_NEGATIVE_FIELDS = new Set([
  "qc_checked",
  "qc_passed",
  "offeredQuantity",
  "barcode",
  "CBM",
  "CBM_top",
  "CBM_bottom",
  "inspected_weight_top_net",
  "inspected_weight_top_gross",
  "inspected_weight_bottom_net",
  "inspected_weight_bottom_gross",
  "inspected_weight_total_net",
  "inspected_weight_total_gross",
  "inspected_item_L",
  "inspected_item_B",
  "inspected_item_H",
  "inspected_box_L",
  "inspected_box_B",
  "inspected_box_H",
  "inspected_top_L",
  "inspected_top_B",
  "inspected_top_H",
  "inspected_bottom_L",
  "inspected_bottom_B",
  "inspected_bottom_H",
  "inspected_item_top_L",
  "inspected_item_top_B",
  "inspected_item_top_H",
  "inspected_item_bottom_L",
  "inspected_item_bottom_B",
  "inspected_item_bottom_H",
]);

const INSPECTED_WEIGHT_FIELDS = Object.freeze([
  {
    formKey: "inspected_weight_top_net",
    payloadKey: "top_net",
    label: "Top Net Weight",
    shortLabel: "Net",
  },
  {
    formKey: "inspected_weight_top_gross",
    payloadKey: "top_gross",
    label: "Top Gross Weight",
    shortLabel: "Gross",
  },
  {
    formKey: "inspected_weight_bottom_net",
    payloadKey: "bottom_net",
    label: "Bottom Net Weight",
    shortLabel: "Net",
  },
  {
    formKey: "inspected_weight_bottom_gross",
    payloadKey: "bottom_gross",
    label: "Bottom Gross Weight",
    shortLabel: "Gross",
  },
  {
    formKey: "inspected_weight_total_net",
    payloadKey: "total_net",
    label: "Total Net Weight",
    shortLabel: "Net",
  },
  {
    formKey: "inspected_weight_total_gross",
    payloadKey: "total_gross",
    label: "Total Gross Weight",
    shortLabel: "Gross",
  },
]);

const INSPECTED_WEIGHT_GROUPS = Object.freeze([
  {
    key: "top",
    label: "Top Weight (Net/Gross)",
    fields: [INSPECTED_WEIGHT_FIELDS[0], INSPECTED_WEIGHT_FIELDS[1]],
  },
  {
    key: "bottom",
    label: "Bottom Weight (Net/Gross)",
    fields: [INSPECTED_WEIGHT_FIELDS[2], INSPECTED_WEIGHT_FIELDS[3]],
  },
  {
    key: "total",
    label: "Total Weight (Net/Gross)",
    fields: [INSPECTED_WEIGHT_FIELDS[4], INSPECTED_WEIGHT_FIELDS[5]],
  },
]);

const LEGACY_INSPECTED_WEIGHT_FALLBACK_BY_KEY = Object.freeze({
  total_net: "net",
  total_gross: "gross",
});

const createEmptyLabelRange = () => ({ start: "", end: "" });
const toDimensionInputValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return String(parsed);
};
const getWeightValueFromModel = (weightData = {}, payloadKey = "") => {
  const normalizedPayloadKey = String(payloadKey || "").trim();
  if (!normalizedPayloadKey) return 0;

  const legacyKey = LEGACY_INSPECTED_WEIGHT_FALLBACK_BY_KEY[normalizedPayloadKey];
  const rawValue =
    weightData?.[normalizedPayloadKey]
    ?? (legacyKey ? weightData?.[legacyKey] : undefined)
    ?? 0;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const hasAnyLbhInput = (values = []) =>
  values.some((value) => String(value ?? "").trim() !== "");
const hasCompletePositiveLbh = (dimensions = {}) =>
  Number(dimensions?.L || 0) > 0 &&
  Number(dimensions?.B || 0) > 0 &&
  Number(dimensions?.H || 0) > 0;

const toStrictLbhInputGroup = (dimensions = {}) => {
  const L = toDimensionInputValue(dimensions?.L);
  const B = toDimensionInputValue(dimensions?.B);
  const H = toDimensionInputValue(dimensions?.H);
  if (L && B && H) return { L, B, H };
  return { L: "", B: "", H: "" };
};

const getUtcDayOffsetFromToday = (isoDateValue) => {
  const normalizedIso = toISODateString(isoDateValue);
  if (!normalizedIso) return null;
  const [year, month, day] = normalizedIso.split("-").map(Number);
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

const toSortableTimestamp = (value) => {
  const isoDate = toISODateString(value);
  if (isoDate) {
    const parsed = new Date(`${isoDate}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const normalizeLabels = (labels = []) => {
  if (!Array.isArray(labels)) return [];
  const numericLabels = labels
    .map((label) => Number(label))
    .filter((label) => Number.isInteger(label) && label >= 0);
  return [...new Set(numericLabels)].sort((a, b) => a - b);
};

const buildLabelRangesFromLabels = (labels = []) => {
  const normalizedLabels = normalizeLabels(labels);
  if (normalizedLabels.length === 0) return [];

  const ranges = [];
  let start = normalizedLabels[0];
  let end = normalizedLabels[0];

  for (let index = 1; index < normalizedLabels.length; index += 1) {
    const label = normalizedLabels[index];
    if (label === end + 1) {
      end = label;
      continue;
    }

    ranges.push({ start: String(start), end: String(end) });
    start = label;
    end = label;
  }

  ranges.push({ start: String(start), end: String(end) });
  return ranges;
};

const getInitialLabelRanges = (record) => {
  const existingRanges = Array.isArray(record?.label_ranges)
    ? record.label_ranges
        .map((range) => ({
          start: String(range?.start ?? "").trim(),
          end: String(range?.end ?? "").trim(),
        }))
        .filter((range) => range.start !== "" || range.end !== "")
    : [];

  if (existingRanges.length > 0) return existingRanges;

  const rangesFromLabels = buildLabelRangesFromLabels(record?.labels_added);
  return rangesFromLabels.length > 0 ? rangesFromLabels : [createEmptyLabelRange()];
};

const getLatestInspectionRecord = (qc = {}) =>
  (Array.isArray(qc?.inspection_record) ? [...qc.inspection_record] : [])
    .sort((left, right) => {
      const leftTime = Math.max(
        toSortableTimestamp(left?.inspection_date),
        toSortableTimestamp(left?.createdAt),
      );
      const rightTime = Math.max(
        toSortableTimestamp(right?.inspection_date),
        toSortableTimestamp(right?.createdAt),
      );
      return rightTime - leftTime;
    })[0] || null;

const toQuantityInputValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  return String(parsed);
};

const computeAqlSampleQuantity = (quantity) => {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.ceil(parsed * 0.1));
};

const UPDATE_QC_PAST_DAYS_OVERRIDE_BY_USER = Object.freeze({
  "6993ff47473290fa1cf76b65": 3,
});

const getUpdateQcPastDaysLimit = (role = "", userId = "") => {
  const normalizedUserId = String(userId || "").trim();
  const override = UPDATE_QC_PAST_DAYS_OVERRIDE_BY_USER[normalizedUserId];
  if (Number.isInteger(override) && override >= 0) {
    return override;
  }

  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "manager") return 2;
  if (normalizedRole === "qc") return 1;
  return 0;
};

const buildUpdateQcPastDaysMessage = (role = "", daysBack = 0) => {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const actorLabel = normalizedRole === "manager" ? "Manager" : "QC";
  const safeDaysBack =
    Number.isInteger(daysBack) && daysBack >= 0 ? daysBack : 0;
  const dayLabel = safeDaysBack === 1 ? "day" : "days";
  return `${actorLabel} can update QC only for today and previous ${safeDaysBack} ${dayLabel}.`;
};

const PREFERRED_BARCODE_FORMATS = [
  "code_128",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "codabar",
];

const UpdateQcModal = ({ qc, onClose, onUpdated, isAdmin = false }) => {
  const user = getUserFromToken();
  const currentUserId = String(user?.id || user?._id || "").trim();
  const normalizedRole = String(user?.role || "").trim().toLowerCase();
  const isActualAdmin = normalizedRole === "admin";
  const isQcUser = normalizedRole === "qc";
  const isManager = normalizedRole === "manager";
  const canRewriteLatestInspectionRecord = isActualAdmin || Boolean(isAdmin);
  const hasElevatedAccess = canRewriteLatestInspectionRecord || isManager;
  const canManageLabels = ["admin", "manager"].includes(normalizedRole);
  const todayIso = toISODateString(new Date());
  const updateQcPastDaysLimit = getUpdateQcPastDaysLimit(
    normalizedRole,
    currentUserId,
  );
  const updateQcMinAllowedDateIso = (() => {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - updateQcPastDaysLimit);
    return toISODateString(minDate);
  })();


  const [form, setForm] = useState({
    inspector: "",
    qc_checked: "",
    qc_passed: "",
    offeredQuantity: "",
    barcode: "",
    packed_size: false,
    finishing: false,
    branding: false,
    labelRanges: [createEmptyLabelRange()],
    remarks: "",
    CBM: "",
    CBM_top: "",
    CBM_bottom: "",
    inspected_weight_top_net: "",
    inspected_weight_top_gross: "",
    inspected_weight_bottom_net: "",
    inspected_weight_bottom_gross: "",
    inspected_weight_total_net: "",
    inspected_weight_total_gross: "",
    inspected_item_L: "",
    inspected_item_B: "",
    inspected_item_H: "",
    inspected_box_L: "",
    inspected_box_B: "",
    inspected_box_H: "",
    inspected_top_L: "",
    inspected_top_B: "",
    inspected_top_H: "",
    inspected_bottom_L: "",
    inspected_bottom_B: "",
    inspected_bottom_H: "",
    inspected_item_top_L: "",
    inspected_item_top_B: "",
    inspected_item_top_H: "",
    inspected_item_bottom_L: "",
    inspected_item_bottom_B: "",
    inspected_item_bottom_H: "",
    last_inspected_date: "",
  });
  const [inspectors, setInspectors] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);
  const [barcodeScannerError, setBarcodeScannerError] = useState("");
  const [barcodeScannerStatus, setBarcodeScannerStatus] = useState("");
  const barcodeVideoRef = useRef(null);
  const barcodeStreamRef = useRef(null);
  const barcodeDetectorRef = useRef(null);
  const barcodeReaderRef = useRef(null);
  const barcodeReaderControlsRef = useRef(null);
  const lockBarcodeField = qc?.barcode > 0 && !canRewriteLatestInspectionRecord;
  const latestInspectionRecord = getLatestInspectionRecord(qc);

  useEffect(() => {
    if (isQcUser) {
      setInspectors([]);
      return;
    }

    const fetchInspectors = async () => {
      try {
        const res = await api.get("/auth/?role=QC");
        setInspectors(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setInspectors([]);
      }
    };

    fetchInspectors();
  }, [isQcUser]);

  useEffect(() => {
    if (!qc) return;
    const assignedInspectorId = String(qc?.inspector?._id || qc?.inspector || "");
    const adminRecord = canRewriteLatestInspectionRecord ? latestInspectionRecord : null;
    const defaultInspectorId = String(
      adminRecord?.inspector?._id ||
        adminRecord?.inspector ||
        assignedInspectorId,
    );
    const initialLabelRanges = adminRecord
      ? getInitialLabelRanges(adminRecord)
      : [createEmptyLabelRange()];
    const initialRemarks =
      adminRecord?.remarks !== undefined
        ? String(adminRecord.remarks || "")
        : String(qc?.remarks || "");
    const initialCbmTop =
      qc?.cbm?.top && qc.cbm.top !== "0" ? String(qc.cbm.top) : "";
    const initialCbmBottom =
      qc?.cbm?.bottom && qc.cbm.bottom !== "0" ? String(qc.cbm.bottom) : "";
    const initialCbmTotal =
      qc?.cbm?.total && qc.cbm.total !== "0" ? String(qc.cbm.total) : "";
    const hasTopOrBottomCbm = initialCbmTop !== "" || initialCbmBottom !== "";
    const itemMaster = qc?.item_master || {};
    const inspectedItemLbh = itemMaster?.inspected_item_LBH || itemMaster?.item_LBH || {};
    const inspectedBoxLbh = itemMaster?.inspected_box_LBH || itemMaster?.box_LBH || {};
    const inspectedTopLbh =
      itemMaster?.inspected_box_top_LBH
      || itemMaster?.inspected_top_LBH
      || {};
    const inspectedBottomLbh =
      itemMaster?.inspected_box_bottom_LBH
      || itemMaster?.inspected_bottom_LBH
      || {};
    const inspectedItemTopLbh = itemMaster?.inspected_item_top_LBH || {};
    const inspectedItemBottomLbh = itemMaster?.inspected_item_bottom_LBH || {};
    const inspectedWeight = itemMaster?.inspected_weight || {};
    const strictInspectedItemLbh = toStrictLbhInputGroup(inspectedItemLbh);
    const strictInspectedBoxLbh = toStrictLbhInputGroup(inspectedBoxLbh);
    const strictInspectedTopLbh = toStrictLbhInputGroup(inspectedTopLbh);
    const strictInspectedBottomLbh = toStrictLbhInputGroup(inspectedBottomLbh);
    const strictInspectedItemTopLbh = toStrictLbhInputGroup(inspectedItemTopLbh);
    const strictInspectedItemBottomLbh = toStrictLbhInputGroup(inspectedItemBottomLbh);

    setForm({
      inspector: defaultInspectorId,
      qc_checked: adminRecord ? toQuantityInputValue(adminRecord?.checked) : "",
      qc_passed: adminRecord ? toQuantityInputValue(adminRecord?.passed) : "",
      offeredQuantity: adminRecord
        ? toQuantityInputValue(adminRecord?.vendor_offered)
        : "",
      barcode: qc.barcode > 0 ? String(qc.barcode) : "",
      packed_size: Boolean(qc?.packed_size),
      finishing: Boolean(qc?.finishing),
      branding: Boolean(qc?.branding),
      labelRanges: initialLabelRanges,
      remarks: canRewriteLatestInspectionRecord ? initialRemarks : "",
      CBM: hasTopOrBottomCbm ? "" : initialCbmTotal,
      CBM_top: initialCbmTop,
      CBM_bottom: initialCbmBottom,
      inspected_weight_top_net: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "top_net"),
      ),
      inspected_weight_top_gross: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "top_gross"),
      ),
      inspected_weight_bottom_net: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "bottom_net"),
      ),
      inspected_weight_bottom_gross: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "bottom_gross"),
      ),
      inspected_weight_total_net: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "total_net"),
      ),
      inspected_weight_total_gross: toDimensionInputValue(
        getWeightValueFromModel(inspectedWeight, "total_gross"),
      ),
      inspected_item_L: strictInspectedItemLbh.L,
      inspected_item_B: strictInspectedItemLbh.B,
      inspected_item_H: strictInspectedItemLbh.H,
      inspected_box_L: strictInspectedBoxLbh.L,
      inspected_box_B: strictInspectedBoxLbh.B,
      inspected_box_H: strictInspectedBoxLbh.H,
      inspected_top_L: strictInspectedTopLbh.L,
      inspected_top_B: strictInspectedTopLbh.B,
      inspected_top_H: strictInspectedTopLbh.H,
      inspected_bottom_L: strictInspectedBottomLbh.L,
      inspected_bottom_B: strictInspectedBottomLbh.B,
      inspected_bottom_H: strictInspectedBottomLbh.H,
      inspected_item_top_L: strictInspectedItemTopLbh.L,
      inspected_item_top_B: strictInspectedItemTopLbh.B,
      inspected_item_top_H: strictInspectedItemTopLbh.H,
      inspected_item_bottom_L: strictInspectedItemBottomLbh.L,
      inspected_item_bottom_B: strictInspectedItemBottomLbh.B,
      inspected_item_bottom_H: strictInspectedItemBottomLbh.H,
      last_inspected_date: toDDMMYYYYInputValue(
        adminRecord?.inspection_date || qc.last_inspected_date,
        "",
      ),
    });
  }, [qc, canRewriteLatestInspectionRecord, latestInspectionRecord]);

  useEffect(() => {
    if (lockBarcodeField && barcodeScannerOpen) {
      setBarcodeScannerOpen(false);
    }
  }, [lockBarcodeField, barcodeScannerOpen]);

  useEffect(() => {
    if (!barcodeScannerOpen) return undefined;

    const BarcodeDetectorApi = globalThis?.BarcodeDetector;
    const mediaDevices = globalThis?.navigator?.mediaDevices;
    let animationFrameId = null;
    let cancelled = false;

    const stopScannerResources = () => {
      if (animationFrameId) {
        globalThis.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      if (barcodeReaderControlsRef.current?.stop) {
        try {
          barcodeReaderControlsRef.current.stop();
        } catch {
          // No-op
        }
      }
      barcodeReaderControlsRef.current = null;

      if (barcodeReaderRef.current?.reset) {
        try {
          barcodeReaderRef.current.reset();
        } catch {
          // No-op
        }
      }
      barcodeReaderRef.current = null;

      if (barcodeStreamRef.current) {
        barcodeStreamRef.current.getTracks().forEach((track) => track.stop());
        barcodeStreamRef.current = null;
      }

      if (barcodeVideoRef.current) {
        const attachedStream = barcodeVideoRef.current.srcObject;
        if (attachedStream && typeof attachedStream.getTracks === "function") {
          attachedStream.getTracks().forEach((track) => track.stop());
        }
        barcodeVideoRef.current.srcObject = null;
      }

      barcodeDetectorRef.current = null;
    };

    const applyDetectedBarcode = (rawValue) => {
      const parsedNumericBarcode = String(rawValue || "").trim().replace(/\D/g, "");
      if (!parsedNumericBarcode) return false;

      setForm((prev) => ({
        ...prev,
        barcode: parsedNumericBarcode,
      }));
      setBarcodeScannerStatus(`Scanned: ${parsedNumericBarcode}`);
      setBarcodeScannerOpen(false);
      return true;
    };

    const startNativeScanner = async () => {
      if (!BarcodeDetectorApi) {
        throw new Error("BarcodeDetector not available");
      }
      setBarcodeScannerError("");
      setBarcodeScannerStatus("Starting camera...");

      if (typeof BarcodeDetectorApi.getSupportedFormats === "function") {
        const supportedFormats = await BarcodeDetectorApi.getSupportedFormats();
        const usableFormats = PREFERRED_BARCODE_FORMATS.filter((format) =>
          supportedFormats.includes(format),
        );
        barcodeDetectorRef.current = usableFormats.length
          ? new BarcodeDetectorApi({ formats: usableFormats })
          : new BarcodeDetectorApi();
      } else {
        barcodeDetectorRef.current = new BarcodeDetectorApi();
      }

      const stream = await mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      barcodeStreamRef.current = stream;

      const videoElement = barcodeVideoRef.current;
      if (!videoElement) {
        throw new Error("Unable to start scanner preview.");
      }

      videoElement.srcObject = stream;
      await videoElement.play();
      setBarcodeScannerStatus("Scanning...");

      const scanFrame = async () => {
        if (cancelled) return;

        const detector = barcodeDetectorRef.current;
        const activeVideo = barcodeVideoRef.current;
        if (!detector || !activeVideo) {
          animationFrameId = globalThis.requestAnimationFrame(scanFrame);
          return;
        }

        try {
          const codes = await detector.detect(activeVideo);
          const rawValue = String(codes?.[0]?.rawValue || "").trim();
          if (applyDetectedBarcode(rawValue)) {
            return;
          }
        } catch {
          // Keep scanning frames; transient camera decode errors are expected.
        }

        animationFrameId = globalThis.requestAnimationFrame(scanFrame);
      };

      animationFrameId = globalThis.requestAnimationFrame(scanFrame);
    };

    const startZxingScanner = async () => {
      setBarcodeScannerError("");
      setBarcodeScannerStatus("Starting camera...");

      const { BrowserMultiFormatReader } = await import("@zxing/browser");

      if (cancelled) return;

      const videoElement = barcodeVideoRef.current;
      if (!videoElement) {
        throw new Error("Unable to start scanner preview.");
      }

      const reader = new BrowserMultiFormatReader();
      barcodeReaderRef.current = reader;

      setBarcodeScannerStatus("Scanning...");

      const controls = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
          },
          audio: false,
        },
        videoElement,
        (result, decodeError) => {
          if (cancelled) return;

          if (result) {
            const rawValue =
              typeof result.getText === "function"
                ? result.getText()
                : String(result?.text || "");
            if (applyDetectedBarcode(rawValue)) {
              return;
            }
          }

          if (decodeError && decodeError?.name !== "NotFoundException") {
            setBarcodeScannerStatus("Scanning...");
          }
        },
      );

      barcodeReaderControlsRef.current = controls;
    };

    const startScanner = async () => {
      if (!mediaDevices?.getUserMedia) {
        setBarcodeScannerError("Camera access is not available in this browser.");
        setBarcodeScannerStatus("");
        return;
      }

      try {
        if (BarcodeDetectorApi) {
          await startNativeScanner();
          return;
        }
      } catch {
        // Fall through to ZXing fallback.
      }

      try {
        await startZxingScanner();
      } catch (scannerError) {
        setBarcodeScannerError(
          scannerError?.message
            ? `Unable to start scanner: ${scannerError.message}`
            : "Unable to start scanner. Please allow camera access and retry. Use HTTPS/localhost.",
        );
        setBarcodeScannerStatus("");
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopScannerResources();
    };
  }, [barcodeScannerOpen]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (NON_NEGATIVE_FIELDS.has(name) && value !== "") {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return;
      }
    }

    setForm((prev) => {
      const nextValue = type === "checkbox" ? checked : value;

      if (name === "CBM") {
        const hasTotalValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          CBM: nextValue,
          ...(hasTotalValue ? { CBM_top: "", CBM_bottom: "" } : {}),
        };
      }

      if (name === "CBM_top" || name === "CBM_bottom") {
        const hasSegmentValue = String(nextValue).trim() !== "";
        return {
          ...prev,
          [name]: nextValue,
          ...(hasSegmentValue ? { CBM: "" } : {}),
        };
      }

      if (
        name.startsWith("inspected_item_")
        || name.startsWith("inspected_box_")
        || name.startsWith("inspected_top_")
        || name.startsWith("inspected_bottom_")
        || name.startsWith("inspected_item_top_")
        || name.startsWith("inspected_item_bottom_")
      ) {
        return {
          ...prev,
          [name]: nextValue,
          CBM: "",
          CBM_top: "",
          CBM_bottom: "",
        };
      }

      return {
        ...prev,
        [name]: nextValue,
      };
    });
  };

  const handleLabelRangeChange = (index, field, value) => {
    if (value !== "") {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      labelRanges: prev.labelRanges.map((range, rangeIndex) =>
        rangeIndex === index ? { ...range, [field]: value } : range,
      ),
    }));
  };

  const addLabelRange = () => {
    setForm((prev) => ({
      ...prev,
      labelRanges: [...prev.labelRanges, createEmptyLabelRange()],
    }));
  };

  const removeLabelRange = (index) => {
    setForm((prev) => {
      if (prev.labelRanges.length <= 1) {
        return { ...prev, labelRanges: [createEmptyLabelRange()] };
      }

      return {
        ...prev,
        labelRanges: prev.labelRanges.filter((_, rangeIndex) => rangeIndex !== index),
      };
    });
  };

  const parseLabelRanges = (ranges = []) => {
    const enteredRanges = ranges.filter((range) => {
      const hasStart = String(range?.start ?? "").trim() !== "";
      const hasEnd = String(range?.end ?? "").trim() !== "";
      return hasStart || hasEnd;
    });

    if (enteredRanges.length === 0) {
      return { ranges: [], labels: [] };
    }

    const labels = [];
    const normalizedRanges = [];

    for (let i = 0; i < enteredRanges.length; i++) {
      const range = enteredRanges[i];
      const hasStart = String(range.start ?? "").trim() !== "";
      const hasEnd = String(range.end ?? "").trim() !== "";

      if (!hasStart || !hasEnd) {
        return {
          error: `Both start and end are required for range ${i + 1}.`,
        };
      }

      const startNum = Number(range.start);
      const endNum = Number(range.end);

      if (!Number.isInteger(startNum) || !Number.isInteger(endNum)) {
        return {
          error: `Range ${i + 1} must use integer values.`,
        };
      }

      if (startNum < 0 || endNum < 0) {
        return {
          error: `Range ${i + 1} cannot contain negative values.`,
        };
      }

      if (startNum > endNum) {
        return {
          error: `Start label cannot be greater than end label in range ${i + 1}.`,
        };
      }

      normalizedRanges.push({ start: startNum, end: endNum });
      for (let label = startNum; label <= endNum; label++) {
        labels.push(label);
      }
    }

    return { ranges: normalizedRanges, labels };
  };

  const handleSubmit = async () => {
    if (!qc) return;
    setError("");

    const qcChecked = form.qc_checked === "" ? 0 : Number(form.qc_checked);
    const qcPassed = form.qc_passed === "" ? 0 : Number(form.qc_passed);
    const offeredQuantity =
      form.offeredQuantity === "" ? 0 : Number(form.offeredQuantity);

    if (
      [qcChecked, qcPassed, offeredQuantity].some((value) =>
        Number.isNaN(value),
      )
    ) {
      setError("QC quantities must be valid numbers.");
      return;
    }

    if (
      [qcChecked, qcPassed, offeredQuantity].some(
        (value) => value < 0,
      )
    ) {
      setError("QC quantities cannot be negative.");
      return;
    }

    const parsedLabelRangeData = parseLabelRanges(form.labelRanges);
    if (parsedLabelRangeData.error) {
      setError(parsedLabelRangeData.error);
      return;
    }
    const labels = parsedLabelRangeData.labels;
    const normalizedLabelRanges = parsedLabelRangeData.ranges;
    const labelsForUpdate = normalizeLabels(labels);
    const isAdminRewriteMode =
      canRewriteLatestInspectionRecord && Boolean(latestInspectionRecord?._id);
    const hasQuantityUpdate = isAdminRewriteMode
      ? qcChecked > 0 || qcPassed > 0 || offeredQuantity > 0
      : (
        form.qc_checked !== "" ||
        form.qc_passed !== "" ||
        form.offeredQuantity !== ""
      );
    const hasLabelUpdate =
      labelsForUpdate.length > 0 || normalizedLabelRanges.length > 0;
    const selectedInspectorId = String(form.inspector || "").trim();
    const currentInspectorId = String(
      qc?.inspector?._id || qc?.inspector || "",
    ).trim();
    const normalizedRemarks = String(form.remarks || "").trim();
    const clientDemandQuantity = Number(qc?.quantities?.client_demand || 0) || 0;
    const requestType = String(qc?.request_type || "").trim().toUpperCase();
    const isAqlRequest = requestType === "AQL";
    const aqlSampleQuantity = computeAqlSampleQuantity(clientDemandQuantity);

    if ((qcPassed > 0 || hasLabelUpdate) && qcChecked <= 0) {
      setError("QC checked must be greater than 0 for updates.");
      return;
    }

    if (qcPassed > qcChecked && qcChecked > 0) {
      setError("Passed cannot exceed checked quantity.");
      return;
    }

    const existingItemMaster = qc?.item_master || {};
    const lockInspectedItemLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
      existingItemMaster?.inspected_item_LBH,
    );
    const lockInspectedBoxLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
      existingItemMaster?.inspected_box_LBH,
    );
    const lockInspectedBoxTopLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
      existingItemMaster?.inspected_box_top_LBH
      || existingItemMaster?.inspected_top_LBH,
    );
    const lockInspectedBoxBottomLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
      existingItemMaster?.inspected_box_bottom_LBH
      || existingItemMaster?.inspected_bottom_LBH,
    );
    const lockInspectedItemTopLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
      existingItemMaster?.inspected_item_top_LBH,
    );
    const lockInspectedItemBottomLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
      existingItemMaster?.inspected_item_bottom_LBH,
    );

    const parseLbhGroup = (groupName, values) => {
      const entries = Object.entries(values);
      const parsed = {};
      const hasAnyInput = entries.some(([, rawValue]) => String(rawValue ?? "").trim() !== "");

      if (!hasAnyInput) return { hasAnyInput: false, value: null };

      const hasAllInputs = entries.every(([, rawValue]) => String(rawValue ?? "").trim() !== "");
      if (!hasAllInputs) {
        return { error: `${groupName} requires L, B and H values.` };
      }

      for (const [key, rawValue] of entries) {
        const normalized = String(rawValue ?? "").trim();
        const numeric = Number(normalized);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          return { error: `${groupName} ${key} must be greater than 0.` };
        }

        parsed[key] = numeric;
      }

      return { hasAnyInput: true, value: parsed };
    };

    const inspectedItemLbh = parseLbhGroup("Inspected Item LBH", {
      L: form.inspected_item_L,
      B: form.inspected_item_B,
      H: form.inspected_item_H,
    });
    if (inspectedItemLbh.error) {
      setError(inspectedItemLbh.error);
      return;
    }

    const inspectedBoxLbh = parseLbhGroup("Inspected Box LBH", {
      L: form.inspected_box_L,
      B: form.inspected_box_B,
      H: form.inspected_box_H,
    });
    if (inspectedBoxLbh.error) {
      setError(inspectedBoxLbh.error);
      return;
    }

    const inspectedTopLbh = parseLbhGroup("Inspected Box Top LBH", {
      L: form.inspected_top_L,
      B: form.inspected_top_B,
      H: form.inspected_top_H,
    });
    if (inspectedTopLbh.error) {
      setError(inspectedTopLbh.error);
      return;
    }

    const inspectedBottomLbh = parseLbhGroup("Inspected Box Bottom LBH", {
      L: form.inspected_bottom_L,
      B: form.inspected_bottom_B,
      H: form.inspected_bottom_H,
    });
    if (inspectedBottomLbh.error) {
      setError(inspectedBottomLbh.error);
      return;
    }

    const inspectedItemTopLbh = parseLbhGroup("Inspected Item Top LBH", {
      L: form.inspected_item_top_L,
      B: form.inspected_item_top_B,
      H: form.inspected_item_top_H,
    });
    if (inspectedItemTopLbh.error) {
      setError(inspectedItemTopLbh.error);
      return;
    }

    const inspectedItemBottomLbh = parseLbhGroup("Inspected Item Bottom LBH", {
      L: form.inspected_item_bottom_L,
      B: form.inspected_item_bottom_B,
      H: form.inspected_item_bottom_H,
    });
    if (inspectedItemBottomLbh.error) {
      setError(inspectedItemBottomLbh.error);
      return;
    }

    const parseWeightInput = (fieldLabel, rawValue) => {
      const normalized = String(rawValue ?? "").trim();
      if (!normalized) return { hasAnyInput: false, value: null };
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: `${fieldLabel} must be greater than 0.` };
      }
      return { hasAnyInput: true, value: parsed };
    };

    const inspectedWeightInputs = {};
    for (const field of INSPECTED_WEIGHT_FIELDS) {
      const parsedWeightInput = parseWeightInput(field.label, form[field.formKey]);
      if (parsedWeightInput.error) {
        setError(parsedWeightInput.error);
        return;
      }
      inspectedWeightInputs[field.payloadKey] = parsedWeightInput;
    }

    const cbmLockedByLbh = hasAnyLbhInput([
      form.inspected_item_L,
      form.inspected_item_B,
      form.inspected_item_H,
      form.inspected_box_L,
      form.inspected_box_B,
      form.inspected_box_H,
      form.inspected_top_L,
      form.inspected_top_B,
      form.inspected_top_H,
      form.inspected_bottom_L,
      form.inspected_bottom_B,
      form.inspected_bottom_H,
      form.inspected_item_top_L,
      form.inspected_item_top_B,
      form.inspected_item_top_H,
      form.inspected_item_bottom_L,
      form.inspected_item_bottom_B,
      form.inspected_item_bottom_H,
    ]);

    const barcodeValue = form.barcode.trim();
    const parseOptionalCbm = (value, label) => {
      if (cbmLockedByLbh && !canRewriteLatestInspectionRecord) {
        return { hasValue: false, value: null };
      }
      const raw = value.trim();
      if (raw === "") return { hasValue: false, value: null };
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return {
          hasValue: true,
          error: `${label} must be a valid non-negative number`,
        };
      }
      return { hasValue: true, value: String(parsed) };
    };

    const cbmTotal = parseOptionalCbm(form.CBM, "CBM");
    const cbmTop = parseOptionalCbm(form.CBM_top, "CBM top");
    const cbmBottom = parseOptionalCbm(form.CBM_bottom, "CBM bottom");
    const lastInspectedDateValue = form.last_inspected_date.trim();
    const lastInspectedDateIso = toISODateString(lastInspectedDateValue);

    if (cbmTotal.error || cbmTop.error || cbmBottom.error) {
      setError(cbmTotal.error || cbmTop.error || cbmBottom.error);
      return;
    }
    if (lastInspectedDateValue && (!isValidDDMMYYYY(lastInspectedDateValue) || !lastInspectedDateIso)) {
      setError("Last inspected date must be in DD/MM/YYYY format.");
      return;
    }
    if (
      isManager &&
      lastInspectedDateIso &&
      (
        lastInspectedDateIso < updateQcMinAllowedDateIso
        || lastInspectedDateIso > todayIso
      )
    ) {
      setError(buildUpdateQcPastDaysMessage(normalizedRole, updateQcPastDaysLimit));
      return;
    }
    if (isQcUser && lastInspectedDateIso) {
      const qcDateOffset = getUtcDayOffsetFromToday(lastInspectedDateIso);
      if (
        qcDateOffset === null
        || qcDateOffset < 0
        || qcDateOffset > updateQcPastDaysLimit
      ) {
        setError(buildUpdateQcPastDaysMessage(normalizedRole, updateQcPastDaysLimit));
        return;
      }
      if (qcDateOffset === 1) {
        const hasUsedOneDayBackdatedUpdate = Array.isArray(qc?.inspection_record)
          && qc.inspection_record.some((record) => {
            const recordDate = toISODateString(record?.inspection_date || record?.createdAt || "");
            if (!recordDate || recordDate !== lastInspectedDateIso) return false;
            const recordInspectorId = String(record?.inspector?._id || record?.inspector || "").trim();
            if (!recordInspectorId || recordInspectorId !== String(currentUserId || "").trim()) {
              return false;
            }
            const checked = Number(record?.checked || 0);
            const passed = Number(record?.passed || 0);
            const offered = Number(record?.vendor_offered || 0);
            const labelsAddedCount = Array.isArray(record?.labels_added)
              ? record.labels_added.length
              : 0;
            return checked > 0 || passed > 0 || offered > 0 || labelsAddedCount > 0;
          });
        if (hasUsedOneDayBackdatedUpdate) {
          setError("QC can update a 1-day backdated entry only once.");
          return;
        }
      }
    }

    const hasTotalCbmValue = String(form.CBM || "").trim() !== "";
    const existingCbmTopValue = Number(qc?.cbm?.top || 0);
    const existingCbmBottomValue = Number(qc?.cbm?.bottom || 0);
    const currentCbmTopValue = cbmTop.hasValue ? Number(cbmTop.value) : existingCbmTopValue;
    const currentCbmBottomValue = cbmBottom.hasValue
      ? Number(cbmBottom.value)
      : existingCbmBottomValue;
    const existingBoxTopLbhForLabels =
      existingItemMaster?.inspected_box_top_LBH
      || existingItemMaster?.inspected_top_LBH
      || {};
    const existingBoxBottomLbhForLabels =
      existingItemMaster?.inspected_box_bottom_LBH
      || existingItemMaster?.inspected_bottom_LBH
      || {};
    const existingItemTopLbhForLabels =
      existingItemMaster?.inspected_item_top_LBH
      || {};
    const existingItemBottomLbhForLabels =
      existingItemMaster?.inspected_item_bottom_LBH
      || {};
    const currentBoxTopLbhForLabels = inspectedTopLbh.value || existingBoxTopLbhForLabels;
    const currentBoxBottomLbhForLabels = inspectedBottomLbh.value || existingBoxBottomLbhForLabels;
    const currentItemTopLbhForLabels =
      inspectedItemTopLbh.value || existingItemTopLbhForLabels;
    const currentItemBottomLbhForLabels =
      inspectedItemBottomLbh.value || existingItemBottomLbhForLabels;
    const hasTopBottomBoxLbhForLabels =
      hasCompletePositiveLbh(currentBoxTopLbhForLabels)
      && hasCompletePositiveLbh(currentBoxBottomLbhForLabels);
    const hasTopBottomItemLbhForLabels =
      hasCompletePositiveLbh(currentItemTopLbhForLabels)
      && hasCompletePositiveLbh(currentItemBottomLbhForLabels);
    const hasTopBottomLbh =
      hasTopBottomBoxLbhForLabels || hasTopBottomItemLbhForLabels;
    const hasTopBottomCbmForLabels =
      !hasTotalCbmValue
      && currentCbmTopValue > 0
      && currentCbmBottomValue > 0;
    const hasSplitTopBottomForLabels =
      hasTopBottomCbmForLabels || hasTopBottomLbh;

    const isVisitUpdate = hasQuantityUpdate || hasLabelUpdate;
    if ((isVisitUpdate || isAdminRewriteMode) && !selectedInspectorId) {
      setError("Inspector is required for inspection updates.");
      return;
    }

    if ((isVisitUpdate || isAdminRewriteMode) && !lastInspectedDateValue) {
      setError("Last inspected date is required.");
      return;
    }

    const barcodeParsed = barcodeValue === "" ? null : Number(barcodeValue);

    if (
      barcodeParsed !== null &&
      (!Number.isInteger(barcodeParsed) || barcodeParsed <= 0)
    ) {
      setError("Barcode must be a positive integer.");
      return;
    }
    const hasTotalCbmInput = String(form.CBM || "").trim() !== "";
    const hasTopOrBottomInput =
      String(form.CBM_top || "").trim() !== "" ||
      String(form.CBM_bottom || "").trim() !== "";

    const buildQcPayload = () => {
      const payload = isAdminRewriteMode
        ? {
            admin_rewrite_latest_record: true,
            remarks: normalizedRemarks,
            packed_size: Boolean(form.packed_size),
            finishing: Boolean(form.finishing),
            branding: Boolean(form.branding),
            last_inspected_date: lastInspectedDateIso,
          }
        : {
            remarks: normalizedRemarks || undefined,
          };

      if (!isAdminRewriteMode) {
        if (form.qc_checked !== "") payload.qc_checked = qcChecked;
        if (form.qc_passed !== "") payload.qc_passed = qcPassed;
        if (form.offeredQuantity !== "") payload.vendor_provision = offeredQuantity;
        if (labelsForUpdate.length > 0) {
          payload.labels = labelsForUpdate;
        }
        if (normalizedLabelRanges.length > 0) {
          payload.label_ranges = normalizedLabelRanges;
        }
      }

      if (
        selectedInspectorId &&
        (isAdminRewriteMode || selectedInspectorId !== currentInspectorId)
      ) {
        payload.inspector = selectedInspectorId;
      }

      if (
        (!cbmLockedByLbh || canRewriteLatestInspectionRecord) &&
        (isAdminRewriteMode || hasTotalCbmInput || hasTopOrBottomInput)
      ) {
        if (hasTotalCbmInput) {
          payload.CBM = cbmTotal.value ?? "0";
          payload.CBM_top = "0";
          payload.CBM_bottom = "0";
        } else if (hasTopOrBottomInput) {
          payload.CBM = "0";
          payload.CBM_top =
            cbmTop.hasValue && cbmTop.value !== null ? cbmTop.value : "0";
          payload.CBM_bottom =
            cbmBottom.hasValue && cbmBottom.value !== null ? cbmBottom.value : "0";
        } else if (isAdminRewriteMode) {
          payload.CBM = "0";
          payload.CBM_top = "0";
          payload.CBM_bottom = "0";
        }
      }

      if (isAdminRewriteMode && barcodeParsed !== null) {
        payload.barcode = barcodeParsed;
      } else if (!isAdminRewriteMode && barcodeParsed !== null) {
        payload.barcode = barcodeParsed;
      }

      if (lastInspectedDateValue && !isAdminRewriteMode) {
        payload.last_inspected_date = lastInspectedDateIso;
      }

      if (!lockInspectedItemLbh && inspectedItemLbh.hasAnyInput && inspectedItemLbh.value) {
        payload.inspected_item_LBH = inspectedItemLbh.value;
      }
      if (!lockInspectedBoxLbh && inspectedBoxLbh.hasAnyInput && inspectedBoxLbh.value) {
        payload.inspected_box_LBH = inspectedBoxLbh.value;
      }
      if (!lockInspectedBoxTopLbh && inspectedTopLbh.hasAnyInput && inspectedTopLbh.value) {
        payload.inspected_box_top_LBH = inspectedTopLbh.value;
        payload.inspected_top_LBH = inspectedTopLbh.value;
      }
      if (
        !lockInspectedBoxBottomLbh &&
        inspectedBottomLbh.hasAnyInput &&
        inspectedBottomLbh.value
      ) {
        payload.inspected_box_bottom_LBH = inspectedBottomLbh.value;
        payload.inspected_bottom_LBH = inspectedBottomLbh.value;
      }
      if (
        !lockInspectedItemTopLbh &&
        inspectedItemTopLbh.hasAnyInput &&
        inspectedItemTopLbh.value
      ) {
        payload.inspected_item_top_LBH = inspectedItemTopLbh.value;
      }
      if (
        !lockInspectedItemBottomLbh &&
        inspectedItemBottomLbh.hasAnyInput &&
        inspectedItemBottomLbh.value
      ) {
        payload.inspected_item_bottom_LBH = inspectedItemBottomLbh.value;
      }
      if (
        INSPECTED_WEIGHT_FIELDS.some(
          (field) =>
            !inspectedWeightLocks[field.payloadKey]
            && inspectedWeightInputs[field.payloadKey]?.hasAnyInput,
        )
      ) {
        payload.inspected_weight = {};
        for (const field of INSPECTED_WEIGHT_FIELDS) {
          const parsedWeightInput = inspectedWeightInputs[field.payloadKey];
          if (
            inspectedWeightLocks[field.payloadKey]
            || !parsedWeightInput?.hasAnyInput
            || parsedWeightInput.value === null
          ) {
            continue;
          }
          payload.inspected_weight[field.payloadKey] = parsedWeightInput.value;
        }
        if (Object.keys(payload.inspected_weight).length === 0) {
          delete payload.inspected_weight;
        }
      }

      if (!isAdminRewriteMode) {
        if (!qc.packed_size && form.packed_size) payload.packed_size = true;
        if (!qc.finishing && form.finishing) payload.finishing = true;
        if (!qc.branding && form.branding) payload.branding = true;
      }

      return payload;
    };

    if (isAdminRewriteMode) {
      const otherInspectionRecords = (Array.isArray(qc?.inspection_record)
        ? qc.inspection_record
        : []
      ).filter(
        (record) =>
          String(record?._id || "") !== String(latestInspectionRecord?._id || ""),
      );
      const otherChecked = otherInspectionRecords.reduce(
        (sum, record) => sum + (Number(record?.checked || 0) || 0),
        0,
      );
      const otherPassed = otherInspectionRecords.reduce(
        (sum, record) => sum + (Number(record?.passed || 0) || 0),
        0,
      );
      const otherOffered = otherInspectionRecords.reduce(
        (sum, record) => sum + (Number(record?.vendor_offered || 0) || 0),
        0,
      );
      const otherLabels = normalizeLabels(
        otherInspectionRecords.flatMap((record) =>
          Array.isArray(record?.labels_added) ? record.labels_added : [],
        ),
      );
      const totalOfferedAfterRewrite = otherOffered + offeredQuantity;
      const totalCheckedAfterRewrite = otherChecked + qcChecked;
      const totalPassedAfterRewrite = otherPassed + qcPassed;
      const totalLabelsAfterRewrite = new Set([
        ...otherLabels,
        ...labelsForUpdate,
      ]).size;
      const maxLabelsAllowed = hasSplitTopBottomForLabels
        ? Math.max(0, totalCheckedAfterRewrite) * 2
        : Math.max(0, totalCheckedAfterRewrite);
      const pendingAfterRewrite = Math.max(
        0,
        clientDemandQuantity - totalPassedAfterRewrite,
      );
      const requestedDateIso = toISODateString(
        latestInspectionRecord?.requested_date ||
          latestInspectionRecord?.request_date ||
          qc?.request_date ||
          lastInspectedDateIso,
      );

      if (!requestedDateIso) {
        setError("Requested date is missing on the latest inspection record.");
        return;
      }

      if (isAqlRequest && totalCheckedAfterRewrite > aqlSampleQuantity) {
        setError(
          `AQL checked quantity cannot exceed 10% sample (${aqlSampleQuantity}).`,
        );
        return;
      }

      if (totalCheckedAfterRewrite > totalOfferedAfterRewrite) {
        setError("QC checked cannot exceed offered quantity.");
        return;
      }

      if (totalPassedAfterRewrite > totalOfferedAfterRewrite) {
        setError("Passed quantity cannot exceed offered quantity.");
        return;
      }

      if (totalLabelsAfterRewrite > maxLabelsAllowed) {
        setError(
          hasSplitTopBottomForLabels
            ? `Total labels cannot exceed double inspected quantity (${maxLabelsAllowed}) when top and bottom CBM/LBH are set.`
            : `Total labels cannot exceed inspected quantity (${maxLabelsAllowed}).`,
        );
        return;
      }

      const qcPayload = buildQcPayload();

      try {
        setSaving(true);
        const qcResponse = await api.patch(`/qc/update-qc/${qc._id}`, qcPayload);
        const updatedQc = qcResponse?.data?.data || qc;
        await api.patch(`/qc/${qc._id}/inspection-records`, {
          records: [
            {
              _id: latestInspectionRecord._id,
              requested_date: requestedDateIso,
              inspection_date: lastInspectedDateIso,
              inspector: selectedInspectorId,
              vendor_requested: Number(latestInspectionRecord?.vendor_requested || 0) || 0,
              vendor_offered: offeredQuantity,
              checked: qcChecked,
              passed: qcPassed,
              pending_after: pendingAfterRewrite,
              cbm: {
                top: String(updatedQc?.cbm?.top ?? "0"),
                bottom: String(updatedQc?.cbm?.bottom ?? "0"),
                total: String(updatedQc?.cbm?.total ?? "0"),
              },
              label_ranges: normalizedLabelRanges,
              labels_added: labelsForUpdate,
              remarks: normalizedRemarks,
            },
          ],
        });
        alert("QC updated successfully.");
        onUpdated?.();
        onClose();
      } catch (err) {
        setError(err.response?.data?.message || "Failed to update QC record.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const nextNetOffered =
      (qc.quantities?.vendor_provision || 0) + offeredQuantity;
    const totalOfferedNext = nextNetOffered;
    const nextChecked = (qc.quantities?.qc_checked || 0) + qcChecked;
    const nextPassed = (qc.quantities?.qc_passed || 0) + qcPassed;
    const existingLabelsSet = new Set(normalizeLabels(qc?.labels));
    const incomingNewLabels = labelsForUpdate.filter(
      (label) => !existingLabelsSet.has(label),
    );
    const totalLabelsAfterUpdate =
      existingLabelsSet.size + incomingNewLabels.length;
    const quantityRequestedLimit =
      qc.quantities?.quantity_requested &&
      qc.quantities.quantity_requested !== 0
        ? qc.quantities.quantity_requested
        : qc.quantities?.client_demand;
    const hasStartedInspection =
      (qc.quantities?.qc_checked || 0) > 0 ||
      Number(qc?.quantities?.qc_passed || 0) > 0 ||
      Number(qc?.quantities?.vendor_provision || 0) > 0 ||
      (Array.isArray(qc?.inspection_record) &&
        qc.inspection_record.some((record) => {
          const checked = Number(record?.checked || 0);
          const passed = Number(record?.passed || 0);
          const offered = Number(record?.vendor_offered || 0);
          const labelsAdded = Array.isArray(record?.labels_added)
            ? record.labels_added.length
            : 0;
          return checked > 0 || passed > 0 || offered > 0 || labelsAdded > 0;
        }));
    const parsedPendingQuantityLimit = Number(
      qc.quantities?.pending ??
        (qc.quantities?.client_demand || 0) - (qc.quantities?.qc_passed || 0),
    );
    const pendingQuantityLimit = Number.isFinite(parsedPendingQuantityLimit)
      ? Math.max(0, parsedPendingQuantityLimit)
      : 0;

    if (isAqlRequest && nextChecked > aqlSampleQuantity) {
      setError(
        `AQL checked quantity cannot exceed 10% sample (${aqlSampleQuantity}).`,
      );
      return;
    }

    if (hasStartedInspection) {
      if (offeredQuantity > pendingQuantityLimit) {
        setError("Offered quantity cannot exceed pending quantity.");
        return;
      }
    } else if (
      quantityRequestedLimit !== undefined &&
      nextNetOffered > quantityRequestedLimit
    ) {
      setError("Offered quantity cannot exceed quantity requested.");
      return;
    }

    if (nextNetOffered < 0) {
      setError("Offered quantity cannot be negative.");
      return;
    }

    if (nextChecked > totalOfferedNext) {
      setError("QC checked cannot exceed offered quantity.");
      return;
    }

    if (
      qc.quantities?.vendor_provision !== undefined &&
      nextPassed > nextNetOffered
    ) {
      setError("Passed quantity cannot exceed offered quantity.");
      return;
    }

    const baseLabelLimit = Math.max(0, nextChecked);
    const maxLabelsAllowed = hasSplitTopBottomForLabels
      ? baseLabelLimit * 2
      : baseLabelLimit;

    if (totalLabelsAfterUpdate > maxLabelsAllowed) {
      setError(
        hasSplitTopBottomForLabels
          ? `Total labels cannot exceed double inspected quantity (${maxLabelsAllowed}) when top and bottom CBM/LBH are set.`
          : `Total labels cannot exceed inspected quantity (${maxLabelsAllowed}).`,
      );
      return;
    }

    const payload = buildQcPayload();

    try {
      setSaving(true);
      await api.patch(`/qc/update-qc/${qc._id}`, payload);
      alert("QC updated successfully.");
      onUpdated?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update QC record.");
    } finally {
      setSaving(false);
    }
  };

  if (!qc) return null;
  const requestedInspectorId = String(qc?.inspector?._id || qc?.inspector || "").trim();
  const requestedInspectorName = String(
    qc?.inspector?.name
      || (
        requestedInspectorId
        && requestedInspectorId === currentUserId
        && user?.name
      )
      || "",
  ).trim();
  const disableInspectorSelection =
    isQcUser || (!hasElevatedAccess && (qc?.quantities?.qc_checked || 0) > 0);
  const hasTotalCbmInput = String(form.CBM || "").trim() !== "";
  const hasTopOrBottomCbmInput =
    String(form.CBM_top || "").trim() !== "" ||
    String(form.CBM_bottom || "").trim() !== "";
  const existingItemMaster = qc?.item_master || {};
  const lockInspectedItemLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
    existingItemMaster?.inspected_item_LBH,
  );
  const lockInspectedBoxLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
    existingItemMaster?.inspected_box_LBH,
  );
  const lockInspectedBoxTopLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
    existingItemMaster?.inspected_box_top_LBH || existingItemMaster?.inspected_top_LBH,
  );
  const lockInspectedBoxBottomLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
    existingItemMaster?.inspected_box_bottom_LBH || existingItemMaster?.inspected_bottom_LBH,
  );
  const lockInspectedItemTopLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
    existingItemMaster?.inspected_item_top_LBH,
  );
  const lockInspectedItemBottomLbh = !canRewriteLatestInspectionRecord && hasCompletePositiveLbh(
    existingItemMaster?.inspected_item_bottom_LBH,
  );
  const existingInspectedWeight = existingItemMaster?.inspected_weight || {};
  const inspectedWeightLocks = INSPECTED_WEIGHT_FIELDS.reduce((accumulator, field) => {
    accumulator[field.payloadKey] =
      !canRewriteLatestInspectionRecord &&
      getWeightValueFromModel(existingInspectedWeight, field.payloadKey) > 0;
    return accumulator;
  }, {});
  const hasLockedInspectedWeight = INSPECTED_WEIGHT_FIELDS.some(
    (field) => inspectedWeightLocks[field.payloadKey],
  );
  const hasAnyLockedInspectedLbh = (
    lockInspectedItemLbh ||
    lockInspectedBoxLbh ||
    lockInspectedBoxTopLbh ||
    lockInspectedBoxBottomLbh ||
    lockInspectedItemTopLbh ||
    lockInspectedItemBottomLbh
  );
  const cbmLockedByLbh = hasAnyLbhInput([
    form.inspected_item_L,
    form.inspected_item_B,
    form.inspected_item_H,
    form.inspected_box_L,
    form.inspected_box_B,
    form.inspected_box_H,
    form.inspected_top_L,
    form.inspected_top_B,
    form.inspected_top_H,
    form.inspected_bottom_L,
    form.inspected_bottom_B,
    form.inspected_bottom_H,
    form.inspected_item_top_L,
    form.inspected_item_top_B,
    form.inspected_item_top_H,
    form.inspected_item_bottom_L,
    form.inspected_item_bottom_B,
    form.inspected_item_bottom_H,
  ]);
  const disableCbmTotal =
    hasTopOrBottomCbmInput ||
    (cbmLockedByLbh && !canRewriteLatestInspectionRecord);
  const disableCbmTopBottom =
    hasTotalCbmInput ||
    (cbmLockedByLbh && !canRewriteLatestInspectionRecord);

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
    >
      <div
        className="modal-dialog modal-dialog-centered modal-xl"
        role="document"
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Update QC Record</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
            />
          </div>

          <div style={{ marginBottom: "30px"}} className="modal-body d-grid gap-3">
            <div className="row g-3 qc-modal-summary-row">
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Order ID</div>
                <div className="fw-semibold">{qc.order?.order_id || "N/A"}</div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Item</div>
                <div className="fw-semibold">{qc.item?.item_code || "N/A"}</div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Order Quantity</div>
                <div className="fw-semibold">
                  {qc.quantities?.client_demand ?? "N/A"}
                </div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Requested Quantity</div>
                <div className="fw-semibold">
                  {qc.quantities?.quantity_requested ?? "N/A"}
                </div>
              </div>
              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Passed</div>
                <div className="fw-semibold">
                  {qc.quantities?.qc_passed ?? "N/A"}
                </div>
              </div>

              <div className="col qc-modal-summary-item">
                <div className="small text-secondary">Pending</div>
                <div className="fw-semibold">
                  {qc.quantities?.pending ?? "N/A"}
                </div>
              </div>
            </div>

            {canRewriteLatestInspectionRecord && latestInspectionRecord && (
              <div className="small text-secondary">
                Admin updates rewrite the latest inspection record and sync the QC totals.
              </div>
            )}

            <div className="row g-3">
              <div className="col-md-12">
                <label className="form-label">QC Inspector</label>
                {isQcUser ? (
                  <input
                    type="text"
                    className="form-control"
                    value={requestedInspectorName || "N/A"}
                    disabled
                    readOnly
                  />
                ) : (
                  <select
                    className="form-select"
                    name="inspector"
                    value={form.inspector}
                    onChange={handleChange}
                    disabled={disableInspectorSelection}
                  >
                    <option value="">Select Inspector</option>
                    {inspectors.map((qcInspector) => (
                      <option key={qcInspector._id} value={qcInspector._id}>
                        {qcInspector.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="col-md-12">{"   "}</div>

              {INSPECTED_WEIGHT_GROUPS.map((group) => (
                <div key={group.key} className="col-md-4">
                  <label className="form-label">{group.label}</label>
                  <div className="input-group">
                    {group.fields.map((field) => {
                      const isLocked = inspectedWeightLocks[field.payloadKey];
                      return (
                        <input
                          key={field.formKey}
                          type="number"
                          className="form-control"
                          name={field.formKey}
                          value={form[field.formKey]}
                          onChange={handleChange}
                          min="0"
                          step="any"
                          disabled={isLocked}
                          placeholder={isLocked ? "Locked" : field.shortLabel}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {hasLockedInspectedWeight && (
                <div className="col-12">
                  <div className="small text-secondary">
                    Inspected weight fields are locked after first update.
                  </div>
                </div>
              )}

              <div className="col-md-12">{"   "}</div>

              <div className="col-md-4">
                <label className="form-label">CBM Total</label>
                <input
                  type="number"
                  className="form-control"
                  name="CBM"
                  value={form.CBM}
                  onChange={handleChange}
                  min="0"
                  step="any"
                  disabled={disableCbmTotal}
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">CBM Top</label>
                <input
                  type="number"
                  className="form-control"
                  name="CBM_top"
                  value={form.CBM_top}
                  onChange={handleChange}
                  min="0"
                  step="any"
                  disabled={disableCbmTopBottom}
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">CBM Bottom</label>
                <input
                  type="number"
                  className="form-control"
                  name="CBM_bottom"
                  value={form.CBM_bottom}
                  onChange={handleChange}
                  min="0"
                  step="any"
                  disabled={disableCbmTopBottom}
                />
              </div>

              {cbmLockedByLbh && !canRewriteLatestInspectionRecord && (
                <div className="col-12">
                  <div className="small text-secondary">
                    CBM fields are locked because inspected LBH is present. Update LBH to recalculate CBM.
                  </div>
                </div>
              )}

              <div className="col-12">
                <h6 className="mb-0">Inspected LBH (cm)</h6>
              </div>
              {hasAnyLockedInspectedLbh && (
                <div className="col-12">
                  <div className="small text-secondary">
                    Inspected LBH fields are locked after first update.
                  </div>
                </div>
              )}

              <div className="col-md-5">
                <label className="form-label">Inspected Item LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_L"
                    value={form.inspected_item_L}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="L"
                    disabled={lockInspectedItemLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_B"
                    value={form.inspected_item_B}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="B"
                    disabled={lockInspectedItemLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_H"
                    value={form.inspected_item_H}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="H"
                    disabled={lockInspectedItemLbh}
                  />
                </div>
              </div>
<div className="col-md-2">{"   "}</div>
              <div className="col-md-5">
                <label className="form-label">Inspected Box LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_box_L"
                    value={form.inspected_box_L}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="L"
                    disabled={lockInspectedBoxLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_box_B"
                    value={form.inspected_box_B}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="B"
                    disabled={lockInspectedBoxLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_box_H"
                    value={form.inspected_box_H}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="H"
                    disabled={lockInspectedBoxLbh}
                  />
                </div>
              </div>
              <div className="col-md-5">
                <label className="form-label">Inspected Item Top LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_top_L"
                    value={form.inspected_item_top_L}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="L"
                    disabled={lockInspectedItemTopLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_top_B"
                    value={form.inspected_item_top_B}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="B"
                    disabled={lockInspectedItemTopLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_top_H"
                    value={form.inspected_item_top_H}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="H"
                    disabled={lockInspectedItemTopLbh}
                  />
                </div>
              </div>
<div className="col-md-2">{"   "}</div>
              <div className="col-md-5">
                <label className="form-label">Inspected Box Top LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_top_L"
                    value={form.inspected_top_L}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="L"
                    disabled={lockInspectedBoxTopLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_top_B"
                    value={form.inspected_top_B}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="B"
                    disabled={lockInspectedBoxTopLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_top_H"
                    value={form.inspected_top_H}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="H"
                    disabled={lockInspectedBoxTopLbh}
                  />
                </div>
              </div>
              <div className="col-md-5">
                <label className="form-label">Inspected Item Bottom LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_bottom_L"
                    value={form.inspected_item_bottom_L}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="L"
                    disabled={lockInspectedItemBottomLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_bottom_B"
                    value={form.inspected_item_bottom_B}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="B"
                    disabled={lockInspectedItemBottomLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_item_bottom_H"
                    value={form.inspected_item_bottom_H}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="H"
                    disabled={lockInspectedItemBottomLbh}
                  />
                </div>
              </div>

<div className="col-md-2">{"   "}</div>

              <div className="col-md-5">
                <label className="form-label">Inspected Box Bottom LBH (L/B/H)</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_bottom_L"
                    value={form.inspected_bottom_L}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="L"
                    disabled={lockInspectedBoxBottomLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_bottom_B"
                    value={form.inspected_bottom_B}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="B"
                    disabled={lockInspectedBoxBottomLbh}
                  />
                  <input
                    type="number"
                    className="form-control"
                    name="inspected_bottom_H"
                    value={form.inspected_bottom_H}
                    onChange={handleChange}
                    min="0"
                    step="any"
                    placeholder="H"
                    disabled={lockInspectedBoxBottomLbh}
                  />
                </div>
              </div>

              <div className="col-md-6">
                <label className="form-label">Last Inspected Date</label>
                <input
                  type="date"
                  lang="en-GB"
                  className="form-control"
                  name="last_inspected_date"
                  value={toISODateString(form.last_inspected_date)}
                  min={isManager ? updateQcMinAllowedDateIso : undefined}
                  max={isManager ? todayIso : undefined}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      last_inspected_date: toDDMMYYYYInputValue(e.target.value, ""),
                    }))
                  }
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Barcode</label>
                <div className="input-group">
                  <input
                    type="number"
                    className="form-control"
                    name="barcode"
                    value={form.barcode}
                    onChange={handleChange}
                    min="1"
                    step="1"
                    disabled={lockBarcodeField}
                    placeholder={
                      lockBarcodeField ? "Already set" : "Enter barcode"
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => {
                      setBarcodeScannerError("");
                      setBarcodeScannerStatus("");
                      setBarcodeScannerOpen((prev) => !prev);
                    }}
                    disabled={lockBarcodeField}
                  >
                    {barcodeScannerOpen ? "Stop Scan" : "Scan"}
                  </button>
                </div>
                {barcodeScannerOpen && (
                  <div className="border rounded p-2 mt-2">
                    <video
                      ref={barcodeVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-100 rounded"
                      style={{ maxHeight: "240px", objectFit: "cover", background: "#111827" }}
                    />
                    {barcodeScannerStatus && (
                      <div className="small text-muted mt-2">{barcodeScannerStatus}</div>
                    )}
                    {barcodeScannerError && (
                      <div className="small text-danger mt-1">{barcodeScannerError}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="col-md-12">{"   "}</div>

              <div className="col-md-4">
                <label className="form-label">Quantity Offered</label>
                <input
                  type="number"
                  className="form-control"
                  name="offeredQuantity"
                  value={form.offeredQuantity}
                  onChange={handleChange}
                  min="0"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">QC Inspected</label>
                <input
                  type="number"
                  className="form-control"
                  name="qc_checked"
                  value={form.qc_checked}
                  onChange={handleChange}
                  min="0"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">QC Passed</label>
                <input
                  type="number"
                  className="form-control"
                  name="qc_passed"
                  value={form.qc_passed}
                  onChange={handleChange}
                  min="0"
                />
              </div>

              <div className="col-md-2">
                <label className="form-label">Packed Size</label>
                <div className="form-check border rounded p-2 qc-bool-check">
                  <input
                    id="packed_size"
                    type="checkbox"
                    className="form-check-input qc-bool-check-input"
                    name="packed_size"
                    checked={form.packed_size}
                    onChange={handleChange}
                    disabled={qc.packed_size && !canRewriteLatestInspectionRecord}
                  />
                  <label
                    htmlFor="packed_size"
                    className="form-check-label qc-bool-check-label"
                  >
                    {form.packed_size ? "Yes" : "No"}
                  </label>
                </div>
              </div>

              

              <div className="col-md-2">
                <label className="form-label">Finishing</label>
                <div className="form-check border rounded p-2 qc-bool-check">
                  <input
                    id="finishing"
                    type="checkbox"
                    className="form-check-input qc-bool-check-input"
                    name="finishing"
                    checked={form.finishing}
                    onChange={handleChange}
                    disabled={qc.finishing && !canRewriteLatestInspectionRecord}
                  />
                  <label
                    htmlFor="finishing"
                    className="form-check-label qc-bool-check-label"
                  >
                    {form.finishing ? "Yes" : "No"}
                  </label>
                </div>
              </div>

              <div className="col-md-2">
                <label className="form-label">Branding</label>
                <div className="form-check border rounded p-2 qc-bool-check">
                  <input
                    id="branding"
                    type="checkbox"
                    className="form-check-input qc-bool-check-input"
                    name="branding"
                    checked={form.branding}
                    onChange={handleChange}
                    disabled={qc.branding && !canRewriteLatestInspectionRecord}
                  />
                  <label
                    htmlFor="branding"
                    className="form-check-label qc-bool-check-label"
                  >
                    {form.branding ? "Yes" : "No"}
                  </label>
                </div>
              </div>

              <div className="col-md-6 d-flex flex-column">{canManageLabels && (
                <>
                <label
                    htmlFor="branding"
                    className="form-label"
                  >
                    Allocate Label
                  </label>
                  <div>
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => {
                              setShowAllocateModal(true);
                            }}
                            >
                            Allocate 
                          </button>
                              </div>
                            </>
                        )}</div>

              <div className="col-md-6">
                <label className="form-label d-block">Label Ranges</label>
                <div className="d-grid gap-2">
                  {form.labelRanges.map((range, index) => (
                    <div
                      key={`label-range-${index}`}
                      className="row g-2 align-items-end"
                    >
                      <div className="col-sm-5">
                        <input
                          type="number"
                          className="form-control"
                          value={range.start}
                          onChange={(e) =>
                            handleLabelRangeChange(index, "start", e.target.value)
                          }
                          min="0"
                          step="1"
                          placeholder={`Start label ${index + 1}`}
                        />
                      </div>
                      <div className="col-sm-5">
                        <input
                          type="number"
                          className="form-control"
                          value={range.end}
                          onChange={(e) =>
                            handleLabelRangeChange(index, "end", e.target.value)
                          }
                          min="0"
                          step="1"
                          placeholder={`End label ${index + 1}`}
                        />
                      </div>
                      <div className="col-sm-2 d-flex gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={addLabelRange}
                          title="Add another range"
                        >
                          +
                        </button>
                        {form.labelRanges.length > 1 && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={() => removeLabelRange(index)}
                            title="Remove this range"
                          >
                            -
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* <div className="col-md-12">{"   "}</div> */}

              <div className="col-6">
                <label className="form-label">Remarks</label>
                <textarea
                  className="form-control"
                  name="remarks"
                  value={form.remarks}
                  onChange={handleChange}
                  rows="3"
                />
              </div>
            </div>

            {error && <div className="alert alert-danger mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? "Updating..." : "Update"}
            </button>
          </div>
        </div>
      </div>
      {showAllocateModal && (
              <AllocateLabelsModal
                onClose={() => {
                  setShowAllocateModal(false);
                }}
              />
            )}
    </div>
  );
};

export default UpdateQcModal;
