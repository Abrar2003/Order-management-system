import { useEffect, useMemo, useState } from "react";
import { getUserFromToken } from "../../auth/auth.service";
import {
  addWorkflowTaskComment,
  approveWorkflowTask,
  assignWorkflowTask,
  getWorkflowTaskById,
  reviewWorkflowTask,
  sendWorkflowTaskToRework,
  startWorkflowTask,
  submitWorkflowTask,
} from "../../api/workflowApi";
import { formatBytes } from "../../utils/workflowManifest";

const normalizeText = (value) => String(value ?? "").trim();

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

const getAuditActorName = (actor = {}) =>
  actor?.name || actor?.user?.name || actor?.user?.email || "N/A";

const getUserId = (entry = {}) =>
  entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || "";

const WorkflowTaskDetailModal = ({
  taskId,
  availableUsers = [],
  canManageWorkflow = false,
  canAssignWorkflow = false,
  canApproveWorkflow = false,
  onClose,
  onUpdated,
}) => {
  const currentUser = getUserFromToken();
  const currentUserId = currentUser?._id || currentUser?.id || "";

  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [openPanel, setOpenPanel] = useState("");
  const [assignIds, setAssignIds] = useState([]);
  const [assignNote, setAssignNote] = useState("");
  const [managerNote, setManagerNote] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentType, setCommentType] = useState("general");

  const loadTask = async ({ keepMessages = false } = {}) => {
    if (!taskId) return;
    setLoading(true);
    if (!keepMessages) {
      setError("");
      setActionError("");
      setActionSuccess("");
    }
    try {
      const response = await getWorkflowTaskById(taskId);
      const nextTask = response?.data || null;
      setTask(nextTask);
      setAssignIds(
        Array.isArray(nextTask?.assigned_to)
          ? nextTask.assigned_to.map((entry) => getUserId(entry)).filter(Boolean)
          : [],
      );
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to fetch workflow task.",
      );
      setTask(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTask();
  }, [taskId]);

  const assignedUsers = useMemo(
    () =>
      Array.isArray(task?.assigned_to)
        ? task.assigned_to.map((entry) => entry?.user || entry).filter(Boolean)
        : [],
    [task?.assigned_to],
  );

  const isAssignedUser = useMemo(
    () =>
      assignedUsers.some((user) => {
        const userId = user?._id || user?.id || user;
        return String(userId) === String(currentUserId);
      }),
    [assignedUsers, currentUserId],
  );

  const canStart = isAssignedUser && ["assigned", "rework"].includes(task?.status);
  const canSubmit = isAssignedUser && ["assigned", "in_progress", "rework"].includes(task?.status);
  const canMoveToReview = canApproveWorkflow && task?.status === "submitted";
  const canApprove = canApproveWorkflow && ["submitted", "review"].includes(task?.status);
  const canRework = canApproveWorkflow && ["submitted", "review"].includes(task?.status);
  const canAssign = canAssignWorkflow && !["completed", "cancelled"].includes(task?.status);
  const canComment = Boolean(task?._id);

  const handleTaskAction = async (action, message) => {
    setActionLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      await action();
      await loadTask({ keepMessages: true });
      setActionSuccess(message);
      setManagerNote("");
      setAssignNote("");
      onUpdated?.();
    } catch (submitError) {
      setActionError(
        submitError?.response?.data?.message
          || submitError?.message
          || "Task update failed.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const toggleAssignId = (userId) => {
    setAssignIds((prev) =>
      prev.includes(userId)
        ? prev.filter((entry) => entry !== userId)
        : [...prev, userId],
    );
  };

  const handleSaveAssignments = async () => {
    await handleTaskAction(
      () =>
        assignWorkflowTask(taskId, {
          assignee_ids: assignIds,
          note: normalizeText(assignNote),
        }),
      "Task assignment updated successfully.",
    );
  };

  const handleAddComment = async () => {
    if (!normalizeText(commentText)) {
      setActionError("Comment is required.");
      return;
    }

    await handleTaskAction(
      () =>
        addWorkflowTaskComment(taskId, {
          comment: normalizeText(commentText),
          comment_type: commentType,
        }),
      "Comment added successfully.",
    );
    setCommentText("");
    setCommentType("general");
  };

  return (
    <div
      className="modal d-block om-modal-backdrop"
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-xl workflow-modal-dialog"
        role="document"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">Workflow Task Detail</h5>
              <div className="small text-muted">
                View source references, comments, history, and available workflow actions.
              </div>
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
            />
          </div>

          <div className="modal-body">
            {loading ? (
              <div className="text-center py-5 text-secondary">Loading workflow task...</div>
            ) : error ? (
              <div className="alert alert-danger mb-0">{error}</div>
            ) : !task ? (
              <div className="alert alert-secondary mb-0">Workflow task not found.</div>
            ) : (
              <>
                {actionError && <div className="alert alert-danger">{actionError}</div>}
                {actionSuccess && <div className="alert alert-success">{actionSuccess}</div>}

                <div className="d-flex flex-wrap justify-content-between gap-2 mb-3">
                  <div>
                    <h5 className="mb-1">{task.title}</h5>
                    <div className="small text-secondary">
                      {task.task_no} • {task.task_type_name || task.task_type?.name || task.task_type_key}
                    </div>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    <span className="om-summary-chip">Status: {task.status}</span>
                    <span className="om-summary-chip">
                      Rework Count: {Number(task.rework_count || 0)}
                    </span>
                    <span className="om-summary-chip">
                      Source Files: {Array.isArray(task.source_files) ? task.source_files.length : 0}
                    </span>
                  </div>
                </div>

                <section className="card om-card mb-3">
                  <div className="card-body">
                    <div className="row g-3">
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Batch</div>
                        <div className="fw-semibold">
                          {task.batch?.batch_no || "—"} {task.batch?.name ? `• ${task.batch.name}` : ""}
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Brand</div>
                        <div className="fw-semibold">{task.brand || "—"}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Department</div>
                        <div className="fw-semibold">{task.department?.name || "—"}</div>
                      </div>
                      <div className="col-md-6">
                        <div className="small text-secondary mb-1">Source Folder</div>
                        <div className="fw-semibold">{task.source_folder_name || "—"}</div>
                      </div>
                      <div className="col-md-6">
                        <div className="small text-secondary mb-1">Source Folder Path</div>
                        <div className="fw-semibold">{task.source_folder_path || "—"}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Assigned Users</div>
                        <div className="fw-semibold">
                          {assignedUsers.length > 0
                            ? assignedUsers.map((user) => user?.name || user?.email || "User").join(", ")
                            : "Unassigned"}
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Due Date</div>
                        <div className="fw-semibold">{formatDateTime(task.due_date)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Created By</div>
                        <div className="fw-semibold">
                          {getAuditActorName(task.created_by)}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="card om-card mb-3">
                  <div className="card-body">
                    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                      <div>
                        <h6 className="mb-1">Actions</h6>
                        <div className="small text-secondary">
                          Buttons only appear when the current user can perform them.
                        </div>
                      </div>
                      <div className="d-flex flex-wrap gap-2">
                        {canStart && (
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            disabled={actionLoading}
                            onClick={() =>
                              handleTaskAction(
                                () => startWorkflowTask(taskId),
                                "Task moved to in progress.",
                              )
                            }
                          >
                            Start Work
                          </button>
                        )}
                        {canSubmit && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={actionLoading}
                            onClick={() =>
                              handleTaskAction(
                                () => submitWorkflowTask(taskId),
                                "Task submitted for review.",
                              )
                            }
                          >
                            Mark as Done / Submit for Review
                          </button>
                        )}
                        {canMoveToReview && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            disabled={actionLoading}
                            onClick={() => setOpenPanel((prev) => (prev === "review" ? "" : "review"))}
                          >
                            Move to Review
                          </button>
                        )}
                        {canApprove && (
                          <button
                            type="button"
                            className="btn btn-success btn-sm"
                            disabled={actionLoading}
                            onClick={() => setOpenPanel((prev) => (prev === "approve" ? "" : "approve"))}
                          >
                            Approve
                          </button>
                        )}
                        {canRework && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            disabled={actionLoading}
                            onClick={() => setOpenPanel((prev) => (prev === "rework" ? "" : "rework"))}
                          >
                            Send to Rework
                          </button>
                        )}
                        {canAssign && (
                          <button
                            type="button"
                            className="btn btn-outline-dark btn-sm"
                            disabled={actionLoading}
                            onClick={() => setOpenPanel((prev) => (prev === "assign" ? "" : "assign"))}
                          >
                            Assign / Reassign
                          </button>
                        )}
                        {canComment && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            disabled={actionLoading}
                            onClick={() => setOpenPanel((prev) => (prev === "comment" ? "" : "comment"))}
                          >
                            Add Comment
                          </button>
                        )}
                      </div>
                    </div>

                    {openPanel === "assign" && (
                      <div className="workflow-action-panel">
                        <div className="row g-3">
                          <div className="col-12">
                            <label className="form-label">Assignees</label>
                            {availableUsers.length === 0 ? (
                              <div className="alert alert-secondary mb-0 py-2">
                                No user options available for assignment.
                              </div>
                            ) : (
                              <div className="workflow-user-picker">
                                {availableUsers.map((user) => {
                                  const userId = user?._id || user?.id;
                                  const checked = assignIds.includes(userId);
                                  return (
                                    <label
                                      key={userId}
                                      className="form-check d-flex align-items-center gap-2 mb-0"
                                    >
                                      <input
                                        type="checkbox"
                                        className="form-check-input mt-0"
                                        checked={checked}
                                        onChange={() => toggleAssignId(userId)}
                                      />
                                      <span>
                                        {user?.name || user?.username || "User"}{" "}
                                        <span className="small text-secondary">
                                          ({user?.role || "user"})
                                        </span>
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className="col-12">
                            <label className="form-label">Note</label>
                            <textarea
                              rows="2"
                              className="form-control"
                              value={assignNote}
                              onChange={(event) => setAssignNote(event.target.value)}
                            />
                          </div>
                          <div className="col-12 d-flex justify-content-end">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={actionLoading}
                              onClick={handleSaveAssignments}
                            >
                              {actionLoading ? "Saving..." : "Save Assignment"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {openPanel === "comment" && (
                      <div className="workflow-action-panel">
                        <div className="row g-3">
                          <div className="col-md-4">
                            <label className="form-label">Comment Type</label>
                            <select
                              className="form-select"
                              value={commentType}
                              onChange={(event) => setCommentType(event.target.value)}
                            >
                              <option value="general">General</option>
                              <option value="review">Review</option>
                              <option value="rework">Rework</option>
                              <option value="system">System</option>
                            </select>
                          </div>
                          <div className="col-12">
                            <label className="form-label">Comment</label>
                            <textarea
                              rows="3"
                              className="form-control"
                              value={commentText}
                              onChange={(event) => setCommentText(event.target.value)}
                            />
                          </div>
                          <div className="col-12 d-flex justify-content-end">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={actionLoading}
                              onClick={handleAddComment}
                            >
                              {actionLoading ? "Saving..." : "Add Comment"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {openPanel === "review" && (
                      <div className="workflow-action-panel">
                        <div className="row g-3">
                          <div className="col-12">
                            <label className="form-label">Review Note</label>
                            <textarea
                              rows="3"
                              className="form-control"
                              value={managerNote}
                              onChange={(event) => setManagerNote(event.target.value)}
                            />
                          </div>
                          <div className="col-12 d-flex justify-content-end">
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              disabled={actionLoading}
                              onClick={() =>
                                handleTaskAction(
                                  () => reviewWorkflowTask(taskId, { note: normalizeText(managerNote) }),
                                  "Task moved to review.",
                                )
                              }
                            >
                              {actionLoading ? "Saving..." : "Confirm Review"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {openPanel === "approve" && (
                      <div className="workflow-action-panel">
                        <div className="row g-3">
                          <div className="col-12">
                            <label className="form-label">Approval Note</label>
                            <textarea
                              rows="3"
                              className="form-control"
                              value={managerNote}
                              onChange={(event) => setManagerNote(event.target.value)}
                            />
                          </div>
                          <div className="col-12 d-flex justify-content-end">
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              disabled={actionLoading}
                              onClick={() =>
                                handleTaskAction(
                                  () => approveWorkflowTask(taskId, { note: normalizeText(managerNote) }),
                                  "Task approved successfully.",
                                )
                              }
                            >
                              {actionLoading ? "Saving..." : "Confirm Approval"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {openPanel === "rework" && (
                      <div className="workflow-action-panel">
                        <div className="row g-3">
                          <div className="col-12">
                            <label className="form-label">Rework Reason</label>
                            <textarea
                              rows="3"
                              className="form-control"
                              value={managerNote}
                              onChange={(event) => setManagerNote(event.target.value)}
                            />
                          </div>
                          <div className="col-12 d-flex justify-content-end">
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={actionLoading}
                              onClick={() =>
                                handleTaskAction(
                                  () =>
                                    sendWorkflowTaskToRework(taskId, {
                                      note: normalizeText(managerNote),
                                    }),
                                  "Task sent to rework.",
                                )
                              }
                            >
                              {actionLoading ? "Saving..." : "Confirm Rework"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <div className="row g-3">
                  <div className="col-lg-7">
                    <section className="card om-card mb-3">
                      <div className="card-body">
                        <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
                          <div>
                            <h6 className="mb-1">Source File References</h6>
                            <div className="small text-secondary">
                              Metadata only. Files are not stored in OMS.
                            </div>
                          </div>
                          <span className="om-summary-chip">
                            {Array.isArray(task.source_files) ? task.source_files.length : 0} files
                          </span>
                        </div>
                        <div className="table-responsive">
                          <table className="table table-sm align-middle mb-0">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Relative Path</th>
                                <th>File Type</th>
                                <th>Size</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(Array.isArray(task.source_files) ? task.source_files : []).map((entry) => (
                                <tr key={entry.relative_path}>
                                  <td>{entry.name}</td>
                                  <td>{entry.relative_path}</td>
                                  <td>{entry.file_type || entry.mime_type || "other"}</td>
                                  <td>{formatBytes(entry.size_bytes)}</td>
                                </tr>
                              ))}
                              {(!Array.isArray(task.source_files) || task.source_files.length === 0) && (
                                <tr>
                                  <td colSpan="4" className="text-center text-secondary">
                                    No source file references stored on this task.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </section>

                    <section className="card om-card">
                      <div className="card-body">
                        <h6 className="mb-3">Comments</h6>
                        {Array.isArray(task.comments) && task.comments.length > 0 ? (
                          <div className="d-grid gap-2">
                            {task.comments.map((comment) => (
                              <div key={comment._id} className="workflow-comment-card">
                                <div className="d-flex flex-wrap justify-content-between gap-2 mb-1">
                                  <div className="fw-semibold">
                                    {getAuditActorName(comment.created_by)}
                                  </div>
                                  <div className="small text-secondary">
                                    {formatDateTime(comment.createdAt || comment.created_at)}
                                  </div>
                                </div>
                                <div className="small text-secondary text-uppercase mb-1">
                                  {comment.comment_type || "general"}
                                </div>
                                <div>{comment.comment}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-secondary">No comments yet.</div>
                        )}
                      </div>
                    </section>
                  </div>

                  <div className="col-lg-5">
                    <section className="card om-card mb-3">
                      <div className="card-body">
                        <h6 className="mb-3">Assignment History</h6>
                        {Array.isArray(task.assignments) && task.assignments.length > 0 ? (
                          <div className="d-grid gap-2">
                            {task.assignments.map((assignment) => (
                              <div key={assignment._id} className="workflow-comment-card">
                                <div className="fw-semibold mb-1">
                                  {assignment.assignee?.name || assignment.assignee?.email || "User"}
                                </div>
                                <div className="small text-secondary">
                                  Status: {assignment.status}
                                </div>
                                <div className="small text-secondary">
                                  Assigned: {formatDateTime(assignment.assigned_at)}
                                </div>
                                {assignment.note && (
                                  <div className="small mt-1">{assignment.note}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-secondary">No assignment history yet.</div>
                        )}
                      </div>
                    </section>

                    <section className="card om-card">
                      <div className="card-body">
                        <h6 className="mb-3">Status History</h6>
                        {Array.isArray(task.status_history) && task.status_history.length > 0 ? (
                          <div className="d-grid gap-2">
                            {task.status_history.map((history) => (
                              <div key={history._id} className="workflow-comment-card">
                                <div className="d-flex flex-wrap justify-content-between gap-2 mb-1">
                                  <div className="fw-semibold">
                                    {(history.from_status || "created").replace(/_/g, " ")} →{" "}
                                    {(history.to_status || "—").replace(/_/g, " ")}
                                  </div>
                                  <div className="small text-secondary">
                                    {formatDateTime(history.changed_at || history.createdAt)}
                                  </div>
                                </div>
                                <div className="small text-secondary mb-1">
                                  By {getAuditActorName(history.changed_by)}
                                </div>
                                {history.note && <div className="small">{history.note}</div>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-secondary">No status history yet.</div>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </>
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

export default WorkflowTaskDetailModal;
