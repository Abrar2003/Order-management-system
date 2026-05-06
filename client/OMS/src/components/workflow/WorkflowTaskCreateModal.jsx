import { useMemo, useState } from "react";
import { createWorkflowTask } from "../../api/workflowApi";

const normalizeText = (value) => String(value ?? "").trim();
const normalizeDistinctValues = (values = []) =>
  [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"];

const createDraft = ({ defaultTaskTypeKey = "" } = {}) => ({
  task_type_key: normalizeText(defaultTaskTypeKey),
  title: "",
  description: "",
  assignee_ids: [],
  department: "",
  priority: "normal",
  due_date: "",
  brand: "",
});

const getUserId = (entry = {}) => entry?._id || entry?.id || "";

const getTaskTypeDefaultAssigneeIds = (taskType = {}) =>
  Array.isArray(taskType?.default_assignees)
    ? taskType.default_assignees
        .map((entry) => entry?.user?._id || entry?.user || entry?._id || entry?.id)
        .filter(Boolean)
    : [];

const WorkflowTaskCreateModal = ({
  taskTypes = [],
  departments = [],
  availableUsers = [],
  brandOptions = [],
  defaultTaskTypeKey = "",
  onClose,
  onCreated,
}) => {
  const [form, setForm] = useState(() => createDraft({ defaultTaskTypeKey }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedTaskType = useMemo(
    () =>
      (Array.isArray(taskTypes) ? taskTypes : []).find(
        (entry) => entry?.key === form.task_type_key,
      ) || null,
    [form.task_type_key, taskTypes],
  );

  const selectedAssigneeIds = useMemo(
    () => new Set((Array.isArray(form.assignee_ids) ? form.assignee_ids : []).map(String)),
    [form.assignee_ids],
  );

  const availableBrandOptions = useMemo(
    () =>
      normalizeDistinctValues([
        ...brandOptions,
        form.brand,
      ]),
    [brandOptions, form.brand],
  );

  const handleTaskTypeChange = (taskTypeKey) => {
    const nextTaskType = (Array.isArray(taskTypes) ? taskTypes : []).find(
      (entry) => entry?.key === taskTypeKey,
    );

    setForm((prev) => ({
      ...prev,
      task_type_key: taskTypeKey,
      department:
        nextTaskType?.default_department?._id
        || nextTaskType?.default_department
        || "",
      assignee_ids: getTaskTypeDefaultAssigneeIds(nextTaskType),
      priority: normalizeText(nextTaskType?.default_priority) || "normal",
    }));
  };

  const toggleAssignee = (userId) => {
    setForm((prev) => ({
      ...prev,
      assignee_ids: selectedAssigneeIds.has(String(userId))
        ? prev.assignee_ids.filter((entry) => String(entry) !== String(userId))
        : [...prev.assignee_ids, userId],
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!normalizeText(form.task_type_key)) {
      setError("Task type is required.");
      return;
    }
    if (!normalizeText(form.title)) {
      setError("Task name is required.");
      return;
    }
    if (!Array.isArray(form.assignee_ids) || form.assignee_ids.length === 0) {
      setError("At least one assignee is required.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        task_type_key: normalizeText(form.task_type_key),
        title: normalizeText(form.title),
        description: normalizeText(form.description),
        assignee_ids: form.assignee_ids,
        department: normalizeText(form.department) || null,
        priority: normalizeText(form.priority) || "normal",
        brand: normalizeText(form.brand),
      };

      if (normalizeText(form.due_date)) {
        payload.due_date = normalizeText(form.due_date);
      }

      const result = await createWorkflowTask(payload);
      onCreated?.(result?.data || result);
    } catch (submitError) {
      setError(
        submitError?.response?.data?.message
          || submitError?.message
          || "Failed to create workflow task.",
      );
    } finally {
      setSubmitting(false);
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
              <h5 className="modal-title">Create Workflow Task</h5>
              <div className="small text-muted">
                Create a standalone manual task.
              </div>
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}

              <div className="row g-3">
                <div className="col-lg-5">
                  <section className="card om-card h-100">
                    <div className="card-body">
                      <h6 className="mb-3">Task Details</h6>

                      <div className="row g-3">
                        <div className="col-12">
                          <label className="form-label">Task Type</label>
                          <select
                            className="form-select"
                            value={form.task_type_key}
                            onChange={(event) => handleTaskTypeChange(event.target.value)}
                          >
                            <option value="">Select task type</option>
                            {taskTypes
                              .filter((taskType) => taskType?.is_active !== false)
                              .map((taskType) => (
                                <option key={taskType._id || taskType.key} value={taskType.key}>
                                  {taskType.name}
                                </option>
                              ))}
                          </select>
                        </div>

                        <div className="col-12">
                          <label className="form-label">Task Name</label>
                          <input
                            type="text"
                            className="form-control"
                            value={form.title}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, title: event.target.value }))
                            }
                          />
                        </div>

                        <div className="col-12">
                          <label className="form-label">Description</label>
                          <textarea
                            rows="3"
                            className="form-control"
                            value={form.description}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, description: event.target.value }))
                            }
                          />
                        </div>

                        <div className="col-md-6">
                          <label className="form-label">Department</label>
                          <select
                            className="form-select"
                            value={form.department}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, department: event.target.value }))
                            }
                          >
                            <option value="">None</option>
                            {departments.map((department) => (
                              <option key={department._id} value={department._id}>
                                {department.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="col-md-3">
                          <label className="form-label">Priority</label>
                          <select
                            className="form-select"
                            value={form.priority}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, priority: event.target.value }))
                            }
                          >
                            {PRIORITY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="col-md-3">
                          <label className="form-label">Due Date</label>
                          <input
                            type="date"
                            className="form-control"
                            value={form.due_date}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, due_date: event.target.value }))
                            }
                          />
                        </div>

                        <div className="col-md-12">
                          <label className="form-label">Brand</label>
                          <select
                            className="form-select"
                            value={form.brand}
                            onChange={(event) =>
                              setForm((prev) => ({ ...prev, brand: event.target.value }))
                            }
                          >
                            <option value="">Select brand</option>
                            {availableBrandOptions.map((brand) => (
                              <option key={brand} value={brand}>
                                {brand}
                              </option>
                            ))}
                          </select>
                        </div>

                      </div>
                    </div>
                  </section>
                </div>

                <div className="col-lg-7">
                  <section className="card om-card mb-3">
                    <div className="card-body">
                      <div className="d-flex flex-wrap gap-2 mb-3">
                        <span className="om-summary-chip">
                          Task Type: {selectedTaskType?.name || "Select a task type"}
                        </span>
                        <span className="om-summary-chip">
                          Status Flow: Assigned {"->"} Complete {"->"} Approved {"->"} Uploaded
                        </span>
                        <span className="om-summary-chip">
                          Priority: {form.priority || "normal"}
                        </span>
                        <span className="om-summary-chip">
                          Due Date: {form.due_date || "—"}
                        </span>
                      </div>

                      <div className="row g-3">
                        <div className="col-md-6">
                          <div className="small text-secondary mb-1">Default Department</div>
                          <div className="fw-semibold">
                            {selectedTaskType?.default_department?.name || "—"}
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="small text-secondary mb-1">Default Priority</div>
                          <div className="fw-semibold">
                            {selectedTaskType?.default_priority || "normal"}
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="small text-secondary mb-1">Auto Create Mode</div>
                          <div className="fw-semibold">
                            {selectedTaskType?.auto_create_mode || "manual"}
                          </div>
                        </div>
                        <div className="col-md-6">
                          <div className="small text-secondary mb-1">Category</div>
                          <div className="fw-semibold">
                            {selectedTaskType?.category || "—"}
                          </div>
                        </div>
                        <div className="col-12">
                          <div className="small text-secondary mb-1">Task Type Description</div>
                          <div className="fw-semibold">
                            {selectedTaskType?.description || "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="card om-card">
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
                        <div>
                          <h6 className="mb-1">Assignees</h6>
                          <div className="small text-secondary">
                            Pick one or multiple users for this task.
                          </div>
                        </div>
                        <span className="om-summary-chip">
                          Selected: {form.assignee_ids.length}
                        </span>
                      </div>

                      {availableUsers.length === 0 ? (
                        <div className="alert alert-secondary mb-0">
                          No user options are available for assignment.
                        </div>
                      ) : (
                        <div className="workflow-user-picker">
                          {availableUsers.map((user) => {
                            const userId = getUserId(user);
                            return (
                              <label
                                key={userId}
                                className="form-check d-flex align-items-center gap-2 mb-0"
                              >
                                <input
                                  type="checkbox"
                                  className="form-check-input mt-0"
                                  checked={selectedAssigneeIds.has(String(userId))}
                                  onChange={() => toggleAssignee(userId)}
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
                  </section>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Creating..." : "Create Task"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default WorkflowTaskCreateModal;
