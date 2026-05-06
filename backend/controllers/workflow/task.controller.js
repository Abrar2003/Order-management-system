const {
  addWorkflowTaskComment,
  approveWorkflowTask,
  assignWorkflowTask,
  buildTaskDetail,
  completeWorkflowTask,
  createWorkflowTask,
  deleteWorkflowTask,
  getWorkflowDashboardSummary,
  listWorkflowTasks,
  reviewWorkflowTask,
  reworkWorkflowTask,
  startWorkflowTask,
  submitWorkflowTask,
  uploadWorkflowTask,
  updateWorkflowTaskStatus,
} = require("../../services/workflow/workflowStatusService");
const { getErrorStatusCode } = require("./_utils");

const getWorkflowDashboard = async (req, res) => {
  try {
    const data = await getWorkflowDashboardSummary({
      query: req.query || {},
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Workflow Dashboard Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch workflow dashboard",
    });
  }
};

const getWorkflowTasks = async (req, res) => {
  try {
    const result = await listWorkflowTasks({
      query: req.query || {},
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("List Workflow Tasks Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch workflow tasks",
    });
  }
};

const createTask = async (req, res) => {
  try {
    const data = await createWorkflowTask({
      payload: req.body || {},
      actor: req.user,
      realtimeSource: req,
    });

    return res.status(201).json({
      success: true,
      message: "Workflow task created successfully",
      data,
    });
  } catch (error) {
    console.error("Create Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to create workflow task",
    });
  }
};

const getWorkflowTask = async (req, res) => {
  try {
    const data = await buildTaskDetail(req.params.id, req.user);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Workflow task not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch workflow task",
    });
  }
};

const assignTask = async (req, res) => {
  try {
    const data = await assignWorkflowTask({
      taskId: req.params.id,
      assigneeIds: req.body?.assignee_ids || [],
      actor: req.user,
      note: req.body?.note || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task assignment updated successfully",
      data,
    });
  } catch (error) {
    console.error("Assign Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to assign workflow task",
    });
  }
};

const startTask = async (req, res) => {
  try {
    const data = await startWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task started successfully",
      data,
    });
  } catch (error) {
    console.error("Start Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to start workflow task",
    });
  }
};

const submitTask = async (req, res) => {
  try {
    const data = await submitWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task marked complete successfully",
      data,
    });
  } catch (error) {
    console.error("Submit Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to complete workflow task",
    });
  }
};

const completeTask = async (req, res) => {
  try {
    const data = await completeWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || req.body?.comment || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task marked complete successfully",
      data,
    });
  } catch (error) {
    console.error("Complete Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to complete workflow task",
    });
  }
};

const reviewTask = async (req, res) => {
  try {
    const data = await reviewWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task moved to review successfully",
      data,
    });
  } catch (error) {
    console.error("Review Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to review workflow task",
    });
  }
};

const approveTask = async (req, res) => {
  try {
    const data = await approveWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task approved successfully",
      data,
    });
  } catch (error) {
    console.error("Approve Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to approve workflow task",
    });
  }
};

const uploadTask = async (req, res) => {
  try {
    const data = await uploadWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task marked uploaded successfully",
      data,
    });
  } catch (error) {
    console.error("Upload Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to mark workflow task uploaded",
    });
  }
};

const reworkTask = async (req, res) => {
  try {
    const data = await reworkWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || req.body?.reason || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task moved to rework successfully",
      data,
    });
  } catch (error) {
    console.error("Rework Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to send workflow task to rework",
    });
  }
};

const patchTaskStatus = async (req, res) => {
  try {
    const data = await updateWorkflowTaskStatus({
      taskId: req.params.id,
      actor: req.user,
      toStatus: req.body?.status,
      note: req.body?.note || req.body?.reason || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task status updated successfully",
      data,
    });
  } catch (error) {
    console.error("Update Workflow Task Status Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to update workflow task status",
    });
  }
};

const postTaskComment = async (req, res) => {
  try {
    const data = await addWorkflowTaskComment({
      taskId: req.params.id,
      actor: req.user,
      comment: req.body?.comment,
      commentType: req.body?.comment_type || "general",
      realtimeSource: req,
    });

    return res.status(201).json({
      success: true,
      message: "Workflow task comment added successfully",
      data,
    });
  } catch (error) {
    console.error("Create Workflow Task Comment Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to add workflow task comment",
    });
  }
};

const removeTask = async (req, res) => {
  try {
    const data = await deleteWorkflowTask({
      taskId: req.params.id,
      actor: req.user,
      note: req.body?.note || req.body?.reason || "",
      realtimeSource: req,
    });

    return res.status(200).json({
      success: true,
      message: "Workflow task deleted successfully",
      data,
    });
  } catch (error) {
    console.error("Delete Workflow Task Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to delete workflow task",
    });
  }
};

module.exports = {
  approveTask,
  assignTask,
  completeTask,
  createTask,
  getWorkflowDashboard,
  getWorkflowTask,
  getWorkflowTasks,
  patchTaskStatus,
  postTaskComment,
  removeTask,
  reviewTask,
  reworkTask,
  startTask,
  submitTask,
  uploadTask,
};
