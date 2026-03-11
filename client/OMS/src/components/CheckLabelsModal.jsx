import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";

const normalizeLabels = (labels = []) => (
  [...new Set(
    (Array.isArray(labels) ? labels : [])
      .map((label) => Number(label))
      .filter((label) => Number.isInteger(label) && label > 0),
  )].sort((left, right) => left - right)
);

const normalizeLabelRanges = (labels = []) => {
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

const formatRange = ({ start, end }) => (start === end ? String(start) : `${start}-${end}`);

const renderRangeGroup = (ranges = [], emptyLabel) => {
  if (ranges.length === 0) {
    return <span className="text-secondary">{emptyLabel}</span>;
  }

  return (
    <div className="d-flex flex-wrap gap-2">
      {ranges.map((range) => (
        <span
          key={`${range.start}-${range.end}`}
          className="badge text-bg-light border text-dark"
        >
          {formatRange(range)}
        </span>
      ))}
    </div>
  );
};

const CheckLabelsModal = ({ onClose }) => {
  const [inspectors, setInspectors] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInspectors = async () => {
      try {
        setLoading(true);
        setError("");
        const response = await api.get("/inspectors", {
          params: { page: 1, limit: 1000 },
        });
        setInspectors(Array.isArray(response.data?.data) ? response.data.data : []);
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load QC labels.");
      } finally {
        setLoading(false);
      }
    };

    fetchInspectors();
  }, []);

  const rows = useMemo(() => (
    [...inspectors]
      .sort((left, right) => {
        const leftName = String(left?.user?.name || left?.user?.email || "").trim().toLowerCase();
        const rightName = String(right?.user?.name || right?.user?.email || "").trim().toLowerCase();
        return leftName.localeCompare(rightName);
      })
      .map((inspector) => {
        const allocatedLabels = normalizeLabels(inspector?.alloted_labels);
        const usedLabels = normalizeLabels(inspector?.used_labels);
        const usedSet = new Set(usedLabels);
        const availableLabels = allocatedLabels.filter((label) => !usedSet.has(label));

        return {
          id: String(inspector?._id || ""),
          name: inspector?.user?.name || inspector?.user?.email || "Unnamed QC",
          allocated: {
            count: allocatedLabels.length,
            ranges: normalizeLabelRanges(allocatedLabels),
          },
          available: {
            count: availableLabels.length,
            ranges: normalizeLabelRanges(availableLabels),
          },
          used: {
            count: usedLabels.length,
            ranges: normalizeLabelRanges(usedLabels),
          },
        };
      })
  ), [inspectors]);

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Check Labels</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body">
            {loading ? (
              <div className="text-center py-4 text-secondary">Loading QC label allocations...</div>
            ) : error ? (
              <div className="alert alert-danger mb-0">{error}</div>
            ) : rows.length === 0 ? (
              <div className="alert alert-secondary mb-0">No QC inspectors found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th style={{ minWidth: "220px" }}>QC Name</th>
                      <th style={{ minWidth: "240px" }}>Allocated Labels</th>
                      <th style={{ minWidth: "240px" }}>Available To Use</th>
                      <th style={{ minWidth: "240px" }}>Used Labels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="fw-semibold">{row.name}</td>
                        <td>
                          <div className="small text-secondary mb-2">
                            Total: {row.allocated.count}
                          </div>
                          {renderRangeGroup(row.allocated.ranges, "No labels allocated")}
                        </td>
                        <td>
                          <div className="small text-secondary mb-2">
                            Total: {row.available.count}
                          </div>
                          {renderRangeGroup(row.available.ranges, "No available labels")}
                        </td>
                        <td>
                          <div className="small text-secondary mb-2">
                            Total: {row.used.count}
                          </div>
                          {renderRangeGroup(row.used.ranges, "No used labels")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckLabelsModal;
