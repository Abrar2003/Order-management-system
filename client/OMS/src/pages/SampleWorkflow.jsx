import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SampleCreateModal from "../components/samples/SampleCreateModal";
import { listSampleWorkflows } from "../services/sampleWorkflow.service";
import { getUserFromToken } from "../auth/auth.service";
import { usePermissions } from "../auth/PermissionContext";
import { normalizeUserRole } from "../auth/permissions";
import { formatDateDDMMYYYY } from "../utils/date";
import {
  getWorkflowTasks,
  startWorkflowTask,
  completeWorkflowTask,
  approveWorkflowTask,
  sendWorkflowTaskToRework,
  addWorkflowTaskComment,
} from "../api/workflowApi";
import "../App.css";

const DEFAULT_LIMIT = 10;
const LIMIT_OPTIONS = [5, 10, 20, 50];

const clean = (value) => String(value || "").trim();
const positiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getStatusBadgeClass = (status = "") => {
  const s = String(status).toLowerCase();
  if (s === "assigned") return "bg-primary-subtle text-primary border border-primary-subtle";
  if (s === "started") return "bg-info-subtle text-info border border-info-subtle";
  if (s === "complete") return "bg-warning-subtle text-warning border border-warning-subtle";
  if (s === "approved") return "bg-success-subtle text-success border border-success-subtle";
  if (s === "uploaded") return "bg-teal-subtle text-teal border border-teal-subtle";
  if (s === "hold") return "bg-dark-subtle text-dark border border-dark-subtle";
  return "bg-secondary-subtle text-secondary border border-secondary-subtle";
};

const SampleWorkflowPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { role } = usePermissions();
  const user = getUserFromToken();
  const currentUserId = user?._id || user?.id || "";

  const isGaurav = useMemo(() => {
    const name = String(user?.name || "").toLowerCase();
    const username = String(user?.username || "").toLowerCase();
    return name === "gaurav" || username === "gaurav";
  }, [user]);

  const isManagerOrAdmin = useMemo(() => {
    const normalized = normalizeUserRole(role);
    return ["admin", "super_admin", "inspection_manager", "product_manager"].includes(normalized);
  }, [role]);

  const canApproveOrRework = useCallback((task) => {
    if (isGaurav || isManagerOrAdmin) return true;
    const taskAssignerId = task?.assigned_by?.user?._id || task?.assigned_by?.user || "";
    return String(taskAssignerId) === String(currentUserId);
  }, [isGaurav, isManagerOrAdmin, currentUserId]);

  const canPerformAssigneeAction = useCallback((task) => {
    const assignees = Array.isArray(task?.assigned_to) ? task.assigned_to : [];
    return assignees.some((assignee) => {
      const id = assignee?.user?._id || assignee?.user || assignee || "";
      return String(id) === String(currentUserId);
    });
  }, [currentUserId]);

  // State
  const [workflows, setWorkflows] = useState([]);
  const [filters, setFilters] = useState({ brands: [], vendors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [showCreateWorkflowModal, setShowCreateWorkflowModal] = useState(false);

  // Detail Panel State
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");

  // Comment & Rework Modal states
  const [newComment, setNewComment] = useState({});
  const [reworkModal, setReworkModal] = useState({
    isOpen: false,
    taskId: null,
    note: "",
    dueDate: "",
  });

  // Query Params & Pagination
  const [page, setPage] = useState(() => positiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => {
    const val = positiveInt(searchParams.get("limit"), DEFAULT_LIMIT);
    return LIMIT_OPTIONS.includes(val) ? val : DEFAULT_LIMIT;
  });
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [query, setQuery] = useState({
    search: clean(searchParams.get("search")),
    brand: clean(searchParams.get("brand")) || "all",
    vendor: clean(searchParams.get("vendor")) || "all",
  });
  const [draft, setDraft] = useState(query);

  // Fetch Workflow list
  const fetchWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await listSampleWorkflows({
        page,
        limit,
        search: query.search,
        brand: query.brand === "all" ? "" : query.brand,
        vendor: query.vendor === "all" ? "" : query.vendor,
      });

      const list = Array.isArray(response?.data?.data) ? response.data.data : [];
      setWorkflows(list);
      setFilters((prev) => ({ ...prev, ...(response?.data?.filters || {}) }));
      setPage(Math.max(1, Number(response?.data?.pagination?.page || 1)));
      setTotalPages(Math.max(1, Number(response?.data?.pagination?.totalPages || 1)));
      setTotalRecords(Number(response?.data?.pagination?.totalRecords || 0));

      // Auto-select first workflow if nothing selected
      if (list.length > 0 && !selectedWorkflow) {
        setSelectedWorkflow(list[0]);
      }
    } catch (fetchError) {
      setWorkflows([]);
      setError(fetchError?.response?.data?.message || "Failed to load sample workflows.");
    } finally {
      setLoading(false);
    }
  }, [limit, page, query, selectedWorkflow]);

  // Fetch Tasks for Selected Workflow
  const fetchWorkflowTasks = useCallback(async (code) => {
    if (!code) return;
    try {
      setTasksLoading(true);
      setTasksError("");
      const response = await getWorkflowTasks({ search: code, limit: 100 });
      // Only include tasks belonging to this workflow (title matches code)
      const list = Array.isArray(response?.data)
        ? response.data.filter((task) => String(task?.title).toUpperCase() === String(code).toUpperCase())
        : [];
      setTasks(list);
    } catch (taskError) {
      setTasks([]);
      setTasksError(taskError?.response?.data?.message || "Failed to load workflow tasks.");
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  useEffect(() => {
    if (selectedWorkflow?.code) {
      fetchWorkflowTasks(selectedWorkflow.code);
    } else {
      setTasks([]);
    }
  }, [selectedWorkflow, fetchWorkflowTasks]);

  // Search Filter Sync
  useEffect(() => {
    const next = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (!value || value === "all") return;
      next.set(key, value);
    });
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));
    setSearchParams(next, { replace: true });
  }, [limit, page, query, setSearchParams]);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setQuery({ ...draft });
  };

  const clearFilters = () => {
    const next = {
      search: "",
      brand: "all",
      vendor: "all",
    };
    setPage(1);
    setDraft(next);
    setQuery(next);
  };

  // Task Actions
  const handleStartTask = async (taskId) => {
    try {
      setSuccess("");
      setTasksError("");
      await startWorkflowTask(taskId, { note: "Started via Sample Workflow dashboard" });
      setSuccess("Task started successfully.");
      if (selectedWorkflow) fetchWorkflowTasks(selectedWorkflow.code);
    } catch (err) {
      setTasksError(err?.response?.data?.message || "Failed to start task.");
    }
  };

  const handleCompleteTask = async (taskId) => {
    try {
      setSuccess("");
      setTasksError("");
      await completeWorkflowTask(taskId, { note: "Completed via Sample Workflow dashboard" });
      setSuccess("Task completed successfully.");
      if (selectedWorkflow) fetchWorkflowTasks(selectedWorkflow.code);
    } catch (err) {
      setTasksError(err?.response?.data?.message || "Failed to complete task.");
    }
  };

  const handleApproveTask = async (taskId) => {
    try {
      setSuccess("");
      setTasksError("");
      await approveWorkflowTask(taskId, { note: "Approved via Sample Workflow dashboard" });
      setSuccess("Task approved successfully.");
      if (selectedWorkflow) fetchWorkflowTasks(selectedWorkflow.code);
    } catch (err) {
      setTasksError(err?.response?.data?.message || "Failed to approve task.");
    }
  };

  const handleOpenReworkModal = (taskId) => {
    setReworkModal({
      isOpen: true,
      taskId,
      note: "",
      dueDate: "",
    });
  };

  const handleReworkSubmit = async (e) => {
    e.preventDefault();
    if (!reworkModal.note.trim()) {
      alert("Rework reason/note is required.");
      return;
    }
    try {
      setSuccess("");
      setTasksError("");
      await sendWorkflowTaskToRework(reworkModal.taskId, {
        note: reworkModal.note.trim(),
        due_date: reworkModal.dueDate || undefined,
      });
      setSuccess("Task sent back for rework.");
      setReworkModal({ isOpen: false, taskId: null, note: "", dueDate: "" });
      if (selectedWorkflow) fetchWorkflowTasks(selectedWorkflow.code);
    } catch (err) {
      setTasksError(err?.response?.data?.message || "Failed to send task to rework.");
    }
  };

  const handleAddComment = async (taskId) => {
    const comment = clean(newComment[taskId]);
    if (!comment) return;
    try {
      setTasksError("");
      await addWorkflowTaskComment(taskId, { comment, comment_type: "general" });
      setNewComment((prev) => ({ ...prev, [taskId]: "" }));
      if (selectedWorkflow) fetchWorkflowTasks(selectedWorkflow.code);
    } catch (err) {
      setTasksError(err?.response?.data?.message || "Failed to add comment.");
    }
  };

  // Organize Tasks by Pipeline stages
  const pipeline = useMemo(() => {
    const cad = tasks.find((t) => t.task_type_key === "cad_files");
    const misc = tasks.find((t) => t.task_type_key === "miscellaneous");
    const threeD = tasks.find((t) => t.task_type_key === "3d_by_cad");

    return {
      cad: cad || null,
      misc: misc || null,
      threeD: threeD || null,
    };
  }, [tasks]);

  return (
    <>
      <Navbar />
      <main className="container-fluid py-3 sample-workflow-page">
        <div className="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
          <div>
            <h2 className="mb-0">Sample Workflow Tracker</h2>
            <div className="text-secondary small">Monitor and update progress on Sample design tasks</div>
          </div>
          {isManagerOrAdmin && (
            <button
              type="button"
              className="btn btn-primary btn-sm px-3"
              onClick={() => setShowCreateWorkflowModal(true)}
            >
              Create Sample Workflow
            </button>
          )}
        </div>

        {/* Filters */}
        <form className="card om-card mb-3" onSubmit={applyFilters}>
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-md-3">
                <label className="form-label small fw-semibold">Search</label>
                <input
                  className="form-control form-control-sm"
                  value={draft.search}
                  onChange={(e) => setDraft((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Code, brand, name..."
                />
              </div>
              <div className="col-md-3">
                <label className="form-label small fw-semibold">Brand</label>
                <select
                  className="form-select form-select-sm"
                  value={draft.brand}
                  onChange={(e) => setDraft((prev) => ({ ...prev, brand: e.target.value }))}
                >
                  <option value="all">All Brands</option>
                  {filters.brands.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label small fw-semibold">Vendor</label>
                <select
                  className="form-select form-select-sm"
                  value={draft.vendor}
                  onChange={(e) => setDraft((prev) => ({ ...prev, vendor: e.target.value }))}
                >
                  <option value="all">All Vendors</option>
                  {filters.vendors.map((vendor) => (
                    <option key={vendor} value={vendor}>{vendor}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 d-flex gap-2">
                <button type="submit" className="btn btn-primary btn-sm px-3 flex-grow-1">Apply Filters</button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={clearFilters}>Clear</button>
              </div>
            </div>
          </div>
        </form>

        {error && <div className="alert alert-danger">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="row g-3">
          {/* Master List (Left Column) */}
          <div className="col-md-4">
            <div className="card om-card shadow-sm h-100">
              <div className="card-header bg-transparent border-bottom py-2">
                <h6 className="mb-0 fw-semibold text-secondary">Active Sample Workflows ({totalRecords})</h6>
              </div>
              <div className="list-group list-group-flush overflow-auto" style={{ maxHeight: "65vh" }}>
                {loading ? (
                  <div className="text-center py-5 text-secondary">Loading workflows...</div>
                ) : workflows.length === 0 ? (
                  <div className="text-center py-5 text-secondary">No sample workflows found.</div>
                ) : (
                  workflows.map((wf) => {
                    const isSelected = selectedWorkflow?._id === wf._id;
                    return (
                      <button
                        key={wf._id}
                        onClick={() => setSelectedWorkflow(wf)}
                        className={`list-group-item list-group-item-action text-start p-3 border-bottom border-light ${
                          isSelected ? "bg-light border-start border-primary border-4" : ""
                        }`}
                      >
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <span className="fw-bold text-dark">{wf.code}</span>
                          <span className="badge bg-secondary-subtle text-secondary small px-2 py-1">
                            {wf.brand}
                          </span>
                        </div>
                        <div className="small text-secondary text-truncate mb-2">{wf.name || wf.description || "No description"}</div>
                        <div className="d-flex justify-content-between align-items-center small text-muted">
                          <span>Vendors: {wf.vendors?.join(", ") || wf.vendor?.join(", ") || "None"}</span>
                          <span>{formatDateDDMMYYYY(wf.updatedAt)}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {/* Pagination footer */}
              {totalPages > 1 && (
                <div className="card-footer bg-transparent border-top d-flex justify-content-between align-items-center py-2">
                  <button
                    className="btn btn-outline-secondary btn-xs rounded"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </button>
                  <span className="small text-secondary">Page {page} of {totalPages}</span>
                  <button
                    className="btn btn-outline-secondary btn-xs rounded"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Detail Tracker (Right Column) */}
          <div className="col-md-8">
            {selectedWorkflow ? (
              <div className="card om-card shadow-sm h-100">
                <div className="card-header bg-light border-bottom p-3">
                  <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <div>
                      <h4 className="mb-0 fw-bold text-dark">{selectedWorkflow.code}</h4>
                      <div className="text-secondary small">
                        {selectedWorkflow.name} • Brand: <strong>{selectedWorkflow.brand}</strong>
                      </div>
                    </div>
                    <button
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => fetchWorkflowTasks(selectedWorkflow.code)}
                      disabled={tasksLoading}
                    >
                      {tasksLoading ? "Refreshing..." : "Refresh Tasks"}
                    </button>
                  </div>
                </div>

                <div className="card-body p-4" style={{ overflowY: "auto", maxHeight: "65vh" }}>
                  {tasksError && <div className="alert alert-danger">{tasksError}</div>}

                  {/* Metadata fields */}
                  <div className="row g-3 mb-4 bg-light rounded-4 p-3 border">
                    <div className="col-sm-4">
                      <div className="small text-secondary">Vendor List</div>
                      <div className="fw-semibold">
                        {selectedWorkflow.vendors?.join(", ") || selectedWorkflow.vendor?.join(", ") || "N/A"}
                      </div>
                    </div>
                    <div className="col-sm-4">
                      <div className="small text-secondary">Estimated CBM</div>
                      <div className="fw-semibold">{Number(selectedWorkflow.cbm || 0).toFixed(4)}</div>
                    </div>
                    <div className="col-sm-4">
                      <div className="small text-secondary">Description</div>
                      <div className="fw-semibold text-truncate" title={selectedWorkflow.description}>
                        {selectedWorkflow.description || "N/A"}
                      </div>
                    </div>
                  </div>

                  {tasksLoading && tasks.length === 0 ? (
                    <div className="text-center py-5 text-secondary">Loading associated workflow tasks...</div>
                  ) : tasks.length === 0 ? (
                    <div className="text-center py-5 text-secondary">
                      No tasks found for workflow <strong>{selectedWorkflow.code}</strong>.
                      <p className="small mt-2">
                        Tasks might have been deleted, or this sample workflow was created prior to auto-tasking integration.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <h5 className="mb-3 fw-bold border-bottom pb-2">Design Pipeline Stages</h5>

                      {/* Visual flow layout */}
                      <div className="d-flex flex-column gap-4">
                        {/* AutoCAD Task (Stage 1) */}
                        <div className="border rounded-4 p-3 bg-white shadow-xs position-relative">
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <span className="badge bg-dark text-white me-2">Stage 1</span>
                              <h6 className="d-inline fw-bold">AutoCAD Task (cad_files)</h6>
                            </div>
                            {pipeline.cad && (
                              <span className={`badge px-2.5 py-1 ${getStatusBadgeClass(pipeline.cad.status)}`}>
                                {pipeline.cad.status}
                              </span>
                            )}
                          </div>

                          {!pipeline.cad ? (
                            <div className="text-muted small py-2">Task not generated.</div>
                          ) : (
                            <div className="small text-secondary">
                              <div className="mb-2">
                                Assigned to: <strong>{pipeline.cad.assigned_to?.map(u => u.user?.name || u.name).join(", ") || "Unassigned"}</strong> | 
                                Due Date: <strong>{formatDateDDMMYYYY(pipeline.cad.active_due_date || pipeline.cad.due_date)}</strong>
                              </div>
                              <p className="mb-3 text-dark">{pipeline.cad.description || "No description"}</p>

                              {/* Task Action Bar */}
                              <div className="d-flex gap-2 mb-3">
                                {pipeline.cad.status === "assigned" && canPerformAssigneeAction(pipeline.cad) && (
                                  <button
                                    onClick={() => handleStartTask(pipeline.cad._id)}
                                    className="btn btn-primary btn-sm px-3"
                                  >
                                    Start Task
                                  </button>
                                )}
                                {pipeline.cad.status === "started" && canPerformAssigneeAction(pipeline.cad) && (
                                  <button
                                    onClick={() => handleCompleteTask(pipeline.cad._id)}
                                    className="btn btn-success btn-sm px-3"
                                  >
                                    Complete Task
                                  </button>
                                )}
                                {pipeline.cad.status === "complete" && canApproveOrRework(pipeline.cad) && (
                                  <button
                                    onClick={() => handleApproveTask(pipeline.cad._id)}
                                    className="btn btn-success btn-sm px-3"
                                  >
                                    Approve Task
                                  </button>
                                )}
                                {["complete", "approved", "uploaded"].includes(pipeline.cad.status) && canApproveOrRework(pipeline.cad) && (
                                  <button
                                    onClick={() => handleOpenReworkModal(pipeline.cad._id)}
                                    className="btn btn-outline-danger btn-sm px-3"
                                  >
                                    Send to Rework
                                  </button>
                                )}
                              </div>

                              {/* Comment and Rework Logs section */}
                              {pipeline.cad.reworked?.count > 0 && (
                                <div className="alert alert-warning-soft border-warning-subtle small mb-3 p-2.5 rounded-3">
                                  <strong>Rework Count: {pipeline.cad.reworked.count}</strong>
                                  <ul className="mb-0 mt-1 pl-4">
                                    {pipeline.cad.reworked.comments?.map((c, i) => (
                                      <li key={i}>{c.comment} <span className="text-muted small">({c.created_by?.name || "User"})</span></li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Inline Task Commenting */}
                              <div className="d-flex gap-2">
                                <input
                                  className="form-control form-control-sm"
                                  value={newComment[pipeline.cad._id] || ""}
                                  onChange={(e) => setNewComment((prev) => ({ ...prev, [pipeline.cad._id]: e.target.value }))}
                                  placeholder="Write a comment..."
                                />
                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={() => handleAddComment(pipeline.cad._id)}
                                >
                                  Comment
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Stage 2 (Operations and 3D) - parallel processes */}
                        <div className="row g-3">
                          {/* Operations Task */}
                          <div className="col-md-6">
                            <div className="border rounded-4 p-3 bg-white shadow-xs h-100">
                              <div className="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                  <span className="badge bg-dark text-white me-2">Stage 2A</span>
                                  <h6 className="fw-bold d-inline">Operations (miscellaneous)</h6>
                                </div>
                                {pipeline.misc && (
                                  <span className={`badge px-2.5 py-1 ${getStatusBadgeClass(pipeline.misc.status)}`}>
                                    {pipeline.misc.status}
                                  </span>
                                )}
                              </div>

                              {!pipeline.misc ? (
                                <div className="text-muted small py-3 text-center border border-dashed rounded-3">
                                  {pipeline.cad?.status === "approved"
                                    ? "Task not generated."
                                    : "Awaiting AutoCAD approval to trigger"}
                                </div>
                              ) : (
                                <div className="small text-secondary">
                                  <div className="mb-2">
                                    Assigned to: <strong>{pipeline.misc.assigned_to?.map(u => u.user?.name || u.name).join(", ") || "Unassigned"}</strong> | 
                                    Due Date: <strong>{formatDateDDMMYYYY(pipeline.misc.active_due_date || pipeline.misc.due_date)}</strong>
                                  </div>
                                  <p className="mb-3 text-dark">{pipeline.misc.description || "No description"}</p>

                                  {/* Action Buttons */}
                                  <div className="d-flex gap-2 mb-3">
                                    {pipeline.misc.status === "assigned" && canPerformAssigneeAction(pipeline.misc) && (
                                      <button
                                        onClick={() => handleStartTask(pipeline.misc._id)}
                                        className="btn btn-primary btn-sm px-2.5"
                                      >
                                        Start
                                      </button>
                                    )}
                                    {pipeline.misc.status === "started" && canPerformAssigneeAction(pipeline.misc) && (
                                      <button
                                        onClick={() => handleCompleteTask(pipeline.misc._id)}
                                        className="btn btn-success btn-sm px-2.5"
                                      >
                                        Complete
                                      </button>
                                    )}
                                    {pipeline.misc.status === "complete" && canApproveOrRework(pipeline.misc) && (
                                      <button
                                        onClick={() => handleApproveTask(pipeline.misc._id)}
                                        className="btn btn-success btn-sm px-2.5"
                                      >
                                        Approve
                                      </button>
                                    )}
                                    {["complete", "approved", "uploaded"].includes(pipeline.misc.status) && canApproveOrRework(pipeline.misc) && (
                                      <button
                                        onClick={() => handleOpenReworkModal(pipeline.misc._id)}
                                        className="btn btn-outline-danger btn-sm px-2.5"
                                      >
                                        Rework
                                      </button>
                                    )}
                                  </div>

                                  {pipeline.misc.reworked?.count > 0 && (
                                    <div className="alert alert-warning-soft border-warning-subtle small mb-3 p-2 rounded-3">
                                      <strong>Rework Count: {pipeline.misc.reworked.count}</strong>
                                      <ul className="mb-0 mt-1 pl-4">
                                        {pipeline.misc.reworked.comments?.map((c, i) => (
                                          <li key={i}>{c.comment}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  <div className="d-flex gap-2">
                                    <input
                                      className="form-control form-control-sm"
                                      value={newComment[pipeline.misc._id] || ""}
                                      onChange={(e) => setNewComment((prev) => ({ ...prev, [pipeline.misc._id]: e.target.value }))}
                                      placeholder="Comment..."
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() => handleAddComment(pipeline.misc._id)}
                                    >
                                      Post
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 3D CAD Task */}
                          <div className="col-md-6">
                            <div className="border rounded-4 p-3 bg-white shadow-xs h-100">
                              <div className="d-flex justify-content-between align-items-start mb-2">
                                <div>
                                  <span className="badge bg-dark text-white me-2">Stage 2B</span>
                                  <h6 className="fw-bold d-inline">3D Modeling (3d_by_cad)</h6>
                                </div>
                                {pipeline.threeD && (
                                  <span className={`badge px-2.5 py-1 ${getStatusBadgeClass(pipeline.threeD.status)}`}>
                                    {pipeline.threeD.status}
                                  </span>
                                )}
                              </div>

                              {!pipeline.threeD ? (
                                <div className="text-muted small py-3 text-center border border-dashed rounded-3">
                                  {pipeline.cad?.status === "approved"
                                    ? "Task not generated."
                                    : "Awaiting AutoCAD approval to trigger"}
                                </div>
                              ) : (
                                <div className="small text-secondary">
                                  <div className="mb-2">
                                    Assigned to: <strong>{pipeline.threeD.assigned_to?.map(u => u.user?.name || u.name).join(", ") || "Unassigned"}</strong> | 
                                    Due Date: <strong>{formatDateDDMMYYYY(pipeline.threeD.active_due_date || pipeline.threeD.due_date)}</strong>
                                  </div>
                                  <p className="mb-3 text-dark">{pipeline.threeD.description || "No description"}</p>

                                  {/* Action Buttons */}
                                  <div className="d-flex gap-2 mb-3">
                                    {pipeline.threeD.status === "assigned" && canPerformAssigneeAction(pipeline.threeD) && (
                                      <button
                                        onClick={() => handleStartTask(pipeline.threeD._id)}
                                        className="btn btn-primary btn-sm px-2.5"
                                      >
                                        Start
                                      </button>
                                    )}
                                    {pipeline.threeD.status === "started" && canPerformAssigneeAction(pipeline.threeD) && (
                                      <button
                                        onClick={() => handleCompleteTask(pipeline.threeD._id)}
                                        className="btn btn-success btn-sm px-2.5"
                                      >
                                        Complete
                                      </button>
                                    )}
                                    {pipeline.threeD.status === "complete" && canApproveOrRework(pipeline.threeD) && (
                                      <button
                                        onClick={() => handleApproveTask(pipeline.threeD._id)}
                                        className="btn btn-success btn-sm px-2.5"
                                      >
                                        Approve
                                      </button>
                                    )}
                                    {["complete", "approved", "uploaded"].includes(pipeline.threeD.status) && canApproveOrRework(pipeline.threeD) && (
                                      <button
                                        onClick={() => handleOpenReworkModal(pipeline.threeD._id)}
                                        className="btn btn-outline-danger btn-sm px-2.5"
                                      >
                                        Rework
                                      </button>
                                    )}
                                  </div>

                                  {pipeline.threeD.reworked?.count > 0 && (
                                    <div className="alert alert-warning-soft border-warning-subtle small mb-3 p-2 rounded-3">
                                      <strong>Rework Count: {pipeline.threeD.reworked.count}</strong>
                                      <ul className="mb-0 mt-1 pl-4">
                                        {pipeline.threeD.reworked.comments?.map((c, i) => (
                                          <li key={i}>{c.comment}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  <div className="d-flex gap-2">
                                    <input
                                      className="form-control form-control-sm"
                                      value={newComment[pipeline.threeD._id] || ""}
                                      onChange={(e) => setNewComment((prev) => ({ ...prev, [pipeline.threeD._id]: e.target.value }))}
                                      placeholder="Comment..."
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() => handleAddComment(pipeline.threeD._id)}
                                    >
                                      Post
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="card om-card shadow-sm h-100 justify-content-center align-items-center text-center p-5 text-secondary">
                <div>
                  <i className="bi bi-diagram-3 fs-1 text-secondary mb-3"></i>
                  <h4>No Workflow Selected</h4>
                  <p className="small">Please select a Sample Workflow from the left panel to inspect task statuses and perform workflow transitions.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Send to Rework Modal dialog */}
        {reworkModal.isOpen && (
          <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
            <div className="modal-dialog modal-dialog-centered workflow-quick-modal-dialog" role="document">
              <form className="modal-content shadow-lg border-0 rounded-4" onSubmit={handleReworkSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title fw-bold">Send Task Back to Rework</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setReworkModal({ isOpen: false, taskId: null, note: "", dueDate: "" })}
                  />
                </div>
                <div className="modal-body d-flex flex-column gap-3">
                  <div>
                    <label className="form-label small fw-semibold">Rework Reason (Required)</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      value={reworkModal.note}
                      onChange={(e) => setReworkModal((prev) => ({ ...prev, note: e.target.value }))}
                      placeholder="Explain what changes are needed..."
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label small fw-semibold">New Due Date (Optional)</label>
                    <input
                      type="date"
                      className="form-control"
                      value={reworkModal.dueDate}
                      onChange={(e) => setReworkModal((prev) => ({ ...prev, dueDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="modal-footer border-0">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setReworkModal({ isOpen: false, taskId: null, note: "", dueDate: "" })}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-danger btn-sm px-4">
                    Send to Rework
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
      {showCreateWorkflowModal && (
        <SampleCreateModal
          isWorkflow={true}
          onClose={() => setShowCreateWorkflowModal(false)}
          onSaved={(newWf) => {
            setShowCreateWorkflowModal(false);
            fetchWorkflows();
            if (newWf) setSelectedWorkflow(newWf);
          }}
        />
      )}
    </>
  );
};

export default SampleWorkflowPage;
