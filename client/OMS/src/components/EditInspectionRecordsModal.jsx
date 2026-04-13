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
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Edit Inspection Records And Labels</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="alert alert-info mb-0" role="alert">
              Removing labels from a QC record here will free them for reuse after save.
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th>Request Date</th>
                    <th>Inspection Date</th>
                    <th>Inspector</th>
                    <th>Requested</th>
                    <th>Offered</th>
                    <th>Inspected</th>
                    <th>Passed</th>
                    <th>Pending</th>
                    <th>CBM</th>
                    <th>Labels</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan="11" className="text-center text-secondary py-3">
                        No inspection records found
                      </td>
                    </tr>
                  )}
                  {rows.map((row, index) => (
                    <tr key={row._id || `inspection-row-${index}`}>
                      <td>
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
                      </td>
                      <td>
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
                      </td>
                      <td>
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
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="form-control form-control-sm"
                          value={row.vendor_requested}
                          onChange={(e) => updateRow(index, "vendor_requested", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="form-control form-control-sm"
                          value={row.vendor_offered}
                          onChange={(e) => updateRow(index, "vendor_offered", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="form-control form-control-sm"
                          value={row.checked}
                          onChange={(e) => updateRow(index, "checked", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="form-control form-control-sm"
                          value={row.passed}
                          onChange={(e) => updateRow(index, "passed", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="form-control form-control-sm"
                          value={row.pending_after}
                          onChange={(e) => updateRow(index, "pending_after", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="form-control form-control-sm"
                          value={row.cbm_total}
                          onChange={(e) => updateRow(index, "cbm_total", e.target.value)}
                        />
                      </td>
                      <td>
                        <div className="d-flex flex-column gap-1">
                          <span className="small">
                            Count: {Array.isArray(row.labels_added) ? row.labels_added.length : 0}
                          </span>
                          <span className="small text-muted">
                            Ranges: {formatLabelRanges(row.label_ranges)}
                          </span>
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
                      </td>
                      <td>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={row.remarks}
                          onChange={(e) => updateRow(index, "remarks", e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="table-light fw-semibold">
                      <td colSpan="3">Totals</td>
                      <td>{totals.vendor_requested}</td>
                      <td>{totals.vendor_offered}</td>
                      <td>{totals.checked}</td>
                      <td>{totals.passed}</td>
                      <td>{totals.pending_after}</td>
                      <td>-</td>
                      <td>-</td>
                      <td>-</td>
                    </tr>
                  </tfoot>
                )}
              </table>
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
