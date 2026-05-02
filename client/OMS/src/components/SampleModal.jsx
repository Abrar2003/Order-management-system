import { useEffect, useMemo, useState } from "react";
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
import {
  getTodayDDMMYYYY,
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import {
  useShippingInspectors,
} from "../hooks/useShippingInspectors";
import "../App.css";

const createInitialSampleForm = () => ({
  code: "",
  name: "",
  description: "",
  brand: "",
  vendor: "",
  item_count: "1",
  box_mode: BOX_PACKAGING_MODES.INDIVIDUAL,
  box_count: "1",
  item_sizes: [createEmptyMeasuredSizeEntry()],
  box_sizes: [
    createEmptyMeasuredSizeEntry({ mode: BOX_PACKAGING_MODES.INDIVIDUAL }),
  ],
});

const normalizeSampleOptionLabel = (sample = {}) => {
  const code = String(sample?.code || "").trim();
  const name = String(sample?.name || "").trim();
  const brand = String(sample?.brand || "").trim();

  return [code, name, brand].filter(Boolean).join(" | ");
};

const hasPositiveNumericInput = (value) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return false;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0;
};

const hasMeaningfulSampleSizeInput = (
  entry = {},
  { mode = BOX_PACKAGING_MODES.INDIVIDUAL } = {},
) => {
  const resolvedMode = detectBoxPackagingMode(mode, [entry]);

  if (
    String(entry?.L ?? "").trim() !== "" ||
    String(entry?.B ?? "").trim() !== "" ||
    String(entry?.H ?? "").trim() !== "" ||
    String(entry?.weight ?? "").trim() !== ""
  ) {
    return true;
  }

  if (resolvedMode === BOX_PACKAGING_MODES.CARTON) {
    return (
      hasPositiveNumericInput(entry?.item_count_in_inner) ||
      hasPositiveNumericInput(entry?.box_count_in_master)
    );
  }

  return String(entry?.remark ?? "").trim() !== "";
};

const parseOptionalSampleMeasuredSizeEntries = ({
  entries = [],
  count = 1,
  mode = BOX_PACKAGING_MODES.INDIVIDUAL,
  ...rest
} = {}) => {
  const resolvedMode = detectBoxPackagingMode(mode, entries);
  const normalizedEntries = ensureMeasuredSizeEntryCount(entries, count, {
    mode: resolvedMode,
  });
  const hasMeaningfulInput = normalizedEntries.some((entry) =>
    hasMeaningfulSampleSizeInput(entry, { mode: resolvedMode }),
  );

  if (!hasMeaningfulInput) {
    return {
      mode: resolvedMode,
      hasAnyInput: false,
      value: [],
    };
  }

  return parseMeasuredSizeEntries({
    entries,
    count,
    mode: resolvedMode,
    ...rest,
  });
};

const SampleModal = ({
  mode = "create",
  onClose,
  onCreated,
  onShipped,
  brandOptions = [],
  vendorOptions = [],
  shippingContext = null,
}) => {
  const isShippingMode = mode === "ship";
  const usesExternalShippingContext = Boolean(shippingContext);
  const [sampleForm, setSampleForm] = useState(createInitialSampleForm);
  const [shippingMode, setShippingMode] = useState("existing");
  const [samples, setSamples] = useState([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [samplesError, setSamplesError] = useState("");
  const [sampleSearch, setSampleSearch] = useState("");
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [shipmentQuantity, setShipmentQuantity] = useState("");
  const [remarks, setRemarks] = useState("");
  const [containerNumber, setContainerNumber] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [stuffingDate, setStuffingDate] = useState(
    toDDMMYYYYInputValue(new Date(), "") || getTodayDDMMYYYY(),
  );
  const [stuffedById, setStuffedById] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const {
    inspectors,
    inspectorById,
    loadingInspectors,
    inspectorError,
  } = useShippingInspectors();

  useEffect(() => {
    if (!isShippingMode) return undefined;

    let ignore = false;

    const fetchSamples = async () => {
      try {
        setSamplesLoading(true);
        setSamplesError("");
        const response = await api.get("/samples", {
          params: {
            limit: 100,
          },
        });
        if (!ignore) {
          setSamples(Array.isArray(response?.data?.data) ? response.data.data : []);
        }
      } catch (fetchError) {
        if (!ignore) {
          setSamples([]);
          setSamplesError(
            fetchError?.response?.data?.message || "Failed to load samples.",
          );
        }
      } finally {
        if (!ignore) {
          setSamplesLoading(false);
        }
      }
    };

    fetchSamples();

    return () => {
      ignore = true;
    };
  }, [isShippingMode]);

  const displayedItemEntries = useMemo(
    () => ensureMeasuredSizeEntryCount(sampleForm.item_sizes, sampleForm.item_count),
    [sampleForm.item_count, sampleForm.item_sizes],
  );
  const displayedBoxEntries = useMemo(
    () =>
      ensureMeasuredSizeEntryCount(sampleForm.box_sizes, sampleForm.box_count, {
        mode: sampleForm.box_mode,
      }),
    [sampleForm.box_count, sampleForm.box_mode, sampleForm.box_sizes],
  );
  const calculatedItemCbm = useMemo(
    () => calculateMeasuredSizeEntriesCbm(sampleForm.item_sizes, sampleForm.item_count),
    [sampleForm.item_count, sampleForm.item_sizes],
  );
  const calculatedBoxCbm = useMemo(
    () =>
      calculateMeasuredSizeEntriesCbm(sampleForm.box_sizes, sampleForm.box_count, {
        mode: sampleForm.box_mode,
      }),
    [sampleForm.box_count, sampleForm.box_mode, sampleForm.box_sizes],
  );
  const calculatedCbm = useMemo(() => {
    const itemValue = Number(calculatedItemCbm || 0);
    const boxValue = Number(calculatedBoxCbm || 0);
    return boxValue >= itemValue ? calculatedBoxCbm : calculatedItemCbm;
  }, [calculatedBoxCbm, calculatedItemCbm]);

  const selectedSample = useMemo(
    () =>
      samples.find(
        (entry) => String(entry?._id || "").trim() === String(selectedSampleId || "").trim(),
      ) || null,
    [samples, selectedSampleId],
  );

  const filteredSamples = useMemo(() => {
    const needle = String(sampleSearch || "").trim().toLowerCase();
    if (!needle) return samples;

    return samples.filter((sample) =>
      normalizeSampleOptionLabel(sample).toLowerCase().includes(needle),
    );
  }, [sampleSearch, samples]);

  const handleSampleFieldChange = (name, value) => {
    setSampleForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCountChange = (countKey, entriesKey, value) => {
    const safeCount = String(normalizeSizeCount(value, 1));
    setSampleForm((prev) => ({
      ...prev,
      [countKey]: safeCount,
      [entriesKey]: ensureMeasuredSizeEntryCount(prev[entriesKey], safeCount),
    }));
  };

  const handleBoxModeChange = (value) => {
    const nextMode = detectBoxPackagingMode(value, sampleForm.box_sizes);
    const nextCount = nextMode === BOX_PACKAGING_MODES.CARTON ? "2" : sampleForm.box_count;
    setSampleForm((prev) => ({
      ...prev,
      box_mode: nextMode,
      box_count: nextCount,
      box_sizes: ensureMeasuredSizeEntryCount(prev.box_sizes, nextCount, {
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

    setSampleForm((prev) => ({
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
        entriesKey === "box_sizes" ? { mode: prev.box_mode } : {},
      ),
    }));
  };

  const buildSamplePayload = () => {
    const code = String(sampleForm.code || "").trim().toUpperCase();
    if (!code) {
      throw new Error("Sample code is required.");
    }

    const itemSizesPayload = parseOptionalSampleMeasuredSizeEntries({
      entries: sampleForm.item_sizes,
      count: sampleForm.item_count,
      groupLabel: "Sample item size",
      remarkOptions: ITEM_SIZE_REMARK_OPTIONS,
      payloadWeightKey: "net_weight",
      weightFieldLabel: "Net weight",
    });
    if (itemSizesPayload.error) {
      throw new Error(itemSizesPayload.error);
    }

    const boxSizesPayload = parseOptionalSampleMeasuredSizeEntries({
      entries: sampleForm.box_sizes,
      count: sampleForm.box_count,
      groupLabel: "Sample box size",
      remarkOptions: BOX_SIZE_REMARK_OPTIONS,
      payloadWeightKey: "gross_weight",
      weightFieldLabel: "Gross weight",
      mode: sampleForm.box_mode,
    });
    if (boxSizesPayload.error) {
      throw new Error(boxSizesPayload.error);
    }

    return {
      code,
      name: String(sampleForm.name || "").trim(),
      description: String(sampleForm.description || "").trim(),
      brand: String(sampleForm.brand || "").trim(),
      vendor: String(sampleForm.vendor || "").trim(),
      box_mode: sampleForm.box_mode,
      item_sizes: itemSizesPayload.value,
      box_sizes: boxSizesPayload.value,
      cbm: Number(calculatedCbm || 0) || 0,
    };
  };

  const createSample = async () => {
    const payload = buildSamplePayload();
    const response = await api.post("/samples", payload);
    return response?.data?.data || null;
  };

  const buildShipmentPayload = () => {
    const quantity = Number(shipmentQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a valid positive number.");
    }

    if (usesExternalShippingContext) {
      const stuffedBy = shippingContext?.stuffed_by || null;
      if (!shippingContext?.container) {
        throw new Error("Container number is required before adding a sample.");
      }
      if (!shippingContext?.stuffing_date) {
        throw new Error("Shipping date is required before adding a sample.");
      }
      if (!stuffedBy) {
        throw new Error("Shipped by is required before adding a sample.");
      }

      return {
        stuffing_date: shippingContext.stuffing_date,
        container: shippingContext.container,
        invoice_number: shippingContext.invoice_number || "",
        stuffed_by: stuffedBy,
        quantity,
        remarks: String(remarks || "").trim(),
      };
    }

    const stuffingDateIso = toISODateString(stuffingDate);
    if (!isValidDDMMYYYY(stuffingDate) || !stuffingDateIso) {
      throw new Error("Stuffing date must be in DD/MM/YYYY format.");
    }

    const stuffedBy = inspectorById.get(String(stuffedById || "").trim());
    if (!stuffedBy) {
      throw new Error("Select who shipped this sample.");
    }

    const parsedContainer = String(containerNumber || "").trim();
    if (!parsedContainer) {
      throw new Error("Container number is required.");
    }

    return {
      stuffing_date: stuffingDateIso,
      container: parsedContainer,
      invoice_number: String(invoiceNumber || "").trim(),
      stuffed_by: stuffedBy,
      quantity,
      remarks: String(remarks || "").trim(),
    };
  };

  const handleSubmit = async () => {
    try {
      setSaving(true);
      setError("");

      if (!isShippingMode) {
        const createdSample = await createSample();
        onCreated?.(createdSample);
        onClose?.();
        return;
      }

      let sampleToShip = selectedSample;
      if (shippingMode === "create") {
        sampleToShip = await createSample();
      }

      const sampleId = String(sampleToShip?._id || "").trim();
      if (!sampleId) {
        throw new Error("Select an existing sample or create a new one.");
      }

      const shipmentPayload = buildShipmentPayload();
      const response = await api.patch(
        `/samples/${encodeURIComponent(sampleId)}/finalize-shipment`,
        shipmentPayload,
      );

      onShipped?.(response?.data?.data || sampleToShip || null);
      onClose?.();
    } catch (submitError) {
      setError(
        submitError?.response?.data?.message
          || submitError?.message
          || "Failed to save sample.",
      );
    } finally {
      setSaving(false);
    }
  };

  const modalTitle = isShippingMode
    ? "Add Sample"
    : "Create Sample";
  const submitLabel = isShippingMode
    ? (shippingMode === "create" ? "Create and Add Sample" : "Add Sample")
    : "Create Sample";

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{modalTitle}</h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              disabled={saving}
              onClick={onClose}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            {isShippingMode && (
              <div className="d-flex gap-2 flex-wrap">
                <button
                  type="button"
                  className={`btn btn-sm ${shippingMode === "existing" ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => {
                    setShippingMode("existing");
                    setError("");
                  }}
                  disabled={saving}
                >
                  Select Existing
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${shippingMode === "create" ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => {
                    setShippingMode("create");
                    setError("");
                  }}
                  disabled={saving}
                >
                  Create New
                </button>
              </div>
            )}

            {isShippingMode && shippingMode === "existing" ? (
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label">Search Samples</label>
                  <input
                    type="text"
                    className="form-control"
                    value={sampleSearch}
                    onChange={(event) => setSampleSearch(event.target.value)}
                    placeholder="Search by code, name, or brand"
                    disabled={saving}
                  />
                </div>
                <div className="col-12">
                  <label className="form-label">Existing Sample</label>
                  <select
                    className="form-select"
                    value={selectedSampleId}
                    onChange={(event) => setSelectedSampleId(event.target.value)}
                    disabled={saving || samplesLoading}
                  >
                    <option value="">
                      {samplesLoading ? "Loading samples..." : "Select sample"}
                    </option>
                    {filteredSamples.map((sample) => (
                      <option key={sample._id} value={sample._id}>
                        {normalizeSampleOptionLabel(sample)}
                      </option>
                    ))}
                  </select>
                  {selectedSample && (
                    <div className="small text-secondary mt-2">
                      {selectedSample.description || selectedSample.name || selectedSample.code}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label">Sample Code</label>
                    <input
                      type="text"
                      className="form-control"
                      value={sampleForm.code}
                      onChange={(event) =>
                        handleSampleFieldChange("code", event.target.value.toUpperCase())
                      }
                      disabled={saving}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Sample Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={sampleForm.name}
                      onChange={(event) =>
                        handleSampleFieldChange("name", event.target.value)
                      }
                      disabled={saving}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Brand</label>
                    <input
                      type="text"
                      className="form-control"
                      list="sample-brand-options"
                      value={sampleForm.brand}
                      onChange={(event) =>
                        handleSampleFieldChange("brand", event.target.value)
                      }
                      disabled={saving}
                    />
                    <datalist id="sample-brand-options">
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
                      list="sample-vendor-options"
                      value={sampleForm.vendor}
                      onChange={(event) =>
                        handleSampleFieldChange("vendor", event.target.value)
                      }
                      disabled={saving}
                    />
                    <datalist id="sample-vendor-options">
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
                      value={sampleForm.description}
                      onChange={(event) =>
                        handleSampleFieldChange("description", event.target.value)
                      }
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="row g-3">
                  <div className="col-12">
                    <h6 className="mb-0">Measurements</h6>
                  </div>

                  <MeasuredSizeSection
                    sectionKey="sample-item"
                    title="Sample Item Sizes (Optional) (cm) and Net Weight"
                    countLabel="Item Sets"
                    countValue={sampleForm.item_count}
                    entries={displayedItemEntries}
                    remarkOptions={ITEM_SIZE_REMARK_OPTIONS}
                    weightLabel="Net Weight"
                    disabled={saving}
                    onCountChange={(value) =>
                      handleCountChange("item_count", "item_sizes", value)
                    }
                    onEntryChange={(index, field, value) =>
                      handleSizeEntryChange("item_sizes", index, field, value)
                    }
                  />

                  <MeasuredSizeSection
                    sectionKey="sample-box"
                    title="Sample Box Sizes (Optional) (cm) and Gross Weight"
                    countLabel="Box Sets"
                    countValue={sampleForm.box_count}
                    entries={displayedBoxEntries}
                    remarkOptions={BOX_SIZE_REMARK_OPTIONS}
                    weightLabel="Gross Weight"
                    mode={sampleForm.box_mode}
                    showModeSelector
                    disabled={saving}
                    onModeChange={handleBoxModeChange}
                    onCountChange={(value) =>
                      handleCountChange("box_count", "box_sizes", value)
                    }
                    onEntryChange={(index, field, value) =>
                      handleSizeEntryChange("box_sizes", index, field, value)
                    }
                  />

                  <div className="col-md-4">
                    <label className="form-label">Calculated CBM</label>
                    <input
                      type="text"
                      className="form-control"
                      value={calculatedCbm}
                      disabled
                      readOnly
                    />
                  </div>
                </div>
              </>
            )}

            {isShippingMode && (
              <div className="row g-2">
                <div className="col-md-4">
                  <label className="form-label">Quantity</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={shipmentQuantity}
                    onChange={(event) => setShipmentQuantity(event.target.value)}
                    disabled={saving}
                  />
                </div>

                {!usesExternalShippingContext && (
                  <>
                    <div className="col-md-4">
                      <label className="form-label">Container Number</label>
                      <input
                        type="text"
                        className="form-control"
                        value={containerNumber}
                        onChange={(event) => setContainerNumber(event.target.value)}
                        disabled={saving}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Invoice Number</label>
                      <input
                        type="text"
                        className="form-control"
                        value={invoiceNumber}
                        onChange={(event) => setInvoiceNumber(event.target.value)}
                        disabled={saving}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Shipped By</label>
                      <select
                        className="form-select"
                        value={stuffedById}
                        onChange={(event) => setStuffedById(event.target.value)}
                        disabled={saving || loadingInspectors}
                      >
                        <option value="">
                          {loadingInspectors ? "Loading inspectors..." : "Select shipped by"}
                        </option>
                        {inspectors.map((inspector) => (
                          <option key={inspector.id} value={inspector.id}>
                            {inspector.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Stuffing Date</label>
                      <input
                        type="date"
                        className="form-control"
                        value={toISODateString(stuffingDate)}
                        onChange={(event) =>
                          setStuffingDate(toDDMMYYYYInputValue(event.target.value, ""))
                        }
                        disabled={saving}
                      />
                    </div>
                  </>
                )}

                {usesExternalShippingContext && (
                  <div className="col-12">
                    <div className="small text-secondary">
                      This sample will use the current bulk shipping container, date, invoice,
                      and shipped-by details from the page.
                    </div>
                  </div>
                )}

                <div className="col-12">
                  <label className="form-label">Remarks</label>
                  <input
                    type="text"
                    className="form-control"
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
            )}

            {samplesError && <div className="alert alert-warning mb-0">{samplesError}</div>}
            {inspectorError && isShippingMode && !usesExternalShippingContext && (
              <div className="alert alert-warning mb-0">{inspectorError}</div>
            )}
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
              disabled={saving || (isShippingMode && shippingMode === "existing" && samplesLoading)}
            >
              {saving ? "Saving..." : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SampleModal;
