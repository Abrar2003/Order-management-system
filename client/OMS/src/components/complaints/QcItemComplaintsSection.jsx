import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addQcComplaintComment,
  getItemRelatedComplaints,
  markComplaintRead,
} from "../../services/complaints.service";
import ComplaintFilesDropdown from "./ComplaintFilesDropdown";
import { formatComplaintDateTime } from "./complaintConstants";

const getCommentCount = (complaint = {}) =>
  Array.isArray(complaint.comments) ? complaint.comments.length : 0;

const getFileCount = (complaint = {}) =>
  Array.isArray(complaint.files) ? complaint.files.length : 0;

const QcItemComplaintsSection = ({ enabled = true, itemCode = "" }) => {
  const normalizedItemCode = String(itemCode || "").trim();
  const [complaints, setComplaints] = useState([]);
  const [expandedId, setExpandedId] = useState("");
  const [commentDrafts, setCommentDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [markingReadId, setMarkingReadId] = useState("");
  const [error, setError] = useState("");

  const unreadTotal = useMemo(
    () =>
      complaints.reduce(
        (total, complaint) => total + Number(complaint?.unread_count || 0),
        0,
      ),
    [complaints],
  );

  const replaceComplaint = useCallback((updatedComplaint) => {
    if (!updatedComplaint?._id) return;
    setComplaints((prev) =>
      prev.map((complaint) =>
        complaint._id === updatedComplaint._id ? updatedComplaint : complaint,
      ),
    );
  }, []);

  const loadComplaints = useCallback(async () => {
    if (!enabled || !normalizedItemCode) {
      setComplaints([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await getItemRelatedComplaints(normalizedItemCode);
      setComplaints(Array.isArray(response?.data?.data) ? response.data.data : []);
    } catch (loadError) {
      setComplaints([]);
      setError(loadError?.response?.data?.message || "Failed to load item complains.");
    } finally {
      setLoading(false);
    }
  }, [enabled, normalizedItemCode]);

  useEffect(() => {
    loadComplaints();
  }, [loadComplaints]);

  const handleToggleComplaint = async (complaint) => {
    const complaintId = complaint?._id || "";
    const isOpening = expandedId !== complaintId;
    setExpandedId(isOpening ? complaintId : "");

    if (!isOpening || !complaintId || Number(complaint?.unread_count || 0) <= 0) {
      return;
    }

    try {
      setMarkingReadId(complaintId);
      const response = await markComplaintRead(complaintId, {
        item_code: normalizedItemCode,
      });
      replaceComplaint(response?.data?.data);
    } catch {
      setComplaints((prev) =>
        prev.map((entry) =>
          entry._id === complaintId
            ? { ...entry, unread_count: 0, has_unread: false }
            : entry,
        ),
      );
    } finally {
      setMarkingReadId("");
    }
  };

  const handleDraftChange = (complaintId, value) => {
    setCommentDrafts((prev) => ({ ...prev, [complaintId]: value }));
  };

  const handleAddComment = async (event, complaint) => {
    event.preventDefault();
    const complaintId = complaint?._id || "";
    const comment = String(commentDrafts[complaintId] || "").trim();
    if (!complaintId || !comment) return;

    try {
      setSavingId(complaintId);
      setError("");
      const response = await addQcComplaintComment(complaintId, {
        item_code: normalizedItemCode,
        comment,
      });
      replaceComplaint(response?.data?.data);
      setCommentDrafts((prev) => ({ ...prev, [complaintId]: "" }));
    } catch (commentError) {
      setError(commentError?.response?.data?.message || "Failed to add complain comment.");
    } finally {
      setSavingId("");
    }
  };

  if (!enabled) return null;

  return (
    <section className="qc-complaints-section">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          <h3 className="h6 mb-0">Complains</h3>
          {unreadTotal > 0 && (
            <span className="qc-complaints-unread-badge" title={`${unreadTotal} unread complain update${unreadTotal === 1 ? "" : "s"}`}>
              {unreadTotal}
            </span>
          )}
        </div>
        <span className="small text-secondary">
          {complaints.length} related complain{complaints.length === 1 ? "" : "s"}
        </span>
      </div>

      {!normalizedItemCode ? (
        <div className="small text-muted">No item code available for complain lookup.</div>
      ) : loading ? (
        <div className="small text-muted">Loading complains...</div>
      ) : error && complaints.length === 0 ? (
        <div className="alert alert-danger py-2 mb-0">{error}</div>
      ) : complaints.length === 0 ? (
        <div className="small text-muted">No active complains found for this item.</div>
      ) : (
        <div className="qc-complaints-accordion">
          {error && <div className="alert alert-danger py-2 mb-2">{error}</div>}
          {complaints.map((complaint) => {
            const isExpanded = expandedId === complaint._id;
            const unreadCount = Number(complaint?.unread_count || 0);
            const isSaving = savingId === complaint._id;
            const isMarkingRead = markingReadId === complaint._id;

            return (
              <article className="qc-complaint-item" key={complaint._id}>
                <button
                  type="button"
                  className="qc-complaint-toggle"
                  onClick={() => handleToggleComplaint(complaint)}
                  aria-expanded={isExpanded}
                >
                  <span className="qc-complaint-toggle-main">
                    <span className="fw-semibold">
                      {complaint.complaint_no || "Complain"}
                    </span>
                    <span className="small text-secondary">
                      {complaint.category || "Uncategorized"} | {getCommentCount(complaint)} comment{getCommentCount(complaint) === 1 ? "" : "s"} | {getFileCount(complaint)} file{getFileCount(complaint) === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="qc-complaint-toggle-meta">
                    {unreadCount > 0 && (
                      <span className="qc-complaints-unread-badge qc-complaints-unread-badge--small">
                        {unreadCount}
                      </span>
                    )}
                    <span className="small text-secondary">
                      {isMarkingRead ? "Marking read..." : formatComplaintDateTime(complaint.updated_at)}
                    </span>
                  </span>
                </button>

                {isExpanded && (
                  <div className="qc-complaint-panel">
                    <div className="complaint-details-grid">
                      <div>
                        <div className="small text-secondary">Brand</div>
                        <div>{complaint.brand || "N/A"}</div>
                      </div>
                      <div>
                        <div className="small text-secondary">Vendor</div>
                        <div>{complaint.vendor || "N/A"}</div>
                      </div>
                      <div>
                        <div className="small text-secondary">PO</div>
                        <div>{complaint.po || "N/A"}</div>
                      </div>
                      <div>
                        <div className="small text-secondary">Created</div>
                        <div>{formatComplaintDateTime(complaint.created_at)}</div>
                      </div>
                    </div>

                    <div className="complaint-detail-section">
                      <h4 className="h6 mb-2">Comments</h4>
                      {getCommentCount(complaint) === 0 ? (
                        <div className="text-secondary small">No comments added.</div>
                      ) : (
                        <div className="complaint-timeline">
                          {complaint.comments.map((entry, index) => (
                            <div className="complaint-timeline-entry" key={entry._id || `qc-comment-${index}`}>
                              <div>{entry.comment}</div>
                              <div className="small text-secondary">
                                {entry.created_by?.name || "Unknown"} | {formatComplaintDateTime(entry.created_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="complaint-detail-section">
                      <h4 className="h6 mb-2">Files</h4>
                      <ComplaintFilesDropdown files={complaint.files} />
                    </div>

                    <form
                      className="qc-complaint-comment-form"
                      onSubmit={(event) => handleAddComment(event, complaint)}
                    >
                      <label className="form-label">Add Comment</label>
                      <textarea
                        className="form-control"
                        rows="3"
                        value={commentDrafts[complaint._id] || ""}
                        onChange={(event) => handleDraftChange(complaint._id, event.target.value)}
                        placeholder="Write a complain comment"
                        disabled={isSaving}
                      />
                      <div className="d-flex justify-content-end mt-2">
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={isSaving || !String(commentDrafts[complaint._id] || "").trim()}
                        >
                          {isSaving ? "Adding..." : "Add Comment"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default QcItemComplaintsSection;
