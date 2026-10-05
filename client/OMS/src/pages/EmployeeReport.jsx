import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { usePermissions } from "../auth/PermissionContext";
import { getEmployeeTaskDrilldownPath } from "../utils/employeeTaskDrilldown";
import "../App.css";

const formatCount = new Intl.NumberFormat("en-IN");
const asCount = (value) => Math.max(0, Number(value) || 0);
const EMPTY_METRIC = Object.freeze({ total: 0, pending: 0 });

const addMetric = (target, metric = EMPTY_METRIC) => ({
  total: target.total + asCount(metric.total),
  pending: target.pending + asCount(metric.pending),
});

const completionPercent = ({ total, pending }) => (
  total ? Math.round((Math.max(0, total - Math.min(total, pending)) / total) * 100) : 0
);

const departmentName = (employee = {}) => String(employee.department || "").trim() || "Unassigned";
const hasDepartment = (employee = {}) => Boolean(String(employee.department || "").trim());
const isQcEmployee = (employee = {}) => String(employee.role || "").trim().toLowerCase() === "qc";
const QC_TEAM = Object.freeze({ _id: "qc-team", name: "QC Team", department: "QC", role: "QC" });

const EmployeeReport = () => {
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const [report, setReport] = useState({ tasks: [], employee: null });
  const [management, setManagement] = useState({ tasks: [], employees: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
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
      setReport(personalResponse?.data || { tasks: [], employee: null });
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
  const sourceEmployees = useMemo(
    () => (isAdmin ? management.employees : (report.employee ? [report.employee] : [])),
    [isAdmin, management.employees, report.employee],
  );
  const qcUsers = useMemo(() => sourceEmployees.filter(isQcEmployee), [sourceEmployees]);
  const qcUserIds = useMemo(() => new Set(qcUsers.map((employee) => String(employee._id))), [qcUsers]);
  const employees = useMemo(() => [
    ...sourceEmployees.filter((employee) => !isQcEmployee(employee) && hasDepartment(employee)),
    ...(qcUsers.length ? [QC_TEAM] : []),
  ], [qcUsers.length, sourceEmployees]);
  const countries = useMemo(() => Array.from(new Set(
    dashboardTasks.flatMap((task) => Object.keys(task.country_metrics || {})),
  )).sort((left, right) => left.localeCompare(right)), [dashboardTasks]);

  const taskWorkloads = useMemo(() => {
    const employeesById = new Map(employees.map((employee) => [String(employee._id), employee]));
    const workloads = [];
    for (const task of dashboardTasks) {
      const assigneeIds = task.qc_shared
        ? (qcUsers.length ? [QC_TEAM._id] : [])
        : Array.from(new Set((task.assignee_ids || []).map((id) => (
          qcUserIds.has(String(id)) ? QC_TEAM._id : String(id)
        ))));
      for (const employeeId of assigneeIds) {
        const employee = employeesById.get(employeeId);
        if (!employee) continue;
        const countriesForTask = task.country_metrics || {};
        workloads.push({
          key: `${employeeId}-${task.key}`,
          employee,
          task,
          countries: countriesForTask,
          all: Object.values(countriesForTask).reduce(addMetric, { total: 0, pending: 0 }),
        });
      }
    }
    return workloads;
  }, [dashboardTasks, employees, qcUserIds, qcUsers.length]);

  const visibleWorkloads = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    const metric = (workload) => countryFilter === "all"
      ? workload.all : workload.countries[countryFilter] || EMPTY_METRIC;
    return taskWorkloads
      .filter((workload) => {
        const employee = workload.employee;
        const current = metric(workload);
        const name = `${employee.name || ""} ${employee.email || ""}`.toLowerCase();
        const matchesSearch = !searchTerm || name.includes(searchTerm);
        const matchesDepartment = departmentFilter === "all" || departmentName(employee) === departmentFilter;
        const matchesWorkload = workloadFilter === "all"
          || (workloadFilter === "pending" ? current.pending > 0 : current.total > 0 && current.pending === 0);
        return matchesSearch && matchesDepartment && matchesWorkload;
      })
      .sort((left, right) => {
        const leftMetric = metric(left);
        const rightMetric = metric(right);
        if (sort === "total_desc") return rightMetric.total - leftMetric.total;
        if (sort === "completion_desc") return completionPercent(rightMetric) - completionPercent(leftMetric);
        return rightMetric.pending - leftMetric.pending;
      });
  }, [countryFilter, departmentFilter, search, sort, taskWorkloads, workloadFilter]);

  const departments = useMemo(() => Array.from(new Set(employees.map(departmentName)))
    .sort((left, right) => left.localeCompare(right)), [employees]);
  const departmentWorkloads = useMemo(() => {
    const metric = (workload) => countryFilter === "all"
      ? workload.all : workload.countries[countryFilter] || EMPTY_METRIC;
    return visibleWorkloads.reduce((groups, workload) => {
      const department = departmentName(workload.employee);
      if (!groups[department]) groups[department] = { name: department, employeeIds: new Set(), workloads: [], summary: { total: 0, pending: 0 } };
      groups[department].employeeIds.add(workload.employee._id);
      groups[department].workloads.push(workload);
      groups[department].summary = addMetric(groups[department].summary, metric(workload));
      return groups;
    }, {});
  }, [countryFilter, visibleWorkloads]);

  return (
    <>
      <Navbar />
      <main className="page-shell py-4 employee-report-page">
        <div className="employee-report-header">
          <div>
            <p className="text-uppercase text-secondary fw-semibold small mb-1">Live workload</p>
            <h1>Employee Report</h1>
            <p className="text-secondary mb-0">
              See employee workload by department, then by country.
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
            {employees.length === 0 ? (
              <section className="employee-report-empty-state">
                <h2>No employees with departments are available.</h2>
                <p>Assign an employee to a department in Employee Management to include them here.</p>
              </section>
            ) : (
              <>
                <div className="employee-report-toolbar employee-report-employee-toolbar" aria-label="Employee filters">
                  <input
                    type="search"
                    className="form-control"
                    value={search}
                    placeholder="Search employee"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <select className="form-select" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                    <option value="all">All departments</option>
                    {departments.map((department) => <option key={department} value={department}>{department}</option>)}
                  </select>
                  <select className="form-select" value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}>
                    <option value="all">All countries</option>
                    {countries.map((country) => <option key={country} value={country}>{country}</option>)}
                  </select>
                  <select className="form-select" value={workloadFilter} onChange={(event) => setWorkloadFilter(event.target.value)}>
                    <option value="all">All workload</option>
                    <option value="pending">Has pending work</option>
                    <option value="complete">Completed</option>
                  </select>
                  <select className="form-select" value={sort} onChange={(event) => setSort(event.target.value)}>
                    <option value="pending_desc">Pending: High to low</option>
                    <option value="total_desc">Total: High to low</option>
                    <option value="completion_desc">Completion: High to low</option>
                  </select>
                </div>

                {visibleWorkloads.length === 0 ? (
                  <div className="employee-report-empty-state compact"><h2>No tasks match these filters.</h2></div>
                ) : (
                  <section className="employee-department-grid" aria-label="Department employee workloads">
                    {Object.values(departmentWorkloads).map((department) => {
                      const { total, pending } = department.summary;
                      const completed = Math.max(0, total - pending);
                      return (
                        <section className="employee-department-section" key={department.name}>
                          <header className="employee-department-header">
                            <p>Department</p><h2>{department.name}</h2>
                            <dl className="employee-department-summary">
                              <div><dt>Employees</dt><dd>{formatCount.format(department.employeeIds.size)}</dd></div>
                              <div><dt>Total</dt><dd>{formatCount.format(total)}</dd></div>
                              <div><dt>Pending</dt><dd>{formatCount.format(pending)}</dd></div>
                              <div><dt>Completed</dt><dd>{formatCount.format(completed)}</dd></div>
                            </dl>
                          </header>
                          <div className="employee-card-stack">
                            {department.workloads.map((workload) => {
                              const current = countryFilter === "all" ? workload.all : workload.countries[countryFilter] || EMPTY_METRIC;
                              const completedTasks = Math.max(0, current.total - current.pending);
                              const progress = completionPercent(current);
                              const countryRows = countryFilter === "all"
                                ? Object.entries(workload.countries)
                                  .filter(([, metric]) => metric.total > 0 || metric.pending > 0)
                                  .sort(([left], [right]) => left.localeCompare(right))
                                : [[countryFilter, current]];
                              const countLink = (value, status, country, label) => {
                                const destination = getEmployeeTaskDrilldownPath({
                                  taskKey: workload.task.key,
                                  status,
                                  country,
                                });
                                return destination ? (
                                  <button
                                    type="button"
                                    className="employee-report-count-link"
                                    onClick={() => navigate(destination)}
                                    aria-label={`View ${label} for ${workload.task.label}`}
                                  >
                                    {formatCount.format(value)}
                                  </button>
                                ) : <strong>{formatCount.format(value)}</strong>;
                              };
                              const countryCountLink = (value, status, country, label) => {
                                const destination = getEmployeeTaskDrilldownPath({
                                  taskKey: workload.task.key,
                                  status,
                                  country,
                                });
                                return destination ? (
                                  <button
                                    type="button"
                                    className="employee-country-count-link"
                                    onClick={() => navigate(destination)}
                                    aria-label={`View ${label} for ${country}`}
                                  >
                                    {label} {formatCount.format(value)}
                                  </button>
                                ) : <span>{label} {formatCount.format(value)}</span>;
                              };
                              return (
                                <article className="employee-workload-card" key={workload.key}>
                                  <header><div><p>{departmentName(workload.employee)} · {workload.employee.name || workload.employee.email || "Unnamed user"}</p><h3>{workload.task.label}</h3></div></header>
                                  <div className="employee-report-metrics">
                                    <div><span>Total assigned</span>{countLink(current.total, "all", countryFilter, "all assigned items")}</div>
                                    <div className="is-pending"><span>Pending</span>{countLink(current.pending, "pending", countryFilter, "pending items")}</div>
                                    <div><span>Completed</span>{countLink(completedTasks, "completed", countryFilter, "completed items")}</div>
                                  </div>
                                  <div className="employee-report-completion"><span>Completion</span><span>{progress}%</span></div>
                                  <div className="employee-report-progress" aria-label={`${progress}% completed`}><span style={{ width: `${progress}%` }} /></div>
                                  <div className="employee-country-workload">
                                    <h4>Country workload</h4>
                                    {countryFilter === "all" && <div className="employee-country-row is-all"><strong>All Countries</strong><span>{countryCountLink(workload.all.total, "all", "all", "Total")} <b>·</b> {countryCountLink(workload.all.pending, "pending", "all", "Pending")}</span></div>}
                                    {countryRows.length ? countryRows.map(([country, metric]) => (
                                      <div className="employee-country-row" key={country}><strong>{country}</strong><span>{countryCountLink(metric.total, "all", country, "Total")} <b>·</b> {countryCountLink(metric.pending, "pending", country, "Pending")}</span></div>
                                    )) : <p className="employee-country-empty">No country workload assigned.</p>}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </section>
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
