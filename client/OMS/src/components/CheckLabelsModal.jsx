import { useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { getOptionText } from "../utils/optionText";

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
    vendor: getOptionText(entry?.qc_meta?.vendor || qcDoc?.order_meta?.vendor),
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

const renderRangeGroup = (ranges = [], emptyLabel, limit = 20) => {
  if (ranges.length === 0) {
    return <span className="check-labels-empty-state">{emptyLabel}</span>;
  }

  return (
    <div className="check-labels-range-list">
      {ranges.slice(0, limit).map((range) => (
        <span
          key={`${range.start}-${range.end}`}
          className="check-labels-range-chip"
        >
          {formatRange(range)}
        </span>
      ))}
      {ranges.length > limit && (
        <span className="check-labels-range-more">+{ranges.length - limit} more ranges</span>
      )}
    </div>
  );
};

const renderHistoryList = (entries = [], emptyLabel, renderEntry) => {
  if (entries.length === 0) {
    return <span className="check-labels-empty-state">{emptyLabel}</span>;
  }

  return (
    <div className="check-labels-history-list">
      {entries.slice(0, 3).map((entry, index) => (
        <div
          key={entry?._id || `${entry?.recorded_at || entry?.used_at || ""}-${index}`}
          className="check-labels-history-entry"
        >
          {renderEntry(entry)}
        </div>
      ))}
      {entries.length > 3 && (
        <div className="check-labels-history-more">+{entries.length - 3} more recent entries</div>
      )}
    </div>
  );
};

const CheckLabelsModal = ({ onClose }) => {
  const [inspectors, setInspectors] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [labelSearch, setLabelSearch] = useState("");
  const [qcSearch, setQcSearch] = useState("");

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

  const visibleRows = useMemo(() => {
    const query = qcSearch.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [qcSearch, rows]);

  const totals = useMemo(() => rows.reduce(
    (summary, row) => ({
      allocated: summary.allocated + row.allocated.count,
      available: summary.available + row.available.count,
      used: summary.used + row.used.count,
      rejected: summary.rejected + row.rejected.count,
    }),
    { allocated: 0, available: 0, used: 0, rejected: 0 },
  ), [rows]);

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered check-labels-modal-dialog" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title mb-1">Label checker</h5>
              <div className="check-labels-subtitle">Find a label or review QC availability at a glance.</div>
            </div>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>

          <div className="modal-body check-labels-modal-body">
            {loading ? (
              <div className="text-center py-4 text-secondary">Loading QC label allocations...</div>
            ) : error ? (
              <div className="alert alert-danger mb-0">{error}</div>
            ) : rows.length === 0 ? (
              <div className="alert alert-secondary mb-0">No QC inspectors found.</div>
            ) : (
              <div className="check-labels-page">
                <div className="check-labels-toolbar">
                  <div>
                    <label className="form-label" htmlFor="check-labels-label-search">Find a label</label>
                    <input
                      id="check-labels-label-search"
                      type="search"
                      className="form-control"
                      inputMode="numeric"
                      value={labelSearch}
                      onChange={(event) => setLabelSearch(event.target.value)}
                      placeholder="Enter label number, e.g. 1001"
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="check-labels-qc-search">Filter QCs</label>
                    <input
                      id="check-labels-qc-search"
                      type="search"
                      className="form-control"
                      value={qcSearch}
                      onChange={(event) => setQcSearch(event.target.value)}
                      placeholder="Search QC name"
                    />
                  </div>
                  {(labelSearch || qcSearch) && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary check-labels-clear-btn"
                      onClick={() => {
                        setLabelSearch("");
                        setQcSearch("");
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="check-labels-total-grid" aria-label="Label totals">
                  {[
                    ["QCs", rows.length, "qcs"],
                    ["Allocated", totals.allocated, "allocated"],
                    ["Available", totals.available, "available"],
                    ["Used", totals.used, "used"],
                    ["Rejected", totals.rejected, "rejected"],
                  ].map(([label, value, tone]) => (
                    <div key={label} className={`check-labels-total check-labels-total--${tone}`}>
                      <div className="check-labels-total-value">{value.toLocaleString()}</div>
                      <div className="check-labels-total-label">{label}</div>
                    </div>
                  ))}
                </div>

                {labelSearchResult.active && (
                  <div
                    className={
                      labelSearchResult.invalid
                        ? "alert alert-warning mb-0"
                        : "check-labels-search-result"
                    }
                    aria-live="polite"
                  >
                    {labelSearchResult.invalid ? (
                      labelSearchResult.message
                    ) : labelSearchResult.matches.length === 0 ? (
                      <div className="check-labels-no-result">
                        <strong>Label {labelSearchResult.labelNumber}</strong> is not allocated, used, or rejected.
                      </div>
                    ) : (
                      <div>
                        <div className="check-labels-result-heading">
                          <span>Label {labelSearchResult.labelNumber}</span>
                          <span>{labelSearchResult.matches.length} match{labelSearchResult.matches.length === 1 ? "" : "es"}</span>
                        </div>
                        <div className="check-labels-search-match-list">
                        {labelSearchResult.matches.map((match) => (
                          <div key={match.key} className="check-labels-search-match">
                            <div className="d-flex flex-wrap gap-2 align-items-center">
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
                      </div>
                    )}
                  </div>
                )}

                <div className="check-labels-list-header">
                  <div>
                    <div className="fw-semibold">QC label availability</div>
                    <div className="check-labels-subtitle">
                      {visibleRows.length} of {rows.length} QC{rows.length === 1 ? "" : "s"} shown
                    </div>
                  </div>
                  <div className="check-labels-subtitle">Open a QC to view ranges and recent activity.</div>
                </div>

                {visibleRows.length === 0 ? (
                  <div className="check-labels-no-result">No QC matches "{qcSearch.trim()}".</div>
                ) : (
                  <div className="check-labels-list">
                    {visibleRows.map((row) => (
                      <details key={row.id} className="check-labels-qc-card">
                        <summary className="check-labels-qc-summary">
                          <div className="check-labels-qc-name">{row.name}</div>
                          <div className="check-labels-stat-grid">
                            {[
                              ["Allocated", row.allocated.count, "allocated"],
                              ["Available", row.available.count, "available"],
                              ["Used", row.used.count, "used"],
                              ["Rejected", row.rejected.count, "rejected"],
                            ].map(([label, value, tone]) => (
                              <div key={label} className={`check-labels-stat check-labels-stat--${tone}`}>
                                <div className="check-labels-stat-value">{value.toLocaleString()}</div>
                                <div className="check-labels-stat-label">{label}</div>
                              </div>
                            ))}
                          </div>
                          <span className="check-labels-details-toggle">Details <span aria-hidden="true">v</span></span>
                        </summary>

                        <div className="check-labels-qc-details">
                          <section>
                            <div className="check-labels-section-title">Label ranges</div>
                            <div className="check-labels-range-grid">
                              {[
                                ["Allocated", row.allocated, "No labels allocated", "allocated"],
                                ["Available to use", row.available, "No available labels", "available"],
                                ["Used", row.used, "No used labels", "used"],
                                ["Rejected", row.rejected, "No rejected labels", "rejected"],
                              ].map(([label, data, emptyLabel, tone]) => (
                                <div key={label} className={`check-labels-range-card check-labels-range-card--${tone}`}>
                                  <div className="check-labels-range-card-title">{label}</div>
                                  {renderRangeGroup(data.ranges, emptyLabel)}
                                </div>
                              ))}
                            </div>
                          </section>

                          <section>
                            <div className="check-labels-section-title">Recent activity</div>
                            <div className="check-labels-history-grid">
                              <div className="check-labels-activity-card">
                                <div className="check-labels-range-card-title">Allocation history</div>
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
                                      <div className="small">{formatLabelList(entry?.labels)}</div>
                                    </>
                                  ),
                                )}
                              </div>
                              <div className="check-labels-activity-card">
                                <div className="check-labels-range-card-title">Used history</div>
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
                                      <div className="small">{formatLabelList(entry?.labels)}</div>
                                    </>
                                  ),
                                )}
                              </div>
                            </div>
                          </section>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
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
