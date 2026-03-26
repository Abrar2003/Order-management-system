import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import "../App.css";

const LABEL_ACTION_MODES = Object.freeze({
  ALLOCATE: "allocate",
  TRANSFER: "transfer",
});

const buildRange = (start, end) => {
  const labels = [];
  for (let i = start; i <= end; i++) {
    labels.push(i);
  }
  return labels;
};

const formatLabelList = (labels, limit = 10) => {
  if (!labels.length) return "";
  const preview = labels.slice(0, limit).join(", ");
  if (labels.length <= limit) return preview;
  return `${preview} (+${labels.length - limit} more)`;
};

const parseRangeLabels = ({ labelStart = "", labelEnd = "" } = {}) => {
  if (labelStart.trim() === "" || labelEnd.trim() === "") {
    return { labels: [], error: "Please enter both start and end label numbers." };
  }

  const startNum = Number(labelStart);
  const endNum = Number(labelEnd);

  if (!Number.isInteger(startNum) || !Number.isInteger(endNum)) {
    return { labels: [], error: "Label range values must be integers." };
  }

  if (startNum <= 0 || endNum <= 0) {
    return { labels: [], error: "Label numbers must be positive integers." };
  }

  if (startNum > endNum) {
    return { labels: [], error: "Start label cannot be greater than end label." };
  }

  return { labels: buildRange(startNum, endNum), error: "" };
};

const UsageSummaryCard = ({
  title,
  inspector = null,
  usage = null,
  loading = false,
}) => (
  <div className="col-md-6">
    <div className="border rounded p-3 h-100">
      <div className="small text-secondary">{title}</div>
      <div className="fw-semibold mb-2">
        {inspector?.user?.name || inspector?.user?.email || "Select inspector"}
      </div>
      <div className="row g-2">
        <div className="col-4">
          <div className="small text-secondary">Allocated</div>
          <div className="fw-semibold">{loading ? "Loading..." : usage?.total_allocated ?? "-"}</div>
        </div>
        <div className="col-4">
          <div className="small text-secondary">Used</div>
          <div className="fw-semibold">{loading ? "Loading..." : usage?.total_used ?? "-"}</div>
        </div>
        <div className="col-4">
          <div className="small text-secondary">Unused</div>
          <div className="fw-semibold">{loading ? "Loading..." : usage?.unused_labels?.length ?? "-"}</div>
        </div>
      </div>
    </div>
  </div>
);

const AllocateLabelsModal = ({ onClose }) => {
  const [inspectors, setInspectors] = useState([]);
  const [mode, setMode] = useState(LABEL_ACTION_MODES.ALLOCATE);
  const [selectedInspectorId, setSelectedInspectorId] = useState("");
  const [usage, setUsage] = useState(null);
  const [sourceInspectorId, setSourceInspectorId] = useState("");
  const [targetInspectorId, setTargetInspectorId] = useState("");
  const [sourceUsage, setSourceUsage] = useState(null);
  const [targetUsage, setTargetUsage] = useState(null);
  const [labelStart, setLabelStart] = useState("");
  const [labelEnd, setLabelEnd] = useState("");
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingInspectors, setLoadingInspectors] = useState(true);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [loadingSourceUsage, setLoadingSourceUsage] = useState(false);
  const [loadingTargetUsage, setLoadingTargetUsage] = useState(false);

  const isTransferMode = mode === LABEL_ACTION_MODES.TRANSFER;
  const selectedInspector = useMemo(
    () => inspectors.find((inspector) => inspector._id === selectedInspectorId),
    [inspectors, selectedInspectorId],
  );
  const sourceInspector = useMemo(
    () => inspectors.find((inspector) => inspector._id === sourceInspectorId),
    [inspectors, sourceInspectorId],
  );
  const targetInspector = useMemo(
    () => inspectors.find((inspector) => inspector._id === targetInspectorId),
    [inspectors, targetInspectorId],
  );

  const globalAllocated = useMemo(() => {
    const allocated = new Set();
    inspectors.forEach((inspector) => {
      (inspector.alloted_labels || []).forEach((label) => allocated.add(Number(label)));
      (inspector.used_labels || []).forEach((label) => allocated.add(Number(label)));
    });
    return allocated;
  }, [inspectors]);

  useEffect(() => {
    const fetchInspectors = async () => {
      try {
        setLoadingInspectors(true);
        const res = await api.get("/inspectors", {
          params: { page: 1, limit: 1000 },
        });
        setInspectors(res.data.data || []);
      } catch (err) {
        setErrors([err.response?.data?.message || "Failed to load inspectors."]);
      } finally {
        setLoadingInspectors(false);
      }
    };

    fetchInspectors();
  }, []);

  useEffect(() => {
    setErrors([]);
  }, [mode]);

  useEffect(() => {
    if (!selectedInspectorId) {
      setUsage(null);
      return;
    }

    const fetchUsage = async () => {
      try {
        setLoadingUsage(true);
        const res = await api.get(`/inspectors/${selectedInspectorId}/label-usage`);
        setUsage(res.data.data);
      } catch (err) {
        setErrors([err.response?.data?.message || "Failed to load label usage."]);
      } finally {
        setLoadingUsage(false);
      }
    };

    fetchUsage();
  }, [selectedInspectorId]);

  useEffect(() => {
    if (!sourceInspectorId) {
      setSourceUsage(null);
      return;
    }

    const fetchSourceUsage = async () => {
      try {
        setLoadingSourceUsage(true);
        const res = await api.get(`/inspectors/${sourceInspectorId}/label-usage`);
        setSourceUsage(res.data.data);
      } catch (err) {
        setErrors([err.response?.data?.message || "Failed to load source inspector label usage."]);
      } finally {
        setLoadingSourceUsage(false);
      }
    };

    fetchSourceUsage();
  }, [sourceInspectorId]);

  useEffect(() => {
    if (!targetInspectorId) {
      setTargetUsage(null);
      return;
    }

    const fetchTargetUsage = async () => {
      try {
        setLoadingTargetUsage(true);
        const res = await api.get(`/inspectors/${targetInspectorId}/label-usage`);
        setTargetUsage(res.data.data);
      } catch (err) {
        setErrors([err.response?.data?.message || "Failed to load target inspector label usage."]);
      } finally {
        setLoadingTargetUsage(false);
      }
    };

    fetchTargetUsage();
  }, [targetInspectorId]);

  const resetForm = () => {
    setSelectedInspectorId("");
    setUsage(null);
    setSourceInspectorId("");
    setTargetInspectorId("");
    setSourceUsage(null);
    setTargetUsage(null);
    setLabelStart("");
    setLabelEnd("");
    setErrors([]);
  };

  const handleAllocate = async () => {
    setErrors([]);

    if (!selectedInspectorId) {
      setErrors(["Please select a QC inspector."]);
      return;
    }

    const { labels, error } = parseRangeLabels({ labelStart, labelEnd });
    if (error) {
      setErrors([error]);
      return;
    }

    const usageAllocated = usage?.allocated_labels || selectedInspector?.alloted_labels || [];
    const usageUsed = usage?.used_labels || selectedInspector?.used_labels || [];
    const allocatedSet = new Set(usageAllocated.map(Number));
    const usedSet = new Set(usageUsed.map(Number));

    const conflictsUsed = labels.filter((label) => usedSet.has(label));
    const conflictsAllocated = labels.filter((label) => allocatedSet.has(label));
    const conflictsOther = labels.filter(
      (label) => globalAllocated.has(label) && !allocatedSet.has(label) && !usedSet.has(label),
    );

    const nextErrors = [];
    if (conflictsUsed.length) {
      nextErrors.push(`Used labels cannot be reallocated: ${formatLabelList(conflictsUsed)}`);
    }
    if (conflictsAllocated.length) {
      nextErrors.push(`Already allocated to this inspector: ${formatLabelList(conflictsAllocated)}`);
    }
    if (conflictsOther.length) {
      nextErrors.push(`Allocated to another inspector: ${formatLabelList(conflictsOther)}`);
    }

    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    try {
      setSaving(true);
      await api.patch(`/inspectors/${selectedInspectorId}/allocate-labels`, { labels });
      resetForm();
      onClose();
      alert("Labels allocated successfully.");
    } catch (err) {
      setErrors([err.response?.data?.message || "Failed to allocate labels."]);
    } finally {
      setSaving(false);
    }
  };

  const handleTransfer = async () => {
    setErrors([]);

    if (!sourceInspectorId || !targetInspectorId) {
      setErrors(["Please select both source and target QC inspectors."]);
      return;
    }

    if (sourceInspectorId === targetInspectorId) {
      setErrors(["Source and target QC inspectors must be different."]);
      return;
    }

    const { labels, error } = parseRangeLabels({ labelStart, labelEnd });
    if (error) {
      setErrors([error]);
      return;
    }

    const sourceAllocated = sourceUsage?.allocated_labels || sourceInspector?.alloted_labels || [];
    const sourceUsed = sourceUsage?.used_labels || sourceInspector?.used_labels || [];
    const targetAllocated = targetUsage?.allocated_labels || targetInspector?.alloted_labels || [];
    const targetUsed = targetUsage?.used_labels || targetInspector?.used_labels || [];

    const sourceAllocatedSet = new Set(sourceAllocated.map(Number));
    const sourceUsedSet = new Set(sourceUsed.map(Number));
    const targetAllocatedSet = new Set(targetAllocated.map(Number));
    const targetUsedSet = new Set(targetUsed.map(Number));

    const missingFromSource = labels.filter((label) => !sourceAllocatedSet.has(label));
    const usedInSource = labels.filter((label) => sourceUsedSet.has(label));
    const alreadyInTarget = labels.filter(
      (label) => targetAllocatedSet.has(label) || targetUsedSet.has(label),
    );

    const nextErrors = [];
    if (missingFromSource.length) {
      nextErrors.push(`Not allocated to source QC: ${formatLabelList(missingFromSource)}`);
    }
    if (usedInSource.length) {
      nextErrors.push(`Used labels cannot be transferred: ${formatLabelList(usedInSource)}`);
    }
    if (alreadyInTarget.length) {
      nextErrors.push(`Already assigned to target QC: ${formatLabelList(alreadyInTarget)}`);
    }

    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    try {
      setSaving(true);
      await api.patch("/inspectors/transfer-labels", {
        from_inspector_id: sourceInspectorId,
        to_inspector_id: targetInspectorId,
        labels,
      });
      resetForm();
      onClose();
      alert("Labels transferred successfully.");
    } catch (err) {
      setErrors([err.response?.data?.message || "Failed to transfer labels."]);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => {
    if (isTransferMode) {
      handleTransfer();
      return;
    }
    handleAllocate();
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Allocate / Transfer QC Labels</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Action</label>
                <select
                  className="form-select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value={LABEL_ACTION_MODES.ALLOCATE}>Allocate Range</option>
                  <option value={LABEL_ACTION_MODES.TRANSFER}>Transfer Range</option>
                </select>
              </div>

              <div className="col-md-4">
                <label className="form-label">Start Label</label>
                <input
                  type="number"
                  className="form-control"
                  value={labelStart}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (nextValue === "" || Number(nextValue) >= 0) {
                      setLabelStart(nextValue);
                    }
                  }}
                  min="1"
                  placeholder="e.g. 1001"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">End Label</label>
                <input
                  type="number"
                  className="form-control"
                  value={labelEnd}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (nextValue === "" || Number(nextValue) >= 0) {
                      setLabelEnd(nextValue);
                    }
                  }}
                  min="1"
                  placeholder="e.g. 1050"
                />
              </div>
            </div>

            {isTransferMode ? (
              <>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">From QC Inspector</label>
                    <select
                      className="form-select"
                      value={sourceInspectorId}
                      onChange={(e) => setSourceInspectorId(e.target.value)}
                      disabled={loadingInspectors}
                    >
                      <option value="">
                        {loadingInspectors ? "Loading inspectors..." : "Select Source Inspector"}
                      </option>
                      {inspectors.map((inspector) => (
                        <option key={inspector._id} value={inspector._id}>
                          {inspector.user?.name || inspector.user?.email || inspector._id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-md-6">
                    <label className="form-label">To QC Inspector</label>
                    <select
                      className="form-select"
                      value={targetInspectorId}
                      onChange={(e) => setTargetInspectorId(e.target.value)}
                      disabled={loadingInspectors}
                    >
                      <option value="">
                        {loadingInspectors ? "Loading inspectors..." : "Select Target Inspector"}
                      </option>
                      {inspectors.map((inspector) => (
                        <option key={inspector._id} value={inspector._id}>
                          {inspector.user?.name || inspector.user?.email || inspector._id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="small text-secondary">
                  Only unused labels can be transferred between QC inspectors.
                </div>

                <div className="row g-3">
                  <UsageSummaryCard
                    title="Source QC"
                    inspector={sourceInspector}
                    usage={sourceUsage}
                    loading={loadingSourceUsage}
                  />
                  <UsageSummaryCard
                    title="Target QC"
                    inspector={targetInspector}
                    usage={targetUsage}
                    loading={loadingTargetUsage}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label">QC Inspector</label>
                    <select
                      className="form-select"
                      value={selectedInspectorId}
                      onChange={(e) => setSelectedInspectorId(e.target.value)}
                      disabled={loadingInspectors}
                    >
                      <option value="">
                        {loadingInspectors ? "Loading inspectors..." : "Select Inspector"}
                      </option>
                      {inspectors.map((inspector) => (
                        <option key={inspector._id} value={inspector._id}>
                          {inspector.user?.name || inspector.user?.email || inspector._id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="row g-3">
                  <UsageSummaryCard
                    title="Selected QC"
                    inspector={selectedInspector}
                    usage={usage}
                    loading={loadingUsage}
                  />
                </div>
              </>
            )}

            {errors.length > 0 && (
              <div className="alert alert-danger mb-0">
                <ul className="mb-0 ps-3">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={saving || loadingInspectors}
            >
              {saving
                ? (isTransferMode ? "Transferring..." : "Allocating...")
                : (isTransferMode ? "Transfer" : "Allocate")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AllocateLabelsModal;
