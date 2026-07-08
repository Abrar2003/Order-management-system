import { useMemo, useState } from "react";
import MeasuredSizeSection from "../MeasuredSizeSection";
import useBrandOptions from "../../hooks/useBrandOptions";
import { createSample, updateSample } from "../../services/samples.service";
import { createSampleWorkflow } from "../../services/sampleWorkflow.service";
import {
  BOX_PACKAGING_MODES,
  BOX_SIZE_ENTRY_LIMIT,
  BOX_SIZE_REMARK_OPTIONS,
  ITEM_SIZE_REMARK_OPTIONS,
  calculateMeasuredSizeEntriesCbm,
  convertMeasuredBoxEntriesMode,
  createEmptyMeasuredSizeEntry,
  ensureMeasuredSizeEntryCount,
  getFixedBoxEntryCount,
  normalizeSizeCount,
  parseMeasuredSizeEntries,
  resolvePreferredMeasuredSizeCbm,
} from "../../utils/measuredSizeForm";
import { getOptionText, normalizeTextOptions } from "../../utils/optionText";

const initialForm = (sample = null) => ({
  code: String(sample?.code || ""),
  name: String(sample?.name || ""),
  description: String(sample?.description || ""),
  brand: String(sample?.brand || ""),
  vendor: normalizeTextOptions(
    Array.isArray(sample?.vendor) ? sample.vendor : [sample?.vendor],
  ).join(", "),
  box_mode: sample?.box_mode || BOX_PACKAGING_MODES.INDIVIDUAL,
  item_count: String(Math.max(1, sample?.item_sizes?.length || 1)),
  box_count: String(
    getFixedBoxEntryCount(sample?.box_mode) ??
      Math.max(1, sample?.box_sizes?.length || 1),
  ),
  item_sizes: Array.isArray(sample?.item_sizes) && sample.item_sizes.length
    ? sample.item_sizes.map((entry) => ({
        remark: entry?.remark || "",
        L: String(entry?.L || ""),
        B: String(entry?.B || ""),
        H: String(entry?.H || ""),
        weight: String(entry?.net_weight ?? entry?.weight ?? ""),
      }))
    : [createEmptyMeasuredSizeEntry()],
  box_sizes: Array.isArray(sample?.box_sizes) && sample.box_sizes.length
    ? sample.box_sizes.map((entry) => ({
        remark: entry?.remark || entry?.box_type || "",
        box_type: entry?.box_type || "",
        L: String(entry?.L || ""),
        B: String(entry?.B || ""),
        H: String(entry?.H || ""),
        weight: String(entry?.gross_weight ?? entry?.weight ?? ""),
        item_count_in_inner: String(entry?.item_count_in_inner ?? ""),
        box_count_in_master: String(entry?.box_count_in_master ?? ""),
      }))
    : [createEmptyMeasuredSizeEntry({ mode: BOX_PACKAGING_MODES.INDIVIDUAL })],
});

const hasSizeInput = (entries = []) =>
  entries.some((entry) =>
    ["L", "B", "H", "weight"].some((field) => String(entry?.[field] ?? "").trim() !== "") ||
      Number(entry?.item_count_in_inner || 0) > 0 ||
      Number(entry?.box_count_in_master || 0) > 0,
  );

const buildSizePayload = ({
  entries,
  count,
  mode,
  groupLabel,
  remarkOptions,
  payloadWeightKey,
  singleRemark,
  limit,
}) => {
  if (!hasSizeInput(entries)) return { value: [] };

  const parsed = parseMeasuredSizeEntries({
    entries,
    count,
    mode,
    groupLabel,
    remarkOptions,
    payloadWeightKey,
    weightFieldLabel: payloadWeightKey === "gross_weight" ? "Gross Weight" : "Net Weight",
    singleRemark,
    ...(limit ? { limit } : {}),
  });
  if (parsed.error) return parsed;
  return {
    value: parsed.value.map((entry) => {
      const next = { ...entry };
      if (payloadWeightKey === "net_weight") next.gross_weight = 0;
      if (payloadWeightKey === "gross_weight") next.net_weight = 0;
      return next;
    }),
  };
};

const SampleCreateModal = ({ sample = null, onClose, onSaved, isWorkflow = false }) => {
  const isEdit = Boolean(sample?._id);
  const [form, setForm] = useState(() => initialForm(sample));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { brandOptions, loadingBrands } = useBrandOptions([sample?.brand]);

  const itemEntries = useMemo(
    () => ensureMeasuredSizeEntryCount(form.item_sizes, form.item_count, { singleRemark: "item" }),
    [form.item_count, form.item_sizes],
  );
  const boxEntries = useMemo(
    () => ensureMeasuredSizeEntryCount(form.box_sizes, form.box_count, {
      mode: form.box_mode,
      singleRemark: "box",
      limit: BOX_SIZE_ENTRY_LIMIT,
    }),
    [form.box_count, form.box_mode, form.box_sizes],
  );
  const cbm = useMemo(() => resolvePreferredMeasuredSizeCbm(
    calculateMeasuredSizeEntriesCbm(boxEntries, form.box_count, {
      mode: form.box_mode,
      limit: BOX_SIZE_ENTRY_LIMIT,
    }),
    calculateMeasuredSizeEntriesCbm(itemEntries, form.item_count),
  ), [boxEntries, form.box_count, form.box_mode, itemEntries, form.item_count]);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const setCount = (countKey, entriesKey, value) => {
    const isBoxEntries = entriesKey === "box_sizes";
    const safeCount = String(
      normalizeSizeCount(value, 1, isBoxEntries ? BOX_SIZE_ENTRY_LIMIT : undefined),
    );
    setForm((prev) => ({
      ...prev,
      [countKey]: safeCount,
      [entriesKey]: ensureMeasuredSizeEntryCount(prev[entriesKey], safeCount, {
        mode: isBoxEntries ? prev.box_mode : BOX_PACKAGING_MODES.INDIVIDUAL,
        singleRemark: isBoxEntries ? "box" : "item",
        ...(isBoxEntries ? { limit: BOX_SIZE_ENTRY_LIMIT } : {}),
      }),
    }));
  };

  const setEntry = (entriesKey, index, field, value) => {
    setForm((prev) => {
      const entries = [...prev[entriesKey]];
      entries[index] = { ...entries[index], [field]: value };
      return { ...prev, [entriesKey]: entries };
    });
  };

  const handleBoxModeChange = (mode) => {
    setForm((prev) => ({
      ...prev,
      box_mode: mode,
      box_count: String(
        getFixedBoxEntryCount(mode) ??
          normalizeSizeCount(prev.box_count, 1, BOX_SIZE_ENTRY_LIMIT),
      ),
      box_sizes: convertMeasuredBoxEntriesMode(prev.box_sizes, mode),
    }));
  };

  const buildPayload = () => {
    const itemPayload = buildSizePayload({
      entries: itemEntries,
      count: form.item_count,
      mode: BOX_PACKAGING_MODES.INDIVIDUAL,
      groupLabel: "Item Size",
      remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
      payloadWeightKey: "net_weight",
      singleRemark: "item",
    });
    if (itemPayload.error) return { error: itemPayload.error };

    const boxPayload = buildSizePayload({
      entries: boxEntries,
      count: form.box_count,
      mode: form.box_mode,
      groupLabel: "Box Size",
      remarkOptions: BOX_SIZE_REMARK_OPTIONS,
      payloadWeightKey: "gross_weight",
      singleRemark: "box",
      limit: BOX_SIZE_ENTRY_LIMIT,
    });
    if (boxPayload.error) return { error: boxPayload.error };

    return {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      brand: form.brand.trim(),
      vendor: getOptionText(form.vendor),
      item_sizes: itemPayload.value,
      box_sizes: boxPayload.value,
      box_mode: form.box_mode,
      cbm,
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const payload = buildPayload();
    if (payload.error) {
      setError(payload.error);
      return;
    }
    if (!payload.code || !payload.brand || (!payload.name && !payload.description)) {
      setError("Code, brand, and either name or description are required.");
      return;
    }

    try {
      setSaving(true);
      const response = isEdit
        ? await updateSample(sample._id, payload)
        : isWorkflow
        ? await createSampleWorkflow(payload)
        : await createSample(payload);
      onSaved?.(response?.data?.data || response?.data);
      onClose?.();
    } catch (submitError) {
      setError(submitError?.response?.data?.message || "Failed to save sample.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <form className="modal-content" onSubmit={handleSubmit}>
          <div className="modal-header">
            <h5 className="modal-title">{isEdit ? "Edit Sample" : isWorkflow ? "Create Sample Workflow" : "Create Sample"}</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>
          <div className="modal-body d-grid gap-3">
            {error && <div className="alert alert-danger mb-0">{error}</div>}
            <div className="row g-3">
              <div className="col-md-3">
                <label className="form-label">Sample Code</label>
                <input className="form-control" value={form.code} onChange={(e) => setField("code", e.target.value.toUpperCase())} disabled={isEdit} required />
              </div>
              <div className="col-md-3">
                <label className="form-label">Name</label>
                <input className="form-control" value={form.name} onChange={(e) => setField("name", e.target.value)} />
              </div>
              <div className="col-md-3">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={form.brand}
                  onChange={(e) => setField("brand", e.target.value)}
                  required
                >
                  <option value="">Select Brand</option>
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
                {loadingBrands && <div className="form-text">Loading brands...</div>}
              </div>
              <div className="col-md-3">
                <label className="form-label">Vendor</label>
                <input className="form-control" value={form.vendor} onChange={(e) => setField("vendor", e.target.value)} placeholder="Optional" />
              </div>
              <div className="col-md-6">
                <label className="form-label">Description</label>
                <textarea className="form-control" rows="2" value={form.description} onChange={(e) => setField("description", e.target.value)} />
              </div>
              <div className="col-md-3">
                <label className="form-label">CBM</label>
                <input className="form-control" value={cbm} readOnly />
              </div>
            </div>
            <div className="row g-3">
              <MeasuredSizeSection
                sectionKey="sample-item"
                title="Item Sizes"
                countLabel="Item Size Rows"
                countValue={form.item_count}
                entries={itemEntries}
                remarkOptions={ITEM_SIZE_REMARK_OPTIONS}
                weightLabel="Net Weight"
                onCountChange={(value) => setCount("item_count", "item_sizes", value)}
                onEntryChange={(index, field, value) => setEntry("item_sizes", index, field, value)}
              />
            </div>
            <div className="row g-3">
              <MeasuredSizeSection
                sectionKey="sample-box"
                title="Box Sizes"
                countLabel="Box Size Rows"
                countValue={form.box_count}
                entries={boxEntries}
                remarkOptions={BOX_SIZE_REMARK_OPTIONS}
                weightLabel="Gross Weight"
                mode={form.box_mode}
                showModeSelector
                onModeChange={handleBoxModeChange}
                onCountChange={(value) => setCount("box_count", "box_sizes", value)}
                onEntryChange={(index, field, value) => setEntry("box_sizes", index, field, value)}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : isWorkflow ? "Create Sample Workflow" : "Save Sample"}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SampleCreateModal;
