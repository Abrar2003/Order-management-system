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

const formatLabelList = (labels = [], limit = 8) => {
  const normalizedLabels = normalizeLabels(labels);
  if (normalizedLabels.length === 0) return "-";

  const preview = normalizedLabels.slice(0, limit).join(", ");
  if (normalizedLabels.length <= limit) return preview;
  return `${preview} (+${normalizedLabels.length - limit} more)`;
};

const formatHistoryDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const LABEL_ACTION_LABELS = Object.freeze({
  allocate: "Allocated",
  transfer_in: "Transferred In",
  transfer_out: "Transferred Out",
  reject: "Rejected",
  replace: "Replaced",
  remove: "Removed",
});

const LABEL_STATUS_BADGES = Object.freeze({
  Used: "text-bg-success",
  Unused: "text-bg-secondary",
  Rejected: "text-bg-danger",
  Allocated: "text-bg-primary",
});

const normalizeHistoryRows = (entries = [], dateKey = "recorded_at") => (
  (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .sort((left, right) => (
      new Date(right?.[dateKey] || 0) - new Date(left?.[dateKey] || 0)
    ))
);

const formatShortId = (value) => {
  const id = String(value?._id || value || "").trim();
  if (!id) return "-";
  return id.length > 8 ? id.slice(-8) : id;
};

const historyEntryHasLabel = (entry = {}, labelNumber = 0) =>
  normalizeLabels(entry?.labels).includes(labelNumber);

const getUsedHistoryMeta = (entry = {}) => {
  const qcDoc = entry?.qc && typeof entry.qc === "object" ? entry.qc : {};
  return {
    orderId: String(entry?.qc_meta?.order_id || qcDoc?.order_meta?.order_id || ""),
    brand: String(entry?.qc_meta?.brand || qcDoc?.order_meta?.brand || ""),
    vendor: String(entry?.qc_meta?.vendor || qcDoc?.order_meta?.vendor || ""),
    itemCode: String(entry?.qc_meta?.item_code || qcDoc?.item?.item_code || ""),
    description: String(entry?.qc_meta?.description || qcDoc?.item?.description || ""),
  };
};

const formatUsedLocation = (entry = {}) => {
  const meta = getUsedHistoryMeta(entry);
  const parts = [
    meta.orderId ? `PO ${meta.orderId}` : "",
    meta.itemCode ? `Item ${meta.itemCode}` : "",
    meta.vendor,
    meta.brand,
  ].filter(Boolean);

  return parts.join(" | ") || `QC ${formatShortId(entry?.qc)}`;
};

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

const renderHistoryList = (entries = [], emptyLabel, renderEntry) => {
  if (entries.length === 0) {
    return <span className="text-secondary">{emptyLabel}</span>;
  }

  return (
    <div className="d-grid gap-2">
      {entries.slice(0, 3).map((entry, index) => (
        <div
          key={entry?._id || `${entry?.recorded_at || entry?.used_at || ""}-${index}`}
          className="border rounded p-2"
        >
          {renderEntry(entry)}
        </div>
      ))}
      {entries.length > 3 && (
        <div className="small text-secondary">+{entries.length - 3} more</div>
      )}
    </div>
  );
};

const CheckLabelsModal = ({ onClose }) => {
  const [inspectors, setInspectors] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [labelSearch, setLabelSearch] = useState("");

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
        const rejectedLabels = normalizeLabels(inspector?.rejected_labels);
        const usedSet = new Set(usedLabels);
        const availableLabels = allocatedLabels.filter((label) => !usedSet.has(label));
        const allocationHistory = normalizeHistoryRows(
          inspector?.label_allocation_history,
          "recorded_at",
        );
        const usedHistory = normalizeHistoryRows(
          inspector?.label_used_history,
          "used_at",
        );

        return {
          id: String(inspector?._id || ""),
          name: inspector?.user?.name || inspector?.user?.email || "Unnamed QC",
          allocatedLabels,
          availableLabels,
          usedLabels,
          rejectedLabels,
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
          rejected: {
            count: rejectedLabels.length,
            ranges: normalizeLabelRanges(rejectedLabels),
          },
          allocationHistory,
          usedHistory,
        };
      })
  ), [inspectors]);

  const labelSearchResult = useMemo(() => {
    const query = labelSearch.trim();
    if (!query) return { active: false };

    if (!/^\d+$/.test(query)) {
      return {
        active: true,
        invalid: true,
        message: "Enter a positive label number.",
      };
    }

    const labelNumber = Number(query);
    if (!Number.isInteger(labelNumber) || labelNumber <= 0) {
      return {
        active: true,
        invalid: true,
        message: "Enter a positive label number.",
      };
    }

    const matches = [];
    rows.forEach((row) => {
      const usedEntries = row.usedHistory.filter((entry) =>
        historyEntryHasLabel(entry, labelNumber),
      );
      const rejectedEvents = row.allocationHistory.filter((entry) =>
        entry?.action === "reject" && historyEntryHasLabel(entry, labelNumber),
      );
      const isUsed = row.usedLabels.includes(labelNumber) || usedEntries.length > 0;
      const isRejected = row.rejectedLabels.includes(labelNumber);
      const isUnused = row.availableLabels.includes(labelNumber);
      const isAllocated = row.allocatedLabels.includes(labelNumber);

      if (isUsed) {
        matches.push({
          key: `${row.id}-used`,
          status: "Used",
          row,
          usedEntries,
        });
      }

      if (isRejected) {
        matches.push({
          key: `${row.id}-rejected`,
          status: "Rejected",
          row,
          rejectedEvents,
        });
      }

      if (isUnused && !isUsed && !isRejected) {
        matches.push({
          key: `${row.id}-unused`,
          status: "Unused",
          row,
        });
      } else if (isAllocated && !isUsed && !isRejected && !isUnused) {
        matches.push({
          key: `${row.id}-allocated`,
          status: "Allocated",
          row,
        });
      }
    });

    return {
      active: true,
      invalid: false,
      labelNumber,
      matches,
    };
  }, [labelSearch, rows]);

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Check Labels</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body d-grid gap-3">
            {loading ? (
              <div className="text-center py-4 text-secondary">Loading QC label allocations...</div>
            ) : error ? (
              <div className="alert alert-danger mb-0">{error}</div>
            ) : rows.length === 0 ? (
              <div className="alert alert-secondary mb-0">No QC inspectors found.</div>
            ) : (
              <div className="d-grid gap-3">
                <div className="row g-3 align-items-end">
                  <div className="col-sm-5 col-md-4">
                    <label className="form-label">Search Label</label>
                    <input
                      type="number"
                      className="form-control"
                      min="1"
                      value={labelSearch}
                      onChange={(event) => setLabelSearch(event.target.value)}
                      placeholder="e.g. 1001"
                    />
                  </div>
                </div>

                {labelSearchResult.active && (
                  <div
                    className={
                      labelSearchResult.invalid
                        ? "alert alert-warning mb-0"
                        : "border rounded p-3"
                    }
                  >
                    {labelSearchResult.invalid ? (
                      labelSearchResult.message
                    ) : labelSearchResult.matches.length === 0 ? (
                      <div className="text-secondary">
                        Label {labelSearchResult.labelNumber} not found.
                      </div>
                    ) : (
                      <div className="d-grid gap-2">
                        {labelSearchResult.matches.map((match) => (
                          <div key={match.key} className="border rounded p-2">
                            <div className="d-flex flex-wrap gap-2 align-items-center mb-1">
                              <span
                                className={`badge ${LABEL_STATUS_BADGES[match.status] || "text-bg-primary"}`}
                              >
                                {match.status}
                              </span>
                              <span className="fw-semibold">{match.row.name}</span>
                            </div>

                            {match.status === "Used" ? (
                              match.usedEntries.length > 0 ? (
                                <div className="d-grid gap-1">
                                  {match.usedEntries.map((entry, index) => (
                                    <div
                                      key={`${entry?.inspection_record || ""}-${index}`}
                                      className="small"
                                    >
                                      <div>{formatUsedLocation(entry)}</div>
                                      <div className="text-secondary">
                                        Record {formatShortId(entry?.inspection_record)}
                                        {" | "}
                                        {entry?.inspection_date || formatHistoryDate(entry?.used_at)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="small text-secondary">
                                  Used label history is pending sync.
                                </div>
                              )
                            ) : match.status === "Rejected" ? (
                              <div className="small text-secondary">
                                {match.rejectedEvents?.[0]
                                  ? `${formatHistoryDate(match.rejectedEvents[0].recorded_at)}${
                                    match.rejectedEvents[0]?.actor?.name
                                      ? ` by ${match.rejectedEvents[0].actor.name}`
                                      : ""
                                  }`
                                  : "Rejected for this QC inspector."}
                              </div>
                            ) : (
                              <div className="small text-secondary">
                                Allocated to this QC inspector and not linked to an inspection record.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th style={{ minWidth: "220px" }}>QC Name</th>
                        <th style={{ minWidth: "240px" }}>Allocated Labels</th>
                        <th style={{ minWidth: "240px" }}>Available To Use</th>
                        <th style={{ minWidth: "240px" }}>Used Labels</th>
                        <th style={{ minWidth: "240px" }}>Rejected Labels</th>
                        <th style={{ minWidth: "300px" }}>Allocation History</th>
                        <th style={{ minWidth: "320px" }}>Used History</th>
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
                          <td>
                            <div className="small text-secondary mb-2">
                              Total: {row.rejected.count}
                            </div>
                            {renderRangeGroup(row.rejected.ranges, "No rejected labels")}
                          </td>
                          <td>
                            {renderHistoryList(
                              row.allocationHistory,
                              "No allocation history",
                              (entry) => (
                                <>
                                  <div className="small fw-semibold">
                                    {LABEL_ACTION_LABELS[entry?.action] || entry?.action || "Updated"}
                                    {" "}
                                    ({normalizeLabels(entry?.labels).length})
                                  </div>
                                  <div className="small text-secondary">
                                    {formatHistoryDate(entry?.recorded_at)}
                                    {entry?.actor?.name ? ` by ${entry.actor.name}` : ""}
                                  </div>
                                  <div className="small">
                                    {formatLabelList(entry?.labels)}
                                  </div>
                                </>
                              ),
                            )}
                          </td>
                          <td>
                            {renderHistoryList(
                              row.usedHistory,
                              "No used history",
                              (entry) => (
                                <>
                                  <div className="small fw-semibold">
                                    Record {formatShortId(entry?.inspection_record)}
                                    {" "}
                                    ({normalizeLabels(entry?.labels).length})
                                  </div>
                                  <div className="small text-secondary">
                                    {formatHistoryDate(entry?.used_at)}
                                    {entry?.inspection_date ? ` | ${entry.inspection_date}` : ""}
                                  </div>
                                  <div className="small">
                                    {formatLabelList(entry?.labels)}
                                  </div>
                                </>
                              ),
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
