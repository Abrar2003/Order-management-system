import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import {
  isValidDDMMYYYY,
  toDDMMYYYYInputValue,
  toISODateString,
} from "../utils/date";
import { formatNumberInputValue } from "../utils/measurementDisplay";
import "../App.css";

const normalizeLabels = (labels = []) =>
  [
    ...new Set(
      (Array.isArray(labels) ? labels : [])
        .map((label) => Number(label))
        .filter((label) => Number.isInteger(label) && label >= 0),
    ),
  ].sort((left, right) => left - right);

const toSafeNumberString = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return String(parsed);
};

const normalizeLabelRanges = (ranges = []) =>
  (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      start: Number(range?.start),
      end: Number(range?.end),
    }))
    .filter(
      (range) =>
        Number.isInteger(range.start) &&
        Number.isInteger(range.end) &&
        range.start >= 0 &&
        range.end >= 0 &&
        range.start <= range.end,
    )
    .sort((left, right) => {
      if (left.start !== right.start) return left.start - right.start;
      return left.end - right.end;
    });

const formatLabelRanges = (ranges = []) => {
  const normalizedRanges = normalizeLabelRanges(ranges);
  if (normalizedRanges.length === 0) return "None";
  return normalizedRanges
    .map((range) =>
      range.start === range.end
        ? String(range.start)
        : `${range.start}-${range.end}`,
    )
    .join(" | ");
};

const toTimestamp = (value) => {
  if (!value) return 0;
  const isoDate = toISODateString(value);
  if (!isoDate) return 0;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const buildInitialRows = (qc) =>
  (Array.isArray(qc?.inspection_record) ? [...qc.inspection_record] : [])
    .sort((a, b) => {
      const aTime = toTimestamp(a?.inspection_date) || toTimestamp(a?.createdAt);
      const bTime = toTimestamp(b?.inspection_date) || toTimestamp(b?.createdAt);
      return bTime - aTime;
    })
    .map((record) => ({
      _id: String(record?._id || ""),
      requested_date: toDDMMYYYYInputValue(record?.requested_date || qc?.request_date, ""),
      inspection_date: toDDMMYYYYInputValue(
        record?.inspection_date || qc?.last_inspected_date || qc?.request_date,
        "",
      ),
      inspector: String(record?.inspector?._id || record?.inspector || ""),
      vendor_requested: toSafeNumberString(record?.vendor_requested),
      vendor_offered: toSafeNumberString(record?.vendor_offered),
      checked: toSafeNumberString(record?.checked),
      passed: toSafeNumberString(record?.passed),
      pending_after: toSafeNumberString(record?.pending_after),
      cbm_total: formatNumberInputValue(record?.cbm?.total, { allowZero: true }) || "0.00",
      remarks: String(record?.remarks || ""),
      inspected_k_d: Boolean(record?.inspected_k_d),
      pis_k_d: Boolean(record?.pis_k_d),
      labels_added: normalizeLabels(record?.labels_added),
      label_ranges: normalizeLabelRanges(record?.label_ranges),
      original_labels_added: normalizeLabels(record?.labels_added),
      original_label_ranges: normalizeLabelRanges(record?.label_ranges),
      labels_removed: false,
    }));

const parseNonNegativeNumber = (value, fieldName, rowIndex) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Row ${rowIndex + 1}: ${fieldName} must be a valid non-negative number`);
  }
  return parsed;
};

const EditInspectionRecordsModal = ({ qc, onClose, onSuccess }) => {
  const [rows, setRows] = useState(() => buildInitialRows(qc));
  const [inspectors, setInspectors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(buildInitialRows(qc));
  }, [qc]);

  useEffect(() => {
    const fetchInspectors = async () => {
      try {
        const res = await api.get("/auth/?role=QC");
        setInspectors(Array.isArray(res.data) ? res.data : []);
      } catch {
        setInspectors([]);
      }
    };
    fetchInspectors();
  }, []);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          acc.vendor_requested += Number(row.vendor_requested || 0) || 0;
          acc.vendor_offered += Number(row.vendor_offered || 0) || 0;
          acc.checked += Number(row.checked || 0) || 0;
          acc.passed += Number(row.passed || 0) || 0;
          acc.pending_after += Number(row.pending_after || 0) || 0;
          return acc;
        },
        {
          vendor_requested: 0,
          vendor_offered: 0,
          checked: 0,
          passed: 0,
          pending_after: 0,
        },
      ),
    [rows],
  );

  const updateRow = (index, field, value) => {
    setRows((prev) =>
      prev.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row,
      ),
    );
  };

  const toggleRemoveLabels = (index) => {
    setRows((prev) =>
      prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (row.labels_removed) {
          return {
            ...row,
            labels_added: [...row.original_labels_added],
            label_ranges: [...row.original_label_ranges],
            labels_removed: false,
          };
        }

        return {
          ...row,
          labels_added: [],
          label_ranges: [],
          labels_removed: true,
        };
      }),
    );
  };

  const handleSubmit = async () => {
    setError("");

    try {
      const payload = rows.map((row, rowIndex) => {
        if (!row._id) {
          throw new Error(`Row ${rowIndex + 1}: record id is missing`);
        }

        const requestedDate = String(row.requested_date || "").trim();
        const requestedDateIso = toISODateString(requestedDate);
        if (!requestedDateIso || !isValidDDMMYYYY(requestedDate)) {
          throw new Error(`Row ${rowIndex + 1}: requested date must be in DD/MM/YYYY format`);
        }

        const inspectionDate = String(row.inspection_date || "").trim();
        const inspectionDateIso = toISODateString(inspectionDate);
        if (!inspectionDateIso || !isValidDDMMYYYY(inspectionDate)) {
          throw new Error(`Row ${rowIndex + 1}: inspection date must be in DD/MM/YYYY format`);
        }

        const inspector = String(row.inspector || "").trim();
        if (!inspector) {
          throw new Error(`Row ${rowIndex + 1}: inspector is required`);
        }

        const vendorRequested = parseNonNegativeNumber(
          row.vendor_requested,
          "requested quantity",
          rowIndex,
        );
        const vendorOffered = parseNonNegativeNumber(
          row.vendor_offered,
          "offered quantity",
          rowIndex,
        );
        const checked = parseNonNegativeNumber(row.checked, "checked quantity", rowIndex);
        const passed = parseNonNegativeNumber(row.passed, "passed quantity", rowIndex);
        const pendingAfter = parseNonNegativeNumber(
          row.pending_after,
          "pending quantity",
          rowIndex,
        );
        const cbmTotal = parseNonNegativeNumber(row.cbm_total, "cbm", rowIndex);

        if (passed > checked) {
          throw new Error(`Row ${rowIndex + 1}: passed quantity cannot exceed checked quantity`);
        }

        return {
          _id: row._id,
          requested_date: requestedDateIso,
          inspection_date: inspectionDateIso,
          inspector,
          vendor_requested: vendorRequested,
          vendor_offered: vendorOffered,
          checked,
          passed,
          pending_after: pendingAfter,
          cbm: {
            total: cbmTotal,
          },
          label_ranges: normalizeLabelRanges(row.label_ranges),
          labels_added: normalizeLabels(row.labels_added),
          inspected_k_d: Boolean(row.inspected_k_d),
          pis_k_d: Boolean(row.pis_k_d),
          remarks: String(row.remarks || "").trim(),
        };
      });

      setSaving(true);
      await api.patch(`/qc/${qc?._id}/inspection-records`, { records: payload });
      onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to update inspection records.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl edit-inspection-records-dialog" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Edit Inspection Records And Labels</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3 edit-inspection-records-body">
            <div className="alert alert-info mb-0" role="alert">
              Removing labels from a QC record here will free them for reuse after save.
            </div>
            {rows.length > 0 && (
              <div className="edit-inspection-totals" aria-label="Inspection record totals">
                <div>
                  <span>Requested</span>
                  <strong>{totals.vendor_requested}</strong>
                </div>
                <div>
                  <span>Offered</span>
                  <strong>{totals.vendor_offered}</strong>
                </div>
                <div>
                  <span>Inspected</span>
                  <strong>{totals.checked}</strong>
                </div>
                <div>
                  <span>Passed</span>
                  <strong>{totals.passed}</strong>
                </div>
                <div>
                  <span>Pending</span>
                  <strong>{totals.pending_after}</strong>
                </div>
              </div>
            )}

            <div className="edit-inspection-record-list">
              {rows.length === 0 && (
                <div className="text-center text-secondary py-3">
                  No inspection records found
                </div>
              )}

              {rows.map((row, index) => (
                <section
                  key={row._id || `inspection-row-${index}`}
                  className="edit-inspection-record-card"
                >
                  <div className="edit-inspection-record-card-head">
                    <div>
                      <div className="small text-secondary">Record</div>
                      <h6 className="mb-0">Inspection #{index + 1}</h6>
                    </div>
                    <div className="edit-inspection-card-meta">
                      <span>Passed {row.passed || 0}</span>
                      <span>Pending {row.pending_after || 0}</span>
                    </div>
                  </div>

                  <div className="edit-inspection-form-grid">
                    <label className="edit-inspection-field">
                      <span>Request Date</span>
                      <input
                        type="date"
                        lang="en-GB"
                        className="form-control form-control-sm"
                        value={toISODateString(row.requested_date)}
                        onChange={(e) =>
                          updateRow(
                            index,
                            "requested_date",
                            toDDMMYYYYInputValue(e.target.value, ""),
                          )
                        }
                      />
                    </label>

                    <label className="edit-inspection-field">
                      <span>Inspection Date</span>
                      <input
                        type="date"
                        lang="en-GB"
                        className="form-control form-control-sm"
                        value={toISODateString(row.inspection_date)}
                        onChange={(e) =>
                          updateRow(
                            index,
                            "inspection_date",
                            toDDMMYYYYInputValue(e.target.value, ""),
                          )
                        }
                      />
                    </label>

                    <label className="edit-inspection-field edit-inspection-field-wide">
                      <span>Inspector</span>
                      <select
                        className="form-select form-select-sm"
                        value={row.inspector}
                        onChange={(e) => updateRow(index, "inspector", e.target.value)}
                      >
                        <option value="">Select inspector</option>
                        {inspectors.map((inspector) => (
                          <option key={inspector._id} value={inspector._id}>
                            {inspector.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="edit-inspection-field">
                      <span>Requested</span>
                      <input
                        type="number"
                        min="0"
                        className="form-control form-control-sm"
                        value={row.vendor_requested}
                        onChange={(e) => updateRow(index, "vendor_requested", e.target.value)}
                      />
                    </label>

                    <label className="edit-inspection-field">
                      <span>Offered</span>
                      <input
                        type="number"
                        min="0"
                        className="form-control form-control-sm"
                        value={row.vendor_offered}
                        onChange={(e) => updateRow(index, "vendor_offered", e.target.value)}
                      />
                    </label>

                    <label className="edit-inspection-field">
                      <span>Inspected</span>
                      <input
                        type="number"
                        min="0"
                        className="form-control form-control-sm"
                        value={row.checked}
                        onChange={(e) => updateRow(index, "checked", e.target.value)}
                      />
                    </label>

                    <label className="edit-inspection-field">
                      <span>Passed</span>
                      <input
                        type="number"
                        min="0"
                        className="form-control form-control-sm"
                        value={row.passed}
                        onChange={(e) => updateRow(index, "passed", e.target.value)}
                      />
                    </label>

                    <label className="edit-inspection-field">
                      <span>Pending</span>
                      <input
                        type="number"
                        min="0"
                        className="form-control form-control-sm"
                        value={row.pending_after}
                        onChange={(e) => updateRow(index, "pending_after", e.target.value)}
                      />
                    </label>

                    <label className="edit-inspection-field">
                      <span>CBM</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="form-control form-control-sm"
                        value={row.cbm_total}
                        onChange={(e) => updateRow(index, "cbm_total", e.target.value)}
                      />
                    </label>

                    <div className="edit-inspection-field">
                      <span>Inspected K/D</span>
                      <div className="btn-group btn-group-sm w-100" role="group" aria-label="Inspected K/D">
                        <button
                          type="button"
                          className={`btn ${row.inspected_k_d ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => updateRow(index, "inspected_k_d", true)}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`btn ${!row.inspected_k_d ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => updateRow(index, "inspected_k_d", false)}
                        >
                          No
                        </button>
                      </div>
                    </div>

                    <div className="edit-inspection-field">
                      <span>PIS K/D</span>
                      <div className="btn-group btn-group-sm w-100" role="group" aria-label="PIS K/D">
                        <button
                          type="button"
                          className={`btn ${row.pis_k_d ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => updateRow(index, "pis_k_d", true)}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`btn ${!row.pis_k_d ? "btn-primary" : "btn-outline-secondary"}`}
                          onClick={() => updateRow(index, "pis_k_d", false)}
                        >
                          No
                        </button>
                      </div>
                    </div>

                    <div className="edit-inspection-label-panel">
                      <div>
                        <span className="edit-inspection-label-title">Labels</span>
                        <div className="small">
                          Count: {Array.isArray(row.labels_added) ? row.labels_added.length : 0}
                        </div>
                        <div className="small text-muted">
                          Ranges: {formatLabelRanges(row.label_ranges)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`btn btn-sm ${row.labels_removed ? "btn-outline-secondary" : "btn-outline-danger"}`}
                        onClick={() => toggleRemoveLabels(index)}
                        disabled={
                          !row.labels_removed &&
                          (!Array.isArray(row.original_labels_added) ||
                            row.original_labels_added.length === 0)
                        }
                      >
                        {row.labels_removed ? "Restore Labels" : "Remove Labels"}
                      </button>
                    </div>

                    <label className="edit-inspection-field edit-inspection-field-remarks">
                      <span>Remarks</span>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={row.remarks}
                        onChange={(e) => updateRow(index, "remarks", e.target.value)}
                      />
                    </label>
                  </div>
                </section>
              ))}
            </div>

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

export default EditInspectionRecordsModal;
