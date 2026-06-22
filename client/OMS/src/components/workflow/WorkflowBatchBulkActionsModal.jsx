import { useEffect, useMemo, useState } from "react";
import { toISODateString } from "../../utils/date";

const normalizeText = (value) => String(value ?? "").trim();

const getUserId = (entry = {}) => entry?._id || entry?.id || entry?.user?._id || entry?.user || "";
const getTaskId = (task = {}) => String(task?._id || task?.id || "").replace(/^batch:/, "");

const getUserLabel = (entry = {}) =>
  entry?.name || entry?.email || entry?.user?.name || entry?.user?.email || "User";

const getTaskTypeKey = (entry = {}) => normalizeText(entry?.key || entry?.task_type_key);

const getTaskTitle = (task = {}) =>
  normalizeText(task?.title || task?.source_folder_path) || "Untitled Task";

const getTaskNumber = (task = {}) =>
  normalizeText(task?.task_no) || getTaskId(task) || "No task number";

const getTaskStatus = (task = {}) => normalizeText(task?.status).toLowerCase();

const getTaskHoldStatus = (task = {}) => normalizeText(task?.hold?.status).toLowerCase();

const toggleValue = (values = [], value = "") => {
  const normalized = normalizeText(value);
  if (!normalized) return values;
  return values.includes(normalized)
    ? values.filter((entry) => entry !== normalized)
    : [...values, normalized];
};

const buildInitialForm = (batch = {}, mode = "edit") => ({
  mode,
  batchName: normalizeText(batch?.name || batch?.title),
  updateDueDate: false,
  dueDate: toISODateString(batch?.due_date),
  dueDateNote: "",
  updateTaskType: false,
  taskTypeKey: normalizeText(batch?.task_type_key || batch?.selected_task_type?.key),
  updateAssignees: false,
  assignedUserIds: [],
  updateUpload: false,
  uploadRequired: true,
  uploadAssigneeIds: [],
  note: "",
  actionDate: "",
  selectedTaskIds: [],
});

const getEligibleTasks = (tasks = [], mode = "edit") =>
  (Array.isArray(tasks) ? tasks : []).filter((task) => {
    const taskId = getTaskId(task);
    if (!taskId) return false;
    const status = getTaskStatus(task);
    const holdStatus = getTaskHoldStatus(task);
    if (mode === "hold") {
      return status !== "uploaded" && status !== "hold" && holdStatus !== "hold" && holdStatus !== "pending";
    }
    if (mode === "resume") {
      return status === "hold" && holdStatus === "hold";
    }
    if (mode === "approve_hold" || mode === "reject_hold") {
      return status !== "hold" && holdStatus === "pending";
    }
    return status !== "uploaded";
  });

const MODE_META = {
  edit: {
    title: "Edit Shared Details",
    button: "Edit Details",
    submit: "Save Details",
  },
  hold: {
    title: "Hold Tasks",
    button: "Hold",
    submit: "Hold Selected",
  },
  resume: {
    title: "Resume Tasks",
    button: "Resume",
    submit: "Resume Selected",
  },
  approve_hold: {
    title: "Approve Hold",
    button: "Approve Hold",
    submit: "Approve Selected",
  },
  reject_hold: {
    title: "Reject Hold",
    button: "Reject Hold",
    submit: "Reject Selected",
  },
};

const WorkflowBatchBulkActionsModal = ({
  show = false,
  batch = null,
  tasks = [],
  users = [],
  taskTypes = [],
  loading = false,
  result = null,
  error = "",
  onClose,
  onSubmit,
}) => {
  const [mode, setMode] = useState("edit");
  const [form, setForm] = useState(() => buildInitialForm(batch || {}, "edit"));

  const activeTaskTypes = useMemo(
    () => (Array.isArray(taskTypes) ? taskTypes : []).filter((entry) => entry?.is_active !== false),
    [taskTypes],
  );
  const eligibleTasks = useMemo(() => getEligibleTasks(tasks, mode), [mode, tasks]);
  const eligibleTaskIds = useMemo(() => eligibleTasks.map(getTaskId).filter(Boolean), [eligibleTasks]);
  const selectedTaskSet = useMemo(
    () => new Set(form.selectedTaskIds.map(String)),
    [form.selectedTaskIds],
  );
  const allEligibleSelected =
    eligibleTaskIds.length > 0 && form.selectedTaskIds.length === eligibleTaskIds.length;

  useEffect(() => {
    if (!show) return;
    setMode("edit");
    setForm({
      ...buildInitialForm(batch || {}, "edit"),
      selectedTaskIds: getEligibleTasks(tasks, "edit").map(getTaskId).filter(Boolean),
    });
  }, [batch, show, tasks]);

  useEffect(() => {
    if (!show) return;
    setForm((prev) => ({
      ...prev,
      mode,
      note: mode === prev.mode ? prev.note : "",
      actionDate: mode === prev.mode ? prev.actionDate : "",
      selectedTaskIds: eligibleTaskIds,
    }));
  }, [eligibleTaskIds, mode, show]);

  if (!show) return null;

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
  };

  const toggleTask = (taskId) => {
    setForm((prev) => ({
      ...prev,
      selectedTaskIds: toggleValue(prev.selectedTaskIds, taskId),
    }));
  };

  const toggleAllTasks = () => {
    setField("selectedTaskIds", allEligibleSelected ? [] : eligibleTaskIds);
  };

  const buildPayload = () => {
    const payload = {
      selected_task_ids: form.selectedTaskIds,
    };

    if (mode === "edit") {
      const batchName = normalizeText(form.batchName);
      if (batchName && batchName !== normalizeText(batch?.name || batch?.title)) {
        payload.batch_name = batchName;
      }
      if (form.updateDueDate) {
        payload.due_date = form.dueDate;
        payload.due_date_note = form.dueDateNote;
      }
      if (form.updateTaskType) {
        payload.task_type_key = form.taskTypeKey;
      }
      if (form.updateAssignees) {
        payload.assigned_user_ids = form.assignedUserIds;
      }
      if (form.updateUpload) {
        payload.upload_required = form.uploadRequired;
        payload.upload_assignee_ids = form.uploadRequired ? form.uploadAssigneeIds : [];
      }
      return payload;
    }

    payload.action = mode;
    payload.note = form.note;
    if (mode === "hold" && normalizeText(form.actionDate)) {
      payload.due_date = form.actionDate;
      payload.due_date_note = form.note;
    }
    if (mode === "resume") {
      payload.resume_due_date = form.actionDate;
    }
    return payload;
  };

  const handleSubmit = () => {
    if (form.selectedTaskIds.length === 0) {
      onSubmit?.({ __client_error: "Select at least one eligible task." });
      return;
    }
    onSubmit?.(buildPayload());
  };

  const renderTaskChecklist = () => (
    <div className="workflow-bulk-task-list workflow-bulk-section">
      <div className="workflow-bulk-section-head">
        <div>
          <div className="fw-semibold">Affected Tasks</div>
          <div className="small text-secondary">
            {form.selectedTaskIds.length}/{eligibleTaskIds.length} selected
          </div>
        </div>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={toggleAllTasks}
          disabled={loading || eligibleTaskIds.length === 0}
        >
          {allEligibleSelected ? "Deselect All" : "Select All"}
        </button>
      </div>
      {eligibleTasks.length === 0 ? (
        <div className="alert alert-secondary mb-0">No eligible tasks for this action.</div>
      ) : (
        <div className="workflow-bulk-task-picker">
          {eligibleTasks.map((task) => {
            const taskId = getTaskId(task);
            return (
              <label key={taskId} className="workflow-bulk-task-row">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={selectedTaskSet.has(taskId)}
                  onChange={() => toggleTask(taskId)}
                  disabled={loading}
                />
                <span className="workflow-bulk-task-row-copy">
                  <span className="fw-semibold">{getTaskTitle(task)}</span>
                  <span className="small text-secondary">
                    {getTaskNumber(task)} • {getTaskStatus(task)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderEditDetails = () => (
    <div className="workflow-bulk-layout">
      <div className="workflow-bulk-main workflow-bulk-main-action">
        <div className="workflow-bulk-section">
          <div className="workflow-bulk-section-head">
            <div>
              <div className="fw-semibold">Batch</div>
              <div className="small text-secondary">Shared batch fields</div>
            </div>
          </div>
        <label className="form-label">Batch Name</label>
        <input
          className="form-control"
          value={form.batchName}
          onChange={(event) => setField("batchName", event.target.value)}
          disabled={loading}
        />
        </div>

        <div className="workflow-bulk-section">
          <div className="workflow-bulk-section-head">
            <div>
              <div className="fw-semibold">Due Date</div>
              <div className="small text-secondary">Apply a new task due date</div>
            </div>
            <label className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                checked={form.updateDueDate}
                onChange={(event) => setField("updateDueDate", event.target.checked)}
                disabled={loading}
              />
            </label>
          </div>
          {form.updateDueDate && (
            <div className="workflow-bulk-inline-grid">
              <input
                type="date"
                className="form-control"
                value={form.dueDate}
                onChange={(event) => setField("dueDate", event.target.value)}
                disabled={loading}
              />
              <textarea
                rows="2"
                className="form-control"
                placeholder="Due date update note"
                value={form.dueDateNote}
                onChange={(event) => setField("dueDateNote", event.target.value)}
                disabled={loading}
              />
            </div>
          )}
        </div>

        <div className="workflow-bulk-section">
          <div className="workflow-bulk-section-head">
            <div>
              <div className="fw-semibold">Task Type</div>
              <div className="small text-secondary">Replace the task type</div>
            </div>
            <label className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                checked={form.updateTaskType}
                onChange={(event) => setField("updateTaskType", event.target.checked)}
                disabled={loading}
              />
            </label>
          </div>
          {form.updateTaskType && (
            <select
              className="form-select"
              value={form.taskTypeKey}
              onChange={(event) => setField("taskTypeKey", event.target.value)}
              disabled={loading}
            >
              <option value="">Select task type</option>
              {activeTaskTypes.map((taskType) => (
                <option key={getTaskTypeKey(taskType)} value={getTaskTypeKey(taskType)}>
                  {taskType?.name || getTaskTypeKey(taskType)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="workflow-bulk-section">
          <div className="workflow-bulk-section-head">
            <div>
              <div className="fw-semibold">Assigned Users</div>
              <div className="small text-secondary">Replace assignees</div>
            </div>
            <label className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                checked={form.updateAssignees}
                onChange={(event) => setField("updateAssignees", event.target.checked)}
                disabled={loading}
              />
            </label>
          </div>
          {form.updateAssignees && (
            <div className="workflow-user-picker workflow-user-picker-compact">
              {(Array.isArray(users) ? users : []).map((user) => {
                const userId = String(getUserId(user));
                return (
                  <label key={`assign-${userId}`} className="form-check d-flex gap-2 mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={form.assignedUserIds.includes(userId)}
                      onChange={() => setField("assignedUserIds", toggleValue(form.assignedUserIds, userId))}
                      disabled={loading}
                    />
                    <span>{getUserLabel(user)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="workflow-bulk-section">
          <div className="workflow-bulk-section-head">
            <div>
              <div className="fw-semibold">Upload</div>
              <div className="small text-secondary">Upload requirement and users</div>
            </div>
            <label className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                checked={form.updateUpload}
                onChange={(event) => setField("updateUpload", event.target.checked)}
                disabled={loading}
              />
            </label>
          </div>
          {form.updateUpload && (
            <>
              <div className="form-check form-switch mb-2">
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  id="bulk-upload-required"
                  checked={form.uploadRequired}
                  onChange={(event) => setField("uploadRequired", event.target.checked)}
                  disabled={loading}
                />
                <label className="form-check-label" htmlFor="bulk-upload-required">
                  Upload required
                </label>
              </div>
              {form.uploadRequired && (
                <div className="workflow-user-picker workflow-user-picker-compact">
                  {(Array.isArray(users) ? users : []).map((user) => {
                    const userId = String(getUserId(user));
                    return (
                      <label key={`upload-${userId}`} className="form-check d-flex gap-2 mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={form.uploadAssigneeIds.includes(userId)}
                          onChange={() =>
                            setField("uploadAssigneeIds", toggleValue(form.uploadAssigneeIds, userId))
                          }
                          disabled={loading}
                        />
                        <span>{getUserLabel(user)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="workflow-bulk-side">
        {renderTaskChecklist()}
      </div>
    </div>
  );

  const renderActionForm = () => (
    <div className="workflow-bulk-layout">
      <div className="workflow-bulk-main">
        <div className="workflow-bulk-section">
          <div className="workflow-bulk-section-head">
            <div>
              <div className="fw-semibold">{mode === "hold" ? "Hold Details" : mode === "resume" ? "Resume Details" : modeMeta.title}</div>
              <div className="small text-secondary">Applies to checked tasks only</div>
            </div>
          </div>
          <div className="workflow-bulk-inline-grid">
            {(mode === "hold" || mode === "resume") && (
              <div>
                <label className="form-label">
                  {mode === "hold" ? "Due Date While On Hold" : "New Due Date"}
                </label>
                <input
                  type="date"
                  className="form-control"
                  value={form.actionDate}
                  onChange={(event) => setField("actionDate", event.target.value)}
                  disabled={loading}
                />
              </div>
            )}
            <div>
              <label className="form-label">Comment</label>
              <textarea
                rows="4"
                className="form-control"
                value={form.note}
                onChange={(event) => setField("note", event.target.value)}
                disabled={loading}
                placeholder="Add a comment for selected tasks"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="workflow-bulk-side">
        {renderTaskChecklist()}
      </div>
    </div>
  );

  const modeMeta = MODE_META[mode] || MODE_META.edit;

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl workflow-modal-dialog workflow-bulk-modal-dialog">
        <div className="modal-content">
          <div className="modal-header workflow-bulk-modal-header">
            <div>
              <h5 className="modal-title mb-1">Batch Actions</h5>
              <div className="small text-secondary">
                {batch?.batch_no || "Batch"} • {eligibleTaskIds.length} eligible task(s)
              </div>
            </div>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} disabled={loading} />
          </div>
          <div className="modal-body workflow-bulk-modal-body">
            {error && <div className="alert alert-danger">{error}</div>}
            {result && (
              <div className="alert alert-info">
                Updated {Number(result?.affected_task_count || 0)} task(s). Skipped{" "}
                {Number(result?.skipped_task_count || 0)} task(s).
                {Array.isArray(result?.skipped) && result.skipped.length > 0 && (
                  <div className="small mt-2">
                    {result.skipped.slice(0, 6).map((entry) => (
                      <div key={`${entry.task_id}-${entry.reason}`}>
                        {entry.task_no || entry.task_id}: {entry.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="workflow-bulk-action-toolbar">
              {Object.entries(MODE_META).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  className={`btn btn-sm ${mode === key ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => switchMode(key)}
                  disabled={loading}
                >
                  {meta.button}
                </button>
              ))}
            </div>

            <div className="workflow-bulk-current-title">
              <div className="fw-semibold">{modeMeta.title}</div>
              <span className="om-summary-chip">Selected: {form.selectedTaskIds.length}</span>
            </div>

            {mode === "edit" ? renderEditDetails() : renderActionForm()}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={loading}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={loading || eligibleTaskIds.length === 0}
            >
              {loading ? "Saving..." : modeMeta.submit}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowBatchBulkActionsModal;
