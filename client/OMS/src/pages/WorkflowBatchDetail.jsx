import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isAdminLikeRole, isManagerLikeRole } from "../auth/permissions";
import Navbar from "../components/Navbar";
import WorkflowTaskDetailModal from "../components/workflow/WorkflowTaskDetailModal";
import { usePermissions } from "../auth/PermissionContext";
import {
  cancelWorkflowBatch,
  deleteWorkflowBatch,
  deleteWorkflowTask,
  getWorkflowBatchById,
  getWorkflowTasks,
  getWorkflowUsers,
} from "../api/workflowApi";
import "../App.css";

const DEFAULT_TASK_LIMIT = 20;
const TASK_LIMIT_OPTIONS = [20, 50, 100];

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
};

const getAuditActorName = (actor = {}) =>
  actor?.name || actor?.user?.name || actor?.user?.email || "N/A";

const WorkflowBatchDetail = () => {
  const navigate = useNavigate();
  const { batchId } = useParams();
  const { hasPermission, role } = usePermissions();
  const isManagerOrAdmin = isManagerLikeRole(role);
  const isAdmin = isAdminLikeRole(role);
  const canViewWorkflow = hasPermission("workflow", "view");
  const canEditWorkflow = isManagerOrAdmin && hasPermission("workflow", "edit");
  const canAssignWorkflow = isManagerOrAdmin && hasPermission("workflow", "assign");
  const canApproveWorkflow = isAdmin && hasPermission("workflow", "approve");
  const canDeleteWorkflow = isAdmin && hasPermission("workflow", "delete");

  const [batch, setBatch] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskPage, setTaskPage] = useState(1);
  const [taskLimit, setTaskLimit] = useState(DEFAULT_TASK_LIMIT);
  const [taskPagination, setTaskPagination] = useState({
    page: 1,
    totalPages: 1,
    totalRecords: 0,
  });
  const [refreshTick, setRefreshTick] = useState(0);

  const loadBatchDetail = useCallback(async () => {
    if (!canViewWorkflow || !batchId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [batchResult, userResult] = await Promise.allSettled([
        getWorkflowBatchById(batchId),
        canAssignWorkflow ? getWorkflowUsers() : Promise.resolve([]),
      ]);

      if (batchResult.status !== "fulfilled") {
        throw batchResult.reason;
      }

      setBatch(batchResult.value?.data || null);
      setUsers(
        userResult.status === "fulfilled" && Array.isArray(userResult.value)
          ? userResult.value
          : [],
      );
    } catch (loadError) {
      setBatch(null);
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to fetch workflow batch detail.",
      );
    } finally {
      setLoading(false);
    }
  }, [batchId, canAssignWorkflow, canViewWorkflow]);

  const loadBatchTasks = useCallback(async () => {
    if (!canViewWorkflow || !batchId) {
      setTasksLoading(false);
      return;
    }

    setTasksLoading(true);
    setError("");
    try {
      const taskResult = await getWorkflowTasks({
        batch: batchId,
        page: taskPage,
        limit: taskLimit,
      });

      setTasks(Array.isArray(taskResult?.data) ? taskResult.data : []);
      setTaskPagination({
        page: Number(taskResult?.pagination?.page || 1),
        totalPages: Number(taskResult?.pagination?.totalPages || 1),
        totalRecords: Number(taskResult?.pagination?.totalRecords || 0),
      });
    } catch (loadError) {
      setTasks([]);
      setTaskPagination({
        page: 1,
        totalPages: 1,
        totalRecords: 0,
      });
      setError(
        loadError?.response?.data?.message
          || loadError?.message
          || "Failed to fetch workflow tasks for this batch.",
      );
    } finally {
      setTasksLoading(false);
    }
  }, [batchId, canViewWorkflow, taskLimit, taskPage]);

  useEffect(() => {
    loadBatchDetail();
  }, [loadBatchDetail, refreshTick]);

  useEffect(() => {
    loadBatchTasks();
  }, [loadBatchTasks, refreshTick]);

  const handleCancelBatch = async () => {
    const confirmed = window.confirm(
      `Cancel workflow batch ${batch?.batch_no || batch?.name || ""}?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Optional cancellation note") || "";
    setError("");
    setSuccess("");
    try {
      await cancelWorkflowBatch(batchId, { note: reason });
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

  const handleDeleteBatch = async () => {
    const confirmed = window.confirm(
      `Delete workflow batch ${batch?.batch_no || batch?.name || ""} and all tasks inside it?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Optional delete note") || "";
    setError("");
    setSuccess("");
    try {
      await deleteWorkflowBatch(batchId, { note: reason });
      navigate("/workflow/batches");
    } catch (deleteError) {
      setError(
        deleteError?.response?.data?.message
          || deleteError?.message
          || "Failed to delete workflow batch.",
      );
    }
  };

  const handleDeleteTask = async (task) => {
    const confirmed = window.confirm(
      `Delete workflow task ${task?.task_no || task?.title || "this task"}?`,
    );
    if (!confirmed) return;

    const reason = window.prompt("Optional delete note") || "";
    setError("");
    setSuccess("");
    try {
      await deleteWorkflowTask(task._id, { note: reason });
      setSuccess("Workflow task deleted successfully.");
      if (selectedTaskId === task._id) {
        setSelectedTaskId("");
      }
      setRefreshTick((prev) => prev + 1);
    } catch (deleteError) {
      setError(
        deleteError?.response?.data?.message
          || deleteError?.message
          || "Failed to delete workflow task.",
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
            <h2 className="h4">Workflow Batch Detail</h2>
            <div className="text-secondary">
              Review the batch container and the separate production tasks generated
              inside it.
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => navigate("/workflow/batches")}
            >
              Back to Batches
            </button>
            {batch?._id && (
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => navigate(`/workflow/tasks?batch=${batch._id}`)}
              >
                Open Task Board
              </button>
            )}
            {canEditWorkflow && batch?.status !== "cancelled" && (
              <button
                type="button"
                className="btn btn-outline-danger"
                onClick={handleCancelBatch}
              >
                Cancel Batch
              </button>
            )}
            {canDeleteWorkflow && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteBatch}
              >
                Delete Batch
              </button>
            )}
          </div>
        </div>

        {error && <div className="alert alert-danger mb-3">{error}</div>}
        {success && <div className="alert alert-success mb-3">{success}</div>}

        {loading ? (
          <div className="card om-card">
            <div className="card-body text-center py-5 text-secondary">
              Loading workflow batch detail...
            </div>
          </div>
        ) : !batch ? (
          <div className="card om-card">
            <div className="card-body text-center py-5 text-secondary">
              Workflow batch not found.
            </div>
          </div>
        ) : (
          <>
            <div className="card om-card mb-3">
              <div className="card-body">
                <div className="d-flex flex-wrap gap-2 mb-3">
                  <span className="om-summary-chip">Batch No: {batch.batch_no}</span>
                  <span className="om-summary-chip">Batch Status: {batch.status}</span>
                  <span className="om-summary-chip">
                    Task Type: {batch.selected_task_type?.name || batch.task_type?.name || batch.task_type_key}
                  </span>
                  <span className="om-summary-chip">
                    Total Files: {Number(batch.counts?.total_files || 0)}
                  </span>
                  <span className="om-summary-chip">
                    Total Tasks: {Number(batch.counts?.total_tasks || 0)}
                  </span>
                </div>

                <div className="row g-3">
                  <div className="col-md-4">
                    <div className="small text-secondary mb-1">Name</div>
                    <div className="fw-semibold">{batch.name}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="small text-secondary mb-1">Source Folder</div>
                    <div className="fw-semibold">{batch.source_folder_name}</div>
                  </div>
                  <div className="col-md-4">
                    <div className="small text-secondary mb-1">Brand</div>
                    <div className="fw-semibold">{batch.brand || "—"}</div>
                  </div>
                  <div className="col-md-6">
                    <div className="small text-secondary mb-1">Description</div>
                    <div className="fw-semibold">{batch.description || "—"}</div>
                  </div>
                  <div className="col-md-3">
                    <div className="small text-secondary mb-1">How to read this batch</div>
                    <div className="fw-semibold">
                      The batch is only the container. Each generated task below moves
                      independently.
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="small text-secondary mb-1">Created By</div>
                    <div className="fw-semibold">{getAuditActorName(batch.created_by)}</div>
                  </div>
                  <div className="col-md-3">
                    <div className="small text-secondary mb-1">Created At</div>
                    <div className="fw-semibold">{formatDateTime(batch.createdAt)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card om-card mb-3">
              <div className="card-body d-flex flex-wrap gap-2">
                <span className="om-summary-chip">
                  Pending: {Number(batch.counts?.pending_tasks || 0)}
                </span>
                <span className="om-summary-chip">
                  Assigned: {Number(batch.counts?.assigned_tasks || 0)}
                </span>
                <span className="om-summary-chip">
                  In Progress: {Number(batch.counts?.in_progress_tasks || 0)}
                </span>
                <span className="om-summary-chip">
                  Submitted: {Number(batch.counts?.submitted_tasks || 0)}
                </span>
                <span className="om-summary-chip">
                  Review: {Number(batch.counts?.review_tasks || 0)}
                </span>
                <span className="om-summary-chip">
                  Rework: {Number(batch.counts?.rework_tasks || 0)}
                </span>
                <span className="om-summary-chip">
                  Completed: {Number(batch.counts?.completed_tasks || 0)}
                </span>
                <span className="small text-secondary align-self-center">
                  Generated tasks shown below are paginated and keep their own status,
                  history, comments, and rework counts.
                </span>
              </div>
            </div>

            <div className="card om-card">
              <div className="card-body p-0">
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 p-3 border-bottom">
                  <div>
                    <div className="fw-semibold">Generated Tasks</div>
                    <div className="small text-secondary">
                      Total task records in this batch: {taskPagination.totalRecords}
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <label className="small text-secondary mb-0">Rows</label>
                    <select
                      className="form-select form-select-sm"
                      style={{ width: "auto" }}
                      value={taskLimit}
                      onChange={(event) => {
                        setTaskLimit(Number(event.target.value) || DEFAULT_TASK_LIMIT);
                        setTaskPage(1);
                      }}
                    >
                      {TASK_LIMIT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {tasksLoading ? (
                  <div className="text-center py-5 text-secondary">
                    Loading generated tasks...
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="text-center py-5 text-secondary">
                    No generated tasks found for this batch.
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Task No</th>
                          <th>Title</th>
                          <th>Task Type</th>
                          <th>Status</th>
                          <th>Assigned Users</th>
                          <th>Rework Count</th>
                          <th>Source Folder / Path</th>
                          <th>Source Files</th>
                          <th>Due Date</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task) => (
                          <tr key={task._id}>
                            <td>{task.task_no}</td>
                            <td>{task.title}</td>
                            <td>{task.task_type_name || task.task_type?.name || task.task_type_key}</td>
                            <td>{task.status}</td>
                            <td>
                              {Array.isArray(task.assigned_to) && task.assigned_to.length > 0
                                ? task.assigned_to
                                    .map((entry) => entry?.user?.name || entry?.user?.email || "User")
                                    .join(", ")
                                : "Unassigned"}
                            </td>
                            <td>{Number(task.rework_count || 0)}</td>
                            <td>
                              <div>{task.source_folder_name || "—"}</div>
                              <div className="small text-secondary">
                                {task.source_folder_path || "—"}
                              </div>
                            </td>
                            <td>{Array.isArray(task.source_files) ? task.source_files.length : 0}</td>
                            <td>{formatDateTime(task.due_date)}</td>
                            <td>
                              <div className="d-flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn btn-outline-primary btn-sm"
                                  onClick={() => setSelectedTaskId(task._id)}
                                >
                                  View
                                </button>
                                {canDeleteWorkflow && (
                                  <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handleDeleteTask(task)}
                                  >
                                    Delete Task
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
                disabled={tasksLoading || taskPage <= 1}
                onClick={() => setTaskPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </button>
              <div className="small text-secondary">
                Page {taskPagination.page} of {taskPagination.totalPages}
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={tasksLoading || taskPage >= taskPagination.totalPages}
                onClick={() =>
                  setTaskPage((prev) => Math.min(taskPagination.totalPages, prev + 1))
                }
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {selectedTaskId && (
        <WorkflowTaskDetailModal
          taskId={selectedTaskId}
          availableUsers={users}
          canManageWorkflow={canEditWorkflow}
          canAssignWorkflow={canAssignWorkflow}
          canApproveWorkflow={canApproveWorkflow}
          canDeleteWorkflow={canDeleteWorkflow}
          onClose={() => setSelectedTaskId("")}
          onUpdated={() => setRefreshTick((prev) => prev + 1)}
          onDeleted={() => {
            setSelectedTaskId("");
            setRefreshTick((prev) => prev + 1);
          }}
        />
      )}
    </>
  );
};

export default WorkflowBatchDetail;
