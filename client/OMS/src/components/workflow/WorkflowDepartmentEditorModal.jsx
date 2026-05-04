import { useEffect, useState } from "react";

const normalizeText = (value) => String(value ?? "").trim();

const MEMBER_ROLES = ["member", "lead", "manager"];

const createMemberDraft = (entry = null) => ({
  user: entry?.user?._id || entry?.user || "",
  role: normalizeText(entry?.role) || "member",
  is_active: entry?.is_active !== false,
});

const createDraft = (department = null) => ({
  name: normalizeText(department?.name),
  key: normalizeText(department?.key),
  description: normalizeText(department?.description),
  is_active: department?.is_active !== false,
  members: Array.isArray(department?.members)
    ? department.members.map((entry) => createMemberDraft(entry))
    : [],
});

const WorkflowDepartmentEditorModal = ({
  department = null,
  users = [],
  saving = false,
  error = "",
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState(() => createDraft(department));

  useEffect(() => {
    setDraft(createDraft(department));
  }, [department]);

  const updateMember = (index, field, value) => {
    setDraft((prev) => ({
      ...prev,
      members: prev.members.map((entry, memberIndex) =>
        memberIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave?.({
      name: normalizeText(draft.name),
      key: normalizeText(draft.key),
      description: normalizeText(draft.description),
      is_active: Boolean(draft.is_active),
      members: draft.members
        .map((entry) => ({
          user: normalizeText(entry.user),
          role: normalizeText(entry.role) || "member",
          is_active: entry.is_active !== false,
        }))
        .filter((entry) => entry.user),
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
              <h5 className="modal-title">
                {department ? "Edit Workflow Department" : "Create Workflow Department"}
              </h5>
              <div className="small text-muted">
                Manage department identity and workflow members.
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
                <div className="col-md-6">
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
                <div className="col-md-6">
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
                <div className="col-12">
                  <div className="form-check form-switch">
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
                    <label className="form-check-label">Active Department</label>
                  </div>
                </div>
              </div>

              <div className="d-flex justify-content-between align-items-center gap-2 mt-4 mb-3">
                <div>
                  <h6 className="mb-1">Members</h6>
                  <div className="small text-secondary">
                    Add or remove members and set role per user.
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      members: [...prev.members, createMemberDraft()],
                    }))
                  }
                >
                  Add Member
                </button>
              </div>

              {draft.members.length === 0 ? (
                <div className="alert alert-secondary mb-0 py-2">
                  No members added yet.
                </div>
              ) : (
                <div className="d-grid gap-3">
                  {draft.members.map((member, index) => (
                    <div key={`department-member-${index}`} className="workflow-member-card">
                      <div className="row g-3 align-items-end">
                        <div className="col-md-6">
                          <label className="form-label">User</label>
                          <select
                            className="form-select"
                            value={member.user}
                            onChange={(event) => updateMember(index, "user", event.target.value)}
                          >
                            <option value="">Select user</option>
                            {users.map((user) => (
                              <option key={user._id || user.id} value={user._id || user.id}>
                                {user.name || user.username} ({user.role || "user"})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-md-3">
                          <label className="form-label">Role</label>
                          <select
                            className="form-select"
                            value={member.role}
                            onChange={(event) => updateMember(index, "role", event.target.value)}
                          >
                            {MEMBER_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-md-2">
                          <div className="form-check form-switch mt-4 pt-2">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={member.is_active}
                              onChange={(event) =>
                                updateMember(index, "is_active", event.target.checked)
                              }
                            />
                            <label className="form-check-label">Active</label>
                          </div>
                        </div>
                        <div className="col-md-1 d-flex justify-content-end">
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                members: prev.members.filter(
                                  (_entry, memberIndex) => memberIndex !== index,
                                ),
                              }))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                {saving ? "Saving..." : department ? "Save Changes" : "Create Department"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default WorkflowDepartmentEditorModal;
