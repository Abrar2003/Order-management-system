import { useCallback, useEffect, useMemo, useState } from "react";
import { getUserFromToken } from "../../auth/auth.service";
import {
  addWorkflowTaskComment,
  approveWorkflowTask,
  assignWorkflowTask,
  completeWorkflowTask,
  deleteWorkflowTask,
  getWorkflowTaskById,
  sendWorkflowTaskToRework,
  startWorkflowTask,
  updateWorkflowTask,
  uploadWorkflowTask,
} from "../../api/workflowApi";
import useWorkflowRealtime from "../../hooks/useWorkflowRealtime";
import { formatDateOnlyIST, formatDateTimeIST, toISODateString } from "../../utils/date";
import { formatBytes } from "../../utils/workflowManifest";
import WorkflowTaskStageBar from "./WorkflowTaskStageBar";
import {
  formatWorkflowStageLabel,
  isWorkflowUploadStepKey,
} from "./workflowTaskProgress";

const normalizeText = (value) => String(value ?? "").trim();
const uniqueIds = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];

const formatDateTime = (value) => formatDateTimeIST(value);

const formatDateOnly = (value) => formatDateOnlyIST(value);

const formatOrdinal = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "Due Date";
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th Due Date`;
  const mod10 = number % 10;
  if (mod10 === 1) return `${number}st Due Date`;
  if (mod10 === 2) return `${number}nd Due Date`;
  if (mod10 === 3) return `${number}rd Due Date`;
  return `${number}th Due Date`;
};

const getAuditActorName = (actor = {}) =>
  actor?.name || actor?.user?.name || actor?.user?.email || "N/A";

const getUserId = (entry = {}) =>
  entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || "";

const getUserLabel = (entry = {}) =>
  entry?.name || entry?.email || entry?.user?.name || entry?.user?.email || "User";

const hasUploadAssignees = (task = {}) =>
  Array.isArray(task?.upload_assignees) && task.upload_assignees.length > 0;

const isUploadAssignedToUser = (task = {}, userId = "") =>
  hasUploadAssignees(task) &&
  task.upload_assignees.some((entry) => String(getUserId(entry)) === String(userId));

const getUploadUserIdFromStepKey = (stepKey = "") =>
  isWorkflowUploadStepKey(stepKey)
    ? stepKey.split(":").slice(1).join(":")
    : "";

const isUploadStepPending = (task = {}, stepKey = "") => {
  if (stepKey === "uploaded") {
    return !(Array.isArray(task?.upload_statuses) ? task.upload_statuses : []).some(
      (entry) => normalizeText(entry?.status).toLowerCase() === "uploaded",
    );
  }

  const uploadUserId = getUploadUserIdFromStepKey(stepKey);
  if (!uploadUserId) return false;
  return (Array.isArray(task?.upload_statuses) ? task.upload_statuses : []).some(
    (entry) =>
      String(getUserId(entry)) === String(uploadUserId) &&
      normalizeText(entry?.status).toLowerCase() !== "uploaded",
  );
};

const formatDateInputValue = (value) => {
  return toISODateString(value);
};

const getEditableDueDateValue = (task = {}) =>
  formatDateInputValue(task?.active_due_date || task?.due_date);

const buildTaskEditForm = (task = {}) => ({
  title: normalizeText(task?.title),
  description: normalizeText(task?.description),
  brand: normalizeText(task?.brand),
  department: task?.department?._id || task?.department || "",
  priority: normalizeText(task?.priority || "normal"),
  assignmentDate: formatDateInputValue(task?.assigned_at),
  dueDate: getEditableDueDateValue(task),
  uploadRequired: task?.upload_required !== false,
  uploadAssigneeIds: Array.isArray(task?.upload_assignees)
    ? task.upload_assignees.map((entry) => getUserId(entry)).filter(Boolean)
    : [],
});

const WorkflowTaskDetailModal = ({
  taskId,
  availableUsers = [],
  departments = [],
  brandOptions = [],
  canManageWorkflow = false,
  canAssignWorkflow = false,
  canEditTaskDetails = false,
  canEditAnyTaskDetails = false,
  canDeleteWorkflow = false,
  canDeleteOwnTask = false,
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
  const [notePrompt, setNotePrompt] = useState({ type: "", note: "", dueDate: "" });
  const [commentText, setCommentText] = useState("");
  const [commentType, setCommentType] = useState("general");
  const [editForm, setEditForm] = useState(() => buildTaskEditForm());
  const [dueDateNote, setDueDateNote] = useState("");
  const availableBrandOptions = useMemo(
    () =>
      [
        ...new Set(
          [...(Array.isArray(brandOptions) ? brandOptions : []), editForm.brand]
            .map(normalizeText)
            .filter(Boolean),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [brandOptions, editForm.brand],
  );

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
      setEditForm(buildTaskEditForm(nextTask || {}));
      setDueDateNote("");
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

  const handleRealtimeTaskUpdated = useCallback((payload = {}) => {
    if (String(payload?._id || payload?.taskId || "") !== String(taskId)) return;
    setTask((currentTask) => currentTask ? { ...currentTask, ...payload } : currentTask);
  }, [taskId]);

  const handleRealtimeCommentAdded = useCallback((payload = {}) => {
    if (String(payload?.taskId || "") !== String(taskId)) return;
    setTask((currentTask) => {
      if (!currentTask) return currentTask;
      const comments = Array.isArray(currentTask.comments) ? currentTask.comments : [];
      if (comments.some((entry) => String(entry?._id) === String(payload?._id || payload?.commentId))) {
        return currentTask;
      }
      return {
        ...currentTask,
        comments: [payload, ...comments],
      };
    });
  }, [taskId]);

  useWorkflowRealtime({
    enabled: Boolean(taskId && task),
    batchId: task?.batch?._id || task?.batch || "",
    userId: currentUserId,
    onTaskUpdated: handleRealtimeTaskUpdated,
    onCommentAdded: handleRealtimeCommentAdded,
    onForceRefetch: () => loadTask({ keepMessages: true }),
    onSyncRequired: () => loadTask({ keepMessages: true }),
  });

  const assignedUsers = useMemo(
    () =>
      Array.isArray(task?.assigned_to)
        ? task.assigned_to.map((entry) => entry?.user || entry).filter(Boolean)
        : [],
    [task?.assigned_to],
  );
  const reworkDueDateHistory = useMemo(
    () =>
      Array.isArray(task?.rework_due_dates)
        ? task.rework_due_dates.filter((entry) => entry?.date)
        : [],
    [task?.rework_due_dates],
  );
  const dueDateUpdateHistory = useMemo(
    () =>
      (Array.isArray(task?.status_history) ? task.status_history : [])
        .filter((entry) => entry?.metadata?.due_date_updated)
        .map((entry) => ({
          ...entry,
          date: entry?.metadata?.due_date || entry?.metadata?.next_due_date || null,
          previousDate: entry?.metadata?.previous_due_date || null,
        })),
    [task?.status_history],
  );

  const isAssignedUser = useMemo(
    () =>
      assignedUsers.some((user) => {
        const userId = user?._id || user?.id || user;
        return String(userId) === String(currentUserId);
      }),
    [assignedUsers, currentUserId],
  );
  const isTaskAssigner = String(getUserId(task?.assigned_by)) === String(currentUserId);
  const isTaskCreator = String(getUserId(task?.created_by)) === String(currentUserId);

  const canStart = isAssignedUser && task?.status === "assigned";
  const canComplete = isAssignedUser && task?.status === "started";
  const canApprove = isTaskAssigner && task?.status === "complete";
  const canEditCurrentTaskDetails =
    isTaskCreator ||
    (canEditTaskDetails && (canEditAnyTaskDetails || isAssignedUser || isTaskAssigner));
  const canUpload =
    task?.upload_required !== false &&
    task?.status === "approved" &&
    (
      hasUploadAssignees(task)
        ? isUploadAssignedToUser(task, currentUserId)
        : (isAssignedUser || isTaskCreator)
    );
  const canRework =
    canManageWorkflow && ["complete", "approved", "uploaded"].includes(task?.status);
  const canAssign =
    (canAssignWorkflow || isTaskCreator) && canEditCurrentTaskDetails && task?.status !== "uploaded";
  const canDelete =
    Boolean(task?._id) &&
    (canDeleteWorkflow || (canDeleteOwnTask && isTaskCreator));
  const canComment = Boolean(task?._id);

  const departmentOptions = useMemo(() => {
    const options = Array.isArray(departments) ? [...departments] : [];
    const currentDepartment = task?.department;
    const currentDepartmentId = currentDepartment?._id || currentDepartment;
    if (
      currentDepartmentId &&
      !options.some((department) => String(department?._id) === String(currentDepartmentId))
    ) {
      options.push(
        typeof currentDepartment === "object"
          ? currentDepartment
          : { _id: currentDepartmentId, name: "Current Department" },
      );
    }
    return options;
  }, [departments, task?.department]);

  const selectedUploadAssigneeIds = useMemo(
    () =>
      new Set(
        (Array.isArray(editForm.uploadAssigneeIds)
          ? editForm.uploadAssigneeIds
          : []
        ).map(String),
      ),
    [editForm.uploadAssigneeIds],
  );

  const availableUploadUsers = useMemo(() => {
    const optionById = new Map();
    [
      ...availableUsers,
      ...assignedUsers,
      ...(Array.isArray(task?.upload_assignees)
        ? task.upload_assignees.map((entry) => entry?.user || entry)
        : []),
      currentUser,
    ].forEach((user) => {
      const userId = getUserId(user);
      if (!userId || optionById.has(String(userId))) return;
      optionById.set(String(userId), user);
    });
    return [...optionById.values()];
  }, [availableUsers, assignedUsers, currentUser, task?.upload_assignees]);

  const handleTaskAction = async (action, message, { onSuccess } = {}) => {
    setActionLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      await action();
      await loadTask({ keepMessages: true });
      setActionSuccess(message);
      setAssignNote("");
      setNotePrompt({ type: "", note: "", dueDate: "" });
      onSuccess?.();
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

  const handleEditFormChange = (field, value) => {
    setEditForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleEditUploadRequiredChange = (checked) => {
    setEditForm((prev) => ({
      ...prev,
      uploadRequired: checked,
      uploadAssigneeIds:
        checked && (!Array.isArray(prev.uploadAssigneeIds) || prev.uploadAssigneeIds.length === 0)
          ? uniqueIds([currentUserId, ...assignIds])
          : prev.uploadAssigneeIds,
    }));
  };

  const toggleEditUploadAssignee = (userId) => {
    setEditForm((prev) => ({
      ...prev,
      uploadAssigneeIds: selectedUploadAssigneeIds.has(String(userId))
        ? prev.uploadAssigneeIds.filter((entry) => String(entry) !== String(userId))
        : uniqueIds([...(prev.uploadAssigneeIds || []), userId]),
    }));
  };

  const handleSaveTaskDetails = async () => {
    if (!normalizeText(editForm.title)) {
      setActionError("Task name is required.");
      return;
    }
    if (!normalizeText(editForm.dueDate)) {
      setActionError("Due date is required.");
      return;
    }
    const currentDueDate = getEditableDueDateValue(task);
    const dueDateChanged = normalizeText(editForm.dueDate) !== normalizeText(currentDueDate);
    if (dueDateChanged && !normalizeText(dueDateNote)) {
      setActionError("Due date update comment is required.");
      return;
    }
    if (
      editForm.uploadRequired &&
      (!Array.isArray(editForm.uploadAssigneeIds) || editForm.uploadAssigneeIds.length === 0)
    ) {
      setActionError("At least one upload user is required when upload is required.");
      return;
    }

    await handleTaskAction(
      () =>
        updateWorkflowTask(taskId, {
          title: normalizeText(editForm.title),
          description: normalizeText(editForm.description),
          brand: normalizeText(editForm.brand),
          department: normalizeText(editForm.department) || null,
          priority: normalizeText(editForm.priority) || "normal",
          assigned_at: normalizeText(editForm.assignmentDate) || null,
          due_date: normalizeText(editForm.dueDate),
          due_date_note: dueDateChanged ? normalizeText(dueDateNote) : undefined,
          upload_required: Boolean(editForm.uploadRequired),
          upload_assignee_ids: editForm.uploadRequired ? editForm.uploadAssigneeIds : [],
        }),
      "Task details updated successfully.",
      {
        onSuccess: () => {
          setDueDateNote("");
          setOpenPanel("");
        },
      },
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
    if (stepKey === "started" && canStart) {
      await handleTaskAction(
        () => startWorkflowTask(taskId, { note: "" }),
        "Task started successfully.",
      );
      return;
    }

    if (stepKey === "complete" && canComplete) {
      setActionError("");
      setActionSuccess("");
      setOpenPanel("");
      setNotePrompt({ type: "complete", note: "", dueDate: "" });
      return;
    }

    if (stepKey === "approved" && canApprove) {
      await handleTaskAction(
        () => approveWorkflowTask(taskId, { note: "" }),
        "Task approved successfully.",
      );
      return;
    }

    if (
      (stepKey === "uploaded" || isWorkflowUploadStepKey(stepKey)) &&
      canUpload &&
      isUploadStepPending(task, stepKey)
    ) {
      await handleTaskAction(
        () => uploadWorkflowTask(taskId, {
          upload_user_id: getUploadUserIdFromStepKey(stepKey),
        }),
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
      () =>
        sendWorkflowTaskToRework(taskId, {
          note: normalizedNote,
          due_date: normalizeText(notePrompt.dueDate) || undefined,
        }),
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
                      <div className="col-12">
                        <div className="small text-secondary mb-1">Description</div>
                        <div className="fw-semibold text-wrap">
                          {normalizeText(task.description) || "—"}
                        </div>
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
                        <div className="small text-secondary mb-1">Active Due Date</div>
                        <div className="fw-semibold">
                          {formatDateOnly(task.active_due_date || task.due_date)}
                          {task?.deadline_summary?.active_due_source === "rework" ? " (Rework)" : ""}
                        </div>
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
                        <div className="small text-secondary mb-1">Started At</div>
                        <div className="fw-semibold">{formatDateTime(task.started_at)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Complete At</div>
                        <div className="fw-semibold">{formatDateTime(task.completed_at)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Approved At</div>
                        <div className="fw-semibold">{formatDateTime(task.approved_at)}</div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Upload Required</div>
                        <div className="fw-semibold">{task.upload_required === false ? "No" : "Yes"}</div>
                      </div>
                      <div className="col-md-8">
                        <div className="small text-secondary mb-1">Upload Pending Users</div>
                        <div className="fw-semibold">
                          {hasUploadAssignees(task)
                            ? task.upload_assignees
                                .map((entry) => getUserLabel(entry?.user || entry))
                                .join(", ")
                            : "—"}
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Approval Deadline</div>
                        <div className="fw-semibold">
                          {formatDateOnly(task?.deadline_summary?.approval_deadline)}
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">Upload Deadline</div>
                        <div className="fw-semibold">
                          {task.upload_required === false
                            ? "Not required"
                            : formatDateOnly(task?.deadline_summary?.upload_deadline)}
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="small text-secondary mb-1">SLA Stage</div>
                        <div className="fw-semibold">
                          {task.delay_stage
                            ? formatWorkflowStageLabel(task.delay_stage)
                            : task.overdue_stage
                              ? formatWorkflowStageLabel(task.overdue_stage)
                              : "On Time"}
                        </div>
                      </div>
                      {(task?.deadline_summary?.completion_days_late > 0 ||
                        task?.deadline_summary?.approval_days_late > 0 ||
                        task?.deadline_summary?.upload_days_late > 0 ||
                        task?.deadline_summary?.completion_overdue_days > 0 ||
                        task?.deadline_summary?.approval_overdue_days > 0 ||
                        task?.deadline_summary?.upload_overdue_days > 0) && (
                        <div className="col-12">
                          <div className="small text-secondary mb-1">SLA Days</div>
                          <div className="d-flex flex-wrap gap-2">
                            <span className="om-summary-chip">
                              Completion: {task?.deadline_summary?.completion_days_late || task?.deadline_summary?.completion_overdue_days || 0} day(s)
                            </span>
                            <span className="om-summary-chip">
                              Approval: {task?.deadline_summary?.approval_days_late || task?.deadline_summary?.approval_overdue_days || 0} day(s)
                            </span>
                            <span className="om-summary-chip">
                              Upload: {task?.deadline_summary?.upload_days_late || task?.deadline_summary?.upload_overdue_days || 0} day(s)
                            </span>
                          </div>
                        </div>
                      )}
                      {Array.isArray(task?.deadline_summary?.upload_delayed_assignees) &&
                        task.deadline_summary.upload_delayed_assignees.length > 0 && (
                          <div className="col-12">
                            <div className="small text-secondary mb-1">Delayed Upload Users</div>
                            <div className="fw-semibold">
                              {task.deadline_summary.upload_delayed_assignees
                                .map((entry) =>
                                  `${getUserLabel(entry?.user)} (${entry.days_late || 0} day(s))`,
                                )
                                .join(", ")}
                            </div>
                          </div>
                        )}
                      {Array.isArray(task?.deadline_summary?.upload_overdue_assignees) &&
                        task.deadline_summary.upload_overdue_assignees.length > 0 && (
                          <div className="col-12">
                            <div className="small text-secondary mb-1">Upload Overdue Users</div>
                            <div className="fw-semibold">
                              {task.deadline_summary.upload_overdue_assignees
                                .map((entry) =>
                                  `${getUserLabel(entry?.user)} (${entry.days_late || 0} day(s))`,
                                )
                                .join(", ")}
                            </div>
                          </div>
                        )}
                    </div>
                    {reworkDueDateHistory.length > 0 && (
                      <div className="workflow-rework-date-history mt-3">
                        <div className="small text-secondary mb-2">Rework Date History</div>
                        <div className="workflow-rework-date-history-list">
                          {reworkDueDateHistory.map((entry, index) => (
                            <div
                              key={`${task._id}-rework-date-${index}`}
                              className="workflow-rework-date-history-item"
                            >
                              <div className="fw-semibold">
                                {formatOrdinal(reworkDueDateHistory.length - index)}
                              </div>
                              <div className="small text-secondary">
                                {formatDateOnly(entry?.date)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {dueDateUpdateHistory.length > 0 && (
                      <div className="workflow-rework-date-history mt-3">
                        <div className="small text-secondary mb-2">Due Date Update History</div>
                        <div className="workflow-rework-date-history-list">
                          {dueDateUpdateHistory.map((entry, index) => (
                            <div
                              key={`${task._id}-due-date-update-${entry?._id || index}`}
                              className="workflow-rework-date-history-item"
                            >
                              <div className="fw-semibold">{formatDateOnly(entry?.date)}</div>
                              <div className="small text-secondary">
                                {entry?.note || "No comment"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="card om-card mb-3">
                  <div className="card-body">
                    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                      <div>
                        <h6 className="mb-1">Progress & Actions</h6>
                        <div className="small text-secondary">
                          Use the lean status line for quick updates. Start is instant; complete and rework both accept notes.
                        </div>
                      </div>
                      <div className="d-flex flex-wrap gap-2">
                        {canEditCurrentTaskDetails && (
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm"
                            disabled={actionLoading}
                            onClick={() => {
                              setNotePrompt({ type: "", note: "", dueDate: "" });
                              setOpenPanel((prev) => (prev === "edit" ? "" : "edit"));
                            }}
                          >
                            Edit Details
                          </button>
                        )}
                        {canAssign && (
                          <button
                            type="button"
                            className="btn btn-outline-dark btn-sm"
                            disabled={actionLoading}
                            onClick={() => {
                              setNotePrompt({ type: "", note: "", dueDate: "" });
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
                              setNotePrompt({ type: "", note: "", dueDate: "" });
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
                              setNotePrompt({ type: "rework", note: "", dueDate: "" });
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
                        (stepKey === "started" && canStart)
                        || (stepKey === "complete" && canComplete)
                        || (stepKey === "approved" && canApprove)
                        || (
                          (stepKey === "uploaded" || isWorkflowUploadStepKey(stepKey)) &&
                          canUpload &&
                          isUploadStepPending(task, stepKey)
                        )
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
                            onClick={() => setNotePrompt({ type: "", note: "", dueDate: "" })}
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
                        {notePrompt.type === "rework" && (
                          <div className="mt-3">
                            <label className="form-label">Next Due Date</label>
                            <input
                              type="date"
                              className="form-control"
                              value={notePrompt.dueDate}
                              onChange={(event) =>
                                setNotePrompt((prev) => ({
                                  ...prev,
                                  dueDate: event.target.value,
                                }))
                              }
                              disabled={actionLoading}
                            />
                          </div>
                        )}
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

                    {openPanel === "edit" && (
                      <div className="workflow-action-panel mb-3">
                        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                          <div>
                            <div className="fw-semibold">Edit Task Details</div>
                            <div className="small text-secondary">
                              Admin-only task metadata. Status and assignees still use their own actions.
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => {
                              setEditForm(buildTaskEditForm(task || {}));
                              setOpenPanel("");
                            }}
                            disabled={actionLoading}
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="row g-3">
                          <div className="col-md-6">
                            <label className="form-label">Task Name</label>
                            <input
                              type="text"
                              className="form-control"
                              value={editForm.title}
                              onChange={(event) => handleEditFormChange("title", event.target.value)}
                              disabled={actionLoading}
                            />
                          </div>
                          <div className="col-md-6">
                            <label className="form-label">Brand</label>
                            <select
                              className="form-select"
                              value={editForm.brand}
                              onChange={(event) => handleEditFormChange("brand", event.target.value)}
                              disabled={actionLoading}
                            >
                              <option value="">Select brand</option>
                              {availableBrandOptions.map((brand) => (
                                <option key={brand} value={brand}>
                                  {brand}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-md-6">
                            <label className="form-label">Department</label>
                            <select
                              className="form-select"
                              value={editForm.department}
                              onChange={(event) => handleEditFormChange("department", event.target.value)}
                              disabled={actionLoading}
                            >
                              <option value="">No Department</option>
                              {departmentOptions.map((department) => (
                                <option
                                  key={department?._id || department?.key || department?.name}
                                  value={department?._id || ""}
                                >
                                  {department?.name || department?.key || "Department"}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-md-6">
                            <label className="form-label">Priority</label>
                            <select
                              className="form-select"
                              value={editForm.priority}
                              onChange={(event) => handleEditFormChange("priority", event.target.value)}
                              disabled={actionLoading}
                            >
                              <option value="low">Low</option>
                              <option value="normal">Normal</option>
                              <option value="high">High</option>
                              <option value="urgent">Urgent</option>
                            </select>
                          </div>
                          <div className="col-md-6">
                            <label className="form-label">Assignment Date</label>
                            <input
                              type="date"
                              className="form-control"
                              value={editForm.assignmentDate}
                              onChange={(event) =>
                                handleEditFormChange("assignmentDate", event.target.value)
                              }
                              disabled={actionLoading}
                            />
                          </div>
                          <div className="col-md-6">
                            <label className="form-label">Due Date</label>
                            <input
                              type="date"
                              className="form-control"
                              value={editForm.dueDate}
                              onChange={(event) => handleEditFormChange("dueDate", event.target.value)}
                              disabled={actionLoading}
                              required
                            />
                          </div>
                          {normalizeText(editForm.dueDate) !== normalizeText(getEditableDueDateValue(task)) && (
                            <div className="col-12">
                              <label className="form-label">Due Date Update Comment</label>
                              <textarea
                                className="form-control"
                                rows={2}
                                value={dueDateNote}
                                onChange={(event) => setDueDateNote(event.target.value)}
                                disabled={actionLoading}
                                placeholder="Explain why the due date is changing"
                              />
                            </div>
                          )}
                          <div className="col-md-6">
                            <label className="form-label d-block">Upload Required</label>
                            <div className="form-check form-switch">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                role="switch"
                                id="workflow-task-upload-required"
                                checked={Boolean(editForm.uploadRequired)}
                                onChange={(event) =>
                                  handleEditUploadRequiredChange(event.target.checked)
                                }
                                disabled={actionLoading}
                              />
                              <label
                                className="form-check-label"
                                htmlFor="workflow-task-upload-required"
                              >
                                {editForm.uploadRequired ? "On" : "Off"}
                              </label>
                            </div>
                          </div>
                          {editForm.uploadRequired && (
                            <div className="col-12">
                              <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                                <label className="form-label mb-0">Upload Pending Users</label>
                                <span className="om-summary-chip">
                                  Selected: {editForm.uploadAssigneeIds.length}
                                </span>
                              </div>
                              {availableUploadUsers.length === 0 ? (
                                <div className="alert alert-secondary mb-0 py-2">
                                  No user options available for upload assignment.
                                </div>
                              ) : (
                                <div className="workflow-user-picker">
                                  {availableUploadUsers.map((user) => {
                                    const userId = getUserId(user);
                                    const checked = selectedUploadAssigneeIds.has(String(userId));
                                    return (
                                      <label
                                        key={userId}
                                        className="form-check d-flex align-items-center gap-2 mb-0"
                                      >
                                        <input
                                          type="checkbox"
                                          className="form-check-input mt-0"
                                          checked={checked}
                                          onChange={() => toggleEditUploadAssignee(userId)}
                                          disabled={actionLoading}
                                        />
                                        <span>
                                          {user?.name || user?.username || user?.email || "User"}{" "}
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
                          )}
                          <div className="col-12">
                            <label className="form-label">Description</label>
                            <textarea
                              rows="3"
                              className="form-control"
                              value={editForm.description}
                              onChange={(event) =>
                                handleEditFormChange("description", event.target.value)
                              }
                              disabled={actionLoading}
                            />
                          </div>
                        </div>
                        <div className="d-flex justify-content-end mt-3">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={actionLoading}
                            onClick={handleSaveTaskDetails}
                          >
                            {actionLoading ? "Saving..." : "Save Details"}
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
