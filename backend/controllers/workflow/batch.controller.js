const {
  cancelWorkflowBatch,
  createWorkflowBatchFromFolderManifest,
  getWorkflowBatchById,
  listWorkflowBatches,
  updateWorkflowBatch,
} = require("../../services/workflow/workflowBatchService");
const { getErrorStatusCode } = require("./_utils");

const createBatchFromFolderManifest = async (req, res) => {
  try {
    const data = await createWorkflowBatchFromFolderManifest(req.body || {}, req.user);
    return res.status(201).json({
      success: true,
      message: "Workflow batch created successfully",
      data,
    });
  } catch (error) {
    console.error("Create Workflow Batch Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to create workflow batch",
    });
  }
};

const getWorkflowBatches = async (req, res) => {
  try {
    const result = await listWorkflowBatches({
      query: req.query || {},
      user: req.user,
    });

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("List Workflow Batches Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch workflow batches",
    });
  }
};

const getWorkflowBatch = async (req, res) => {
  try {
    const data = await getWorkflowBatchById(req.params.id, req.user);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Workflow batch not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get Workflow Batch Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to fetch workflow batch",
    });
  }
};

const patchWorkflowBatch = async (req, res) => {
  try {
    const data = await updateWorkflowBatch(req.params.id, req.body || {}, req.user);
    return res.status(200).json({
      success: true,
      message: "Workflow batch updated successfully",
      data,
    });
  } catch (error) {
    console.error("Update Workflow Batch Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to update workflow batch",
    });
  }
};

const cancelBatch = async (req, res) => {
  try {
    const data = await cancelWorkflowBatch(
      req.params.id,
      req.user,
      req.body?.note || req.body?.reason || "",
    );

    return res.status(200).json({
      success: true,
      message: "Workflow batch cancelled successfully",
      data,
    });
  } catch (error) {
    console.error("Cancel Workflow Batch Error:", error);
    return res.status(getErrorStatusCode(error)).json({
      success: false,
      message: error.message || "Failed to cancel workflow batch",
    });
  }
};

module.exports = {
  cancelBatch,
  createBatchFromFolderManifest,
  getWorkflowBatch,
  getWorkflowBatches,
  patchWorkflowBatch,
};
