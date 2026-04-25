import { useMemo, useState } from "react";
import api from "../api/axios";
import MeasuredSizeSection from "./MeasuredSizeSection";
import {
  BOX_PACKAGING_MODES,
  BOX_SIZE_REMARK_OPTIONS,
  ITEM_SIZE_REMARK_OPTIONS,
  buildMeasuredSizeEntriesFromLegacy,
  calculateMeasuredSizeEntriesCbm,
  detectBoxPackagingMode,
  ensureMeasuredSizeEntryCount,
  getWeightValueFromModel,
  hasMeaningfulMeasuredSize,
  normalizeSizeCount,
  parseMeasuredSizeEntries,
} from "../utils/measuredSizeForm";
import "../App.css";

const toText = (value, fallback = "") => String(value ?? fallback).trim();
const isPisChecked = (item = {}) => item?.pis_checked_flag === true;
const formatFallback = (value, fallback = "Not Set") => {
  const text = toText(value);
  return text && text !== "0" ? text : fallback;
};
const formatBoxMode = (mode = "") => (
  detectBoxPackagingMode(mode) === BOX_PACKAGING_MODES.CARTON
    ? "Inner / Master Carton"
    : "Individual Boxes"
);
const formatRemarkLabel = (remark = "", fallback = "Entry") => {
  const normalized = toText(remark).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "top") return "Top";
  if (normalized === "base") return "Base";
  if (normalized === "inner") return "Inner Carton";
  if (normalized === "master") return "Master Carton";
  return normalized.replace(/([a-z]+)(\d+)/i, (_, prefix, number) =>
    `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)} ${number}`,
  );
};
const formatEntrySize = (entry = {}) => {
  const parts = [entry?.L, entry?.B, entry?.H].map((value) => formatFallback(value, ""));
  return parts.every(Boolean) ? parts.join(" x ") : "Not Set";
};
const formatEntryWeight = (entry = {}, label = "Weight") => (
  formatFallback(entry?.weight, "") ? `${label}: ${formatFallback(entry.weight)}` : `${label}: Not Set`
);
const formatEntries = (entries = [], weightLabel = "Weight") => {
  const meaningfulEntries = (Array.isArray(entries) ? entries : [])
    .filter((entry) => hasMeaningfulMeasuredSize(entry));
  if (meaningfulEntries.length === 0) return "Not Set";

  return meaningfulEntries
    .map((entry, index) => {
      const label = formatRemarkLabel(entry?.remark, `Entry ${index + 1}`);
      return `${label}: ${formatEntrySize(entry)} (${formatEntryWeight(entry, weightLabel)})`;
    })
    .join(" | ");
};

const getBrandLabel = (item = {}) =>
  toText(
    item?.brand
    || item?.brand_name
    || (Array.isArray(item?.brands) && item.brands.length > 0 ? item.brands[0] : "")
    || "N/A",
  );

const getVendorsLabel = (item = {}) =>
  Array.isArray(item?.vendors) && item.vendors.length > 0
    ? item.vendors.join(", ")
    : "N/A";

const buildInitialForm = (item = {}) => {
  const pisWeight = item?.pis_weight || {};
  const pisBoxMode = detectBoxPackagingMode(item?.pis_box_mode, item?.pis_box_sizes);
  const pisItemEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.pis_item_sizes,
    singleLbh: item?.pis_item_LBH,
    topLbh: item?.pis_item_top_LBH,
    bottomLbh: item?.pis_item_bottom_LBH,
    totalWeight: getWeightValueFromModel(pisWeight, "total_net"),
    topWeight: getWeightValueFromModel(pisWeight, "top_net"),
    bottomWeight: getWeightValueFromModel(pisWeight, "bottom_net"),
    weightKey: "net_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));
  const pisBoxEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.pis_box_sizes,
    mode: pisBoxMode,
    singleLbh: item?.pis_box_LBH,
    topLbh: item?.pis_box_top_LBH,
    bottomLbh: item?.pis_box_bottom_LBH,
    totalWeight: getWeightValueFromModel(pisWeight, "total_gross"),
    topWeight: getWeightValueFromModel(pisWeight, "top_gross"),
    bottomWeight: getWeightValueFromModel(pisWeight, "bottom_gross"),
    weightKey: "gross_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));

  const pisItemCount =
    pisItemEntries.length > 0
      ? normalizeSizeCount(pisItemEntries.length, 1)
      : 1;
  const pisBoxCount =
    pisBoxMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : pisBoxEntries.length > 0
      ? normalizeSizeCount(pisBoxEntries.length, 1)
      : 1;

  return {
    master_barcode: toText(item?.pis_master_barcode || item?.pis_barcode),
    inner_barcode: toText(item?.pis_inner_barcode),
    pis_item_count: String(pisItemCount),
    pis_box_mode: pisBoxMode,
    pis_box_count: String(pisBoxCount),
    pis_item_sizes: ensureMeasuredSizeEntryCount(pisItemEntries, pisItemCount),
    pis_box_sizes: ensureMeasuredSizeEntryCount(pisBoxEntries, pisBoxCount, {
      mode: pisBoxMode,
    }),
  };
};

const buildInspectedReference = (item = {}) => {
  const inspectedWeight = item?.inspected_weight || {};
  const inspectedBoxMode = detectBoxPackagingMode(
    item?.inspected_box_mode,
    item?.inspected_box_sizes,
  );
  const inspectedItemEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_item_sizes,
    singleLbh: item?.inspected_item_LBH,
    topLbh: item?.inspected_item_top_LBH,
    bottomLbh: item?.inspected_item_bottom_LBH,
    totalWeight: getWeightValueFromModel(inspectedWeight, "total_net"),
    topWeight: getWeightValueFromModel(inspectedWeight, "top_net"),
    bottomWeight: getWeightValueFromModel(inspectedWeight, "bottom_net"),
    weightKey: "net_weight",
    topRemark: "top",
    bottomRemark: "base",
  });
  const inspectedBoxEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_box_sizes,
    mode: inspectedBoxMode,
    singleLbh: item?.inspected_box_LBH,
    topLbh: item?.inspected_box_top_LBH || item?.inspected_top_LBH,
    bottomLbh: item?.inspected_box_bottom_LBH || item?.inspected_bottom_LBH,
    totalWeight: getWeightValueFromModel(inspectedWeight, "total_gross"),
    topWeight: getWeightValueFromModel(inspectedWeight, "top_gross"),
    bottomWeight: getWeightValueFromModel(inspectedWeight, "bottom_gross"),
    weightKey: "gross_weight",
    topRemark: "top",
    bottomRemark: "base",
  });

  return {
    masterBarcode: formatFallback(item?.qc?.master_barcode || item?.qc?.barcode),
    innerBarcode: formatFallback(item?.qc?.inner_barcode),
    boxMode: formatBoxMode(inspectedBoxMode),
    itemSizes: formatEntries(inspectedItemEntries, "Net"),
    boxSizes: formatEntries(inspectedBoxEntries, "Gross"),
    cbm: [
      `Top: ${formatFallback(item?.cbm?.inspected_top)}`,
      `Bottom: ${formatFallback(item?.cbm?.inspected_bottom)}`,
      `Total: ${formatFallback(item?.cbm?.inspected_total)}`,
      `Calculated: ${formatFallback(item?.cbm?.calculated_inspected_total)}`,
    ].join(" | "),
  };
};

const EditPisModal = ({ item, onClose, onUpdated }) => {
  const [form, setForm] = useState(() => buildInitialForm(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const itemCode = useMemo(() => toText(item?.code, "N/A"), [item?.code]);
  const itemDescription = useMemo(
    () => toText(item?.description || item?.name, "N/A"),
    [item?.description, item?.name],
  );
  const brandLabel = useMemo(() => getBrandLabel(item), [item]);
  const vendorsLabel = useMemo(() => getVendorsLabel(item), [item]);
  const showInspectedReference = !isPisChecked(item);
  const inspectedReference = useMemo(() => buildInspectedReference(item), [item]);
  const displayedItemEntries = useMemo(
    () => ensureMeasuredSizeEntryCount(form.pis_item_sizes, form.pis_item_count),
    [form.pis_item_sizes, form.pis_item_count],
  );
  const displayedBoxEntries = useMemo(
    () =>
      ensureMeasuredSizeEntryCount(form.pis_box_sizes, form.pis_box_count, {
        mode: form.pis_box_mode,
      }),
    [form.pis_box_count, form.pis_box_mode, form.pis_box_sizes],
  );
  const calculatedPisItemCbm = useMemo(
    () => calculateMeasuredSizeEntriesCbm(form.pis_item_sizes, form.pis_item_count),
    [form.pis_item_sizes, form.pis_item_count],
  );
  const calculatedPisBoxCbm = useMemo(
    () =>
      calculateMeasuredSizeEntriesCbm(form.pis_box_sizes, form.pis_box_count, {
        mode: form.pis_box_mode,
      }),
    [form.pis_box_count, form.pis_box_mode, form.pis_box_sizes],
  );
  const calculatedPisCbm = useMemo(() => {
    const itemCbmValue = Number(calculatedPisItemCbm || 0);
    const boxCbmValue = Number(calculatedPisBoxCbm || 0);
    return boxCbmValue >= itemCbmValue ? calculatedPisBoxCbm : calculatedPisItemCbm;
  }, [calculatedPisBoxCbm, calculatedPisItemCbm]);

  const updateField = (path, value) => {
    setForm((prev) => {
      const next = { ...prev };
      const chunks = path.split(".");
      let cursor = next;
      for (let i = 0; i < chunks.length - 1; i += 1) {
        cursor[chunks[i]] = { ...cursor[chunks[i]] };
        cursor = cursor[chunks[i]];
      }
      cursor[chunks[chunks.length - 1]] = value;
      return next;
    });
  };

  const handleCountChange = (countKey, entriesKey, value) => {
    const safeCount = String(normalizeSizeCount(value, 1));
    setForm((prev) => ({
      ...prev,
      [countKey]: safeCount,
      [entriesKey]: ensureMeasuredSizeEntryCount(prev[entriesKey], safeCount),
    }));
  };

  const handleBoxModeChange = (value) => {
    const nextMode = detectBoxPackagingMode(value, form.pis_box_sizes);
    const nextCount = nextMode === BOX_PACKAGING_MODES.CARTON ? "2" : form.pis_box_count;
    setForm((prev) => ({
      ...prev,
      pis_box_mode: nextMode,
      pis_box_count: nextCount,
      pis_box_sizes: ensureMeasuredSizeEntryCount(prev.pis_box_sizes, nextCount, {
        mode: nextMode,
      }),
    }));
  };

  const handleSizeEntryChange = (entriesKey, index, field, value) => {
    if (field !== "remark" && value !== "") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      [entriesKey]: ensureMeasuredSizeEntryCount(
        prev[entriesKey].map((entry, entryIndex) =>
          entryIndex === index
            ? {
                ...entry,
                [field]:
                  field === "remark"
                    ? String(value || "").trim().toLowerCase()
                    : value,
              }
            : entry,
        ),
        prev[entriesKey]?.length || 1,
        entriesKey === "pis_box_sizes" ? { mode: prev.pis_box_mode } : {},
      ),
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      const pisItemPayload = parseMeasuredSizeEntries({
        entries: form.pis_item_sizes,
        count: form.pis_item_count,
        groupLabel: "PIS item size",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "net_weight",
        weightFieldLabel: "Net weight",
      });
      if (pisItemPayload.error) {
        throw new Error(pisItemPayload.error);
      }

      const pisBoxPayload = parseMeasuredSizeEntries({
        entries: form.pis_box_sizes,
        count: form.pis_box_count,
        groupLabel: "PIS box size",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "gross_weight",
        weightFieldLabel: "Gross weight",
        mode: form.pis_box_mode,
      });
      if (pisBoxPayload.error) {
        throw new Error(pisBoxPayload.error);
      }

      const payload = {
        pis_barcode: toText(form.master_barcode),
        pis_master_barcode: toText(form.master_barcode),
        pis_inner_barcode: toText(form.inner_barcode),
        pis_box_mode: form.pis_box_mode,
        pis_item_sizes: pisItemPayload.value,
        pis_box_sizes: pisBoxPayload.value,
      };

      const response = await api.patch(`/items/${item?._id}/pis`, payload);
      onUpdated?.(response?.data?.data || { ...item, pis_checked_flag: true });
      onClose?.();
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message || saveError?.message || "Failed to update PIS values.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Update PIS: {itemCode}</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onClose}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-md-4">
                <label className="form-label">Code (Read Only)</label>
                <input type="text" className="form-control" value={itemCode} disabled />
              </div>
              <div className="col-md-4">
                <label className="form-label">Brand (Read Only)</label>
                <input type="text" className="form-control" value={brandLabel} disabled />
              </div>
              <div className="col-md-4">
                <label className="form-label">Vendors (Read Only)</label>
                <input type="text" className="form-control" value={vendorsLabel} disabled />
              </div>
              <div className="col-12">
                <label className="form-label">Description (Read Only)</label>
                <input type="text" className="form-control" value={itemDescription} disabled />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label">Master Carton Barcode</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.master_barcode}
                  onChange={(event) => updateField("master_barcode", event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Inner Carton Barcode</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.inner_barcode}
                  onChange={(event) => updateField("inner_barcode", event.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            {showInspectedReference && (
              <div className="border rounded p-3">
                <div className="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">
                  <h6 className="mb-0">Latest Inspected Reference</h6>
                  <span className="badge text-bg-warning">Needs PIS Check</span>
                </div>
                <div className="row g-3 small">
                  <div className="col-md-6">
                    <div className="text-secondary">Master Carton Barcode</div>
                    <div className="fw-semibold">{inspectedReference.masterBarcode}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-secondary">Inner Carton Barcode</div>
                    <div className="fw-semibold">{inspectedReference.innerBarcode}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-secondary">Inspected Item Sizes and Net Weight</div>
                    <div>{inspectedReference.itemSizes}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="text-secondary">Inspected Box Sizes and Gross Weight</div>
                    <div>{inspectedReference.boxSizes}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="text-secondary">Inspected Box Mode</div>
                    <div>{inspectedReference.boxMode}</div>
                  </div>
                  <div className="col-md-8">
                    <div className="text-secondary">Inspected CBM</div>
                    <div>{inspectedReference.cbm}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="row g-3">
              <div className="col-12">
                <h6 className="mb-0">PIS Measurements</h6>
              </div>

              <MeasuredSizeSection
                sectionKey="pis-item"
                title="PIS Item Sizes (cm) and Net Weight"
                countLabel="Item Sets"
                countValue={form.pis_item_count}
                entries={displayedItemEntries}
                remarkOptions={ITEM_SIZE_REMARK_OPTIONS}
                weightLabel="Net Weight"
                disabled={saving}
                onCountChange={(value) =>
                  handleCountChange("pis_item_count", "pis_item_sizes", value)
                }
                onEntryChange={(index, field, value) =>
                  handleSizeEntryChange("pis_item_sizes", index, field, value)
                }
              />

              <MeasuredSizeSection
                sectionKey="pis-box"
                title="PIS Box Sizes (cm) and Gross Weight"
                countLabel="Box Sets"
                countValue={form.pis_box_count}
                entries={displayedBoxEntries}
                remarkOptions={BOX_SIZE_REMARK_OPTIONS}
                weightLabel="Gross Weight"
                mode={form.pis_box_mode}
                showModeSelector
                disabled={saving}
                onModeChange={handleBoxModeChange}
                onCountChange={(value) =>
                  handleCountChange("pis_box_count", "pis_box_sizes", value)
                }
                onEntryChange={(index, field, value) =>
                  handleSizeEntryChange("pis_box_sizes", index, field, value)
                }
              />

              <div className="col-md-4">
                <label className="form-label">Calculated PIS CBM</label>
                <input
                  type="text"
                  className="form-control"
                  value={calculatedPisCbm}
                  disabled
                  readOnly
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
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save PIS"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditPisModal;
