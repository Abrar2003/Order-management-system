import { useCallback, useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import WorkflowDepartmentEditorModal from "../components/workflow/WorkflowDepartmentEditorModal";
import { usePermissions } from "../auth/PermissionContext";
import {
  createWorkflowDepartment,
  getWorkflowDepartments,
  getWorkflowUsers,
  updateWorkflowDepartment,
} from "../api/workflowApi";
import "../App.css";

const WorkflowDepartments = () => {
  const { hasPermission, role } = usePermissions();
  const isManagerOrAdmin = ["admin", "manager"].includes(String(role || "").trim().toLowerCase());
  const canManageWorkflow = isManagerOrAdmin && hasPermission("workflow", "manage");

  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState(null);

  const loadPage = useCallback(async () => {
    if (!canManageWorkflow) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [departmentResult, userResult] = await Promise.allSettled([
        getWorkflowDepartments(),
        getWorkflowUsers(),
      ]);
      if (departmentResult.status !== "fulfilled") {
        throw departmentResult.reason;
      }
      setRows(
        Array.isArray(departmentResult.value?.data)
          ? departmentResult.value.data
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
          || "Failed to load workflow departments.",
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
      if (editingDepartment?._id) {
        await updateWorkflowDepartment(editingDepartment._id, payload);
        setSuccess("Workflow department updated successfully.");
      } else {
        await createWorkflowDepartment(payload);
        setSuccess("Workflow department created successfully.");
      }
      setShowModal(false);
      setEditingDepartment(null);
      await loadPage();
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message
          || saveError?.message
          || "Failed to save workflow department.",
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
            Workflow department management is limited to managers and admins.
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
            <h2 className="h4">Workflow Departments</h2>
            <div className="text-secondary">
              Manage workflow department membership and activation state.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingDepartment(null);
              setShowModal(true);
            }}
          >
            Create Department
          </button>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5 text-secondary">Loading workflow departments...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-5 text-secondary">
                No workflow departments found.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Key</th>
                      <th>Description</th>
                      <th>Members</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((department) => (
                      <tr key={department._id}>
                        <td>{department.name}</td>
                        <td>{department.key}</td>
                        <td>{department.description || "—"}</td>
                        <td>
                          {Array.isArray(department.members) && department.members.length > 0
                            ? department.members
                                .map(
                                  (member) =>
                                    `${member.user?.name || "User"} (${member.role || "member"})`,
                                )
                                .join(", ")
                            : "No members"}
                        </td>
                        <td>{department.is_active === false ? "Inactive" : "Active"}</td>
                        <td>
                          <div className="d-flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => {
                                setEditingDepartment(department);
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
                                  await updateWorkflowDepartment(department._id, {
                                    is_active: department.is_active === false,
                                  });
                                  setSuccess("Workflow department status updated successfully.");
                                  await loadPage();
                                } catch (toggleError) {
                                  setError(
                                    toggleError?.response?.data?.message
                                      || toggleError?.message
                                      || "Failed to update workflow department status.",
                                  );
                                } finally {
                                  setSaving(false);
                                }
                              }}
                            >
                              {department.is_active === false ? "Enable" : "Disable"}
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
        <WorkflowDepartmentEditorModal
          department={editingDepartment}
          users={users}
          saving={saving}
          error={error}
          onClose={() => {
            setShowModal(false);
            setEditingDepartment(null);
          }}
          onSave={handleSave}
        />
      )}
    </>
  );
};

export default WorkflowDepartments;
