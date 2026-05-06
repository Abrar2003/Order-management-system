const mongoose = require("mongoose");
const {
  WORKFLOW_BATCH_STATUSES,
  buildWorkflowTaskStatusNormalizationExpression,
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
  const assignedTasks = Number(counts?.assigned_tasks || 0);
  const completedTasks = Number(counts?.complete_tasks || 0);
  const approvedTasks = Number(counts?.approved_tasks || 0);
  const uploadedTasks = Number(counts?.uploaded_tasks || 0);
  const blockedTasks = Number(meta?.blocked_tasks || 0);
  const cancelledTasks = Number(meta?.cancelled_tasks || 0);

  if (totalTasks <= 0) {
    return "draft";
  }

  if (cancelledTasks >= totalTasks) {
    return "cancelled";
  }

  if (uploadedTasks >= totalTasks) {
    return "completed";
  }

  if (
    assignedTasks > 0 ||
    completedTasks > 0 ||
    approvedTasks > 0 ||
    uploadedTasks > 0 ||
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
      $addFields: {
        normalized_status: buildWorkflowTaskStatusNormalizationExpression(),
        normalized_rework_count: {
          $ifNull: ["$reworked.count", { $ifNull: ["$rework_count", 0] }],
        },
      },
    },
    {
      $group: {
        _id: "$normalized_status",
        count: { $sum: 1 },
      },
    },
  ]);

  const { counts: taskCounts, meta } =
    buildWorkflowBatchTaskCountsFromAggregation(aggregation);

  const [reworkedSummary] = await Task.aggregate([
    {
      $match: {
        batch: batch._id,
        is_deleted: false,
      },
    },
    {
      $group: {
        _id: null,
        reworked_tasks: {
          $sum: {
            $cond: [
              {
                $gt: [
                  { $ifNull: ["$reworked.count", { $ifNull: ["$rework_count", 0] }] },
                  0,
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  taskCounts.reworked_tasks = Number(reworkedSummary?.reworked_tasks || 0);

  batch.counts = buildBatchCounts(batch.counts || {}, taskCounts);
  batch.status = deriveWorkflowBatchStatusFromCounts(
    batch.counts,
    batch.status,
    meta,
  );

  const hasStarted =
    Number(taskCounts.assigned_tasks || 0) > 0 ||
    Number(taskCounts.complete_tasks || 0) > 0 ||
    Number(taskCounts.approved_tasks || 0) > 0 ||
    Number(taskCounts.uploaded_tasks || 0) > 0 ||
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
