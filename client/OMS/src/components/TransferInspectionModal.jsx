import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { formatDateDDMMYYYY } from "../utils/date";
import {
  BOX_PACKAGING_MODES,
  buildMeasuredSizeEntriesFromLegacy,
  detectBoxPackagingMode,
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
  boxMode = BOX_PACKAGING_MODES.INDIVIDUAL,
  boxSizes = [],
}) => {
  const safePassed = Math.max(0, Number(totalPassed) || 0);
  const safeBoxSizesCount = Math.max(0, Number(boxSizesCount) || 0);
  const safeBoxMode = detectBoxPackagingMode(boxMode, boxSizes);
  const multiplier =
    safeBoxMode === BOX_PACKAGING_MODES.CARTON ? 1 : safeBoxSizesCount;

  return {
    requiredCount: safePassed * multiplier,
    basisQuantity: safePassed,
    boxSizesCount: safeBoxSizesCount,
    boxMode: safeBoxMode,
    multiplier,
  };
};

const buildQcLabelRequirementMessage = ({
  totalPassed = 0,
  boxSizesCount = 0,
  boxMode = BOX_PACKAGING_MODES.INDIVIDUAL,
  boxSizes = [],
  actualCount = 0,
}) => {
  const requirement = getQcLabelRequirement({
    totalPassed,
    boxSizesCount,
    boxMode,
    boxSizes,
  });

  if (requirement.boxMode === BOX_PACKAGING_MODES.CARTON) {
    return `Total labels must equal passed quantity (${requirement.requiredCount}). Actual total labels: ${Math.max(0, Number(actualCount) || 0)}. Expected: passed quantity ${requirement.basisQuantity}.`;
  }

  return `Total labels must equal passed quantity x box sizes count (${requirement.requiredCount}). Actual total labels: ${Math.max(0, Number(actualCount) || 0)}. Expected: passed quantity ${requirement.basisQuantity} x box sizes ${requirement.boxSizesCount}.`;
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

const toNonNegativeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const TransferInspectionModal = ({
  qc,
  inspectionRecord,
  sourceRemainingQuantity = null,
  onClose,
  onTransferred,
}) => {
  const inspectionRecordId = String(inspectionRecord?._id || "").trim();
  const sourcePassedQuantity = Number(inspectionRecord?.passed || 0) || 0;
  const hasSourceRemainingLimit =
    sourceRemainingQuantity !== null &&
    sourceRemainingQuantity !== undefined &&
    Number.isFinite(Number(sourceRemainingQuantity));
  const localSourceRemainingQuantity = hasSourceRemainingLimit
    ? toNonNegativeNumber(sourceRemainingQuantity)
    : null;
  const localSourceTransferableQuantity =
    localSourceRemainingQuantity === null
      ? sourcePassedQuantity
      : Math.min(sourcePassedQuantity, localSourceRemainingQuantity);
  const sourceLabels = useMemo(
    () => normalizeLabels(inspectionRecord?.labels_added),
    [inspectionRecord?.labels_added],
  );
  const hasSourceLabels = sourceLabels.length > 0;

  const [po, setPo] = useState("");
  const [quantity, setQuantity] = useState(
    localSourceTransferableQuantity > 0 ? String(localSourceTransferableQuantity) : "",
  );
  const [labelRanges, setLabelRanges] = useState([createEmptyLabelRange()]);
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPo("");
    setQuantity(
      localSourceTransferableQuantity > 0 ? String(localSourceTransferableQuantity) : "",
    );
    setLabelRanges([createEmptyLabelRange()]);
    setLookupResult(null);
    setLookupLoading(false);
    setLookupError("");
    setSaving(false);
    setError("");
  }, [inspectionRecordId, localSourceTransferableQuantity]);

  const parsedLabelRangeData = useMemo(
    () => parseLabelRanges(labelRanges),
    [labelRanges],
  );

  const existingBoxSizeEntries = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    const boxMode = detectBoxPackagingMode(
      itemMaster?.inspected_box_mode,
      itemMaster?.inspected_box_sizes,
    );
    return buildMeasuredSizeEntriesFromLegacy({
      primaryEntries: itemMaster?.inspected_box_sizes,
      mode: boxMode,
    }).filter((entry) => hasMeaningfulMeasuredSize(entry));
  }, [qc?.item_master]);

  const existingBoxMode = useMemo(() => {
    const itemMaster = qc?.item_master || {};
    return detectBoxPackagingMode(
      itemMaster?.inspected_box_mode,
      itemMaster?.inspected_box_sizes,
    );
  }, [qc?.item_master]);
  const boxSizesCount = existingBoxSizeEntries.length;
  const labelRequirement = useMemo(
    () =>
      getQcLabelRequirement({
        totalPassed: toPositiveInteger(quantity) || 0,
        boxSizesCount,
        boxMode: existingBoxMode,
        boxSizes: existingBoxSizeEntries,
      }),
    [boxSizesCount, existingBoxMode, existingBoxSizeEntries, quantity],
  );
  const requiresBoxSizeCountForLabels =
    labelRequirement.boxMode !== BOX_PACKAGING_MODES.CARTON;

  const sourceShippedQuantity = toNonNegativeNumber(
    lookupResult?.source?.shipped_quantity,
  );
  const sourceRemainingLimitQuantity = lookupResult
    ? toNonNegativeNumber(lookupResult?.source?.remaining_quantity)
    : localSourceRemainingQuantity;
  const sourceTransferableQuantity = toNonNegativeNumber(
    lookupResult?.source?.transferable_quantity,
  );
  const maxTransferQuantity = useMemo(() => {
    const targetOpenQuantity = toNonNegativeNumber(lookupResult?.target?.open_quantity);
    const sourceCap = sourceTransferableQuantity || localSourceTransferableQuantity;

    if (targetOpenQuantity > 0) {
      return Math.min(sourceCap, targetOpenQuantity);
    }

    return sourceCap;
  }, [localSourceTransferableQuantity, lookupResult?.target?.open_quantity, sourceTransferableQuantity]);

  const requiredLabelsCount = labelRequirement.requiredCount;
  const requiredLabelsText = !hasSourceLabels
    ? "No source labels on this inspection record; labels are not required."
    : labelRequirement.boxMode === BOX_PACKAGING_MODES.CARTON
      ? `Required labels: ${requiredLabelsCount} = passed quantity ${toPositiveInteger(quantity) || 0}`
      : `Required labels: ${requiredLabelsCount} = passed quantity ${toPositiveInteger(quantity) || 0} x box sizes ${boxSizesCount}`;

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

      const sourceCap = toNonNegativeNumber(
        nextLookupResult?.source?.transferable_quantity,
      );
      const targetCap = toNonNegativeNumber(nextLookupResult?.target?.open_quantity);
      const nextMaxQuantity =
        sourceCap > 0 && targetCap > 0
          ? Math.min(sourceCap, targetCap)
          : sourceCap || targetCap || localSourceTransferableQuantity;

      setQuantity(nextMaxQuantity > 0 ? String(nextMaxQuantity) : "");
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
    const selectedLabels = hasSourceLabels
      ? normalizeLabels(parsedLabelRangeData.labels)
      : [];

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

    if (transferQuantity > maxTransferQuantity) {
      setError("Quantity cannot exceed the passed quantity that has not already shipped or the selected PO open quantity.");
      return;
    }

    if (sourceTransferableQuantity > 0 && transferQuantity > sourceTransferableQuantity) {
      setError("Quantity cannot exceed the passed quantity that has not already shipped.");
      return;
    }

    if (hasSourceLabels && parsedLabelRangeData.error) {
      setError(parsedLabelRangeData.error);
      return;
    }

    if (
      hasSourceLabels &&
      transferQuantity > 0 &&
      requiresBoxSizeCountForLabels &&
      boxSizesCount === 0
    ) {
      setError("At least 1 box size is required to validate labels.");
      return;
    }

    if (hasSourceLabels && selectedLabels.length !== requiredLabelsCount) {
      setError(
        buildQcLabelRequirementMessage({
          totalPassed: transferQuantity,
          boxSizesCount,
          boxMode: existingBoxMode,
          boxSizes: existingBoxSizeEntries,
          actualCount: selectedLabels.length,
        }),
      );
      return;
    }

    if (hasSourceLabels && selectedLabels.length > sourceLabels.length) {
      setError("Labels count cannot be greater than the labels available on this inspection record.");
      return;
    }

    const invalidLabels = selectedLabels.filter((label) => !sourceAvailableLabelSet.has(label));
    if (hasSourceLabels && invalidLabels.length > 0) {
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
              <div className="col-md-3">
                <div className="small text-secondary">Inspection Date</div>
                <div className="fw-semibold">
                  {formatDateDDMMYYYY(
                    inspectionRecord?.inspection_date || inspectionRecord?.createdAt,
                  ) || "N/A"}
                </div>
              </div>
              <div className="col-md-3">
                <div className="small text-secondary">Passed Quantity</div>
                <div className="fw-semibold">{sourcePassedQuantity}</div>
              </div>
              <div className="col-md-3">
                <div className="small text-secondary">Shipped Quantity</div>
                <div className="fw-semibold">
                  {lookupResult ? sourceShippedQuantity : "Check PO"}
                </div>
              </div>
              <div className="col-md-3">
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
                <div className="row g-3 mt-1">
                  <div className="col-md-4">
                    <div className="small text-secondary">Remaining</div>
                    <div className="fw-semibold">{sourceRemainingLimitQuantity ?? "N/A"}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="small text-secondary">Source Transferable</div>
                    <div className="fw-semibold">{sourceTransferableQuantity}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="small text-secondary">Effective Max</div>
                    <div className="fw-semibold">{maxTransferQuantity}</div>
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
                  max={maxTransferQuantity || undefined}
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
                  Max transferable: {maxTransferQuantity || 0} (remaining quantity, passed quantity, and target PO open quantity)
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
                  {hasSourceLabels
                    ? "Label requirement uses transfer quantity × box sizes count."
                    : "Skipped because this source record has no labels."}
                </div>
              </div>
            </div>

            <div>
              <label className="form-label d-block">Label Ranges</label>
              {hasSourceLabels ? (
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
              ) : (
                <div className="alert alert-light border mb-0">
                  This inspection record has no source labels, so the transfer will not require labels.
                </div>
              )}
              <div className="form-text">
                {requiredLabelsText}
              </div>
            </div>

            {hasSourceLabels && !parsedLabelRangeData.error && parsedLabelRangeData.labels.length > 0 && (
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
