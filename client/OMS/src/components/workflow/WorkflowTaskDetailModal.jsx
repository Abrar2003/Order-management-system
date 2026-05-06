import { useEffect, useMemo, useState } from "react";
import { getUserFromToken } from "../../auth/auth.service";
import {
  addWorkflowTaskComment,
  approveWorkflowTask,
  assignWorkflowTask,
  completeWorkflowTask,
  deleteWorkflowTask,
  getWorkflowTaskById,
  sendWorkflowTaskToRework,
  uploadWorkflowTask,
} from "../../api/workflowApi";
import { formatBytes } from "../../utils/workflowManifest";
import WorkflowTaskStageBar from "./WorkflowTaskStageBar";
import { formatWorkflowStageLabel } from "./workflowTaskProgress";

const normalizeText = (value) => String(value ?? "").trim();

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

const formatDateOnly = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
};

const getAuditActorName = (actor = {}) =>
  actor?.name || actor?.user?.name || actor?.user?.email || "N/A";

const getUserId = (entry = {}) =>
  entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || "";

const getUserLabel = (entry = {}) =>
  entry?.name || entry?.email || entry?.user?.name || entry?.user?.email || "User";

const WorkflowTaskDetailModal = ({
  taskId,
  availableUsers = [],
  canManageWorkflow = false,
  canAssignWorkflow = false,
  canApproveWorkflow = false,
  canDeleteWorkflow = false,
  onClose,
  onDeleted,
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
  const [notePrompt, setNotePrompt] = useState({ type: "", note: "" });
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

  const canComplete = isAssignedUser && task?.status === "assigned";
  const canApprove = canApproveWorkflow && !isAssignedUser && task?.status === "complete";
  const canUpload =
    (isAssignedUser || canManageWorkflow || canApproveWorkflow) && task?.status === "approved";
  const canRework =
    canManageWorkflow && ["complete", "approved", "uploaded"].includes(task?.status);
  const canAssign = canAssignWorkflow && task?.status !== "uploaded";
  const canDelete = canDeleteWorkflow && Boolean(task?._id);
  const canComment = Boolean(task?._id);

  const handleTaskAction = async (action, message) => {
    setActionLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      await action();
      await loadTask({ keepMessages: true });
      setActionSuccess(message);
      setAssignNote("");
      setNotePrompt({ type: "", note: "" });
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
    if (!Array.isArray(assignIds) || assignIds.length === 0) {
      setActionError("At least one assignee is required.");
      return;
    }

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

  const handleStageBarClick = async (stepKey) => {
    if (stepKey === "complete" && canComplete) {
      setActionError("");
      setActionSuccess("");
      setOpenPanel("");
      setNotePrompt({ type: "complete", note: "" });
      return;
    }

    if (stepKey === "approved" && canApprove) {
      await handleTaskAction(
        () => approveWorkflowTask(taskId, { note: "" }),
        "Task approved successfully.",
      );
      return;
    }

    if (stepKey === "uploaded" && canUpload) {
      await handleTaskAction(
        () => uploadWorkflowTask(taskId),
        "Task marked uploaded successfully.",
      );
    }
  };

  const handleConfirmNote = async () => {
    const normalizedNote = normalizeText(notePrompt.note);
    if (notePrompt.type === "rework" && !normalizedNote) {
      setActionError("Rework reason is required.");
      return;
    }

    if (notePrompt.type === "complete") {
      await handleTaskAction(
        () => completeWorkflowTask(taskId, { note: normalizedNote }),
        "Task marked complete successfully.",
      );
      return;
    }

    await handleTaskAction(
      () => sendWorkflowTaskToRework(taskId, { note: normalizedNote }),
      "Task sent to rework.",
    );
  };

  const handleDeleteTask = async () => {
    if (!task?._id) return;

    const confirmed = window.confirm(
      `Delete workflow task ${task?.task_no || task?.title || "this task"}?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Optional delete note") || "";
    setActionLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      await deleteWorkflowTask(task._id, {
        note: normalizeText(reason),
      });
      onDeleted?.(task);
    } catch (deleteError) {
      setActionError(
        deleteError?.response?.data?.message
          || deleteError?.message
          || "Failed to delete workflow task.",
      );
    } finally {
      setActionLoading(false);
    }
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
                View task history, comments, assignments, and quick workflow actions.
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
                    <span className="om-summary-chip">
                      Status: {formatWorkflowStageLabel(task.status)}
                    </span>
                    <span className="om-summary-chip">
                      Reworks: {Number(task?.reworked?.count || task?.rework_count || 0)}
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
                        <div className="small text-secondary mb-1">Task No</div>
                        <div className="fw-semibold">{task.task_no || "—"}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Brand</div>
                        <div className="fw-semibold">{task.brand || "—"}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Department</div>
                        <div className="fw-semibold">{task.department?.name || "—"}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Assigned Users</div>
                        <div className="fw-semibold">
                          {assignedUsers.length > 0
                            ? assignedUsers.map((user) => getUserLabel(user)).join(", ")
                            : "Unassigned"}
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Due Date</div>
                        <div className="fw-semibold">{formatDateOnly(task.due_date)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Created By</div>
                        <div className="fw-semibold">{getAuditActorName(task.created_by)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Assigned At</div>
                        <div className="fw-semibold">{formatDateTime(task.assigned_at)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Complete At</div>
                        <div className="fw-semibold">{formatDateTime(task.completed_at)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Approved At</div>
                        <div className="fw-semibold">{formatDateTime(task.approved_at)}</div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="card om-card mb-3">
                  <div className="card-body">
                    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                      <div>
                        <h6 className="mb-1">Progress & Actions</h6>
                        <div className="small text-secondary">
                          Use the lean status line for quick updates. Complete and rework both accept notes.
                        </div>
                      </div>
                      <div className="d-flex flex-wrap gap-2">
                        {canAssign && (
                          <button
                            type="button"
                            className="btn btn-outline-dark btn-sm"
                            disabled={actionLoading}
                            onClick={() => {
                              setNotePrompt({ type: "", note: "" });
                              setOpenPanel((prev) => (prev === "assign" ? "" : "assign"));
                            }}
                          >
                            Assign / Reassign
                          </button>
                        )}
                        {canComment && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            disabled={actionLoading}
                            onClick={() => {
                              setNotePrompt({ type: "", note: "" });
                              setOpenPanel((prev) => (prev === "comment" ? "" : "comment"));
                            }}
                          >
                            Add Comment
                          </button>
                        )}
                        {canRework && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            disabled={actionLoading}
                            onClick={() => {
                              setActionError("");
                              setActionSuccess("");
                              setOpenPanel("");
                              setNotePrompt({ type: "rework", note: "" });
                            }}
                          >
                            Rework
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={actionLoading}
                            onClick={handleDeleteTask}
                          >
                            Delete Task
                          </button>
                        )}
                      </div>
                    </div>

                    <WorkflowTaskStageBar
                      task={task}
                      className="mb-3"
                      disabled={actionLoading}
                      isStepClickable={(stepKey) =>
                        (stepKey === "complete" && canComplete)
                        || (stepKey === "approved" && canApprove)
                        || (stepKey === "uploaded" && canUpload)
                      }
                      onStepClick={handleStageBarClick}
                    />

                    {notePrompt.type && (
                      <div className="workflow-stage-popover mb-3">
                        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                          <div>
                            <div className="fw-semibold">
                              {notePrompt.type === "complete" ? "Mark Complete" : "Send to Rework"}
                            </div>
                            <div className="small text-secondary">
                              {notePrompt.type === "complete"
                                ? "Add an optional completion note before moving the task ahead."
                                : "Add the required remark, then the task goes back for fixes."}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setNotePrompt({ type: "", note: "" })}
                            disabled={actionLoading}
                          >
                            Close
                          </button>
                        </div>
                        <label className="form-label">
                          {notePrompt.type === "complete" ? "Completion Comment" : "Rework Reason"}
                        </label>
                        <textarea
                          rows="3"
                          className="form-control"
                          placeholder={
                            notePrompt.type === "complete"
                              ? "Add a short completion note"
                              : "Explain what needs to be fixed"
                          }
                          value={notePrompt.note}
                          onChange={(event) =>
                            setNotePrompt((prev) => ({ ...prev, note: event.target.value }))
                          }
                        />
                        <div className="d-flex justify-content-end mt-3">
                          <button
                            type="button"
                            className={`btn btn-sm ${notePrompt.type === "complete" ? "btn-primary" : "btn-danger"}`}
                            disabled={actionLoading}
                            onClick={handleConfirmNote}
                          >
                            {actionLoading
                              ? "Saving..."
                              : notePrompt.type === "complete"
                              ? "Save Complete"
                              : "Confirm Rework"}
                          </button>
                        </div>
                      </div>
                    )}

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
                              <option value="complete">Complete</option>
                              <option value="approval">Approval</option>
                              <option value="upload">Upload</option>
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
                        <div className="d-grid gap-3">
                          {(Array.isArray(task.comments) ? task.comments : []).map((entry) => (
                            <div key={entry._id} className="workflow-comment-card">
                              <div className="d-flex flex-wrap justify-content-between gap-2">
                                <div className="fw-semibold">{entry.comment}</div>
                                <span className="om-summary-chip">
                                  {formatWorkflowStageLabel(entry.comment_type || "general")}
                                </span>
                              </div>
                              <div className="small text-secondary mt-2">
                                {getAuditActorName(entry.created_by)} • {formatDateTime(entry.createdAt)}
                              </div>
                            </div>
                          ))}
                          {(!Array.isArray(task.comments) || task.comments.length === 0) && (
                            <div className="text-secondary">No comments on this task yet.</div>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className="col-lg-5">
                    <section className="card om-card mb-3">
                      <div className="card-body">
                        <h6 className="mb-3">Assignment History</h6>
                        <div className="d-grid gap-3">
                          {(Array.isArray(task.assignments) ? task.assignments : []).map((entry) => (
                            <div key={entry._id} className="workflow-member-card">
                              <div className="fw-semibold">{getUserLabel(entry.assignee || {})}</div>
                              <div className="small text-secondary mt-1">
                                {entry.status} • Assigned {formatDateTime(entry.assigned_at)}
                              </div>
                              <div className="small text-secondary mt-1">
                                {normalizeText(entry.note) || "—"}
                              </div>
                            </div>
                          ))}
                          {(!Array.isArray(task.assignments) || task.assignments.length === 0) && (
                            <div className="text-secondary">No assignment history found.</div>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="card om-card">
                      <div className="card-body">
                        <h6 className="mb-3">Status History</h6>
                        <div className="d-grid gap-3">
                          {(Array.isArray(task.status_history) ? task.status_history : []).map((entry) => (
                            <div key={entry._id} className="workflow-member-card">
                              <div className="fw-semibold">
                                {formatWorkflowStageLabel(entry.from_status || "assigned")} {"->"}{" "}
                                {formatWorkflowStageLabel(entry.to_status)}
                              </div>
                              <div className="small text-secondary mt-1">
                                {getAuditActorName(entry.changed_by)} • {formatDateTime(entry.changed_at)}
                              </div>
                              <div className="small text-secondary mt-1">
                                {normalizeText(entry.note) || "—"}
                              </div>
                            </div>
                          ))}
                          {(!Array.isArray(task.status_history) || task.status_history.length === 0) && (
                            <div className="text-secondary">No status history found.</div>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowTaskDetailModal;
