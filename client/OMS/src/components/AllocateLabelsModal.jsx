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
    [inspectors, selectedInspectorId]
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
      (label) => globalAllocated.has(label) && !allocatedSet.has(label) && !usedSet.has(label)
    );

    const nextErrors = [];
    if (conflictsUsed.length) {
      nextErrors.push(
        `Used labels cannot be reallocated: ${formatLabelList(conflictsUsed)}`
      );
    }
    if (conflictsAllocated.length) {
      nextErrors.push(
        `Already allocated to this inspector: ${formatLabelList(conflictsAllocated)}`
      );
    }
    if (conflictsOther.length) {
      nextErrors.push(
        `Allocated to another inspector: ${formatLabelList(conflictsOther)}`
      );
    }

    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    try {
      setSaving(true);
      await api.patch(`/inspectors/${selectedInspectorId}/allocate-labels`, {
        labels,
      });
      setLabelStart("");
      setLabelEnd("");
      setSelectedInspectorId("");
      setUsage(null);
      await new Promise((resolve) => setTimeout(resolve, 150));
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
    <div className="modalOverlay">
      <div className="modalBox qc-modal">
        <h3>Allocate QC Labels</h3>

        <div className="qc-modal-info">
          <p>
            <b>Inspector:</b>{" "}
            {selectedInspector?.user?.name || "Select an inspector"}
          </p>
          <p>
            <b>Allocated:</b>{" "}
            {loadingUsage ? "Loading..." : usage?.total_allocated ?? "—"}
          </p>
          <p>
            <b>Used:</b>{" "}
            {loadingUsage ? "Loading..." : usage?.total_used ?? "—"}
          </p>
          <p>
            <b>Unused:</b>{" "}
            {loadingUsage ? "Loading..." : usage?.unused_labels?.length ?? "—"}
          </p>
        </div>

        <div className="inputContainer qc-modal-grid">
          <div className="qc-modal-field">
            <label>QC Inspector</label>
            <select
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

          <div className="qc-modal-field">
            <label>Start Label</label>
            <input
              type="number"
              value={labelStart}
              onChange={(e) => setLabelStart(e.target.value)}
              min="1"
              placeholder="e.g. 1001"
            />
          </div>

          <div className="qc-modal-field">
            <label>End Label</label>
            <input
              type="number"
              value={labelEnd}
              onChange={(e) => setLabelEnd(e.target.value)}
              min="1"
              placeholder="e.g. 1050"
            />
          </div>
        </div>

        {errors.length > 0 && (
          <div className="modalError">
            <ul className="qc-modal-error-list">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="modalActions">
          <button onClick={handleAllocate} disabled={saving || loadingInspectors}>
            {saving ? "Allocating..." : "Allocate"}
          </button>
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default AllocateLabelsModal;
