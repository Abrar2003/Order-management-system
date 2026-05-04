import { useEffect, useMemo, useState } from "react";

const normalizeText = (value) => String(value ?? "").trim();

const splitCsv = (value) =>
  normalizeText(value)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const WORKFLOW_TASK_TYPE_CATEGORIES = [
  "image",
  "pis",
  "cad",
  "three_d",
  "carton",
  "sticker",
  "other",
];

const WORKFLOW_AUTO_CREATE_MODES = [
  "per_file",
  "per_direct_subfolder",
  "once_per_batch",
  "manual",
];

const WORKFLOW_PRIORITIES = ["low", "normal", "high", "urgent"];

const createDraft = (taskType = null) => ({
  key: normalizeText(taskType?.key),
  name: normalizeText(taskType?.name),
  description: normalizeText(taskType?.description),
  category: normalizeText(taskType?.category) || "other",
  default_department: taskType?.default_department?._id || taskType?.default_department || "",
  default_assignees: Array.isArray(taskType?.default_assignees)
    ? taskType.default_assignees
        .map((entry) => entry?.user?._id || entry?.user || entry?._id || entry?.id)
        .filter(Boolean)
    : [],
  default_priority: normalizeText(taskType?.default_priority) || "normal",
  auto_create_mode: normalizeText(taskType?.auto_create_mode) || "once_per_batch",
  extensions_text: Array.isArray(taskType?.file_match_rule?.extensions)
    ? taskType.file_match_rule.extensions.join(", ")
    : "",
  mime_types_text: Array.isArray(taskType?.file_match_rule?.mime_types)
    ? taskType.file_match_rule.mime_types.join(", ")
    : "",
  name_patterns_text: Array.isArray(taskType?.file_match_rule?.name_patterns)
    ? taskType.file_match_rule.name_patterns.join(", ")
    : "",
  folder_patterns_text: Array.isArray(taskType?.file_match_rule?.folder_patterns)
    ? taskType.file_match_rule.folder_patterns.join(", ")
    : "",
  estimated_minutes: taskType?.estimated_minutes ?? 0,
  requires_review: taskType?.requires_review !== false,
  is_active: taskType?.is_active !== false,
});

const WorkflowTaskTypeEditorModal = ({
  taskType = null,
  departments = [],
  users = [],
  saving = false,
  error = "",
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState(() => createDraft(taskType));

  useEffect(() => {
    setDraft(createDraft(taskType));
  }, [taskType]);

  const modalTitle = taskType ? "Edit Workflow Task Type" : "Create Workflow Task Type";

  const selectedUserIds = useMemo(
    () => new Set(draft.default_assignees.map((entry) => String(entry))),
    [draft.default_assignees],
  );

  const toggleDefaultAssignee = (userId) => {
    setDraft((prev) => ({
      ...prev,
      default_assignees: selectedUserIds.has(String(userId))
        ? prev.default_assignees.filter((entry) => String(entry) !== String(userId))
        : [...prev.default_assignees, userId],
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave?.({
      key: normalizeText(draft.key),
      name: normalizeText(draft.name),
      description: normalizeText(draft.description),
      category: normalizeText(draft.category) || "other",
      default_department: normalizeText(draft.default_department) || null,
      default_assignees: draft.default_assignees.map((userId) => ({ user: userId })),
      default_priority: normalizeText(draft.default_priority) || "normal",
      auto_create_mode: normalizeText(draft.auto_create_mode) || "once_per_batch",
      file_match_rule: {
        extensions: splitCsv(draft.extensions_text),
        mime_types: splitCsv(draft.mime_types_text),
        name_patterns: splitCsv(draft.name_patterns_text),
        folder_patterns: splitCsv(draft.folder_patterns_text),
      },
      estimated_minutes: Number(draft.estimated_minutes || 0),
      requires_review: Boolean(draft.requires_review),
      is_active: Boolean(draft.is_active),
    });
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
        className="modal-dialog modal-dialog-centered modal-lg workflow-modal-dialog"
        role="document"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title">{modalTitle}</h5>
              <div className="small text-muted">
                Configure how a folder manifest becomes production tasks.
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
                <div className="col-md-4">
                  <label className="form-label">Key</label>
                  <input
                    type="text"
                    className="form-control"
                    value={draft.key}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, key: event.target.value }))
                    }
                  />
                </div>
                <div className="col-md-5">
                  <label className="form-label">Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, name: event.target.value }))
                    }
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label">Category</label>
                  <select
                    className="form-select"
                    value={draft.category}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, category: event.target.value }))
                    }
                  >
                    {WORKFLOW_TASK_TYPE_CATEGORIES.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Default Department</label>
                  <select
                    className="form-select"
                    value={draft.default_department}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        default_department: event.target.value,
                      }))
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
                    value={draft.default_priority}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        default_priority: event.target.value,
                      }))
                    }
                  >
                    {WORKFLOW_PRIORITIES.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-3">
                  <label className="form-label">Auto Create Mode</label>
                  <select
                    className="form-select"
                    value={draft.auto_create_mode}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        auto_create_mode: event.target.value,
                      }))
                    }
                  >
                    {WORKFLOW_AUTO_CREATE_MODES.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Estimated Minutes</label>
                  <input
                    type="number"
                    min="0"
                    className="form-control"
                    value={draft.estimated_minutes}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        estimated_minutes: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="col-md-3">
                  <div className="form-check form-switch mt-4 pt-2">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={draft.requires_review}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          requires_review: event.target.checked,
                        }))
                      }
                    />
                    <label className="form-check-label">Requires Review</label>
                  </div>
                </div>

                <div className="col-md-3">
                  <div className="form-check form-switch mt-4 pt-2">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={draft.is_active}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          is_active: event.target.checked,
                        }))
                      }
                    />
                    <label className="form-check-label">Active</label>
                  </div>
                </div>

                <div className="col-12">
                  <label className="form-label">Description</label>
                  <textarea
                    rows="2"
                    className="form-control"
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="col-md-6">
                  <label className="form-label">Extensions</label>
                  <textarea
                    rows="2"
                    className="form-control"
                    value={draft.extensions_text}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        extensions_text: event.target.value,
                      }))
                    }
                  />
                  <div className="form-text">Comma or line separated. Example: `jpg, jpeg, png`</div>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Mime Types</label>
                  <textarea
                    rows="2"
                    className="form-control"
                    value={draft.mime_types_text}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        mime_types_text: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="col-md-6">
                  <label className="form-label">Name Patterns</label>
                  <textarea
                    rows="2"
                    className="form-control"
                    value={draft.name_patterns_text}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        name_patterns_text: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="col-md-6">
                  <label className="form-label">Folder Patterns</label>
                  <textarea
                    rows="2"
                    className="form-control"
                    value={draft.folder_patterns_text}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        folder_patterns_text: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="col-12">
                  <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
                    <label className="form-label mb-0">Default Assignees</label>
                    <span className="small text-secondary">Future-ready</span>
                  </div>
                  {users.length === 0 ? (
                    <div className="alert alert-secondary mb-0 py-2">
                      No user options available.
                    </div>
                  ) : (
                    <div className="workflow-user-picker">
                      {users.map((user) => {
                        const userId = user?._id || user?.id;
                        const checked = selectedUserIds.has(String(userId));
                        return (
                          <label
                            key={userId}
                            className="form-check d-flex align-items-center gap-2 mb-0"
                          >
                            <input
                              type="checkbox"
                              className="form-check-input mt-0"
                              checked={checked}
                              onChange={() => toggleDefaultAssignee(userId)}
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
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : taskType ? "Save Changes" : "Create Task Type"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default WorkflowTaskTypeEditorModal;
