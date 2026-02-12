import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import "../App.css";

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

const AllocateLabelsModal = ({ onClose }) => {
  const [inspectors, setInspectors] = useState([]);
  const [selectedInspectorId, setSelectedInspectorId] = useState("");
  const [usage, setUsage] = useState(null);
  const [labelStart, setLabelStart] = useState("");
  const [labelEnd, setLabelEnd] = useState("");
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingInspectors, setLoadingInspectors] = useState(true);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const selectedInspector = useMemo(
    () => inspectors.find((inspector) => inspector._id === selectedInspectorId),
    [inspectors, selectedInspectorId],
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

  const handleAllocate = async () => {
    setErrors([]);

    if (!selectedInspectorId) {
      setErrors(["Please select a QC inspector."]);
      return;
    }

    if (labelStart.trim() === "" || labelEnd.trim() === "") {
      setErrors(["Please enter both start and end label numbers."]);
      return;
    }

    const startNum = Number(labelStart);
    const endNum = Number(labelEnd);

    if (!Number.isInteger(startNum) || !Number.isInteger(endNum)) {
      setErrors(["Label range values must be integers."]);
      return;
    }

    if (startNum <= 0 || endNum <= 0) {
      setErrors(["Label numbers must be positive integers."]);
      return;
    }

    if (startNum > endNum) {
      setErrors(["Start label cannot be greater than end label."]);
      return;
    }

    const labels = buildRange(startNum, endNum);
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
      setLabelStart("");
      setLabelEnd("");
      setSelectedInspectorId("");
      setUsage(null);
      setErrors([]);
      onClose();
      alert("Labels allocated successfully.");
    } catch (err) {
      setErrors([err.response?.data?.message || "Failed to allocate labels."]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Allocate QC Labels</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            <div className="row g-2">
              <div className="col-sm-6 col-lg-3">
                <div className="small text-secondary">Inspector</div>
                <div className="fw-semibold">{selectedInspector?.user?.name || "Select inspector"}</div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="small text-secondary">Allocated</div>
                <div className="fw-semibold">{loadingUsage ? "Loading..." : usage?.total_allocated ?? "-"}</div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="small text-secondary">Used</div>
                <div className="fw-semibold">{loadingUsage ? "Loading..." : usage?.total_used ?? "-"}</div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="small text-secondary">Unused</div>
                <div className="fw-semibold">{loadingUsage ? "Loading..." : usage?.unused_labels?.length ?? "-"}</div>
              </div>
            </div>

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

              <div className="col-md-4">
                <label className="form-label">Start Label</label>
                <input
                  type="number"
                  className="form-control"
                  value={labelStart}
                  onChange={(e) => setLabelStart(e.target.value)}
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
                  onChange={(e) => setLabelEnd(e.target.value)}
                  min="1"
                  placeholder="e.g. 1050"
                />
              </div>
            </div>

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
              onClick={handleAllocate}
              disabled={saving || loadingInspectors}
            >
              {saving ? "Allocating..." : "Allocate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AllocateLabelsModal;
