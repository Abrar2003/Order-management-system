import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isAdminLikeRole, isManagerLikeRole } from "../auth/permissions";
import Navbar from "../components/Navbar";
import WorkflowBatchCreateModal from "../components/workflow/WorkflowBatchCreateModal";
import { usePermissions } from "../auth/PermissionContext";
import {
  cancelWorkflowBatch,
  deleteWorkflowBatch,
  getWorkflowBatches,
  getWorkflowTaskTypes,
  getWorkflowUsers,
} from "../api/workflowApi";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { areSearchParamsEquivalent } from "../utils/searchParams";
import "../App.css";

const DEFAULT_LIMIT = 20;
const LIMIT_OPTIONS = [10, 20, 50, 100];

const normalizeText = (value) => String(value ?? "").trim();

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseLimit = (value) => {
  const parsed = parsePositiveInt(value, DEFAULT_LIMIT);
  return LIMIT_OPTIONS.includes(parsed) ? parsed : DEFAULT_LIMIT;
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

const getAuditActorName = (actor = {}) =>
  actor?.name || actor?.user?.name || actor?.user?.email || "N/A";

const WorkflowBatches = () => {
  const navigate = useNavigate();
  const { hasPermission, role } = usePermissions();
  const isManagerOrAdmin = isManagerLikeRole(role);
  const isAdmin = isAdminLikeRole(role);
  const canViewWorkflow = hasPermission("workflow", "view");
  const canCreateWorkflow = isManagerOrAdmin && hasPermission("workflow", "create");
  const canEditWorkflow = isManagerOrAdmin && hasPermission("workflow", "edit");
  const canDeleteWorkflow = isAdmin && hasPermission("workflow", "delete");

  const [searchParams, setSearchParams] = useSearchParams();
  useRememberSearchParams(searchParams, setSearchParams, "workflow-batches");

  const [rows, setRows] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookupLoading, setLookupLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState(() => normalizeText(searchParams.get("status")));
  const [brandFilter, setBrandFilter] = useState(() => normalizeText(searchParams.get("brand")));
  const [taskTypeFilter, setTaskTypeFilter] = useState(() => normalizeText(searchParams.get("task_type_key")));
  const [dateFrom, setDateFrom] = useState(() => normalizeText(searchParams.get("date_from")));
  const [dateTo, setDateTo] = useState(() => normalizeText(searchParams.get("date_to")));
  const [search, setSearch] = useState(() => normalizeText(searchParams.get("search")));
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1));
  const [limit, setLimit] = useState(() => parseLimit(searchParams.get("limit")));
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalRecords: 0,
  });
  const [refreshTick, setRefreshTick] = useState(0);

  const loadLookups = useCallback(async () => {
    if (!canViewWorkflow) {
      setLookupLoading(false);
      return;
    }

    setLookupLoading(true);
    try {
      const [taskTypeResult, userResult] = await Promise.allSettled([
        getWorkflowTaskTypes(),
        canCreateWorkflow ? getWorkflowUsers() : Promise.resolve([]),
      ]);

      if (taskTypeResult.status === "fulfilled") {
        setTaskTypes(Array.isArray(taskTypeResult.value?.data) ? taskTypeResult.value.data : []);
      } else {
        throw taskTypeResult.reason;
      }

      if (userResult.status === "fulfilled") {
        setUsers(Array.isArray(userResult.value) ? userResult.value : []);
      } else {
        setUsers([]);
      }
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to load workflow lookups.",
      );
    } finally {
      setLookupLoading(false);
    }
  }, [canCreateWorkflow, canViewWorkflow]);

  const loadBatches = useCallback(async () => {
    if (!canViewWorkflow) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await getWorkflowBatches({
        page,
        limit,
        status: statusFilter || undefined,
        brand: brandFilter || undefined,
        task_type_key: taskTypeFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: search || undefined,
      });

      setRows(Array.isArray(response?.data) ? response.data : []);
      setPagination({
        page: Number(response?.pagination?.page || 1),
        totalPages: Number(response?.pagination?.totalPages || 1),
        totalRecords: Number(response?.pagination?.totalRecords || 0),
      });
    } catch (loadError) {
      setRows([]);
      setPagination({
        page: 1,
        totalPages: 1,
        totalRecords: 0,
      });
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to fetch workflow batches.",
      );
    } finally {
      setLoading(false);
    }
  }, [
    brandFilter,
    canViewWorkflow,
    dateFrom,
    dateTo,
    limit,
    page,
    search,
    statusFilter,
    taskTypeFilter,
  ]);

  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches, refreshTick]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (statusFilter) next.set("status", statusFilter);
    if (brandFilter) next.set("brand", brandFilter);
    if (taskTypeFilter) next.set("task_type_key", taskTypeFilter);
    if (dateFrom) next.set("date_from", dateFrom);
    if (dateTo) next.set("date_to", dateTo);
    if (search) next.set("search", search);
    if (page > 1) next.set("page", String(page));
    if (limit !== DEFAULT_LIMIT) next.set("limit", String(limit));

    if (!areSearchParamsEquivalent(next, searchParams)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    brandFilter,
    dateFrom,
    dateTo,
    limit,
    page,
    search,
    searchParams,
    setSearchParams,
    statusFilter,
    taskTypeFilter,
  ]);

  const handleCancelBatch = async (batch) => {
    const confirmed = window.confirm(
      `Cancel workflow batch ${batch?.batch_no || batch?.name || "this batch"}?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Optional cancellation note") || "";

    setError("");
    setSuccess("");
    try {
      await cancelWorkflowBatch(batch._id, {
        note: normalizeText(reason),
      });
      setSuccess("Workflow batch cancelled successfully.");
      setRefreshTick((prev) => prev + 1);
    } catch (cancelError) {
      setError(
        cancelError?.response?.data?.message
          || cancelError?.message
          || "Failed to cancel workflow batch.",
      );
    }
  };

  const handleDeleteBatch = async (batch) => {
    const confirmed = window.confirm(
      `Delete workflow batch ${batch?.batch_no || batch?.name || "this batch"} and all tasks inside it?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Optional delete note") || "";

    setError("");
    setSuccess("");
    try {
      await deleteWorkflowBatch(batch._id, {
        note: normalizeText(reason),
      });
      setSuccess("Workflow batch deleted successfully.");
      setRefreshTick((prev) => prev + 1);
    } catch (deleteError) {
      setError(
        deleteError?.response?.data?.message
          || deleteError?.message
          || "Failed to delete workflow batch.",
      );
    }
  };

  if (!canViewWorkflow) {
    return (
      <>
        <Navbar />
        <div className="page-shell py-3">
          <div className="alert alert-danger">
            You do not have access to Production Workflow.
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
            <h2 className="h4">Workflow Batches</h2>
            <div className="text-secondary">
              Build batch containers from browser folder manifests and generate separate
              production tasks without uploading files.
            </div>
          </div>
          {canCreateWorkflow && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
            >
              Create Batch from Folder
            </button>
          )}
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        <div className="card om-card mb-3">
          <div className="card-body">
            <form
              className="row g-3 align-items-end"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setRefreshTick((prev) => prev + 1);
              }}
            >
              <div className="col-lg-3">
                <label className="form-label">Search</label>
                <input
                  type="text"
                  className="form-control"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Batch no, name, folder, brand"
                />
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {["draft", "tasks_created", "in_progress", "completed", "cancelled", "failed"].map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Brand</label>
                <input
                  type="text"
                  className="form-control"
                  value={brandFilter}
                  onChange={(event) => setBrandFilter(event.target.value)}
                />
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Task Type</label>
                <select
                  className="form-select"
                  value={taskTypeFilter}
                  onChange={(event) => setTaskTypeFilter(event.target.value)}
                >
                  <option value="">All</option>
                  {taskTypes.map((taskType) => (
                    <option key={taskType._id || taskType.key} value={taskType.key}>
                      {taskType.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Created From</label>
                <input
                  type="date"
                  className="form-control"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </div>
              <div className="col-md-3 col-lg-2">
                <label className="form-label">Created To</label>
                <input
                  type="date"
                  className="form-control"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>
              <div className="col-md-3 col-lg-1">
                <label className="form-label">Rows</label>
                <select
                  className="form-select"
                  value={limit}
                  onChange={(event) => {
                    setLimit(parseLimit(event.target.value));
                    setPage(1);
                  }}
                >
                  {LIMIT_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 d-flex flex-wrap gap-2">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  Apply
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("");
                    setBrandFilter("");
                    setTaskTypeFilter("");
                    setDateFrom("");
                    setDateTo("");
                    setLimit(DEFAULT_LIMIT);
                    setPage(1);
                    setRefreshTick((prev) => prev + 1);
                  }}
                >
                  Clear
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card om-card mb-3">
          <div className="card-body d-flex flex-wrap gap-2">
            <span className="om-summary-chip">Rows: {pagination.totalRecords}</span>
            <span className="om-summary-chip">
              Page: {pagination.page} / {pagination.totalPages}
            </span>
            {lookupLoading && (
              <span className="small text-secondary align-self-center">
                Loading workflow lookups...
              </span>
            )}
          </div>
        </div>

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-5 text-secondary">Loading workflow batches...</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-5 text-secondary">
                No workflow batches found for the current filters.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Batch No</th>
                      <th>Name</th>
                      <th>Source Folder</th>
                      <th>Brand</th>
                      <th>Task Type</th>
                      <th>Status</th>
                      <th>Due Date</th>
                      <th>Total Files</th>
                      <th>Total Tasks</th>
                      <th>Pending</th>
                      <th>Assigned</th>
                      <th>In Progress</th>
                      <th>Submitted</th>
                      <th>Review</th>
                      <th>Rework</th>
                      <th>Completed</th>
                      <th>Created By</th>
                      <th>Created At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((batch) => (
                      <tr key={batch._id}>
                        <td>{batch.batch_no}</td>
                        <td>{batch.name}</td>
                        <td>{batch.source_folder_name}</td>
                        <td>{batch.brand || "—"}</td>
                        <td>{batch.selected_task_type?.name || batch.task_type?.name || batch.task_type_key}</td>
                        <td>{batch.status}</td>
                        <td>{formatDateTime(batch.due_date)}</td>
                        <td>{Number(batch.counts?.total_files || 0)}</td>
                        <td>{Number(batch.counts?.total_tasks || 0)}</td>
                        <td>{Number(batch.counts?.pending_tasks || 0)}</td>
                        <td>{Number(batch.counts?.assigned_tasks || 0)}</td>
                        <td>{Number(batch.counts?.in_progress_tasks || 0)}</td>
                        <td>{Number(batch.counts?.submitted_tasks || 0)}</td>
                        <td>{Number(batch.counts?.review_tasks || 0)}</td>
                        <td>{Number(batch.counts?.rework_tasks || 0)}</td>
                        <td>{Number(batch.counts?.completed_tasks || 0)}</td>
                        <td>{getAuditActorName(batch.created_by)}</td>
                        <td>{formatDateTime(batch.createdAt)}</td>
                        <td>
                          <div className="d-flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-outline-primary btn-sm"
                              onClick={() => navigate(`/workflow/batches/${batch._id}`)}
                            >
                              View Batch
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              onClick={() => navigate(`/workflow/tasks?batch=${batch._id}`)}
                            >
                              Open Task Board
                            </button>
                            {canEditWorkflow && batch.status !== "cancelled" && (
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                onClick={() => handleCancelBatch(batch)}
                              >
                                Cancel
                              </button>
                            )}
                            {canDeleteWorkflow && (
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => handleDeleteBatch(batch)}
                              >
                                Delete Batch
                              </button>
                            )}
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

        <div className="d-flex justify-content-center align-items-center gap-3 mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={loading || page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <div className="small text-secondary">
            Page {pagination.page} of {pagination.totalPages}
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={loading || page >= pagination.totalPages}
            onClick={() => setPage((prev) => Math.min(pagination.totalPages, prev + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {showCreateModal && (
        <WorkflowBatchCreateModal
          taskTypes={taskTypes.filter((taskType) => taskType?.is_active !== false)}
          availableUsers={users}
          onClose={() => setShowCreateModal(false)}
          onCreated={(createdBatch) => {
            setShowCreateModal(false);
            setSuccess("Workflow batch created successfully.");
            setRefreshTick((prev) => prev + 1);
            if (createdBatch?._id) {
              navigate(`/workflow/batches/${createdBatch._id}`);
            }
          }}
        />
      )}
    </>
  );
};

export default WorkflowBatches;
