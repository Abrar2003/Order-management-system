import { useEffect, useState } from "react";
import api from "../api/axios";
import "../App.css";

const UpdateQcModal = ({ qc, onClose, onUpdated, isAdmin = false }) => {
  const [form, setForm] = useState({
    qc_checked: "",
    qc_passed: "",
    qc_rejected: "",
    offeredQuantity: "",
    cbm_top: "",
    cbm_bottom: "",
    cbm_total: "",
    barcode: "",
    packed_size: false,
    finishing: false,
    branding: false,
    labelStart: "",
    labelEnd: "",
    rejectedLabels: "",
    remarks: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isPositiveCbmValue = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  };

  const cbmExisting = (() => {
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
  })();
  const cbmLocked =
    !isAdmin &&
    (isPositiveCbmValue(cbmExisting.top) ||
      isPositiveCbmValue(cbmExisting.bottom) ||
      isPositiveCbmValue(cbmExisting.total));
  const hasCbmTopOrBottom =
    form.cbm_top.trim() !== "" || form.cbm_bottom.trim() !== "";
  const hasCbmTotal = form.cbm_total.trim() !== "";
  const disableCbmTopBottom = cbmLocked || hasCbmTotal;
  const disableCbmTotal = cbmLocked || hasCbmTopOrBottom;

  useEffect(() => {
    if (!qc) return;
    const cbmValue = qc.cbm;
    const cbmData =
      typeof cbmValue === "number" || typeof cbmValue === "string"
        ? { top: "", bottom: "", total: String(cbmValue) }
        : {
            top: cbmValue?.top ?? "",
            bottom: cbmValue?.bottom ?? "",
            total: cbmValue?.total ?? "",
          };
    setForm({
      qc_checked: "",
      qc_passed: "",
      qc_rejected: "",
      offeredQuantity: "",
      cbm_top: isPositiveCbmValue(cbmData.top) ? String(cbmData.top) : "",
      cbm_bottom: isPositiveCbmValue(cbmData.bottom) ? String(cbmData.bottom) : "",
      cbm_total: isPositiveCbmValue(cbmData.total) ? String(cbmData.total) : "",
      barcode: qc.barcode > 0 ? String(qc.barcode) : "",
      packed_size: Boolean(qc.packed_size),
      finishing: Boolean(qc.finishing),
      branding: Boolean(qc.branding),
      labelStart: "",
      labelEnd: "",
      rejectedLabels: "",
      remarks: qc.remarks ?? "",
    });
  }, [qc]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const parseLabels = (start, end) => {
    if (start === "" && end === "") return [];
    if (!start || !end) return null;

    const startNum = Number(start);
    const endNum = Number(end);

    if (Number.isNaN(startNum) || Number.isNaN(endNum)) {
      return null;
    }

    if (startNum > endNum) {
      return null;
    }

    const labels = [];
    for (let i = startNum; i <= endNum; i++) {
      labels.push(i);
    }

    return labels;
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
        Number.isNaN(value)
      )
    ) {
      setError("QC quantities must be valid numbers.");
      return;
    }

    if (
      [qcChecked, qcPassed, qcRejected, offeredQuantity].some(
        (value) => value < 0
      )
    ) {
      setError("QC quantities cannot be negative.");
      return;
    }

    const labels = parseLabels(form.labelStart, form.labelEnd);
    if (labels === null) {
      setError("Label range is invalid. Please enter valid start/end values.");
      return;
    }
    const rejectedLabels = form.rejectedLabels
      ?.split(",")
      .map((label) => Number(label.trim()))
      .filter((label) => !Number.isNaN(label)) || [];

    const filteredLabels = labels.filter(
      (label) => !rejectedLabels.includes(label)
    );

    const hasQuantityUpdate =
      form.qc_checked !== "" ||
      form.qc_passed !== "" ||
      form.qc_rejected !== "" ||
      form.offeredQuantity !== "";
    const hasLabelUpdate = filteredLabels.length > 0;

    if ((hasQuantityUpdate || hasLabelUpdate) && qcChecked <= 0) {
      setError("QC checked must be greater than 0 for updates.");
      return;
    }

    if (qcPassed + qcRejected > qcChecked && qcChecked > 0) {
      setError("Passed + rejected cannot exceed checked quantity.");
      return;
    }

    if (filteredLabels.length > qcChecked && qcChecked > 0) {
      setError("Labels count cannot exceed QC checked quantity.");
      return;
    }

    const cbmTopValue = form.cbm_top.trim();
    const cbmBottomValue = form.cbm_bottom.trim();
    const cbmTotalValue = form.cbm_total.trim();
    const barcodeValue = form.barcode.trim();

    // if (barcodeValue !== "" && qc.barcode > 0) {
    //   setError("Barcode can only be set once.");
    //   return;
    // }

    const cbmHasTop = cbmTopValue !== "";
    const cbmHasBottom = cbmBottomValue !== "";
    const cbmHasTotal = cbmTotalValue !== "";

    if ((cbmHasTop || cbmHasBottom) && cbmHasTotal) {
      setError("Provide either CBM total or CBM top/bottom.");
      return;
    }

    if (cbmHasTop !== cbmHasBottom) {
      setError("Both CBM top and bottom are required.");
      return;
    }

    const cbmTopParsed = cbmHasTop ? Number(cbmTopValue) : null;
    const cbmBottomParsed = cbmHasBottom ? Number(cbmBottomValue) : null;
    const cbmTotalParsed = cbmHasTotal ? Number(cbmTotalValue) : null;

    if (
      cbmTopParsed !== null &&
      (!Number.isFinite(cbmTopParsed) || cbmTopParsed <= 0)
    ) {
      setError("CBM top must be a positive number.");
      return;
    }

    if (
      cbmBottomParsed !== null &&
      (!Number.isFinite(cbmBottomParsed) || cbmBottomParsed <= 0)
    ) {
      setError("CBM bottom must be a positive number.");
      return;
    }

    if (
      cbmTotalParsed !== null &&
      (!Number.isFinite(cbmTotalParsed) || cbmTotalParsed <= 0)
    ) {
      setError("CBM total must be a positive number.");
      return;
    }

    const barcodeParsed = barcodeValue === "" ? null : Number(barcodeValue);

    if (barcodeParsed !== null && (!Number.isInteger(barcodeParsed) || barcodeParsed <= 0)) {
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

    if (
      qc.quantities?.client_demand !== undefined &&
      nextNetOffered > qc.quantities.client_demand
    ) {
      setError("Offered quantity cannot exceed client demand.");
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
    if (form.offeredQuantity !== "") {
      payload.vendor_provision = offeredQuantity;
    }

    if (cbmHasTotal) payload.cbm_total = cbmTotalValue;
    if (cbmHasTop && cbmHasBottom) {
      payload.cbm_top = cbmTopValue;
      payload.cbm_bottom = cbmBottomValue;
    }
    if (barcodeParsed !== null) payload.barcode = barcodeParsed;
    if (!qc.packed_size && form.packed_size) payload.packed_size = true;
    if (!qc.finishing && form.finishing) payload.finishing = true;
    if (!qc.branding && form.branding) payload.branding = true;

    if (filteredLabels.length > 0) {
      payload.labels = filteredLabels;
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

  return (
    <div className="modalOverlay">
      <div className="modalBox qc-modal">
        <h3>Update QC Record</h3>

        <div className="qc-modal-info">
          <p>
            <b>Order ID:</b> {qc.order?.order_id || "N/A"}
          </p>
          <p>
            <b>Item:</b> {qc.item?.item_code || "N/A"}
          </p>
          <p>
            <b>Client Demand:</b> {qc.quantities?.client_demand ?? "N/A"}
          </p>
          <p>
            <b>Vendor Provision:</b> {qc.quantities?.vendor_provision ?? "N/A"}
          </p>
        </div>

        <div className="inputContainer qc-modal-grid">
          <div className="qc-modal-field">
            <label>CBM Top</label>
            <input
              type="number"
              name="cbm_top"
              value={form.cbm_top}
              onChange={handleChange}
              min="0"
              step="any"
              disabled={disableCbmTopBottom && !isAdmin}
              placeholder={cbmLocked && !isAdmin ? "Already set" : "Enter top CBM"}
            />
          </div>
          <div className="qc-modal-field">
            <label>CBM Bottom</label>
            <input
              type="number"
              name="cbm_bottom"
              value={form.cbm_bottom}
              onChange={handleChange}
              min="0"
              step="any"
              disabled={disableCbmTopBottom && !isAdmin}
              placeholder={cbmLocked && !isAdmin ? "Already set" : "Enter bottom CBM"}
            />
          </div>
          <div className="qc-modal-field">
            <label>CBM Total</label>
            <input
              type="number"
              name="cbm_total"
              value={form.cbm_total}
              onChange={handleChange}
              min="0"
              step="any"
              disabled={disableCbmTotal && !isAdmin}
              placeholder={cbmLocked && !isAdmin ? "Already set" : "Enter total CBM"}
            />
          </div>
          <div className="qc-modal-field">
            <label>Barcode</label>
            <input
              type="number"
              name="barcode"
              value={form.barcode}
              onChange={handleChange}
              min="1"
              step="1"
              disabled={qc.barcode > 0 && !isAdmin}
              placeholder={qc.barcode > 0 && !isAdmin ? "Already set" : "Enter barcode"}
            />
          </div>
          <div className="qc-modal-field">
            <label>QC Checked</label>
            <input
              type="number"
              name="qc_checked"
              value={form.qc_checked}
              onChange={handleChange}
              min="0"
            />
          </div>
          <div className="qc-modal-field">
            <label>QC Passed</label>
            <input
              type="number"
              name="qc_passed"
              value={form.qc_passed}
              onChange={handleChange}
              min="0"
            />
          </div>
          <div className="qc-modal-field">
            <label>QC Rejected</label>
            <input
              type="number"
              name="qc_rejected"
              value={form.qc_rejected}
              onChange={handleChange}
              min="0"
            />
          </div>
          <div className="qc-modal-field">
            <label>Offered Quantity</label>
            <input
              type="number"
              name="offeredQuantity"
              value={form.offeredQuantity}
              onChange={handleChange}
              min="0"
            />
          </div>
          <div className="qc-modal-field qc-modal-checkbox">
            <label htmlFor="packed_size">Packed Size</label>
            <div className="qc-modal-check">
              <input
                id="packed_size"
                type="checkbox"
                name="packed_size"
                checked={form.packed_size}
                onChange={handleChange}
                disabled={qc.packed_size && !isAdmin}
              />
              <span>{form.packed_size ? "Yes" : "No"}</span>
            </div>
          </div>
          <div className="qc-modal-field qc-modal-checkbox">
            <label htmlFor="finishing">Finishing</label>
            <div className="qc-modal-check">
              <input
                id="finishing"
                type="checkbox"
                name="finishing"
                checked={form.finishing}
                onChange={handleChange}
                disabled={qc.finishing && !isAdmin}
              />
              <span>{form.finishing ? "Yes" : "No"}</span>
            </div>
          </div>
          <div className="qc-modal-field qc-modal-checkbox">
            <label htmlFor="branding">Branding</label>
            <div className="qc-modal-check">
              <input
                id="branding"
                type="checkbox"
                name="branding"
                checked={form.branding}
                onChange={handleChange}
                disabled={qc.branding && !isAdmin}
              />
              <span>{form.branding ? "Yes" : "No"}</span>
            </div>
          </div>
          <div className="qc-modal-field">
            <label>Start of label range</label>
            <input
              type="text"
              name="labelStart"
              value={form.labelStart}
              onChange={handleChange}
              placeholder="Start of the labels range"
            />
          </div>
          <div className="qc-modal-field">
            <label>End of label range</label>
            <input
              type="text"
              name="labelEnd"
              value={form.labelEnd}
              onChange={handleChange}
              placeholder="End of the labels range"
            />
          </div>
          <div className="qc-modal-field">
            <label>Rejected labels</label>
            <input
              type="text"
              name="rejectedLabels"
              value={form.rejectedLabels}
              onChange={handleChange}
              placeholder="e.g. 101, 102, 103"
            />
          </div>
        </div>

        <label>Remarks</label>
        <textarea
          name="remarks"
          value={form.remarks}
          onChange={handleChange}
          rows="3"
        />

        {error && <div className="modalError">{error}</div>}

        <div className="modalActions">
          <button onClick={handleSubmit} disabled={saving}>
            {saving ? "Updating..." : "Update"}
          </button>
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateQcModal;
