import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { formatDateDDMMYYYY } from "../utils/date";

const normalizeLabels = (labels = []) =>
  [
    ...new Set(
      (Array.isArray(labels) ? labels : [])
        .map((label) => Number(label))
        .filter((label) => Number.isInteger(label) && label > 0),
    ),
  ].sort((left, right) => left - right);

const buildLabelRanges = (labels = []) => {
  const sortedLabels = normalizeLabels(labels);
  if (sortedLabels.length === 0) return [];

  const ranges = [];
  let start = sortedLabels[0];
  let end = sortedLabels[0];

  for (let index = 1; index < sortedLabels.length; index += 1) {
    const current = sortedLabels[index];
    if (current === end + 1) {
      end = current;
      continue;
    }

    ranges.push({ start, end });
    start = current;
    end = current;
  }

  ranges.push({ start, end });
  return ranges;
};

const formatRange = ({ start, end }) =>
  start === end ? String(start) : `${start}-${end}`;

const formatLabelRanges = (labels = [], maxRanges = 8) => {
  const ranges = buildLabelRanges(labels);
  if (ranges.length === 0) return "None";

  const visibleRanges = ranges.slice(0, maxRanges).map(formatRange).join(" | ");
  if (ranges.length <= maxRanges) return visibleRanges;
  return `${visibleRanges} | +${ranges.length - maxRanges} more`;
};

const parseLabelsInput = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return { labels: [], error: "" };

  const parsedLabels = [];
  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      parsedLabels.push(Number(part));
      continue;
    }

    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) {
      return {
        labels: [],
        error: "Labels must be a comma-separated list like 101,102 or ranges like 101-105.",
      };
    }

    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) {
      return {
        labels: [],
        error: "Label numbers must be positive integers.",
      };
    }
    if (start > end) {
      return {
        labels: [],
        error: "Start label cannot be greater than end label.",
      };
    }

    for (let label = start; label <= end; label += 1) {
      parsedLabels.push(label);
    }
  }

  return {
    labels: normalizeLabels(parsedLabels),
    error: "",
  };
};

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const TransferInspectionModal = ({
  qc,
  inspectionRecord,
  onClose,
  onTransferred,
}) => {
  const inspectionRecordId = String(inspectionRecord?._id || "").trim();
  const sourcePassedQuantity = Number(inspectionRecord?.passed || 0) || 0;
  const sourceLabels = useMemo(
    () => normalizeLabels(inspectionRecord?.labels_added),
    [inspectionRecord?.labels_added],
  );

  const [po, setPo] = useState("");
  const [quantity, setQuantity] = useState(
    sourcePassedQuantity > 0 ? String(sourcePassedQuantity) : "",
  );
  const [labelsInput, setLabelsInput] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPo("");
    setQuantity(sourcePassedQuantity > 0 ? String(sourcePassedQuantity) : "");
    setLabelsInput("");
    setLookupResult(null);
    setLookupLoading(false);
    setLookupError("");
    setSaving(false);
    setError("");
  }, [inspectionRecordId, sourcePassedQuantity]);

  const parsedLabels = useMemo(
    () => parseLabelsInput(labelsInput),
    [labelsInput],
  );

  const maxTransferQuantity = useMemo(() => {
    const targetOpenQuantity = Number(lookupResult?.target?.open_quantity || 0) || 0;
    if (targetOpenQuantity > 0) {
      return Math.min(sourcePassedQuantity, targetOpenQuantity);
    }
    return sourcePassedQuantity;
  }, [lookupResult?.target?.open_quantity, sourcePassedQuantity]);

  const handleLookup = async () => {
    const trimmedPo = String(po || "").trim();
    if (!trimmedPo) {
      setLookupResult(null);
      setLookupError("PO is required.");
      return;
    }

    try {
      setLookupLoading(true);
      setLookupError("");
      setError("");
      const response = await api.get(
        `/qc/${encodeURIComponent(qc?._id || "")}/inspection-record/${encodeURIComponent(inspectionRecordId)}/transfer-target`,
        {
          params: { po: trimmedPo },
        },
      );

      const nextLookupResult = response?.data?.data || null;
      setLookupResult(nextLookupResult);

      const suggestedQuantity = Math.min(
        Number(nextLookupResult?.source?.passed_quantity || sourcePassedQuantity) || 0,
        Number(nextLookupResult?.target?.open_quantity || 0) || 0,
      );
      const currentQuantity = toPositiveInteger(quantity);
      if (!currentQuantity || currentQuantity > suggestedQuantity) {
        setQuantity(suggestedQuantity > 0 ? String(suggestedQuantity) : "");
      }
    } catch (lookupRequestError) {
      setLookupResult(null);
      setLookupError(
        lookupRequestError?.response?.data?.message || "Failed to check PO.",
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSubmit = async () => {
    const trimmedPo = String(po || "").trim();
    const transferQuantity = toPositiveInteger(quantity);
    const sourceAvailableLabelSet = new Set(sourceLabels);

    setError("");

    if (!trimmedPo) {
      setError("PO is required.");
      return;
    }

    if (!lookupResult) {
      setError("Check a valid PO with open quantity before transferring.");
      return;
    }

    if (!transferQuantity) {
      setError("Quantity must be a positive integer.");
      return;
    }

    if (transferQuantity > sourcePassedQuantity) {
      setError("Quantity cannot be greater than the passed quantity of this inspection record.");
      return;
    }

    if (lookupResult?.target?.open_quantity && transferQuantity > maxTransferQuantity) {
      setError("Quantity cannot exceed the open quantity on the selected PO.");
      return;
    }

    if (parsedLabels.error) {
      setError(parsedLabels.error);
      return;
    }

    if (parsedLabels.labels.length > transferQuantity) {
      setError("Labels count cannot be greater than the transfer quantity.");
      return;
    }

    if (parsedLabels.labels.length > sourceLabels.length) {
      setError("Labels count cannot be greater than the labels available on this inspection record.");
      return;
    }

    const invalidLabels = parsedLabels.labels.filter((label) => !sourceAvailableLabelSet.has(label));
    if (invalidLabels.length > 0) {
      setError(`Some labels are not available on this inspection record: ${invalidLabels.join(", ")}`);
      return;
    }

    try {
      setSaving(true);
      const response = await api.post(
        `/qc/${encodeURIComponent(qc?._id || "")}/inspection-record/${encodeURIComponent(inspectionRecordId)}/transfer`,
        {
          po: trimmedPo,
          quantity: transferQuantity,
          labels: labelsInput,
        },
      );

      alert(response?.data?.message || "Inspection transferred successfully.");
      await Promise.resolve(onTransferred?.());
    } catch (submitError) {
      setError(
        submitError?.response?.data?.message || "Failed to transfer inspection record.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Transfer Inspection</h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              disabled={saving}
            />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-3">
              <div className="col-md-4">
                <div className="small text-secondary">Inspection Date</div>
                <div className="fw-semibold">
                  {formatDateDDMMYYYY(
                    inspectionRecord?.inspection_date || inspectionRecord?.createdAt,
                  ) || "N/A"}
                </div>
              </div>
              <div className="col-md-4">
                <div className="small text-secondary">Passed Quantity</div>
                <div className="fw-semibold">{sourcePassedQuantity}</div>
              </div>
              <div className="col-md-4">
                <div className="small text-secondary">Available Labels</div>
                <div className="fw-semibold">{sourceLabels.length}</div>
              </div>
            </div>

            <div>
              <div className="small text-secondary mb-1">Source Labels</div>
              <div className="border rounded p-2 bg-light small">
                {formatLabelRanges(sourceLabels)}
              </div>
            </div>

            <div className="row g-3 align-items-end">
              <div className="col-md-8">
                <label className="form-label">PO</label>
                <input
                  type="text"
                  className="form-control"
                  value={po}
                  onChange={(event) => {
                    setPo(event.target.value);
                    setLookupResult(null);
                    setLookupError("");
                    setError("");
                  }}
                  placeholder="Enter PO number"
                  disabled={saving}
                />
              </div>
              <div className="col-md-4">
                <button
                  type="button"
                  className="btn btn-outline-primary w-100"
                  onClick={handleLookup}
                  disabled={lookupLoading || saving}
                >
                  {lookupLoading ? "Checking..." : "Check PO"}
                </button>
              </div>
            </div>

            {lookupResult && (
              <div className="border rounded p-3 bg-light">
                <div className="row g-3">
                  <div className="col-md-4">
                    <div className="small text-secondary">Target PO</div>
                    <div className="fw-semibold">{lookupResult?.target?.order_id || "N/A"}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="small text-secondary">Open Quantity</div>
                    <div className="fw-semibold">{lookupResult?.target?.open_quantity ?? 0}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="small text-secondary">Item</div>
                    <div className="fw-semibold">{lookupResult?.target?.item_code || "N/A"}</div>
                  </div>
                </div>
              </div>
            )}

            {lookupError && <div className="alert alert-danger mb-0">{lookupError}</div>}

            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">Quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="form-control"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setError("");
                  }}
                  disabled={!lookupResult || saving}
                />
                <div className="form-text">
                  Max allowed: {maxTransferQuantity}
                </div>
              </div>
              <div className="col-md-6">
                <label className="form-label">Labels</label>
                <input
                  type="text"
                  className="form-control"
                  value={labelsInput}
                  onChange={(event) => {
                    setLabelsInput(event.target.value);
                    setError("");
                  }}
                  placeholder="101,102 or 101-105"
                  disabled={!lookupResult || saving}
                />
                <div className="form-text">
                  Enter labels to move. Selected labels cannot exceed the quantity.
                </div>
              </div>
            </div>

            {!parsedLabels.error && parsedLabels.labels.length > 0 && (
              <div className="border rounded p-3">
                <div className="small text-secondary mb-1">Selected Labels</div>
                <div className="fw-semibold mb-1">{parsedLabels.labels.length}</div>
                <div className="small">{formatLabelRanges(parsedLabels.labels)}</div>
              </div>
            )}

            {(error || parsedLabels.error) && (
              <div className="alert alert-danger mb-0">
                {error || parsedLabels.error}
              </div>
            )}
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
              disabled={saving || lookupLoading || !lookupResult}
            >
              {saving ? "Transferring..." : "Transfer Inspection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TransferInspectionModal;
