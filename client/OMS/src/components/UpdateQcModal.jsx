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
  "inspected_weight_net",
  "inspected_weight_gross",
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

const createEmptyLabelRange = () => ({ start: "", end: "" });
const toDimensionInputValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return String(parsed);
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

const toLocalIsoDate = (dateValue) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getUtcDayOffsetFromToday = (isoDateValue) => {
  const normalizedIso = toISODateString(isoDateValue);
  if (!normalizedIso) return null;
  const [year, month, day] = normalizedIso.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const targetUtc = Date.UTC(year, month - 1, day);
  const now = new Date();
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round((todayUtc - targetUtc) / oneDayMs);
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
  const isQcUser = normalizedRole === "qc";
  const canManageLabels = ["admin", "manager"].includes(user?.role);
  const isManager = normalizedRole === "manager";
  const todayIso = toLocalIsoDate(new Date());
  const updateQcPastDaysLimit = getUpdateQcPastDaysLimit(
    normalizedRole,
    currentUserId,
  );
  const updateQcMinAllowedDateIso = (() => {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - updateQcPastDaysLimit);
    return toLocalIsoDate(minDate);
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
    inspected_weight_net: "",
    inspected_weight_gross: "",
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
  const lockBarcodeField = qc?.barcode > 0 && !isAdmin;

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
    const defaultInspectorId = assignedInspectorId;
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
      qc_checked: "",
      qc_passed: "",
      offeredQuantity: "",
      barcode: qc.barcode > 0 ? String(qc.barcode) : "",
      packed_size: "",
      finishing: "",
      branding: "",
      labelRanges: [createEmptyLabelRange()],
      remarks: "",
      CBM: hasTopOrBottomCbm ? "" : initialCbmTotal,
      CBM_top: initialCbmTop,
      CBM_bottom: initialCbmBottom,
      inspected_weight_net: toDimensionInputValue(inspectedWeight?.net),
      inspected_weight_gross: toDimensionInputValue(inspectedWeight?.gross),
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
      last_inspected_date: toDDMMYYYYInputValue(qc.last_inspected_date, ""),
    });
  }, [qc]);

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
    const labelsForUpdate = [...new Set(labels)];

    const hasQuantityUpdate =
      form.qc_checked !== "" ||
      form.qc_passed !== "" ||
      form.offeredQuantity !== "";
    const hasLabelUpdate =
      labelsForUpdate.length > 0 || normalizedLabelRanges.length > 0;
    const selectedInspectorId = String(form.inspector || "").trim();
    const currentInspectorId = String(
      qc?.inspector?._id || qc?.inspector || "",
    ).trim();

    if ((hasQuantityUpdate || hasLabelUpdate) && qcChecked <= 0) {
      setError("QC checked must be greater than 0 for updates.");
      return;
    }

    if (qcPassed > qcChecked && qcChecked > 0) {
      setError("Passed cannot exceed checked quantity.");
      return;
    }

    const existingItemMaster = qc?.item_master || {};
    const lockInspectedItemLbh = hasCompletePositiveLbh(
      existingItemMaster?.inspected_item_LBH,
    );
    const lockInspectedBoxLbh = hasCompletePositiveLbh(
      existingItemMaster?.inspected_box_LBH,
    );
    const lockInspectedBoxTopLbh = hasCompletePositiveLbh(
      existingItemMaster?.inspected_box_top_LBH
      || existingItemMaster?.inspected_top_LBH,
    );
    const lockInspectedBoxBottomLbh = hasCompletePositiveLbh(
      existingItemMaster?.inspected_box_bottom_LBH
      || existingItemMaster?.inspected_bottom_LBH,
    );
    const lockInspectedItemTopLbh = hasCompletePositiveLbh(
      existingItemMaster?.inspected_item_top_LBH,
    );
    const lockInspectedItemBottomLbh = hasCompletePositiveLbh(
      existingItemMaster?.inspected_item_bottom_LBH,
    );
    const lockInspectedNetWeight =
      Number(existingItemMaster?.inspected_weight?.net || 0) > 0;
    const lockInspectedGrossWeight =
      Number(existingItemMaster?.inspected_weight?.gross || 0) > 0;

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

    const inspectedNetWeight = parseWeightInput(
      "Inspected Net Weight",
      form.inspected_weight_net,
    );
    if (inspectedNetWeight.error) {
      setError(inspectedNetWeight.error);
      return;
    }

    const inspectedGrossWeight = parseWeightInput(
      "Inspected Gross Weight",
      form.inspected_weight_gross,
    );
    if (inspectedGrossWeight.error) {
      setError(inspectedGrossWeight.error);
      return;
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
      if (cbmLockedByLbh) return { hasValue: false, value: null };
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
    if (isVisitUpdate && !selectedInspectorId) {
      setError("Inspector is required for inspection updates.");
      return;
    }

    if (isVisitUpdate && !lastInspectedDateValue) {
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

    const nextNetOffered =
      (qc.quantities?.vendor_provision || 0) + offeredQuantity;

    const totalOfferedNext = nextNetOffered;
    const nextChecked = (qc.quantities?.qc_checked || 0) + qcChecked;
    const nextPassed = (qc.quantities?.qc_passed || 0) + qcPassed;
    const existingLabelsSet = new Set(
      (Array.isArray(qc?.labels) ? qc.labels : [])
        .map((label) => Number(label))
        .filter((label) => Number.isInteger(label) && label >= 0),
    );
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

    const payload = {
      remarks: form.remarks?.trim() ? form.remarks.trim() : undefined,
    };

    if (form.qc_checked !== "") payload.qc_checked = qcChecked;
    if (form.qc_passed !== "") payload.qc_passed = qcPassed;
    if (form.offeredQuantity !== "") payload.vendor_provision = offeredQuantity;
    if (selectedInspectorId && selectedInspectorId !== currentInspectorId) {
      payload.inspector = selectedInspectorId;
    }

    const hasTotalCbmInput = String(form.CBM || "").trim() !== "";
    const hasTopOrBottomInput =
      String(form.CBM_top || "").trim() !== "" ||
      String(form.CBM_bottom || "").trim() !== "";

    if (!cbmLockedByLbh) {
      if (hasTotalCbmInput) {
        payload.CBM = cbmTotal.value ?? "0";
        payload.CBM_top = "0";
        payload.CBM_bottom = "0";
      } else if (hasTopOrBottomInput) {
        payload.CBM = "0";
        payload.CBM_top = cbmTop.hasValue && cbmTop.value !== null ? cbmTop.value : "0";
        payload.CBM_bottom =
          cbmBottom.hasValue && cbmBottom.value !== null ? cbmBottom.value : "0";
      }
    }
    if (lastInspectedDateValue)
      payload.last_inspected_date = lastInspectedDateIso;

    if (barcodeParsed !== null) payload.barcode = barcodeParsed;
    if (!qc.packed_size && form.packed_size) payload.packed_size = true;
    if (!qc.finishing && form.finishing) payload.finishing = true;
    if (!qc.branding && form.branding) payload.branding = true;

    if (labelsForUpdate.length > 0) {
      payload.labels = labelsForUpdate;
    }
    if (normalizedLabelRanges.length > 0) {
      payload.label_ranges = normalizedLabelRanges;
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
      (!lockInspectedNetWeight && inspectedNetWeight.hasAnyInput) ||
      (!lockInspectedGrossWeight && inspectedGrossWeight.hasAnyInput)
    ) {
      payload.inspected_weight = {};
      if (
        !lockInspectedNetWeight &&
        inspectedNetWeight.hasAnyInput &&
        inspectedNetWeight.value !== null
      ) {
        payload.inspected_weight.net = inspectedNetWeight.value;
      }
      if (
        !lockInspectedGrossWeight &&
        inspectedGrossWeight.hasAnyInput &&
        inspectedGrossWeight.value !== null
      ) {
        payload.inspected_weight.gross = inspectedGrossWeight.value;
      }
    }

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
    isQcUser || (!isAdmin && (qc?.quantities?.qc_checked || 0) > 0);
  const hasTotalCbmInput = String(form.CBM || "").trim() !== "";
  const hasTopOrBottomCbmInput =
    String(form.CBM_top || "").trim() !== "" ||
    String(form.CBM_bottom || "").trim() !== "";
  const existingItemMaster = qc?.item_master || {};
  const lockInspectedItemLbh = hasCompletePositiveLbh(
    existingItemMaster?.inspected_item_LBH,
  );
  const lockInspectedBoxLbh = hasCompletePositiveLbh(
    existingItemMaster?.inspected_box_LBH,
  );
  const lockInspectedBoxTopLbh = hasCompletePositiveLbh(
    existingItemMaster?.inspected_box_top_LBH || existingItemMaster?.inspected_top_LBH,
  );
  const lockInspectedBoxBottomLbh = hasCompletePositiveLbh(
    existingItemMaster?.inspected_box_bottom_LBH || existingItemMaster?.inspected_bottom_LBH,
  );
  const lockInspectedItemTopLbh = hasCompletePositiveLbh(
    existingItemMaster?.inspected_item_top_LBH,
  );
  const lockInspectedItemBottomLbh = hasCompletePositiveLbh(
    existingItemMaster?.inspected_item_bottom_LBH,
  );
  const existingInspectedWeight = existingItemMaster?.inspected_weight || {};
  const lockInspectedNetWeight =
    Number(existingInspectedWeight?.net || 0) > 0;
  const lockInspectedGrossWeight =
    Number(existingInspectedWeight?.gross || 0) > 0;
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
  const disableCbmTotal = hasTopOrBottomCbmInput || cbmLockedByLbh;
  const disableCbmTopBottom = hasTotalCbmInput || cbmLockedByLbh;

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

              <div className="col-md-6">
                <label className="form-label">Inspected Net Weight</label>
                <input
                  type="number"
                  className="form-control"
                  name="inspected_weight_net"
                  value={form.inspected_weight_net}
                  onChange={handleChange}
                  min="0"
                  step="any"
                  disabled={lockInspectedNetWeight}
                  placeholder={lockInspectedNetWeight ? "Locked" : "Enter net weight"}
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Inspected Gross Weight</label>
                <input
                  type="number"
                  className="form-control"
                  name="inspected_weight_gross"
                  value={form.inspected_weight_gross}
                  onChange={handleChange}
                  min="0"
                  step="any"
                  disabled={lockInspectedGrossWeight}
                  placeholder={lockInspectedGrossWeight ? "Locked" : "Enter gross weight"}
                />
              </div>

              {(lockInspectedNetWeight || lockInspectedGrossWeight) && (
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

              {cbmLockedByLbh && (
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
                  min={isManager ? managerMinAllowedDateIso : undefined}
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
                    disabled={qc.packed_size && !isAdmin}
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
                    disabled={qc.finishing && !isAdmin}
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
                    disabled={qc.branding && !isAdmin}
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
