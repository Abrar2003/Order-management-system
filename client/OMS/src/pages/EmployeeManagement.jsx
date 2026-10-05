import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { usePermissions } from "../auth/PermissionContext";
import "../App.css";

const EmployeeManagement = () => {
  const { isAdmin } = usePermissions();
  const [data, setData] = useState({ tasks: [], employees: [] });
  const [loading, setLoading] = useState(true);
  const [savingTask, setSavingTask] = useState("");
  const [savingDepartment, setSavingDepartment] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadManagement = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/employee-report/management");
      setData(response?.data || { tasks: [], employees: [] });
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message || loadError?.message || "Failed to load employee management.",
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadManagement();
  }, [loadManagement]);

  const updateAssignees = (taskKey, employeeId) => {
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) => {
        if (task.key !== taskKey) return task;
        const assigneeIds = new Set(task.assignee_ids || []);
        if (assigneeIds.has(employeeId)) assigneeIds.delete(employeeId);
        else assigneeIds.add(employeeId);
        return { ...task, assignee_ids: Array.from(assigneeIds) };
      }),
    }));
  };

  const assignmentSummary = (task) => {
    const selectedIds = new Set(task.assignee_ids || []);
    const names = data.employees
      .filter((employee) => selectedIds.has(employee._id))
      .map((employee) => employee.name || employee.email || "Unnamed user");
    return names.join(", ") || "Select employees";
  };

  const saveTask = async (task) => {
    setSavingTask(task.key);
    setError("");
    setSuccess("");
    try {
      await api.put(`/employee-report/assignments/${task.key}`, { assignee_ids: task.assignee_ids || [] });
      setSuccess(`${task.label} assignments saved.`);
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message || saveError?.message || "Failed to save task assignment.",
      );
    } finally {
      setSavingTask("");
    }
  };

  const departments = useMemo(() => Array.from(new Set([
    "IT", "QC", "Production", "Design", "Operations", "Management",
    ...data.employees.map((employee) => employee.department).filter(Boolean),
  ])).sort((left, right) => left.localeCompare(right)), [data.employees]);

  const setDepartment = (employeeId, department) => {
    setData((current) => ({
      ...current,
      employees: current.employees.map((employee) => (
        employee._id === employeeId ? { ...employee, department } : employee
      )),
    }));
  };

  const saveDepartment = async (employee) => {
    setSavingDepartment(employee._id);
    setError("");
    setSuccess("");
    try {
      const response = await api.patch(`/employee-report/employees/${employee._id}/department`, {
        department: employee.department || "",
      });
      setDepartment(employee._id, response?.data?.employee?.department || "");
      setSuccess(`${employee.name || employee.email || "Employee"} department saved.`);
    } catch (saveError) {
      setError(saveError?.response?.data?.message || saveError?.message || "Failed to save department.");
    } finally {
      setSavingDepartment("");
    }
  };

  if (!isAdmin) {
    return <><Navbar /><main className="page-shell py-4"><div className="alert alert-danger">Employee management is admin-only.</div></main></>;
  }

  return (
    <>
      <Navbar />
      <main className="page-shell py-4">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
          <div>
            <p className="text-uppercase text-secondary fw-semibold small mb-1">Settings</p>
            <h1 className="h3 mb-1">Employee Management</h1>
            <p className="text-secondary mb-0">Organize employees by department, then assign each live task.</p>
          </div>
          <button type="button" className="btn btn-outline-secondary" onClick={loadManagement} disabled={loading || Boolean(savingTask) || Boolean(savingDepartment)}>Refresh</button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}
        <section className="card om-card shadow-sm mb-4">
          <div className="card-header bg-transparent py-3">
            <h2 className="h6 mb-1">Employee departments</h2>
            <p className="text-secondary small mb-0">Select an existing department or type a new one to create it.</p>
          </div>
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center text-secondary py-4">Loading employees...</div>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead><tr><th>Employee</th><th>Role</th><th>Department</th><th /></tr></thead>
                  <tbody>
                    {data.employees.map((employee) => (
                      <tr key={employee._id}>
                        <td><strong>{employee.name || employee.email || "Unnamed user"}</strong><div className="small text-secondary">{employee.email}</div></td>
                        <td>{employee.role || "user"}</td>
                        <td style={{ minWidth: 220 }}>
                          <input
                            className="form-control"
                            list="employee-departments"
                            value={employee.department || ""}
                            placeholder="Select or create department"
                            disabled={Boolean(savingDepartment)}
                            onChange={(event) => setDepartment(employee._id, event.target.value)}
                          />
                        </td>
                        <td className="text-end"><button type="button" className="btn btn-primary btn-sm" disabled={Boolean(savingDepartment)} onClick={() => saveDepartment(employee)}>{savingDepartment === employee._id ? "Saving..." : "Save"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="employee-departments">
                  {departments.map((department) => <option key={department} value={department} />)}
                </datalist>
              </div>
            )}
          </div>
        </section>

        <section className="card om-card shadow-sm">
          <div className="card-header bg-transparent py-3"><h2 className="h6 mb-0">Task assignments</h2></div>
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center text-secondary py-5">Loading employees...</div>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead><tr><th>Task</th><th className="text-end">Pending</th><th>Assigned employees</th><th /></tr></thead>
                  <tbody>
                    {data.tasks.map((task) => (
                      <tr key={task.key}>
                        <td>{task.label}</td>
                        <td className="text-end fw-semibold">{task.pending_count ?? 0}</td>
                        <td style={{ minWidth: 260 }}>
                          {task.configurable ? (
                            <details className="employee-assignment-select">
                              <summary
                                className="form-select"
                                aria-label={`${task.label} assignees`}
                                title={assignmentSummary(task)}
                              >
                                {assignmentSummary(task)}
                              </summary>
                              <div className="employee-assignment-options shadow-sm">
                              {data.employees.map((employee) => (
                                <label key={employee._id} className="form-check">
                                  <input
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={(task.assignee_ids || []).includes(employee._id)}
                                    disabled={Boolean(savingTask)}
                                    onChange={() => updateAssignees(task.key, employee._id)}
                                  />
                                  <span className="form-check-label">
                                  {employee.name || employee.email || "Unnamed user"} ({employee.role || "user"})
                                  </span>
                                </label>
                              ))}
                              </div>
                            </details>
                          ) : (
                            <span className="text-secondary">All QC users (fixed)</span>
                          )}
                        </td>
                        <td className="text-end">
                          {task.configurable && (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => saveTask(task)} disabled={Boolean(savingTask)}>
                              {savingTask === task.key ? "Saving..." : "Save"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
};

export default EmployeeManagement;
