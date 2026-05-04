import { useCallback, useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import WorkflowTaskTypeEditorModal from "../components/workflow/WorkflowTaskTypeEditorModal";
import { usePermissions } from "../auth/PermissionContext";
import {
  createWorkflowTaskType,
  getWorkflowDepartments,
  getWorkflowTaskTypes,
  getWorkflowUsers,
  updateWorkflowTaskType,
} from "../api/workflowApi";
import "../App.css";

const WorkflowTaskTypes = () => {
  const { hasPermission, role } = usePermissions();
  const isManagerOrAdmin = ["admin", "manager"].includes(String(role || "").trim().toLowerCase());
  const canManageWorkflow = isManagerOrAdmin && hasPermission("workflow", "manage");

  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingTaskType, setEditingTaskType] = useState(null);

  const loadPage = useCallback(async () => {
    if (!canManageWorkflow) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [taskTypeResult, departmentResult, userResult] = await Promise.allSettled([
        getWorkflowTaskTypes(),
        getWorkflowDepartments(),
        getWorkflowUsers(),
      ]);

      if (taskTypeResult.status !== "fulfilled") {
        throw taskTypeResult.reason;
      }
      setRows(Array.isArray(taskTypeResult.value?.data) ? taskTypeResult.value.data : []);
      setDepartments(
        departmentResult.status === "fulfilled"
          ? Array.isArray(departmentResult.value?.data)
            ? departmentResult.value.data
            : []
          : [],
      );
      setUsers(
        userResult.status === "fulfilled" && Array.isArray(userResult.value)
          ? userResult.value
          : [],
      );
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to load workflow task types.",
      );
    } finally {
      setLoading(false);
    }
  }, [canManageWorkflow]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const handleSave = async (payload) => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (editingTaskType?._id) {
        await updateWorkflowTaskType(editingTaskType._id, payload);
        setSuccess("Workflow task type updated successfully.");
      } else {
        await createWorkflowTaskType(payload);
        setSuccess("Workflow task type created successfully.");
      }
      setShowModal(false);
      setEditingTaskType(null);
      await loadPage();
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message
          || saveError?.message
          || "Failed to save workflow task type.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!canManageWorkflow) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-3">
          <div className="alert alert-danger">
            Workflow task type management is limited to managers and admins.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-shell py-3">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h2 className="h4">Workflow Task Types</h2>
            <div className="text-secondary">
              Configure auto-create modes, file rules, departments, and review defaults.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingTaskType(null);
              setShowModal(true);
            }}
          >
            Create Task Type
          </button>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5 text-secondary">Loading workflow task types...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-5 text-secondary">
                No workflow task types found.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Key</th>
                      <th>Category</th>
                      <th>Mode</th>
                      <th>Department</th>
                      <th>Priority</th>
                      <th>Review</th>
                      <th>Estimated Minutes</th>
                      <th>Extensions</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((taskType) => (
                      <tr key={taskType._id}>
                        <td>
                          <div className="fw-semibold">{taskType.name}</div>
                          <div className="small text-secondary">{taskType.description || "—"}</div>
                        </td>
                        <td>{taskType.key}</td>
                        <td>{taskType.category}</td>
                        <td>{taskType.auto_create_mode}</td>
                        <td>{taskType.default_department?.name || "—"}</td>
                        <td>{taskType.default_priority || "normal"}</td>
                        <td>{taskType.requires_review === false ? "No" : "Yes"}</td>
                        <td>{Number(taskType.estimated_minutes || 0)}</td>
                        <td>
                          {Array.isArray(taskType.file_match_rule?.extensions)
                            && taskType.file_match_rule.extensions.length > 0
                            ? taskType.file_match_rule.extensions.join(", ")
                            : "—"}
                        </td>
                        <td>{taskType.is_active === false ? "Inactive" : "Active"}</td>
                        <td>
                          <div className="d-flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => {
                                setEditingTaskType(taskType);
                                setShowModal(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={async () => {
                                setSaving(true);
                                setError("");
                                setSuccess("");
                                try {
                                  await updateWorkflowTaskType(taskType._id, {
                                    is_active: taskType.is_active === false,
                                  });
                                  setSuccess("Workflow task type status updated successfully.");
                                  await loadPage();
                                } catch (toggleError) {
                                  setError(
                                    toggleError?.response?.data?.message
                                      || toggleError?.message
                                      || "Failed to update workflow task type status.",
                                  );
                                } finally {
                                  setSaving(false);
                                }
                              }}
                            >
                              {taskType.is_active === false ? "Enable" : "Disable"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <WorkflowTaskTypeEditorModal
          taskType={editingTaskType}
          departments={departments}
          users={users}
          saving={saving}
          error={error}
          onClose={() => {
            setShowModal(false);
            setEditingTaskType(null);
          }}
          onSave={handleSave}
        />
      )}
    </>
  );
};

export default WorkflowTaskTypes;
