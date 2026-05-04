const {
  createWorkflowDepartment,
  listWorkflowDepartments,
  updateWorkflowDepartment,
} = require("../../services/workflow/workflowStatusService");
const { getErrorStatusCode } = require("./_utils");

const getWorkflowDepartments = async (req, res) => {
  try {
    const data = await listWorkflowDepartments(req.user);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("List Workflow Departments Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch workflow departments",
    });
  }
};

const createDepartment = async (req, res) => {
  try {
    const data = await createWorkflowDepartment(req.body || {}, req.user);
    return res.status(201).json({
      success: true,
      message: "Workflow department created successfully",
      data,
    });
  } catch (error) {
    console.error("Create Workflow Department Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to create workflow department",
    });
  }
};

const patchDepartment = async (req, res) => {
  try {
    const data = await updateWorkflowDepartment(req.params.id, req.body || {}, req.user);
    return res.status(200).json({
      success: true,
      message: "Workflow department updated successfully",
      data,
    });
  } catch (error) {
    console.error("Update Workflow Department Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to update workflow department",
    });
  }
};

module.exports = {
  createDepartment,
  getWorkflowDepartments,
  patchDepartment,
};
