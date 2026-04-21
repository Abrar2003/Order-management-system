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

const toNumberString = (value, fallback = "0") => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return String(parsed);
};

const parseNonNegativeNumber = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return parsed;
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
  const inspectedWeight = item?.inspected_weight || {};
  const inspectedBoxMode = detectBoxPackagingMode(
    item?.inspected_box_mode,
    item?.inspected_box_sizes,
  );
  const inspectedItemEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_item_sizes,
    singleLbh: item?.inspected_item_LBH ?? item?.item_LBH,
    topLbh: item?.inspected_item_top_LBH,
    bottomLbh: item?.inspected_item_bottom_LBH,
    totalWeight: getWeightValueFromModel(inspectedWeight, "total_net"),
    topWeight: getWeightValueFromModel(inspectedWeight, "top_net"),
    bottomWeight: getWeightValueFromModel(inspectedWeight, "bottom_net"),
    weightKey: "net_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));
  const inspectedBoxEntries = buildMeasuredSizeEntriesFromLegacy({
    primaryEntries: item?.inspected_box_sizes,
    mode: inspectedBoxMode,
    singleLbh: item?.inspected_box_LBH ?? item?.box_LBH,
    topLbh: item?.inspected_box_top_LBH ?? item?.inspected_top_LBH,
    bottomLbh: item?.inspected_box_bottom_LBH ?? item?.inspected_bottom_LBH,
    totalWeight: getWeightValueFromModel(inspectedWeight, "total_gross"),
    topWeight: getWeightValueFromModel(inspectedWeight, "top_gross"),
    bottomWeight: getWeightValueFromModel(inspectedWeight, "bottom_gross"),
    weightKey: "gross_weight",
    topRemark: "top",
    bottomRemark: "base",
  }).filter((entry) => hasMeaningfulMeasuredSize(entry));

  const inspectedItemCount =
    inspectedItemEntries.length > 0
      ? normalizeSizeCount(inspectedItemEntries.length, 1)
      : 1;
  const inspectedBoxCount =
    inspectedBoxMode === BOX_PACKAGING_MODES.CARTON
      ? 2
      : inspectedBoxEntries.length > 0
      ? normalizeSizeCount(inspectedBoxEntries.length, 1)
      : 1;

  return {
    name: toText(item?.name),
    description: toText(item?.description),
    inspected_item_count: String(inspectedItemCount),
    inspected_box_mode: inspectedBoxMode,
    inspected_box_count: String(inspectedBoxCount),
    inspected_item_sizes: ensureMeasuredSizeEntryCount(
      inspectedItemEntries,
      inspectedItemCount,
    ),
    inspected_box_sizes: ensureMeasuredSizeEntryCount(
      inspectedBoxEntries,
      inspectedBoxCount,
      { mode: inspectedBoxMode },
    ),
    qc: {
      packed_size: Boolean(item?.qc?.packed_size),
      finishing: Boolean(item?.qc?.finishing),
      branding: Boolean(item?.qc?.branding),
      master_barcode: toNumberString(
        item?.qc?.master_barcode ?? item?.qc?.barcode,
        "0",
      ),
      inner_barcode: toNumberString(item?.qc?.inner_barcode, "0"),
      last_inspected_date: toText(item?.qc?.last_inspected_date),
      quantities: {
        checked: toNumberString(item?.qc?.quantities?.checked, "0"),
        passed: toNumberString(item?.qc?.quantities?.passed, "0"),
        pending: toNumberString(item?.qc?.quantities?.pending, "0"),
      },
    },
    source: {
      from_orders: Boolean(item?.source?.from_orders),
      from_qc: Boolean(item?.source?.from_qc),
    },
  };
};

const EditItemModal = ({ item, onClose, onUpdated }) => {
  const [form, setForm] = useState(() => buildInitialForm(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const itemCode = useMemo(() => toText(item?.code, "N/A"), [item?.code]);
  const brandLabel = useMemo(() => getBrandLabel(item), [item]);
  const vendorsLabel = useMemo(() => getVendorsLabel(item), [item]);
  const displayedItemEntries = useMemo(
    () => ensureMeasuredSizeEntryCount(form.inspected_item_sizes, form.inspected_item_count),
    [form.inspected_item_sizes, form.inspected_item_count],
  );
  const displayedBoxEntries = useMemo(
    () =>
      ensureMeasuredSizeEntryCount(form.inspected_box_sizes, form.inspected_box_count, {
        mode: form.inspected_box_mode,
      }),
    [form.inspected_box_count, form.inspected_box_mode, form.inspected_box_sizes],
  );
  const calculatedInspectedItemCbm = useMemo(
    () => calculateMeasuredSizeEntriesCbm(form.inspected_item_sizes, form.inspected_item_count),
    [form.inspected_item_sizes, form.inspected_item_count],
  );
  const calculatedInspectedBoxCbm = useMemo(
    () =>
      calculateMeasuredSizeEntriesCbm(
        form.inspected_box_sizes,
        form.inspected_box_count,
        { mode: form.inspected_box_mode },
      ),
    [form.inspected_box_count, form.inspected_box_mode, form.inspected_box_sizes],
  );
  const calculatedInspectedCbm = useMemo(() => {
    const itemCbmValue = Number(calculatedInspectedItemCbm || 0);
    const boxCbmValue = Number(calculatedInspectedBoxCbm || 0);
    return boxCbmValue >= itemCbmValue
      ? calculatedInspectedBoxCbm
      : calculatedInspectedItemCbm;
  }, [calculatedInspectedBoxCbm, calculatedInspectedItemCbm]);

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

  const handleInspectedBoxModeChange = (value) => {
    const nextMode = detectBoxPackagingMode(value, form.inspected_box_sizes);
    const nextCount =
      nextMode === BOX_PACKAGING_MODES.CARTON ? "2" : form.inspected_box_count;
    setForm((prev) => ({
      ...prev,
      inspected_box_mode: nextMode,
      inspected_box_count: nextCount,
      inspected_box_sizes: ensureMeasuredSizeEntryCount(
        prev.inspected_box_sizes,
        nextCount,
        { mode: nextMode },
      ),
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
        entriesKey === "inspected_box_sizes"
          ? { mode: prev.inspected_box_mode }
          : {},
      ),
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      const inspectedItemPayload = parseMeasuredSizeEntries({
        entries: form.inspected_item_sizes,
        count: form.inspected_item_count,
        groupLabel: "Inspected item size",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "net_weight",
        weightFieldLabel: "Net weight",
      });
      if (inspectedItemPayload.error) {
        throw new Error(inspectedItemPayload.error);
      }

      const inspectedBoxPayload = parseMeasuredSizeEntries({
        entries: form.inspected_box_sizes,
        count: form.inspected_box_count,
        groupLabel: "Inspected box size",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "gross_weight",
        weightFieldLabel: "Gross weight",
        mode: form.inspected_box_mode,
      });
      if (inspectedBoxPayload.error) {
        throw new Error(inspectedBoxPayload.error);
      }

      const payload = {
        name: toText(form.name),
        description: toText(form.description),
        inspected_item_sizes: inspectedItemPayload.value,
        inspected_box_mode: form.inspected_box_mode,
        inspected_box_sizes: inspectedBoxPayload.value,
        qc: {
          packed_size: Boolean(form.qc.packed_size),
          finishing: Boolean(form.qc.finishing),
          branding: Boolean(form.qc.branding),
          barcode: parseNonNegativeNumber(
            form.qc.master_barcode,
            "QC master barcode",
          ),
          master_barcode: parseNonNegativeNumber(
            form.qc.master_barcode,
            "QC master barcode",
          ),
          inner_barcode: parseNonNegativeNumber(
            form.qc.inner_barcode,
            "QC inner barcode",
          ),
          last_inspected_date: toText(form.qc.last_inspected_date),
          quantities: {
            checked: parseNonNegativeNumber(form.qc.quantities.checked, "QC checked"),
            passed: parseNonNegativeNumber(form.qc.quantities.passed, "QC passed"),
            pending: parseNonNegativeNumber(form.qc.quantities.pending, "QC pending"),
          },
        },
        source: {
          from_orders: Boolean(form.source.from_orders),
          from_qc: Boolean(form.source.from_qc),
        },
      };

      await api.patch(`/items/${item?._id}`, payload);
      onUpdated?.();
      onClose?.();
    } catch (saveError) {
      setError(saveError?.response?.data?.message || saveError?.message || "Failed to update item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Edit Item: {itemCode}</h5>
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
            </div>

            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="row g-3">
              <div className="col-12">
                <h6 className="mb-0">Inspected Measurements</h6>
              </div>

              <MeasuredSizeSection
                sectionKey="item-inspected-item"
                title="Inspected Item Sizes (cm) and Net Weight"
                countLabel="Item Sets"
                countValue={form.inspected_item_count}
                entries={displayedItemEntries}
                remarkOptions={ITEM_SIZE_REMARK_OPTIONS}
                weightLabel="Net Weight"
                disabled={saving}
                onCountChange={(value) =>
                  handleCountChange("inspected_item_count", "inspected_item_sizes", value)
                }
                onEntryChange={(index, field, value) =>
                  handleSizeEntryChange("inspected_item_sizes", index, field, value)
                }
              />

              <MeasuredSizeSection
                sectionKey="item-inspected-box"
                title="Inspected Box Sizes (cm) and Gross Weight"
                countLabel="Box Sets"
                countValue={form.inspected_box_count}
                entries={displayedBoxEntries}
                remarkOptions={BOX_SIZE_REMARK_OPTIONS}
                weightLabel="Gross Weight"
                mode={form.inspected_box_mode}
                showModeSelector
                disabled={saving}
                onModeChange={handleInspectedBoxModeChange}
                onCountChange={(value) =>
                  handleCountChange("inspected_box_count", "inspected_box_sizes", value)
                }
                onEntryChange={(index, field, value) =>
                  handleSizeEntryChange("inspected_box_sizes", index, field, value)
                }
              />

              <div className="col-md-4">
                <label className="form-label">Calculated Inspected CBM</label>
                <input
                  type="text"
                  className="form-control"
                  value={calculatedInspectedCbm}
                  disabled
                  readOnly
                />
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">QC</h6>
              </div>
              <div className="col-md-3">
                <div className="form-check mt-4">
                  <input
                    id="item-qc-packed-size"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.qc.packed_size}
                    onChange={(event) => updateField("qc.packed_size", event.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-qc-packed-size" className="form-check-label">
                    Packed Size Check
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-check mt-4">
                  <input
                    id="item-qc-finishing"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.qc.finishing}
                    onChange={(event) => updateField("qc.finishing", event.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-qc-finishing" className="form-check-label">
                    Finishing Check
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-check mt-4">
                  <input
                    id="item-qc-branding"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.qc.branding}
                    onChange={(event) => updateField("qc.branding", event.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-qc-branding" className="form-check-label">
                    Branding Check
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <label className="form-label">Master Barcode</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="form-control"
                  value={form.qc.master_barcode}
                  onChange={(event) => updateField("qc.master_barcode", event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Inner Barcode</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="form-control"
                  value={form.qc.inner_barcode}
                  onChange={(event) => updateField("qc.inner_barcode", event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">Last Inspected Date</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="YYYY-MM-DD or DD/MM/YYYY"
                  value={form.qc.last_inspected_date}
                  onChange={(event) => updateField("qc.last_inspected_date", event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-8">
                <label className="form-label">QC Quantities (Checked / Passed / Pending)</label>
                <div className="input-group">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="form-control"
                    value={form.qc.quantities.checked}
                    onChange={(event) => updateField("qc.quantities.checked", event.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="form-control"
                    value={form.qc.quantities.passed}
                    onChange={(event) => updateField("qc.quantities.passed", event.target.value)}
                    disabled={saving}
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="form-control"
                    value={form.qc.quantities.pending}
                    onChange={(event) => updateField("qc.quantities.pending", event.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div className="row g-2">
              <div className="col-12">
                <h6 className="mb-1">Source</h6>
              </div>
              <div className="col-md-3">
                <div className="form-check">
                  <input
                    id="item-source-orders"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.source.from_orders}
                    onChange={(event) => updateField("source.from_orders", event.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-source-orders" className="form-check-label">
                    From Orders
                  </label>
                </div>
              </div>
              <div className="col-md-3">
                <div className="form-check">
                  <input
                    id="item-source-qc"
                    className="form-check-input"
                    type="checkbox"
                    checked={form.source.from_qc}
                    onChange={(event) => updateField("source.from_qc", event.target.checked)}
                    disabled={saving}
                  />
                  <label htmlFor="item-source-qc" className="form-check-label">
                    From QC
                  </label>
                </div>
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
              {saving ? "Saving..." : "Save Item"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditItemModal;
