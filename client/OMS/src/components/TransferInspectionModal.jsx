import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { formatDateDDMMYYYY } from "../utils/date";
import {
  buildMeasuredSizeEntriesFromLegacy,
  hasMeaningfulMeasuredSize,
} from "../utils/measuredSizeForm";

const normalizeLabels = (labels = []) =>
  [
    ...new Set(
      (Array.isArray(labels) ? labels : [])
        .map((label) => Number(label))
        .filter((label) => Number.isInteger(label) && label >= 0),
    ),
  ].sort((left, right) => left - right);

const createEmptyLabelRange = () => ({
  start: "",
  end: "",
});

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

const getQcLabelRequirement = ({
  totalPassed = 0,
  boxSizesCount = 0,
}) => {
  const safePassed = Math.max(0, Number(totalPassed) || 0);
  const safeBoxSizesCount = Math.max(0, Number(boxSizesCount) || 0);

  return {
    requiredCount: safePassed * safeBoxSizesCount,
    basisQuantity: safePassed,
    boxSizesCount: safeBoxSizesCount,
  };
};

const buildQcLabelRequirementMessage = ({
  totalPassed = 0,
  boxSizesCount = 0,
  actualCount = 0,
}) => {
  const requirement = getQcLabelRequirement({
    totalPassed,
    boxSizesCount,
  });

  return `Total labels must equal passed quantity × box sizes count (${requirement.requiredCount}). Actual total labels: ${Math.max(0, Number(actualCount) || 0)}. Expected: ${requirement.basisQuantity} × ${requirement.boxSizesCount}.`;
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

  for (let index = 0; index < enteredRanges.length; index += 1) {
    const range = enteredRanges[index];
    const hasStart = String(range?.start ?? "").trim() !== "";
    const hasEnd = String(range?.end ?? "").trim() !== "";

    if (!hasStart || !hasEnd) {
      return {
        error: `Both start and end are required for range ${index + 1}.`,
      };
    }

    const startNum = Number(range.start);
    const endNum = Number(range.end);

    if (!Number.isInteger(startNum) || !Number.isInteger(endNum)) {
      return {
        error: `Range ${index + 1} must use integer values.`,
      };
    }

    if (startNum < 0 || endNum < 0) {
      return {
        error: `Range ${index + 1} cannot contain negative values.`,
      };
    }

    if (startNum > endNum) {
      return {
        error: `Start label cannot be greater than end label in range ${index + 1}.`,
      };
    }

    normalizedRanges.push({ start: startNum, end: endNum });
    for (let label = startNum; label <= endNum; label += 1) {
      labels.push(label);
    }
  }

  return {
    ranges: normalizedRanges,
    labels,
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
  const [labelRanges, setLabelRanges] = useState([createEmptyLabelRange()]);
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPo("");
    setQuantity(sourcePassedQuantity > 0 ? String(sourcePassedQuantity) : "");
    setLabelRanges([createEmptyLabelRange()]);
    setLookupResult(null);
    setLookupLoading(false);
    setLookupError("");
    setSaving(false);
    setError("");
  }, [inspectionRecordId, sourcePassedQuantity]);

  const parsedLabelRangeData = useMemo(
    () => parseLabelRanges(labelRanges),
    [labelRanges],
  );

  const existingBoxSizeEntries = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    return buildMeasuredSizeEntriesFromLegacy({
      primaryEntries: itemMaster?.inspected_box_sizes,
      mode: itemMaster?.inspected_box_mode,
      singleLbh: itemMaster?.inspected_box_LBH || itemMaster?.box_LBH,
      topLbh: itemMaster?.inspected_box_top_LBH || itemMaster?.inspected_top_LBH,
      bottomLbh:
        itemMaster?.inspected_box_bottom_LBH || itemMaster?.inspected_bottom_LBH,
    }).filter((entry) => hasMeaningfulMeasuredSize(entry));
  }, [qc?.item_master]);

  const boxSizesCount = existingBoxSizeEntries.length;

  const maxTransferQuantity = useMemo(() => {
    const targetOpenQuantity = Number(lookupResult?.target?.open_quantity || 0) || 0;
    if (targetOpenQuantity > 0) {
      return Math.min(sourcePassedQuantity, targetOpenQuantity);
    }
    return sourcePassedQuantity;
  }, [lookupResult?.target?.open_quantity, sourcePassedQuantity]);

  const requiredLabelsCount = useMemo(
    () =>
      getQcLabelRequirement({
        totalPassed: toPositiveInteger(quantity) || 0,
        boxSizesCount,
      }).requiredCount,
    [boxSizesCount, quantity],
  );

  const handleLabelRangeChange = (index, field, value) => {
    setLabelRanges((previous) =>
      previous.map((range, rangeIndex) =>
        rangeIndex === index ? { ...range, [field]: value } : range,
      ),
    );
    setError("");
  };

  const addLabelRange = () => {
    setLabelRanges((previous) => [...previous, createEmptyLabelRange()]);
    setError("");
  };

  const removeLabelRange = (index) => {
    setLabelRanges((previous) => {
      if (previous.length <= 1) {
        return [createEmptyLabelRange()];
      }

      return previous.filter((_, rangeIndex) => rangeIndex !== index);
    });
    setError("");
  };

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
    const selectedLabels = normalizeLabels(parsedLabelRangeData.labels);

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

    if (parsedLabelRangeData.error) {
      setError(parsedLabelRangeData.error);
      return;
    }

    if (transferQuantity > 0 && boxSizesCount === 0) {
      setError("At least 1 box size is required to validate labels.");
      return;
    }

    if (selectedLabels.length !== requiredLabelsCount) {
      setError(
        buildQcLabelRequirementMessage({
          totalPassed: transferQuantity,
          boxSizesCount,
          actualCount: selectedLabels.length,
        }),
      );
      return;
    }

    if (selectedLabels.length > sourceLabels.length) {
      setError("Labels count cannot be greater than the labels available on this inspection record.");
      return;
    }

    const invalidLabels = selectedLabels.filter((label) => !sourceAvailableLabelSet.has(label));
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
          labels: selectedLabels,
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
                <label className="form-label">Box Sizes Count</label>
                <input
                  type="text"
                  className="form-control"
                  value={boxSizesCount}
                  disabled
                />
                <div className="form-text">
                  Label requirement uses transfer quantity × box sizes count.
                </div>
              </div>
            </div>

            <div>
              <label className="form-label d-block">Label Ranges</label>
              <div className="d-grid gap-2">
                {labelRanges.map((range, index) => (
                  <div
                    key={`transfer-label-range-${index}`}
                    className="row g-2 align-items-end"
                  >
                    <div className="col-sm-5">
                      <input
                        type="number"
                        className="form-control"
                        value={range.start}
                        onChange={(event) =>
                          handleLabelRangeChange(index, "start", event.target.value)
                        }
                        min="0"
                        step="1"
                        placeholder={`Start label ${index + 1}`}
                        disabled={!lookupResult || saving}
                      />
                    </div>
                    <div className="col-sm-5">
                      <input
                        type="number"
                        className="form-control"
                        value={range.end}
                        onChange={(event) =>
                          handleLabelRangeChange(index, "end", event.target.value)
                        }
                        min="0"
                        step="1"
                        placeholder={`End label ${index + 1}`}
                        disabled={!lookupResult || saving}
                      />
                    </div>
                    <div className="col-sm-2 d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={addLabelRange}
                        title="Add another range"
                        disabled={!lookupResult || saving}
                      >
                        +
                      </button>
                      {labelRanges.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => removeLabelRange(index)}
                          title="Remove this range"
                          disabled={!lookupResult || saving}
                        >
                          -
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="form-text">
                Required labels: {requiredLabelsCount} = {(toPositiveInteger(quantity) || 0)} × {boxSizesCount}
              </div>
            </div>

            {!parsedLabelRangeData.error && parsedLabelRangeData.labels.length > 0 && (
              <div className="border rounded p-3">
                <div className="small text-secondary mb-1">Selected Labels</div>
                <div className="fw-semibold mb-1">{parsedLabelRangeData.labels.length}</div>
                <div className="small">{formatLabelRanges(parsedLabelRangeData.labels)}</div>
              </div>
            )}

            {(error || parsedLabelRangeData.error) && (
              <div className="alert alert-danger mb-0">
                {error || parsedLabelRangeData.error}
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
