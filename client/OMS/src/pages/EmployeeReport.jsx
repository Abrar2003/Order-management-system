import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.service";
import { isQcOnlyUserRole } from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";
import "../App.css";

const formatCount = new Intl.NumberFormat("en-IN");
const asCount = (value) => Math.max(0, Number(value) || 0);
const FILE_TASK_OPTIONS = Object.freeze({
  cad_upload: { fileType: "cad_file" },
  assembly_upload: { fileType: "assembly_file" },
  mounting_upload: { fileType: "mounting_file" },
  shipping_marks_upload: { fileType: "shipping_marks" },
  packaging_ppt_upload: { fileType: "packeging_ppt" },
  cad_approval: { fileType: "cad_file", qcApproval: true },
  assembly_approval: { fileType: "assembly_file", qcApproval: true },
  mounting_approval: { fileType: "mounting_file", qcApproval: true },
});

const EmployeeReport = () => {
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  const isQcOnly = isQcOnlyUserRole(getUserFromToken()?.role);
  const [report, setReport] = useState({ tasks: [] });
  const [management, setManagement] = useState({ tasks: [], employees: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [workloadFilter, setWorkloadFilter] = useState("all");
  const [sort, setSort] = useState("pending_desc");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [personalResponse, managementResponse] = await Promise.all([
        api.get("/employee-report/me"),
        isAdmin ? api.get("/employee-report/management") : Promise.resolve(null),
      ]);
      setReport(personalResponse?.data || { tasks: [] });
      if (managementResponse) setManagement(managementResponse?.data || { tasks: [], employees: [] });
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message || loadError?.message || "Failed to load employee report.",
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const dashboardTasks = isAdmin ? management.tasks : report.tasks;
  const employeeNames = useCallback((assigneeIds = []) => {
    const names = assigneeIds
      .map((id) => management.employees.find((employee) => String(employee._id) === String(id)))
      .map((employee) => employee?.name || employee?.email)
      .filter(Boolean);
    return names.length ? names.join(", ") : "Not assigned";
  }, [management.employees]);

  const assignedLabel = useCallback((task) => {
    if (task.qc_shared || !task.configurable) return "All QC users";
    return isAdmin ? employeeNames(task.assignee_ids) : "Assigned to you";
  }, [employeeNames, isAdmin]);

  const summary = useMemo(() => {
    const totalTasks = dashboardTasks.reduce((sum, task) => sum + asCount(task.total_count), 0);
    const totalPending = dashboardTasks.reduce((sum, task) => sum + asCount(task.pending_count), 0);
    const assignedTaskTypes = dashboardTasks.filter((task) =>
      task.qc_shared || (task.assignee_ids || []).length > 0,
    ).length;
    const assignedEmployeeIds = new Set(
      dashboardTasks.flatMap((task) => (task.configurable ? task.assignee_ids || [] : [])),
    );
    if (isAdmin && dashboardTasks.some((task) => task.qc_shared)) {
      management.employees
        .filter((employee) => String(employee.role || "").trim().toLowerCase() === "qc")
        .forEach((employee) => assignedEmployeeIds.add(employee._id));
    }
    return {
      totalTasks,
      totalPending,
      assignedTaskTypes,
      assignedEmployees: isAdmin ? assignedEmployeeIds.size : (dashboardTasks.length ? 1 : 0),
    };
  }, [dashboardTasks, isAdmin, management.employees]);

  const visibleTasks = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    const nextTasks = dashboardTasks.filter((task) => {
      const total = asCount(task.total_count);
      const pending = Math.min(total, asCount(task.pending_count));
      const matchesSearch = !searchTerm || task.label.toLowerCase().includes(searchTerm);
      const matchesEmployee = employeeFilter === "all"
        || (employeeFilter === "all_qc" ? task.qc_shared : (task.assignee_ids || []).includes(employeeFilter));
      const matchesWorkload = workloadFilter === "all"
        || (workloadFilter === "pending" ? pending > 0 : total > 0 && pending === 0);
      return matchesSearch && matchesEmployee && matchesWorkload;
    });

    return nextTasks.sort((left, right) => {
      if (sort === "pending_asc") return asCount(left.pending_count) - asCount(right.pending_count);
      if (sort === "name") return left.label.localeCompare(right.label);
      return asCount(right.pending_count) - asCount(left.pending_count);
    });
  }, [dashboardTasks, employeeFilter, search, sort, workloadFilter]);

  const openTaskFiles = useCallback((task, pendingOnly) => {
    const option = FILE_TASK_OPTIONS[task.key];
    if (!option || (option.qcApproval && !isQcOnly)) return;
    const params = new URLSearchParams({
      file_type: option.fileType,
      country: option.qcApproval ? "India" : "all",
    });
    if (pendingOnly && !option.qcApproval) params.set("file_status", "missing");
    navigate(`/item-files?${params.toString()}`);
  }, [isQcOnly, navigate]);

  return (
    <>
      <Navbar />
      <main className="page-shell py-4 employee-report-page">
        <div className="employee-report-header">
          <div>
            <p className="text-uppercase text-secondary fw-semibold small mb-1">Live workload</p>
            <h1>Task Assignment Overview</h1>
            <p className="text-secondary mb-0">
              Monitor total workload, pending items, and employee responsibilities.
            </p>
          </div>
          <button type="button" className="btn btn-outline-secondary employee-report-refresh" onClick={loadReport} disabled={loading}>
            Refresh
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {loading ? (
          <div className="text-center text-secondary py-5">Loading report...</div>
        ) : (
          <>
            <section className="employee-report-summary-grid" aria-label="Workload summary">
              <article className="employee-report-summary-card is-emphasized">
                <span>Total Tasks</span><strong>{formatCount.format(summary.totalTasks)}</strong>
              </article>
              <article className="employee-report-summary-card is-emphasized">
                <span>Total Pending</span><strong>{formatCount.format(summary.totalPending)}</strong>
              </article>
              <article className="employee-report-summary-card">
                <span>Assigned Task Types</span><strong>{formatCount.format(summary.assignedTaskTypes)}</strong>
              </article>
              <article className="employee-report-summary-card">
                <span>Employees Assigned</span><strong>{formatCount.format(summary.assignedEmployees)}</strong>
              </article>
            </section>

            {dashboardTasks.length === 0 ? (
              <section className="employee-report-empty-state">
                <h2>No tasks are assigned to you.</h2>
                <p>Tasks assigned to you will appear here with their current workload.</p>
              </section>
            ) : (
              <>
                <div className="employee-report-toolbar" aria-label="Task filters">
                  <input
                    type="search"
                    className="form-control"
                    value={search}
                    placeholder="Search task"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {isAdmin && (
                    <select className="form-select" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                      <option value="all">All employees</option>
                      <option value="all_qc">All QC users</option>
                      {management.employees.map((employee) => (
                        <option key={employee._id} value={employee._id}>
                          {employee.name || employee.email || "Unnamed user"}
                        </option>
                      ))}
                    </select>
                  )}
                  <select className="form-select" value={workloadFilter} onChange={(event) => setWorkloadFilter(event.target.value)}>
                    <option value="all">All workload</option>
                    <option value="pending">Has pending work</option>
                    <option value="complete">Completed</option>
                  </select>
                  <select className="form-select" value={sort} onChange={(event) => setSort(event.target.value)}>
                    <option value="pending_desc">Pending: High to low</option>
                    <option value="pending_asc">Pending: Low to high</option>
                    <option value="name">Task name</option>
                  </select>
                </div>

                {visibleTasks.length === 0 ? (
                  <div className="employee-report-empty-state compact"><h2>No tasks match these filters.</h2></div>
                ) : (
                  <section className="employee-report-task-grid" aria-label="Task workload cards">
                    {visibleTasks.map((task) => {
                      const total = asCount(task.total_count);
                      const pending = Math.min(total, asCount(task.pending_count));
                      const completed = Math.max(0, total - pending);
                      const completedPercent = total ? Math.round((completed / total) * 100) : 0;
                      const canOpenFiles = Boolean(FILE_TASK_OPTIONS[task.key])
                        && (!FILE_TASK_OPTIONS[task.key].qcApproval || isQcOnly);
                      const canOpenTotalFiles = canOpenFiles && !FILE_TASK_OPTIONS[task.key].qcApproval;
                      return (
                        <article key={task.key} className="employee-report-task-card" title={`View ${task.label} workload`}>
                          <div>
                            <span className="employee-report-card-type">
                              {task.qc_shared ? "Shared QC queue" : "Assigned task"}
                            </span>
                            <h2>{task.label}</h2>
                          </div>
                          <div className="employee-report-metrics">
                            <div>
                              <span>Total</span>
                              {canOpenTotalFiles ? (
                                <button type="button" className="employee-report-count-link" onClick={() => openTaskFiles(task, false)}>
                                  {formatCount.format(total)}
                                </button>
                              ) : <strong>{formatCount.format(total)}</strong>}
                            </div>
                            <div className="is-pending">
                              <span>Pending</span>
                              {canOpenFiles ? (
                                <button type="button" className="employee-report-count-link" onClick={() => openTaskFiles(task, true)}>
                                  {formatCount.format(pending)}
                                </button>
                              ) : <strong>{formatCount.format(pending)}</strong>}
                            </div>
                          </div>
                          <div className="employee-report-completion">
                            <span>Completed {formatCount.format(completed)}</span><span>{completedPercent}%</span>
                          </div>
                          <div className="employee-report-progress" aria-label={`${completedPercent}% completed`}>
                            <span style={{ width: `${completedPercent}%` }} />
                          </div>
                          <div className="employee-report-card-assignee">
                            <span>Assigned to</span><strong>{assignedLabel(task)}</strong>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
};

export default EmployeeReport;
