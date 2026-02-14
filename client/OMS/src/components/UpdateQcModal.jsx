import { useEffect, useState } from "react";
import api from "../api/axios";
import { getUserFromToken } from "../auth/auth.utils";
import "../App.css";

const toInputDateValue = (value) => {
  if (!value) return "";
  const asString = String(value).trim();
  if (!asString) return "";
  if (asString.includes("T")) return asString.slice(0, 10);
  return asString;
};

const NON_NEGATIVE_FIELDS = new Set([
  "qc_checked",
  "qc_passed",
  "qc_rejected",
  "offeredQuantity",
  "barcode",
  "CBM",
  "CBM_top",
  "CBM_bottom",
]);

const createEmptyLabelRange = () => ({ start: "", end: "" });

const UpdateQcModal = ({ qc, onClose, onUpdated, isAdmin = false }) => {
  const user = getUserFromToken();
  const currentUserId = user?.id || user?._id || "";
  const isQcUser = user?.role === "QC";

  const [form, setForm] = useState({
    inspector: "",
    qc_checked: "",
    qc_passed: "",
    qc_rejected: "",
    offeredQuantity: "",
    barcode: "",
    packed_size: false,
    finishing: false,
    branding: false,
    labelRanges: [createEmptyLabelRange()],
    rejectedLabels: "",
    remarks: "",
    CBM: "",
    CBM_top: "",
    CBM_bottom: "",
    last_inspected_date: "",
  });
  const [inspectors, setInspectors] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchInspectors = async () => {
      try {
        const res = await api.get("/auth/?role=QC");
        setInspectors(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        setInspectors([]);
      }
    };

    fetchInspectors();
  }, []);

  useEffect(() => {
    if (!qc) return;
    const assignedInspectorId = String(qc?.inspector?._id || qc?.inspector || "");
    setForm({
      inspector: assignedInspectorId || (isQcUser ? String(currentUserId) : ""),
      qc_checked: "",
      qc_passed: "",
      qc_rejected: "",
      offeredQuantity: "",
      barcode: qc.barcode > 0 ? String(qc.barcode) : "",
      packed_size: "",
      finishing: "",
      branding: "",
      labelRanges: [createEmptyLabelRange()],
      rejectedLabels: "", 
      remarks: "",
      CBM: qc?.cbm?.total && qc.cbm.total !== "0" ? String(qc.cbm.total) : "",
      CBM_top: qc?.cbm?.top && qc.cbm.top !== "0" ? String(qc.cbm.top) : "",
      CBM_bottom:
        qc?.cbm?.bottom && qc.cbm.bottom !== "0" ? String(qc.cbm.bottom) : "",
      last_inspected_date: toInputDateValue(qc.last_inspected_date),
    });
  }, [qc, currentUserId, isQcUser]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (NON_NEGATIVE_FIELDS.has(name) && value !== "") {
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return;
      }
    }

    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
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
    const qcRejected = form.qc_rejected === "" ? 0 : Number(form.qc_rejected);
    const offeredQuantity =
      form.offeredQuantity === "" ? 0 : Number(form.offeredQuantity);

    if (
      [qcChecked, qcPassed, qcRejected, offeredQuantity].some((value) =>
        Number.isNaN(value),
      )
    ) {
      setError("QC quantities must be valid numbers.");
      return;
    }

    if (
      [qcChecked, qcPassed, qcRejected, offeredQuantity].some(
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

    const rejectedLabels =
      form.rejectedLabels
        ?.split(",")
        .map((label) => Number(label.trim()))
        .filter((label) => !Number.isNaN(label)) || [];

    if (rejectedLabels.some((label) => label < 0)) {
      setError("Rejected labels cannot contain negative numbers.");
      return;
    }

    const filteredLabels = labels.filter(
      (label) => !rejectedLabels.includes(label),
    );

    const hasQuantityUpdate =
      form.qc_checked !== "" ||
      form.qc_passed !== "" ||
      form.qc_rejected !== "" ||
      form.offeredQuantity !== "";
    const hasLabelUpdate =
      filteredLabels.length > 0 || normalizedLabelRanges.length > 0;
    const selectedInspectorId = String(form.inspector || "").trim();
    const currentInspectorId = String(
      qc?.inspector?._id || qc?.inspector || "",
    ).trim();

    if ((hasQuantityUpdate || hasLabelUpdate) && qcChecked <= 0) {
      setError("QC checked must be greater than 0 for updates.");
      return;
    }

    if (qcPassed + qcRejected > qcChecked && qcChecked > 0) {
      setError("Passed + rejected cannot exceed checked quantity.");
      return;
    }

    const barcodeValue = form.barcode.trim();
    const parseOptionalCbm = (value, label) => {
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

    if (cbmTotal.error || cbmTop.error || cbmBottom.error) {
      setError(cbmTotal.error || cbmTop.error || cbmBottom.error);
      return;
    }

    const isVisitUpdate = hasQuantityUpdate || hasLabelUpdate;
    if (isVisitUpdate && !selectedInspectorId) {
      setError("Inspector is required for inspection updates.");
      return;
    }

    if (isVisitUpdate && !lastInspectedDateValue) {
      setError("Last inspected date is required.");
      return;
    }

    const effectiveCbmTop = cbmTop.hasValue
      ? cbmTop.value
      : (qc?.cbm?.top ?? "0");
    const effectiveCbmBottom = cbmBottom.hasValue
      ? cbmBottom.value
      : (qc?.cbm?.bottom ?? "0");
    const hasDualCbmForLabels =
      Number(effectiveCbmTop) > 0 && Number(effectiveCbmBottom) > 0;
    const labelMultiplier = hasDualCbmForLabels ? 2 : 1;

    if (filteredLabels.length > qcChecked * labelMultiplier && qcChecked > 0) {
      setError(
        `Labels count cannot exceed ${labelMultiplier}x QC checked quantity.`,
      );
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
      (qc.quantities?.vendor_provision || 0) + offeredQuantity - qcRejected;

    const totalOfferedNext =
      (qc.quantities?.vendor_provision || 0) +
      (qc.quantities?.qc_rejected || 0) +
      offeredQuantity;
    const nextChecked = (qc.quantities?.qc_checked || 0) + qcChecked;
    const nextPassed = (qc.quantities?.qc_passed || 0) + qcPassed;

    const quantityRequestedLimit =
      qc.quantities?.quantity_requested &&
      qc.quantities.quantity_requested !== 0
        ? qc.quantities.quantity_requested
        : qc.quantities?.client_demand;

    const hasStartedInspection =
      (qc.quantities?.qc_checked || 0) > 0 ||
      (Array.isArray(qc?.inspection_record) && qc.inspection_record.length > 0);

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

    const payload = {
      remarks: form.remarks?.trim() ? form.remarks.trim() : undefined,
    };

    if (form.qc_checked !== "") payload.qc_checked = qcChecked;
    if (form.qc_passed !== "") payload.qc_passed = qcPassed;
    if (form.qc_rejected !== "") payload.qc_rejected = qcRejected;
    if (form.offeredQuantity !== "") payload.vendor_provision = offeredQuantity;
    if (selectedInspectorId && selectedInspectorId !== currentInspectorId) {
      payload.inspector = selectedInspectorId;
    }

    if (cbmTotal.hasValue && cbmTotal.value !== null)
      payload.CBM = cbmTotal.value;
    if (cbmTop.hasValue && cbmTop.value !== null)
      payload.CBM_top = cbmTop.value;
    if (cbmBottom.hasValue && cbmBottom.value !== null)
      payload.CBM_bottom = cbmBottom.value;
    if (lastInspectedDateValue)
      payload.last_inspected_date = lastInspectedDateValue;

    if (barcodeParsed !== null) payload.barcode = barcodeParsed;
    if (!qc.packed_size && form.packed_size) payload.packed_size = true;
    if (!qc.finishing && form.finishing) payload.finishing = true;
    if (!qc.branding && form.branding) payload.branding = true;

    if (filteredLabels.length > 0) {
      payload.labels = filteredLabels;
    }
    if (normalizedLabelRanges.length > 0) {
      payload.label_ranges = normalizedLabelRanges;
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
  const disableInspectorSelection =
    !isAdmin && (qc?.quantities?.qc_checked || 0) > 0;

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
              </div>

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
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Last Inspected Date</label>
                <input
                  type="date"
                  className="form-control"
                  name="last_inspected_date"
                  value={form.last_inspected_date}
                  onChange={handleChange}
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Barcode</label>
                <input
                  type="number"
                  className="form-control"
                  name="barcode"
                  value={form.barcode}
                  onChange={handleChange}
                  min="1"
                  step="1"
                  disabled={qc.barcode > 0 && !isAdmin}
                  placeholder={
                    qc.barcode > 0 && !isAdmin ? "Already set" : "Enter barcode"
                  }
                />
              </div>

              <div className="col-md-12">{"   "}</div>

              <div className="col-md-3">
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

              <div className="col-md-3">
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

              <div className="col-md-3">
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

              <div className="col-md-3">
                <label className="form-label">QC Rejected</label>
                <input
                  type="number"
                  className="form-control"
                  name="qc_rejected"
                  value={form.qc_rejected}
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

              <div className="col-md-8">
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

              <div className="col-md-4">
                <label className="form-label">Rejected labels</label>
                <input
                  type="text"
                  className="form-control"
                  name="rejectedLabels"
                  value={form.rejectedLabels}
                  onChange={handleChange}
                  placeholder="e.g. 101, 102, 103"
                />
              </div>

              <div className="col-md-12">{"   "}</div>

              <div className="col-12">
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
    </div>
  );
};

export default UpdateQcModal;
