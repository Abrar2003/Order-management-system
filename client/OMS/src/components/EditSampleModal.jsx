import { useMemo, useState } from "react";
import api from "../api/axios";
import {
  formatDateDDMMYYYY,
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { useShippingInspectors } from "../hooks/useShippingInspectors";
import {
  SHIPPED_BY_VENDOR_OPTION,
} from "../hooks/useShippingInspectors";
import useBrandOptions from "../hooks/useBrandOptions";
import { normalizeShipmentCheckedDraft } from "../utils/shipmentRows";
import "../App.css";
import MeasuredSizeSection from "./MeasuredSizeSection";
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
} from "../utils/measuredSizeForm";

const normalizeShipmentDraftInvoiceNumber = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "N/A" ? normalized : "";
};

const normalizeStuffedById = (entry = {}) => {
  const id = String(entry?.stuffed_by?.id ?? "").trim();
  const name = String(entry?.stuffed_by?.name ?? "").trim();
  if (name.toLowerCase() === SHIPPED_BY_VENDOR_OPTION.name.toLowerCase()) {
    return SHIPPED_BY_VENDOR_OPTION.id;
  }
  return id;
};

const makeInitialShipmentRows = (shipment = []) =>
  (Array.isArray(shipment) ? shipment : []).map((entry) => ({
    _id: String(entry?._id ?? ""),
    container: String(entry?.container ?? ""),
    invoice_number: normalizeShipmentDraftInvoiceNumber(entry?.invoice_number),
    stuffing_date: toDDMMYYYYInputValue(entry?.stuffing_date, ""),
    quantity: String(entry?.quantity ?? ""),
    remaining_remarks: String(entry?.remaining_remarks ?? ""),
    stuffed_by_id: normalizeStuffedById(entry),
    stuffed_by_name: String(entry?.stuffed_by?.name ?? ""),
    checked: normalizeShipmentCheckedDraft(entry?.checked),
  }));

const createEmptyShipmentRow = () => ({
  _id: "",
  container: "",
  invoice_number: "",
  stuffing_date: getTodayDDMMYYYY(),
  quantity: "",
  remaining_remarks: "",
  stuffed_by_id: "",
  stuffed_by_name: "",
  checked: normalizeShipmentCheckedDraft(),
});

const EditSampleModal = ({ sample, onClose, onSuccess }) => {
  const hasEditableSizeData =
    Object.prototype.hasOwnProperty.call(sample || {}, "item_sizes") ||
    Object.prototype.hasOwnProperty.call(sample || {}, "box_sizes") ||
    Object.prototype.hasOwnProperty.call(sample || {}, "box_mode");
  const [form, setForm] = useState({
    code: String(sample?.code ?? ""),
    name: String(sample?.name ?? ""),
    description: String(sample?.description ?? ""),
    brand: String(sample?.brand ?? ""),
    vendor: Array.isArray(sample?.vendor)
      ? sample.vendor.join(", ")
      : String(sample?.vendor ?? ""),
    shipment: makeInitialShipmentRows(sample?.shipment),
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const {
    brandOptions,
    loadingBrands,
  } = useBrandOptions([sample?.brand]);
  const {
    inspectors,
    inspectorById,
    loadingInspectors,
    inspectorError,
  } = useShippingInspectors();

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

  const hasSizeInput = (entries = []) =>
    entries.some((entry) =>
      ["L", "B", "H", "weight"].some((field) => String(entry?.[field] ?? "").trim() !== "") ||
        Number(entry?.item_count_in_inner || 0) > 0 ||
        Number(entry?.box_count_in_master || 0) > 0,
    );

  const shipmentInspectorOptions = useMemo(() => {
    const optionMap = new Map(inspectors.map((entry) => [entry.id, entry]));

    (form.shipment || []).forEach((entry) => {
      const inspectorId = String(entry?.stuffed_by_id || "").trim();
      const inspectorName = String(entry?.stuffed_by_name || "").trim();
      if (!inspectorId || optionMap.has(inspectorId)) return;
      optionMap.set(inspectorId, {
        id: inspectorId,
        name: inspectorName || inspectorId,
      });
    });

    return Array.from(optionMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [form.shipment, inspectors]);

  const updateShipmentRow = (index, field, value) => {
    setForm((prev) => {
      const shipment = [...prev.shipment];
      const nextEntry = {
        ...shipment[index],
        [field]: value,
      };

      if (field === "stuffed_by_id") {
        nextEntry.stuffed_by_name =
          inspectorById.get(String(value || "").trim())?.name || "";
      }

      shipment[index] = nextEntry;
      return { ...prev, shipment };
    });
  };

  const removeShipmentRow = (index) => {
    setForm((prev) => ({
      ...prev,
      shipment: prev.shipment.filter((_, rowIndex) => rowIndex !== index),
    }));
  };

  const addShipmentRow = () => {
    setForm((prev) => ({
      ...prev,
      shipment: [...prev.shipment, createEmptyShipmentRow()],
    }));
  };

  const validateForm = () => {
    const code = String(form.code || "").trim();
    if (!code) return "code is required";

    for (let i = 0; i < form.shipment.length; i += 1) {
      const row = form.shipment[i] || {};
      const container = String(row.container || "").trim();
      const stuffingDate = String(row.stuffing_date || "").trim();
      const stuffingDateIso = toISODateString(stuffingDate);
      const shipmentQty = Number(row.quantity);
      const stuffedById = String(row.stuffed_by_id || "").trim();

      if (!container) return `shipment row ${i + 1}: container is required`;
      if (!stuffingDateIso || !isValidDDMMYYYY(stuffingDate)) {
        return `shipment row ${i + 1}: stuffing date must be in DD/MM/YYYY format`;
      }
      if (!stuffedById) {
        return `shipment row ${i + 1}: stuffed by is required`;
      }
      if (!Number.isFinite(shipmentQty) || shipmentQty <= 0) {
        return `shipment row ${i + 1}: quantity must be a positive number`;
      }
    }

    return null;
  };

  const buildConfirmationMessage = (payload) => {
    const lines = [
      "Confirm these sample changes:",
      `Code: ${payload.code}`,
      `Name: ${payload.name || "N/A"}`,
      `Brand: ${payload.brand || "N/A"}`,
      `Vendor: ${payload.vendor || "N/A"}`,
      "Shipment Rows:",
    ];

    if (payload.shipment.length === 0) {
      lines.push("0) None");
    } else {
      payload.shipment.forEach((entry, idx) => {
        lines.push(
          `${idx + 1}) ${entry.container} | invoice ${entry.invoice_number || "N/A"} | stuffed by ${entry.stuffed_by.name || "-"} | ${formatDateDDMMYYYY(entry.stuffing_date, "-")} | qty ${entry.quantity} | remarks ${entry.remaining_remarks || "-"}`,
        );
      });
    }

    return lines.join("\n");
  };

  const handleSubmit = async () => {
    setError("");
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    let itemPayload = null;
    let boxPayload = null;
    if (hasEditableSizeData) {
      itemPayload = buildSizePayload({
        entries: itemEntries,
        count: form.item_count,
        mode: BOX_PACKAGING_MODES.INDIVIDUAL,
        groupLabel: "Item Size",
        remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "net_weight",
        singleRemark: "item",
      });
      if (itemPayload.error) {
        setError(itemPayload.error);
        return;
      }

      boxPayload = buildSizePayload({
        entries: boxEntries,
        count: form.box_count,
        mode: form.box_mode,
        groupLabel: "Box Size",
        remarkOptions: BOX_SIZE_REMARK_OPTIONS,
        payloadWeightKey: "gross_weight",
        singleRemark: "box",
        limit: BOX_SIZE_ENTRY_LIMIT,
      });
      if (boxPayload.error) {
        setError(boxPayload.error);
        return;
      }
    }

    const payload = {
      code: String(form.code || "").trim(),
      name: String(form.name || "").trim(),
      description: String(form.description || "").trim(),
      brand: String(form.brand || "").trim(),
      vendor: String(form.vendor || "").trim(),
      shipment: form.shipment.map((entry) => ({
        _id: String(entry?._id || "").trim(),
        stuffed_by: {
          id: String(entry?.stuffed_by_id || "").trim(),
          name:
            inspectorById.get(String(entry?.stuffed_by_id || "").trim())?.name
            || String(entry?.stuffed_by_name || "").trim(),
        },
        container: String(entry?.container || "").trim(),
        invoice_number: String(entry?.invoice_number || "").trim(),
        stuffing_date: toISODateString(entry?.stuffing_date),
        quantity: Number(entry?.quantity),
        remaining_remarks: String(entry?.remaining_remarks ?? "").trim(),
        checked: normalizeShipmentCheckedDraft(entry?.checked),
      })),
    };
    if (hasEditableSizeData) {
      payload.item_sizes = itemPayload.value;
      payload.box_sizes = boxPayload.value;
      payload.box_mode = form.box_mode;
      payload.cbm = cbm;
    }

    if (!window.confirm(buildConfirmationMessage(payload))) {
      return;
    }

    try {
      setSaving(true);
      const response = await api.patch(
        `/samples/${encodeURIComponent(String(sample?._id || "").trim())}`,
        payload,
      );
      onSuccess?.(response?.data);
      onClose?.();
    } catch (submitError) {
      setError(submitError?.response?.data?.message || "Failed to update sample.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              Edit Sample | {sample?.code || "N/A"}
            </h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label">Sample Code</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.code}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Sample Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Brand</label>
                <select
                  className="form-select"
                  value={form.brand}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, brand: event.target.value }))
                  }
                  disabled={saving || loadingBrands}
                >
                  <option value="">{loadingBrands ? "Loading brands..." : "Select Brand"}</option>
                  {brandOptions.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label">Vendor</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.vendor}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, vendor: event.target.value }))
                  }
                />
              </div>
              <div className={hasEditableSizeData ? "col-md-9" : "col-12"}>
                <label className="form-label">Description</label>
                <textarea
                  className="form-control"
                  rows="2"
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </div>
              {hasEditableSizeData && (
                <div className="col-md-3">
                  <label className="form-label">CBM</label>
                  <input
                    type="text"
                    className="form-control"
                    value={cbm}
                    readOnly
                  />
                </div>
              )}
            </div>

            {hasEditableSizeData && (
              <>
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
              </>
            )}

            <div className="d-flex justify-content-between align-items-center">
              <h6 className="mb-0">Shipment Rows</h6>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addShipmentRow}>
                Add Row
              </button>
            </div>

            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "16%" }}>Shipped By</th>
                    <th style={{ width: "16%" }}>Container</th>
                    <th style={{ width: "16%" }}>Invoice Number</th>
                    <th style={{ width: "14%" }}>Stuffing Date</th>
                    <th style={{ width: "10%" }}>Quantity</th>
                    <th style={{ width: "20%" }}>Remarks</th>
                    <th style={{ width: "8%" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {form.shipment.length === 0 && (
                    <tr>
                      <td colSpan="7" className="text-center text-secondary py-3">
                        No shipment rows
                      </td>
                    </tr>
                  )}
                  {form.shipment.map((entry, index) => (
                    <tr key={`sample-shipment-row-${index}`}>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={entry.stuffed_by_id}
                          disabled={loadingInspectors}
                          onChange={(event) =>
                            updateShipmentRow(index, "stuffed_by_id", event.target.value)
                          }
                        >
                          <option value="">
                            {loadingInspectors ? "Loading inspectors..." : "Select shipped by"}
                          </option>
                          {shipmentInspectorOptions.map((inspector) => (
                            <option key={inspector.id} value={inspector.id}>
                              {inspector.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.container}
                          onChange={(event) =>
                            updateShipmentRow(index, "container", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.invoice_number}
                          onChange={(event) =>
                            updateShipmentRow(index, "invoice_number", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className="form-control form-control-sm"
                          value={toISODateString(entry.stuffing_date)}
                          onChange={(event) =>
                            updateShipmentRow(
                              index,
                              "stuffing_date",
                              toDDMMYYYYInputValue(event.target.value, ""),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          className="form-control form-control-sm"
                          value={entry.quantity}
                          onChange={(event) =>
                            updateShipmentRow(index, "quantity", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={entry.remaining_remarks}
                          onChange={(event) =>
                            updateShipmentRow(index, "remaining_remarks", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => removeShipmentRow(index)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {inspectorError && <div className="alert alert-warning mb-0">{inspectorError}</div>}
            {error && <div className="alert alert-danger mb-0">{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditSampleModal;
