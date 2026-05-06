const mongoose = require("mongoose");
const { buildAuditActor } = require("../../helpers/permissions");
const {
  WORKFLOW_BATCH_STATUSES,
  buildBatchCounts,
  buildWorkflowBatchNo,
  normalizeFileManifest,
  normalizeKey,
  normalizeNameKey,
  normalizeSourceFolderKey,
  normalizeSourceFolderName,
  normalizeText,
  summarizeManifestCounts,
} = require("../../helpers/workflow");
const { Batch, Comment, Task, TaskAssignment, TaskStatusHistory } = require("../../models/workflow");
const {
  findActiveTaskTypeByKey,
  generateTasksForBatch,
  previewTaskDefinitionsForBatch,
  validateAssigneeUsers,
} = require("./workflowTaskGenerationService");
const {
  recalculateWorkflowBatchFromTasks,
} = require("./workflowBatchAggregationService");
const { isAdmin, isPrivilegedWorkflowReader } = require("./workflowPermissionService");

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

const parsePositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const toDateOrNull = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDueDate = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("due_date is invalid");
  }
  return parsed;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeId = (value) => String(value || "").trim();

const getAccessibleBatchIdsForUser = async (user = {}) => {
  const userId = normalizeId(user?._id);
  if (!userId) return [];

  return Task.distinct("batch", {
    is_deleted: false,
    "assigned_to.user": userId,
  });
};

const buildBatchVisibilityMatch = async (user = {}) => {
  if (isPrivilegedWorkflowReader(user)) {
    return { is_deleted: false };
  }

  const accessibleBatchIds = await getAccessibleBatchIdsForUser(user);
  return {
    is_deleted: false,
    _id: { $in: accessibleBatchIds },
  };
};

const populateBatchQuery = (query) =>
  query
    .populate("task_type", "key name category auto_create_mode default_priority requires_review is_active")
    .populate("assignees.user", "name email role")
    .populate("created_by.user", "name email role")
    .populate("updated_by.user", "name email role")
    .lean();

const serializeBatch = (doc = {}) => ({
  ...doc,
  task_type_key: normalizeKey(doc?.task_type_key || doc?.selected_task_type?.key),
  name_key: normalizeNameKey(doc?.name_key || doc?.name),
  source_folder_key: normalizeSourceFolderKey(
    doc?.source_folder_key || doc?.source_folder_name || "folder",
  ),
});

const createWorkflowBatchFromFolderManifest = async (payload = {}, actor = {}) => {
  const name = normalizeText(payload?.name);
  if (!name) {
    throw new Error("Batch name is required");
  }

  const sourceFolderName = normalizeSourceFolderName(payload?.source_folder_name);
  const sourceFolderKey = normalizeSourceFolderKey(sourceFolderName);
  const taskType = await findActiveTaskTypeByKey(payload?.task_type_key);
  const assignees = await validateAssigneeUsers(payload?.assignee_ids || []);
  const dueDate = parseDueDate(payload?.due_date);
  const manifestEntries = normalizeFileManifest(payload?.file_manifest, {
    sourceFolderName,
  });
  const fileCounts = summarizeManifestCounts(manifestEntries);

  const duplicateBatch = await Batch.findOne({
    source_folder_key: sourceFolderKey,
    task_type_key: taskType.key,
    is_deleted: false,
    status: { $nin: ["cancelled", "failed"] },
  })
    .select("_id batch_no name source_folder_name task_type_key status")
    .lean();

  if (duplicateBatch) {
    throw new Error(
      `A workflow batch already exists for folder "${duplicateBatch.source_folder_name}" and task type "${duplicateBatch.task_type_key}"`,
    );
  }

  previewTaskDefinitionsForBatch({
    batch: {
      name,
      source_folder_name: sourceFolderName,
      description: normalizeText(payload?.description),
      brand: normalizeText(payload?.brand),
    },
    taskType,
    manifestEntries,
  });

  const batchId = new mongoose.Types.ObjectId();
  const batchNo = buildWorkflowBatchNo(batchId, new Date());
  const auditActor = buildAuditActor(actor);

  const batchDoc = new Batch({
    _id: batchId,
    batch_no: batchNo,
    name,
    name_key: normalizeNameKey(name),
    source_folder_name: sourceFolderName,
    source_folder_key: sourceFolderKey,
    description: normalizeText(payload?.description),
    brand: normalizeText(payload?.brand),
    selected_task_type: {
      key: taskType.key,
      name: taskType.name,
      category: taskType.category,
      auto_create_mode: taskType.auto_create_mode,
      requires_review: taskType.requires_review !== false,
    },
    task_type: taskType._id,
    task_type_key: taskType.key,
    status: WORKFLOW_BATCH_STATUSES[0],
    assignment_mode: normalizeText(payload?.assignment_mode || "manual").toLowerCase() || "manual",
    assignees: assignees.map((assignee) => ({ user: assignee._id })),
    due_date: dueDate,
    counts: buildBatchCounts(fileCounts, {}),
    uploaded_by: auditActor,
    created_by: auditActor,
    updated_by: auditActor,
  });

  await batchDoc.save();

  try {
    const generationResult = await generateTasksForBatch({
      batch: batchDoc.toObject(),
      taskType,
      manifestEntries,
      assignees,
      actor,
    });

    batchDoc.counts = buildBatchCounts(fileCounts, generationResult.task_counts);
    batchDoc.status = "tasks_created";
    batchDoc.updated_by = auditActor;
    await batchDoc.save();
    await recalculateWorkflowBatchFromTasks(batchDoc._id);

    return populateBatchQuery(Batch.findById(batchDoc._id));
  } catch (error) {
    batchDoc.status = "failed";
    batchDoc.updated_by = auditActor;
    await batchDoc.save().catch(() => {});
    throw error;
  }
};

const listWorkflowBatches = async ({ query = {}, user = {} } = {}) => {
  const page = parsePositiveInt(query?.page, 1);
  const limit = Math.min(MAX_PAGE_LIMIT, parsePositiveInt(query?.limit, DEFAULT_PAGE_LIMIT));
  const skip = (page - 1) * limit;

  const match = await buildBatchVisibilityMatch(user);

  if (normalizeText(query?.status)) {
    match.status = normalizeText(query.status).toLowerCase();
  }
  if (normalizeText(query?.brand)) {
    match.brand = normalizeText(query.brand);
  }
  if (normalizeText(query?.task_type_key)) {
    match.task_type_key = normalizeKey(query.task_type_key);
  }
  if (normalizeText(query?.created_by) && mongoose.Types.ObjectId.isValid(query.created_by)) {
    match["created_by.user"] = new mongoose.Types.ObjectId(query.created_by);
  }

  const createdFrom = toDateOrNull(query?.date_from);
  const createdTo = toDateOrNull(query?.date_to);
  if (createdFrom || createdTo) {
    match.createdAt = {};
    if (createdFrom) {
      match.createdAt.$gte = createdFrom;
    }
    if (createdTo) {
      const endDate = new Date(createdTo);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      match.createdAt.$lt = endDate;
    }
  }

  if (normalizeText(query?.search)) {
    const regex = new RegExp(escapeRegex(normalizeText(query.search)), "i");
    match.$or = [
      { batch_no: regex },
      { name: regex },
      { source_folder_name: regex },
      { brand: regex },
    ];
  }

  const [rows, totalRecords] = await Promise.all([
    populateBatchQuery(
      Batch.find(match)
        .sort({ createdAt: -1, batch_no: 1 })
        .skip(skip)
        .limit(limit),
    ),
    Batch.countDocuments(match),
  ]);

  return {
    rows: rows.map(serializeBatch),
    pagination: {
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
      totalRecords,
    },
  };
};

const getWorkflowBatchById = async (id, user = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }

  const match = await buildBatchVisibilityMatch(user);
  match._id = id;

  const doc = await populateBatchQuery(Batch.findOne(match));
  return doc ? serializeBatch(doc) : null;
};

const updateWorkflowBatch = async (id, payload = {}, actor = {}) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }

  const batch = await Batch.findById(id);
  if (!batch || batch.is_deleted) {
    throw new Error("Workflow batch not found");
  }
  if (batch.status === "cancelled") {
    throw new Error("Cancelled batches cannot be updated");
  }

  if (payload?.name !== undefined) {
    batch.name = normalizeText(payload.name);
    batch.name_key = normalizeNameKey(batch.name);
  }
  if (payload?.description !== undefined) {
    batch.description = normalizeText(payload.description);
  }
  if (payload?.brand !== undefined) {
    batch.brand = normalizeText(payload.brand);
  }
  if (payload?.assignment_mode !== undefined) {
    batch.assignment_mode = normalizeText(payload.assignment_mode).toLowerCase() || batch.assignment_mode;
  }
  if (payload?.due_date !== undefined) {
    batch.due_date = parseDueDate(payload.due_date);
  }

  batch.updated_by = buildAuditActor(actor);
  await batch.save();
  return populateBatchQuery(Batch.findById(batch._id));
};

const deleteWorkflowBatch = async (id, actor = {}, note = "") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }
  if (!isAdmin(actor)) {
    throw new Error("Only admins can delete workflow batches");
  }

  const batch = await Batch.findById(id);
  if (!batch || batch.is_deleted) {
    throw new Error("Workflow batch not found");
  }

  const auditActor = buildAuditActor(actor);
  const normalizedNote = normalizeText(note) || "Workflow batch deleted by admin";
  const tasks = await Task.find({
    batch: batch._id,
    is_deleted: false,
  }).select("_id batch status");

  const taskIds = tasks.map((task) => task._id);
  const tasksNeedingCancellationHistory = tasks.filter(
    (task) => !["completed", "cancelled"].includes(task.status),
  );

  if (taskIds.length > 0) {
    await Task.updateMany(
      { _id: { $in: taskIds } },
      {
        $set: {
          is_deleted: true,
          updated_by: auditActor,
        },
      },
    );

    if (tasksNeedingCancellationHistory.length > 0) {
      await Task.updateMany(
        { _id: { $in: tasksNeedingCancellationHistory.map((task) => task._id) } },
        {
          $set: {
            status: "cancelled",
            blocked_reason: normalizedNote,
          },
        },
      );

      await TaskStatusHistory.insertMany(
        tasksNeedingCancellationHistory.map((task) => ({
          task: task._id,
          batch: batch._id,
          from_status: task.status,
          to_status: "cancelled",
          changed_by: auditActor,
          changed_at: new Date(),
          note: normalizedNote,
          metadata: {
            batch_deleted: true,
            deleted_by_admin: true,
          },
        })),
        { ordered: false },
      );
    }

    await TaskAssignment.updateMany(
      {
        batch: batch._id,
        status: "active",
      },
      {
        $set: {
          status: "removed",
          removed_at: new Date(),
          removed_by: auditActor,
          note: normalizedNote,
        },
      },
    );
  }

  await Comment.updateMany(
    {
      batch: batch._id,
      is_deleted: false,
    },
    {
      $set: {
        is_deleted: true,
        deleted_at: new Date(),
        deleted_by: auditActor,
        updated_by: auditActor,
      },
    },
  );

  batch.is_deleted = true;
  batch.status = "cancelled";
  batch.updated_by = auditActor;
  batch.completed_at = null;
  await batch.save();

  return {
    _id: batch._id,
    batch_no: batch.batch_no,
    status: batch.status,
    is_deleted: true,
  };
};

const cancelWorkflowBatch = async (id, actor = {}, note = "") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }

  const batch = await Batch.findById(id);
  if (!batch || batch.is_deleted) {
    throw new Error("Workflow batch not found");
  }
  if (batch.status === "cancelled") {
    return populateBatchQuery(Batch.findById(batch._id));
  }

  const auditActor = buildAuditActor(actor);
  const tasks = await Task.find({
    batch: batch._id,
    is_deleted: false,
    status: { $nin: ["completed", "cancelled"] },
  }).lean();

  if (tasks.length > 0) {
    const taskIds = tasks.map((task) => task._id);
    await Task.updateMany(
      { _id: { $in: taskIds } },
      {
        $set: {
          status: "cancelled",
          updated_by: auditActor,
        },
      },
    );

    await TaskAssignment.updateMany(
      {
        task: { $in: taskIds },
        status: "active",
      },
      {
        $set: {
          status: "removed",
          removed_at: new Date(),
          removed_by: auditActor,
          note: normalizeText(note) || "Task removed because the batch was cancelled",
        },
      },
    );

    await TaskStatusHistory.insertMany(
      tasks.map((task) => ({
        task: task._id,
        batch: batch._id,
        from_status: task.status,
        to_status: "cancelled",
        changed_by: auditActor,
        changed_at: new Date(),
        note: normalizeText(note) || "Batch cancelled",
        metadata: { batch_cancelled: true },
      })),
      { ordered: false },
    );

    await Comment.insertMany(
      tasks.map((task) => ({
        task: task._id,
        batch: batch._id,
        comment: normalizeText(note) || "Batch cancelled by manager/admin",
        comment_type: "system",
        created_by: auditActor,
        updated_by: auditActor,
      })),
      { ordered: false },
    ).catch(() => {});
  }

  batch.status = "cancelled";
  batch.updated_by = auditActor;
  await batch.save();

  await recalculateWorkflowBatchFromTasks(batch._id);
  return populateBatchQuery(Batch.findById(batch._id));
};

module.exports = {
  cancelWorkflowBatch,
  createWorkflowBatchFromFolderManifest,
  deleteWorkflowBatch,
  getWorkflowBatchById,
  listWorkflowBatches,
  updateWorkflowBatch,
};
