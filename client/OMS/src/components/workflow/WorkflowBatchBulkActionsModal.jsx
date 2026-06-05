import { useEffect, useMemo, useState } from "react";
import { toISODateString } from "../../utils/date";

const normalizeText = (value) => String(value ?? "").trim();

const getUserId = (entry = {}) => entry?._id || entry?.id || entry?.user?._id || entry?.user || "";

const getUserLabel = (entry = {}) =>
  entry?.name || entry?.email || entry?.user?.name || entry?.user?.email || "User";

const getTaskTypeKey = (entry = {}) => normalizeText(entry?.key || entry?.task_type_key);

const getDateInputValue = (value) => {
  return toISODateString(value);
};

const buildInitialForm = (batch = {}) => ({
  batchName: normalizeText(batch?.name || batch?.title),
  updateDueDate: false,
  dueDate: getDateInputValue(batch?.due_date),
  dueDateNote: "",
  updateTaskType: false,
  taskTypeKey: normalizeText(batch?.task_type_key || batch?.selected_task_type?.key),
  updateAssignees: false,
  assignedUserIds: [],
  updateUpload: false,
  uploadRequired: true,
  uploadAssigneeIds: [],
  action: "",
  note: "",
  resumeDueDate: "",
});

const toggleValue = (values = [], value = "") => {
  const normalized = normalizeText(value);
  if (!normalized) return values;
  return values.includes(normalized)
    ? values.filter((entry) => entry !== normalized)
    : [...values, normalized];
};

const WorkflowBatchBulkActionsModal = ({
  show = false,
  batch = null,
  users = [],
  taskTypes = [],
  loading = false,
  result = null,
  error = "",
  onClose,
  onSubmit,
}) => {
  const [form, setForm] = useState(() => buildInitialForm(batch || {}));

  useEffect(() => {
    if (show) {
      setForm(buildInitialForm(batch || {}));
    }
  }, [batch, show]);

  const activeTaskTypes = useMemo(
    () => (Array.isArray(taskTypes) ? taskTypes : []).filter((entry) => entry?.is_active !== false),
    [taskTypes],
  );

  if (!show) return null;

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    const payload = {};
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
    if (form.action) {
      payload.action = form.action;
      payload.note = form.note;
      if (form.action === "resume") {
        payload.resume_due_date = form.resumeDueDate;
      }
    } else if (normalizeText(form.note)) {
      payload.note = form.note;
    }
    onSubmit?.(payload);
  };

  const selectedActionNeedsNote = ["hold", "approve_hold", "reject_hold", "resume"].includes(form.action);

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-xl workflow-modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title mb-1">Batch Edit / Bulk Actions</h5>
              <div className="small text-secondary">
                {batch?.batch_no || "Batch"} • shared fields only
              </div>
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
              disabled={loading}
            />
          </div>
          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}
            {result && (
              <div className="alert alert-info">
                Updated {Number(result?.affected_task_count || 0)} task(s). Skipped{" "}
                {Number(result?.skipped_task_count || 0)} task(s).
                {Array.isArray(result?.skipped) && result.skipped.length > 0 && (
                  <div className="small mt-2">
                    {result.skipped.slice(0, 5).map((entry) => (
                      <div key={`${entry.task_id}-${entry.reason}`}>
                        {entry.task_no || entry.task_id}: {entry.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">Batch Name</label>
                <input
                  className="form-control"
                  value={form.batchName}
                  onChange={(event) => setField("batchName", event.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="col-md-6">
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="bulk-update-due-date"
                    checked={form.updateDueDate}
                    onChange={(event) => setField("updateDueDate", event.target.checked)}
                    disabled={loading}
                  />
                  <label className="form-check-label" htmlFor="bulk-update-due-date">
                    Update due date for all eligible tasks
                  </label>
                </div>
                <input
                  type="date"
                  className="form-control mb-2"
                  value={form.dueDate}
                  onChange={(event) => setField("dueDate", event.target.value)}
                  disabled={loading || !form.updateDueDate}
                />
                <textarea
                  rows="2"
                  className="form-control"
                  placeholder="Due date update note"
                  value={form.dueDateNote}
                  onChange={(event) => setField("dueDateNote", event.target.value)}
                  disabled={loading || !form.updateDueDate}
                />
              </div>

              <div className="col-md-6">
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="bulk-update-task-type"
                    checked={form.updateTaskType}
                    onChange={(event) => setField("updateTaskType", event.target.checked)}
                    disabled={loading}
                  />
                  <label className="form-check-label" htmlFor="bulk-update-task-type">
                    Update task type for all eligible tasks
                  </label>
                </div>
                <select
                  className="form-select"
                  value={form.taskTypeKey}
                  onChange={(event) => setField("taskTypeKey", event.target.value)}
                  disabled={loading || !form.updateTaskType}
                >
                  <option value="">Select task type</option>
                  {activeTaskTypes.map((taskType) => (
                    <option key={getTaskTypeKey(taskType)} value={getTaskTypeKey(taskType)}>
                      {taskType?.name || getTaskTypeKey(taskType)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-6">
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="bulk-update-assignees"
                    checked={form.updateAssignees}
                    onChange={(event) => setField("updateAssignees", event.target.checked)}
                    disabled={loading}
                  />
                  <label className="form-check-label" htmlFor="bulk-update-assignees">
                    Replace assigned users for all eligible tasks
                  </label>
                </div>
                <div className="workflow-user-picker">
                  {(Array.isArray(users) ? users : []).map((user) => {
                    const userId = String(getUserId(user));
                    return (
                      <label key={`assign-${userId}`} className="form-check d-flex gap-2 mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={form.assignedUserIds.includes(userId)}
                          onChange={() =>
                            setField("assignedUserIds", toggleValue(form.assignedUserIds, userId))
                          }
                          disabled={loading || !form.updateAssignees}
                        />
                        <span>{getUserLabel(user)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="col-md-6">
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="bulk-update-upload"
                    checked={form.updateUpload}
                    onChange={(event) => setField("updateUpload", event.target.checked)}
                    disabled={loading}
                  />
                  <label className="form-check-label" htmlFor="bulk-update-upload">
                    Update upload settings for all eligible tasks
                  </label>
                </div>
                <div className="form-check form-switch mb-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="bulk-upload-required"
                    checked={form.uploadRequired}
                    onChange={(event) => setField("uploadRequired", event.target.checked)}
                    disabled={loading || !form.updateUpload}
                  />
                  <label className="form-check-label" htmlFor="bulk-upload-required">
                    Upload required
                  </label>
                </div>
                {form.uploadRequired && (
                  <div className="workflow-user-picker">
                    {(Array.isArray(users) ? users : []).map((user) => {
                      const userId = String(getUserId(user));
                      return (
                        <label key={`upload-${userId}`} className="form-check d-flex gap-2 mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={form.uploadAssigneeIds.includes(userId)}
                            onChange={() =>
                              setField(
                                "uploadAssigneeIds",
                                toggleValue(form.uploadAssigneeIds, userId),
                              )
                            }
                            disabled={loading || !form.updateUpload}
                          />
                          <span>{getUserLabel(user)}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="col-md-6">
                <label className="form-label">Bulk Action</label>
                <select
                  className="form-select mb-2"
                  value={form.action}
                  onChange={(event) => setField("action", event.target.value)}
                  disabled={loading}
                >
                  <option value="">No status action</option>
                  <option value="hold">Hold all eligible tasks</option>
                  <option value="approve_hold">Approve pending hold requests</option>
                  <option value="reject_hold">Reject pending hold requests</option>
                  <option value="resume">Resume held tasks</option>
                </select>
                {form.action === "resume" && (
                  <input
                    type="date"
                    className="form-control mb-2"
                    value={form.resumeDueDate}
                    onChange={(event) => setField("resumeDueDate", event.target.value)}
                    disabled={loading}
                  />
                )}
                <textarea
                  rows="3"
                  className="form-control"
                  placeholder={selectedActionNeedsNote ? "Action note" : "Optional note"}
                  value={form.note}
                  onChange={(event) => setField("note", event.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={loading}>
              Close
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving..." : "Apply Bulk Update"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowBatchBulkActionsModal;
