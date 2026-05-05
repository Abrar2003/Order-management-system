const mongoose = require("mongoose");
const {
  WORKFLOW_BATCH_STATUSES,
  buildBatchCounts,
  buildEmptyTaskCounts,
} = require("../../helpers/workflow");
const { Batch, Task } = require("../../models/workflow");

const buildWorkflowBatchTaskCountsFromAggregation = (aggregation = []) => {
  const counts = buildEmptyTaskCounts();
  const meta = {
    blocked_tasks: 0,
    cancelled_tasks: 0,
  };

  (Array.isArray(aggregation) ? aggregation : []).forEach((entry) => {
    const status = String(entry?._id || "").trim();
    const count = Number(entry?.count || 0);
    counts.total_tasks += count;

    const countKey = `${status}_tasks`;
    if (Object.prototype.hasOwnProperty.call(counts, countKey)) {
      counts[countKey] = count;
      return;
    }

    if (status === "cancelled") {
      meta.cancelled_tasks += count;
    } else if (status === "blocked") {
      meta.blocked_tasks += count;
    }
  });

  return {
    counts,
    meta,
  };
};

const deriveWorkflowBatchStatusFromCounts = (
  counts = {},
  currentStatus = WORKFLOW_BATCH_STATUSES[0],
  meta = {},
) => {
  if (currentStatus === "cancelled") {
    return "cancelled";
  }

  const totalTasks = Number(counts?.total_tasks || 0);
  const completedTasks = Number(counts?.completed_tasks || 0);
  const inProgressTasks = Number(counts?.in_progress_tasks || 0);
  const submittedTasks = Number(counts?.submitted_tasks || 0);
  const reviewTasks = Number(counts?.review_tasks || 0);
  const reworkTasks = Number(counts?.rework_tasks || 0);
  const blockedTasks = Number(meta?.blocked_tasks || 0);
  const cancelledTasks = Number(meta?.cancelled_tasks || 0);

  if (totalTasks <= 0) {
    return "draft";
  }

  if (cancelledTasks >= totalTasks) {
    return "cancelled";
  }

  if (completedTasks >= totalTasks) {
    return "completed";
  }

  if (
    completedTasks > 0 ||
    inProgressTasks > 0 ||
    submittedTasks > 0 ||
    reviewTasks > 0 ||
    reworkTasks > 0 ||
    blockedTasks > 0
  ) {
    return "in_progress";
  }

  return "tasks_created";
};

const recalculateWorkflowBatchFromTasks = async (batchId) => {
  if (!mongoose.Types.ObjectId.isValid(batchId)) {
    throw new Error("Invalid batch id");
  }

  const batch = await Batch.findById(batchId);
  if (!batch || batch.is_deleted) {
    return null;
  }

  const aggregation = await Task.aggregate([
    {
      $match: {
        batch: batch._id,
        is_deleted: false,
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const { counts: taskCounts, meta } =
    buildWorkflowBatchTaskCountsFromAggregation(aggregation);

  batch.counts = buildBatchCounts(batch.counts || {}, taskCounts);
  batch.status = deriveWorkflowBatchStatusFromCounts(
    batch.counts,
    batch.status,
    meta,
  );

  const hasStarted =
    Number(taskCounts.in_progress_tasks || 0) > 0 ||
    Number(taskCounts.submitted_tasks || 0) > 0 ||
    Number(taskCounts.review_tasks || 0) > 0 ||
    Number(taskCounts.rework_tasks || 0) > 0 ||
    Number(taskCounts.completed_tasks || 0) > 0 ||
    Number(meta.blocked_tasks || 0) > 0;

  if (!batch.started_at && hasStarted) {
    batch.started_at = new Date();
  }

  if (batch.status === "completed" && Number(taskCounts.total_tasks || 0) > 0) {
    batch.completed_at = batch.completed_at || new Date();
  } else {
    batch.completed_at = null;
  }

  await batch.save();
  return batch;
};

module.exports = {
  buildWorkflowBatchTaskCountsFromAggregation,
  deriveWorkflowBatchStatusFromCounts,
  recalculateWorkflowBatchFromTasks,
};
