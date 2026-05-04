const {
  createWorkflowTaskType,
  listWorkflowTaskTypes,
  updateWorkflowTaskType,
} = require("../../services/workflow/workflowStatusService");
const { getErrorStatusCode } = require("./_utils");

const getWorkflowTaskTypes = async (req, res) => {
  try {
    const data = await listWorkflowTaskTypes(req.user);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("List Workflow Task Types Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch workflow task types",
    });
  }
};

const createTaskType = async (req, res) => {
  try {
    const data = await createWorkflowTaskType(req.body || {}, req.user);
    return res.status(201).json({
      success: true,
      message: "Workflow task type created successfully",
      data,
    });
  } catch (error) {
    console.error("Create Workflow Task Type Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to create workflow task type",
    });
  }
};

const patchTaskType = async (req, res) => {
  try {
    const data = await updateWorkflowTaskType(req.params.id, req.body || {}, req.user);
    return res.status(200).json({
      success: true,
      message: "Workflow task type updated successfully",
      data,
    });
  } catch (error) {
    console.error("Update Workflow Task Type Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to update workflow task type",
    });
  }
};

module.exports = {
  createTaskType,
  getWorkflowTaskTypes,
  patchTaskType,
};
