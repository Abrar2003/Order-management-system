import { useMemo, useState } from "react";
import api from "../api/axios";
import MeasuredSizeSection from "./MeasuredSizeSection";
import {
  BOX_PACKAGING_MODES,
  BOX_SIZE_REMARK_OPTIONS,
  ITEM_SIZE_REMARK_OPTIONS,
  calculateMeasuredSizeEntriesCbm,
  createEmptyMeasuredSizeEntry,
  detectBoxPackagingMode,
  ensureMeasuredSizeEntryCount,
  normalizeSizeCount,
  parseMeasuredSizeEntries,
} from "../utils/measuredSizeForm";
import "../App.css";

const ACCEPTED_PIS_SHEET = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

const createInitialForm = () => ({
  code: "",
  name: "",
  description: "",
  brand: "",
  vendor: "",
  pis_item_count: "1",
  pis_box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
  pis_box_count: "1",
  pis_item_sizes: [createEmptyMeasuredSizeEntry()],
  pis_box_sizes: [
    createEmptyMeasuredSizeEntry({ mode: BOX_PACKAGING_MODES.INDIVIDUAL }),
  ],
});

const CreateItemModal = ({
  onClose,
  onCreated,
  brandOptions = [],
  vendorOptions = [],
}) => {
  const [form, setForm] = useState(createInitialForm);
  const [pisSheetFile, setPisSheetFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const handleFieldChange = (name, value) => {
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
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

      const code = String(form.code || "").trim().toUpperCase();
      const name = String(form.name || "").trim();
      const description = String(form.description || "").trim();
      const brand = String(form.brand || "").trim();
      const vendor = String(form.vendor || "").trim();

      if (!code) throw new Error("Item code is required.");
      if (!name) throw new Error("Item name is required.");
      if (!description) throw new Error("Description is required.");
      if (!brand) throw new Error("Brand is required.");
      if (!vendor) throw new Error("Vendor is required.");
      if (!pisSheetFile) throw new Error("PIS sheet is required.");

      const normalizedFileName = String(pisSheetFile.name || "").toLowerCase();
      if (
        !normalizedFileName.endsWith(".xlsx") &&
        !normalizedFileName.endsWith(".xls")
      ) {
        throw new Error("Only .xlsx and .xls files are allowed for the PIS sheet.");
      }

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

      const formData = new FormData();
      formData.append("code", code);
      formData.append("name", name);
      formData.append("description", description);
      formData.append("brand", brand);
      formData.append("vendor", vendor);
      formData.append("pis_box_mode", form.pis_box_mode);
      formData.append("pis_item_sizes", JSON.stringify(pisItemPayload.value));
      formData.append("pis_box_sizes", JSON.stringify(pisBoxPayload.value));
      formData.append("pis_file", pisSheetFile);

      const response = await api.post("/items", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      onCreated?.(response?.data?.data || null);
      onClose?.();
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message || saveError?.message || "Failed to create item.",
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
            <h5 className="modal-title">Create Item</h5>
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
              <div className="col-md-6">
                <label className="form-label">Item Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.code}
                  onChange={(event) => handleFieldChange("code", event.target.value.toUpperCase())}
                  disabled={saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Item Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(event) => handleFieldChange("name", event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Brand</label>
                <input
                  type="text"
                  className="form-control"
                  list="create-item-brand-options"
                  value={form.brand}
                  onChange={(event) => handleFieldChange("brand", event.target.value)}
                  disabled={saving}
                />
                <datalist id="create-item-brand-options">
                  {brandOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-6">
                <label className="form-label">Vendor</label>
                <input
                  type="text"
                  className="form-control"
                  list="create-item-vendor-options"
                  value={form.vendor}
                  onChange={(event) => handleFieldChange("vendor", event.target.value)}
                  disabled={saving}
                />
                <datalist id="create-item-vendor-options">
                  {vendorOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="col-12">
                <label className="form-label">Description</label>
                <textarea
                  className="form-control"
                  rows="3"
                  value={form.description}
                  onChange={(event) => handleFieldChange("description", event.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="col-12">
                <label className="form-label">PIS Sheet</label>
                <input
                  type="file"
                  className="form-control"
                  accept={ACCEPTED_PIS_SHEET}
                  onChange={(event) => setPisSheetFile(event.target.files?.[0] || null)}
                  disabled={saving}
                />
                <div className="small text-secondary mt-1">
                  Upload the source PIS spreadsheet in `.xlsx` or `.xls` format.
                </div>
              </div>
            </div>

            <div className="row g-3">
              <div className="col-12">
                <h6 className="mb-0">PIS Measurements</h6>
              </div>

              <MeasuredSizeSection
                sectionKey="create-pis-item"
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
                sectionKey="create-pis-box"
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
              {saving ? "Creating..." : "Create Item"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateItemModal;
