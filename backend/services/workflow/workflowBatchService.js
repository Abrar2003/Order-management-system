const mongoose = require("mongoose");
const { buildAuditActor } = require("../../helpers/permissions");
const {
  WORKFLOW_BATCH_STATUSES,
  buildBatchCounts,
  buildWorkflowBatchNo,
  normalizeDirectSubfolderNames,
  normalizeFileManifest,
  normalizeKey,
  normalizeNameKey,
  normalizeSourceFolderKey,
  normalizeSourceFolderName,
  normalizeText,
  normalizeWorkflowAutoCreateMode,
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
const {
  emitWorkflowBatchUpdated,
  emitWorkflowForceRefetch,
  extractAssignedUserIds,
} = require("./workflowRealtimeService");
const {
  notifyWorkflowBatchEvent,
} = require("../notificationService");
const {
  applyDataAccessMatch,
  assertUserDataAccess,
} = require("../userDataAccess.service");

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const INDIA_TIMEZONE_OFFSET_MS = 330 * 60 * 1000;

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

const getIndianDayStart = (value = new Date()) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const shifted = new Date(parsed.getTime() + INDIA_TIMEZONE_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) - INDIA_TIMEZONE_OFFSET_MS,
  );
};

const isSameIndianDay = (left, right) => {
  const leftDay = left ? getIndianDayStart(left) : null;
  const rightDay = right ? getIndianDayStart(right) : null;
  if (!leftDay || !rightDay) return false;
  return leftDay.getTime() === rightDay.getTime();
};

const parseDueDate = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(
      Date.UTC(year, month - 1, day) - INDIA_TIMEZONE_OFFSET_MS,
    );
    const shifted = new Date(parsed.getTime() + INDIA_TIMEZONE_OFFSET_MS);
    if (
      shifted.getUTCFullYear() !== year ||
      shifted.getUTCMonth() !== month - 1 ||
      shifted.getUTCDate() !== day
    ) {
      throw new Error("due_date is invalid");
    }
    return parsed;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("due_date is invalid");
  }
  return parsed;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeId = (value) => String(value || "").trim();

const uniqueIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))];

const getTaskUserId = (entry = {}) =>
  normalizeId(entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || entry);

const getActiveTaskDueDate = (task = {}) => {
  const candidates = [
    task?.due_date,
    ...(Array.isArray(task?.rework_due_dates)
      ? task.rework_due_dates.map((entry) => entry?.date)
      : []),
  ]
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && !Number.isNaN(value.getTime()));
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, value) =>
    value.getTime() > latest.getTime() ? value : latest,
  );
};

const buildUploadStatusEntries = (assignees = []) =>
  (Array.isArray(assignees) ? assignees : [])
    .map((entry) => {
      const userId = getTaskUserId(entry);
      return userId
        ? {
            user: userId,
            status: "pending",
            uploaded_by: {},
            uploaded_at: null,
          }
        : null;
    })
    .filter(Boolean);

const collectTaskAssigneeIds = (tasks = []) =>
  [
    ...new Set(
      (Array.isArray(tasks) ? tasks : [])
        .flatMap((task) => extractAssignedUserIds(task?.assigned_to))
        .filter(Boolean),
    ),
  ];

const emitWorkflowBatchMutation = ({
  realtimeSource = null,
  batch = null,
  message = "",
  affectedAssigneeIds = [],
  actor = {},
} = {}) => {
  if (!realtimeSource || !batch) return;

  emitWorkflowBatchUpdated(realtimeSource, batch, {
    message,
    changedFields: ["counts", "status"],
    shouldRefetch: true,
    additionalUserIds: affectedAssigneeIds,
  });

  emitWorkflowForceRefetch(realtimeSource, {
    batchId: batch?._id || batch,
    userIds: affectedAssigneeIds,
    reason: message || "workflow_batch_changed",
  });
  notifyWorkflowBatchEvent({
    realtimeSource,
    batch,
    userIds: affectedAssigneeIds,
    actor,
    type: "workflow_batch_updated",
    title: "Workflow batch updated",
    message,
  }).catch((error) => {
    console.error("Workflow batch notification failed:", error);
  });
};

const getAccessibleBatchIdsForUser = async (user = {}) => {
  const userId = normalizeId(user?._id);
  if (!userId) return [];

  return Task.distinct("batch", {
    is_deleted: false,
    "assigned_to.user": userId,
  });
};

const buildBatchVisibilityMatch = async (user = {}) => {
  let match;
  if (isPrivilegedWorkflowReader(user)) {
    match = { is_deleted: false };
  } else {
    const accessibleBatchIds = await getAccessibleBatchIdsForUser(user);
    match = {
      is_deleted: false,
      _id: { $in: accessibleBatchIds },
    };
  }

  return applyDataAccessMatch(match, user);
};

const getMutableBatchByIdForUser = (id, user = {}) =>
  Batch.findOne(
    applyDataAccessMatch(
      { _id: id, is_deleted: false },
      user,
    ),
  );

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

const createWorkflowBatchFromFolderManifest = async (
  payload = {},
  actor = {},
  realtimeSource = null,
) => {
  if (!isAdmin(actor)) {
    throw new Error("Only admins can create workflow batches");
  }

  const startCode = normalizeText(payload?.start_code);
  const name = normalizeText(payload?.name || startCode || payload?.source_folder_name);
  const brand = normalizeText(payload?.brand);
  if (!name) {
    throw new Error("Batch name is required");
  }
  assertUserDataAccess(actor, { brands: brand ? [brand] : [], vendors: [] });

  if (!Array.isArray(payload?.assignee_ids) || payload.assignee_ids.length === 0) {
    throw new Error("At least one assignee is required");
  }

  const sourceFolderName = normalizeSourceFolderName(payload?.source_folder_name);
  const sourceFolderKey = normalizeSourceFolderKey(sourceFolderName);
  const taskType = await findActiveTaskTypeByKey(payload?.task_type_key);
  const assignees = await validateAssigneeUsers(payload?.assignee_ids || []);
  const uploadRequired = payload?.upload_required !== undefined
    ? Boolean(payload.upload_required)
    : true;
  const defaultUploadAssigneeIds = [
    actor?._id || actor?.id,
    ...assignees.map((assignee) => assignee?._id),
  ];
  const uploadAssigneeIds = uploadRequired
    ? (
        payload?.upload_assignee_ids !== undefined
          ? payload.upload_assignee_ids
          : defaultUploadAssigneeIds
      )
    : [];
  const uploadAssignees = uploadRequired
    ? await validateAssigneeUsers(uploadAssigneeIds)
    : [];
  if (uploadRequired && uploadAssignees.length === 0) {
    throw new Error("At least one upload user is required when upload is required");
  }
  const dueDate = parseDueDate(payload?.due_date);
  if (!dueDate) {
    throw new Error("due_date is required");
  }
  const autoCreateMode = normalizeWorkflowAutoCreateMode(taskType?.auto_create_mode);
  const directSubfolders = normalizeDirectSubfolderNames(
    payload?.direct_subfolders || [],
    sourceFolderName,
  );
  const manifestEntries = autoCreateMode === "per_direct_subfolder" && directSubfolders.length > 0
    ? []
    : normalizeFileManifest(payload?.file_manifest, {
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

  const previewDefinitions = previewTaskDefinitionsForBatch({
    batch: {
      name,
      start_code: startCode,
      source_folder_name: sourceFolderName,
      description: normalizeText(payload?.description),
      brand,
    },
    taskType,
    manifestEntries,
    directSubfolders,
  });
  const selectedPreviewIds = uniqueIds(payload?.selected_preview_ids || []);
  if (Array.isArray(payload?.selected_preview_ids) && selectedPreviewIds.length === 0) {
    throw new Error("Select at least one task to create from this folder");
  }
  if (selectedPreviewIds.length > 0) {
    const validPreviewIds = new Set(previewDefinitions.map((entry) => normalizeText(entry?.preview_id)));
    const invalidPreviewId = selectedPreviewIds.find((id) => !validPreviewIds.has(id));
    if (invalidPreviewId) {
      throw new Error("One or more selected preview tasks are no longer valid");
    }
  }

  const batchId = new mongoose.Types.ObjectId();
  const batchNo = buildWorkflowBatchNo(batchId, new Date());
  const auditActor = buildAuditActor(actor);

  const batchDoc = new Batch({
    _id: batchId,
    batch_no: batchNo,
    name,
    name_key: normalizeNameKey(name),
    start_code: startCode,
    source_folder_name: sourceFolderName,
    source_folder_key: sourceFolderKey,
    description: normalizeText(payload?.description),
    brand,
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
      directSubfolders,
      selectedPreviewIds,
      assignees,
      uploadRequired,
      uploadAssignees: uploadAssignees.map((user) => ({ user: user._id })),
      actor,
    });

    batchDoc.counts = buildBatchCounts(fileCounts, generationResult.task_counts);
    batchDoc.status = "tasks_created";
    batchDoc.updated_by = auditActor;
    await batchDoc.save();
    const recalculatedBatch = await recalculateWorkflowBatchFromTasks(batchDoc._id);

    emitWorkflowBatchMutation({
      realtimeSource,
      batch: recalculatedBatch || batchDoc,
      message: "Workflow batch created",
      affectedAssigneeIds: collectTaskAssigneeIds(generationResult.tasks),
      actor,
    });

    return populateBatchQuery(Batch.findById(batchDoc._id));
  } catch (error) {
    batchDoc.status = "failed";
    batchDoc.updated_by = auditActor;
    await batchDoc.save().catch(() => {});
    emitWorkflowBatchUpdated(realtimeSource, batchDoc, {
      message: "Workflow batch failed during task generation",
      changedFields: ["status"],
      shouldRefetch: true,
    });
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

const updateWorkflowBatch = async (
  id,
  payload = {},
  actor = {},
  realtimeSource = null,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }

  const batch = await getMutableBatchByIdForUser(id, actor);
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
    const brand = normalizeText(payload.brand);
    assertUserDataAccess(actor, { brands: brand ? [brand] : [], vendors: [] });
    batch.brand = brand;
  }
  if (payload?.assignment_mode !== undefined) {
    batch.assignment_mode = normalizeText(payload.assignment_mode).toLowerCase() || batch.assignment_mode;
  }
  if (payload?.due_date !== undefined) {
    const dueDate = parseDueDate(payload.due_date);
    if (!dueDate) {
      throw new Error("due_date is required");
    }
    batch.due_date = dueDate;
  }

  batch.updated_by = buildAuditActor(actor);
  await batch.save();
  emitWorkflowBatchUpdated(realtimeSource, batch, {
    message: "Workflow batch updated",
    changedFields: ["batch"],
    shouldRefetch: true,
  });
  return populateBatchQuery(Batch.findById(batch._id));
};

const buildBulkSkip = (task = {}, reason = "") => ({
  task_id: task?._id || null,
  task_no: task?.task_no || "",
  reason,
});

const applyBulkAssignment = async ({ task, assignees, auditActor, note }) => {
  const nextAssigneeIds = assignees.map((user) => normalizeId(user._id));
  const currentAssigneeIds = (Array.isArray(task.assigned_to) ? task.assigned_to : [])
    .map(getTaskUserId)
    .filter(Boolean);
  const idsToRemove = currentAssigneeIds.filter((id) => !nextAssigneeIds.includes(id));
  const idsToAdd = nextAssigneeIds.filter((id) => !currentAssigneeIds.includes(id));
  const normalizedNote = normalizeText(note);

  if (idsToRemove.length > 0) {
    await TaskAssignment.updateMany(
      {
        task: task._id,
        assignee: { $in: idsToRemove },
        status: "active",
      },
      {
        $set: {
          status: "removed",
          removed_at: new Date(),
          removed_by: auditActor,
          note: normalizedNote || "Assignee removed by batch bulk update",
        },
      },
    );
  }

  if (idsToAdd.length > 0) {
    await TaskAssignment.insertMany(
      idsToAdd.map((id) => ({
        task: task._id,
        batch: task.batch || null,
        assignee: id,
        department: task.department || null,
        status: "active",
        assigned_at: new Date(),
        assigned_by: auditActor,
        note: normalizedNote || "Assignee added by batch bulk update",
      })),
      { ordered: false },
    );
  }

  if (idsToRemove.length === 0 && idsToAdd.length === 0) return false;

  const fromStatus = normalizeText(task.status).toLowerCase() || "assigned";
  const toStatus = fromStatus !== "assigned" && idsToAdd.length > 0 ? "assigned" : fromStatus;
  task.assigned_to = assignees.map((user) => ({ user: user._id }));
  task.assigned_by = auditActor;
  task.assigned_at = new Date();
  task.status = toStatus;
  task.upload_statuses = buildUploadStatusEntries(task.upload_assignees);

  if (toStatus === "assigned" && fromStatus !== "assigned") {
    task.started_at = null;
    task.completed_at = null;
    task.approved_at = null;
    task.approved_by = {};
    task.uploaded_at = null;
    task.uploaded_by = {};
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: auditActor,
      changed_at: new Date(),
      note: normalizedNote || "Task assignment updated by batch bulk update",
      metadata: {
        batch_bulk_update: true,
        assignment_change: true,
      },
    });
  }
  return true;
};

const applyBulkAction = async ({ task, action, auditActor, note, resumeDueDate }) => {
  const currentStatus = normalizeText(task.status).toLowerCase() || "assigned";
  const hold = task.hold && typeof task.hold === "object" ? task.hold : {};
  const normalizedNote = normalizeText(note);
  const now = new Date();

  if (action === "hold") {
    if (currentStatus === "uploaded") return "Uploaded tasks cannot be put on hold";
    if (currentStatus === "hold" || hold.status === "hold") return "Task is already on hold";
    if (hold.status === "pending") return "Task already has a pending hold request";
    if (!normalizedNote) return "Hold comment is required";

    task.hold = {
      ...hold,
      status: "hold",
      previous_status: currentStatus,
      requested_comment: normalizedNote,
      requested_by: auditActor,
      requested_at: now,
      approved_comment: normalizedNote,
      approved_by: auditActor,
      approved_at: now,
      resumed_comment: "",
      resumed_by: {},
      resumed_at: null,
      rejected_comment: "",
      rejected_by: {},
      rejected_at: null,
      total_paused_ms: Math.max(0, Number(hold?.total_paused_ms || 0)),
    };
    task.status = "hold";
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: currentStatus,
      to_status: "hold",
      changed_by: auditActor,
      changed_at: now,
      note: normalizedNote,
      metadata: {
        batch_bulk_update: true,
        hold_approved: true,
        hold_previous_status: currentStatus,
      },
    });
    return "";
  }

  if (action === "approve_hold") {
    if (currentStatus === "hold" || hold.status !== "pending") {
      return "Task does not have a pending hold request";
    }
    const fromStatus = normalizeText(hold.previous_status || currentStatus).toLowerCase() || "assigned";
    task.status = "hold";
    task.hold = {
      ...hold,
      status: "hold",
      previous_status: fromStatus,
      approved_comment: normalizedNote || hold.requested_comment || "Hold approved by batch bulk update",
      approved_by: auditActor,
      approved_at: now,
      resumed_comment: "",
      resumed_by: {},
      resumed_at: null,
      rejected_comment: "",
      rejected_by: {},
      rejected_at: null,
    };
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: currentStatus,
      to_status: "hold",
      changed_by: auditActor,
      changed_at: now,
      note: task.hold.approved_comment,
      metadata: {
        batch_bulk_update: true,
        hold_approved: true,
        hold_previous_status: fromStatus,
      },
    });
    return "";
  }

  if (action === "reject_hold") {
    if (hold.status !== "pending") return "Task does not have a pending hold request";
    task.hold = {
      ...hold,
      status: "none",
      rejected_comment: normalizedNote,
      rejected_by: auditActor,
      rejected_at: now,
    };
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: currentStatus,
      to_status: currentStatus,
      changed_by: auditActor,
      changed_at: now,
      note: normalizedNote || "Hold request rejected by batch bulk update",
      metadata: {
        batch_bulk_update: true,
        hold_rejected: true,
        hold_previous_status: hold.previous_status || currentStatus,
      },
    });
    return "";
  }

  if (action === "resume") {
    if (currentStatus !== "hold" || hold.status !== "hold") return "Only held tasks can be resumed";
    if (!resumeDueDate) return "A new due date is required to resume this task";
    const toStatus = normalizeText(hold.previous_status).toLowerCase() || "assigned";
    if (toStatus === "hold" || toStatus === "uploaded") {
      return "This held task does not have a resumable previous status";
    }
    const pausedFrom = toDateOrNull(hold.approved_at);
    const pausedMs = pausedFrom ? Math.max(0, now.getTime() - pausedFrom.getTime()) : 0;
    task.status = toStatus;
    task.due_date = resumeDueDate;
    task.rework_due_dates = [
      ...(Array.isArray(task.rework_due_dates) ? task.rework_due_dates : []),
      {
        date: resumeDueDate,
        comment: normalizedNote || "Task resumed with new due date",
        source: "due_date",
        created_at: now,
        created_by: auditActor,
      },
    ];
    task.hold = {
      ...hold,
      status: "none",
      resumed_comment: normalizedNote,
      resumed_by: auditActor,
      resumed_at: now,
      total_paused_ms: Math.max(0, Number(hold?.total_paused_ms || 0)) + pausedMs,
    };
    await TaskStatusHistory.create({
      task: task._id,
      batch: task.batch || null,
      from_status: "hold",
      to_status: toStatus,
      changed_by: auditActor,
      changed_at: now,
      note: normalizedNote || "Task resumed by batch bulk update",
      metadata: {
        batch_bulk_update: true,
        hold_resumed: true,
        due_date_updated: true,
        due_date: resumeDueDate,
        total_paused_ms: task.hold.total_paused_ms,
      },
    });
    return "";
  }

  return "";
};

const getBulkActionSkipReason = ({ task, action, note, resumeDueDate }) => {
  if (!action) return "";
  const currentStatus = normalizeText(task.status).toLowerCase() || "assigned";
  const hold = task.hold && typeof task.hold === "object" ? task.hold : {};
  const normalizedNote = normalizeText(note);

  if (action === "hold") {
    if (currentStatus === "uploaded") return "Uploaded tasks cannot be put on hold";
    if (currentStatus === "hold" || hold.status === "hold") return "Task is already on hold";
    if (hold.status === "pending") return "Task already has a pending hold request";
    if (!normalizedNote) return "Hold comment is required";
  }

  if (action === "approve_hold") {
    if (currentStatus === "hold" || hold.status !== "pending") {
      return "Task does not have a pending hold request";
    }
  }

  if (action === "reject_hold" && hold.status !== "pending") {
    return "Task does not have a pending hold request";
  }

  if (action === "resume") {
    if (currentStatus !== "hold" || hold.status !== "hold") return "Only held tasks can be resumed";
    if (!resumeDueDate) return "A new due date is required to resume this task";
    const toStatus = normalizeText(hold.previous_status).toLowerCase() || "assigned";
    if (toStatus === "hold" || toStatus === "uploaded") {
      return "This held task does not have a resumable previous status";
    }
  }

  return "";
};

const bulkUpdateWorkflowBatchTasks = async (
  id,
  payload = {},
  actor = {},
  realtimeSource = null,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }

  const batch = await getMutableBatchByIdForUser(id, actor);
  if (!batch || batch.is_deleted) {
    throw new Error("Workflow batch not found");
  }
  if (batch.status === "cancelled") {
    throw new Error("Cancelled batches cannot be updated");
  }

  const auditActor = buildAuditActor(actor);
  const note = normalizeText(payload?.note);
  const changedBatchFields = [];
  const taskPatch = {};
  const hasTaskPatch = {};
  const action = normalizeText(payload?.action).toLowerCase();
  const allowedActions = ["", "hold", "approve_hold", "reject_hold", "resume"];
  if (!allowedActions.includes(action)) {
    throw new Error("Unsupported bulk action");
  }

  if (payload?.batch_name !== undefined) {
    const nextName = normalizeText(payload.batch_name);
    if (!nextName) throw new Error("batch_name is required");
    if (batch.name !== nextName) {
      batch.name = nextName;
      batch.name_key = normalizeNameKey(nextName);
      changedBatchFields.push("name");
    }
  }

  if (payload?.due_date !== undefined) {
    const dueDate = parseDueDate(payload.due_date);
    const dueDateNote = normalizeText(payload?.due_date_note || payload?.note);
    if (!dueDateNote) {
      throw new Error("due_date_note is required when updating task due dates");
    }
    taskPatch.dueDate = dueDate;
    taskPatch.dueDateNote = dueDateNote;
    hasTaskPatch.dueDate = true;
  }

  if (payload?.task_type_key !== undefined) {
    taskPatch.taskType = await findActiveTaskTypeByKey(payload.task_type_key);
    hasTaskPatch.taskType = true;
    if (normalizeKey(batch.task_type_key) !== taskPatch.taskType.key) {
      batch.task_type = taskPatch.taskType._id;
      batch.task_type_key = taskPatch.taskType.key;
      batch.selected_task_type = {
        key: taskPatch.taskType.key,
        name: taskPatch.taskType.name,
        category: taskPatch.taskType.category,
        auto_create_mode: taskPatch.taskType.auto_create_mode,
        requires_review: taskPatch.taskType.requires_review !== false,
      };
      changedBatchFields.push("task_type");
    }
  }

  if (payload?.assigned_user_ids !== undefined) {
    const assigneeIds = uniqueIds(payload.assigned_user_ids);
    taskPatch.assignees = await validateAssigneeUsers(assigneeIds);
    if (taskPatch.assignees.length === 0) {
      throw new Error("At least one assignee is required");
    }
    hasTaskPatch.assignees = true;
  }

  if (payload?.upload_required !== undefined) {
    taskPatch.uploadRequired = Boolean(payload.upload_required);
    hasTaskPatch.uploadRequired = true;
  }

  if (payload?.upload_assignee_ids !== undefined) {
    const uploadAssigneeIds = uniqueIds(payload.upload_assignee_ids);
    taskPatch.uploadAssignees = await validateAssigneeUsers(uploadAssigneeIds);
    if (payload?.upload_required !== false && taskPatch.uploadAssignees.length === 0) {
      throw new Error("At least one upload user is required when upload is required");
    }
    hasTaskPatch.uploadAssignees = true;
  }

  const resumeDueDate = action === "resume" ? parseDueDate(payload?.resume_due_date) : null;
  if (action === "resume" && !resumeDueDate) {
    throw new Error("resume_due_date is required for resume");
  }

  const selectedTaskIds = uniqueIds(payload?.selected_task_ids || []);
  if (selectedTaskIds.some((taskId) => !mongoose.Types.ObjectId.isValid(taskId))) {
    throw new Error("One or more selected_task_ids are invalid");
  }

  const tasks = await Task.find({
    batch: batch._id,
    is_deleted: false,
    ...(selectedTaskIds.length > 0 ? { _id: { $in: selectedTaskIds } } : {}),
  });
  if (selectedTaskIds.length > 0 && tasks.length === 0) {
    throw new Error("No selected tasks were found in this batch");
  }
  const skipped = [];
  const affectedTasks = [];
  const hasMutableTaskPatch = Object.values(hasTaskPatch).some(Boolean);

  for (const task of tasks) {
    const currentStatus = normalizeText(task.status).toLowerCase();
    let changed = false;
    if ((hasMutableTaskPatch || action === "hold") && currentStatus === "uploaded") {
      skipped.push(buildBulkSkip(task, "Uploaded tasks cannot be bulk edited or held"));
      continue;
    }
    const actionSkipReason = getBulkActionSkipReason({
      task,
      action,
      note,
      resumeDueDate,
    });
    if (actionSkipReason) {
      skipped.push(buildBulkSkip(task, actionSkipReason));
      continue;
    }

    if (hasTaskPatch.dueDate) {
      const activeDueDate = getActiveTaskDueDate(task) || task.due_date || null;
      if (!isSameIndianDay(activeDueDate, taskPatch.dueDate)) {
        task.due_date = taskPatch.dueDate;
        task.rework_due_dates = [
          ...(Array.isArray(task.rework_due_dates) ? task.rework_due_dates : []),
          {
            date: taskPatch.dueDate,
            comment: taskPatch.dueDateNote,
            source: "due_date",
            created_at: new Date(),
            created_by: auditActor,
          },
        ];
        await TaskStatusHistory.create({
          task: task._id,
          batch: task.batch || null,
          from_status: currentStatus || "assigned",
          to_status: currentStatus || "assigned",
          changed_by: auditActor,
          changed_at: new Date(),
          note: taskPatch.dueDateNote,
          metadata: {
            batch_bulk_update: true,
            due_date_updated: true,
            previous_due_date: activeDueDate,
            due_date: taskPatch.dueDate,
          },
        });
        changed = true;
      }
    }

    if (hasTaskPatch.taskType) {
      if (normalizeText(task.task_type_key) !== taskPatch.taskType.key) {
        task.task_type = taskPatch.taskType._id;
        task.task_type_key = taskPatch.taskType.key;
        task.task_type_name = taskPatch.taskType.name;
        task.review_required = taskPatch.taskType.requires_review !== false;
        task.priority = task.priority || taskPatch.taskType.default_priority || "normal";
        task.tags = uniqueIds([...(Array.isArray(task.tags) ? task.tags : []), taskPatch.taskType.key]);
        changed = true;
      }
    }

    if (hasTaskPatch.assignees) {
      changed = (await applyBulkAssignment({
        task,
        assignees: taskPatch.assignees,
        auditActor,
        note,
      })) || changed;
    }

    if (hasTaskPatch.uploadRequired) {
      if ((task.upload_required !== false) !== taskPatch.uploadRequired) {
        task.upload_required = taskPatch.uploadRequired;
        if (!taskPatch.uploadRequired) {
          task.upload_assignees = [];
          task.upload_statuses = [];
        } else {
          task.upload_statuses = buildUploadStatusEntries(task.upload_assignees);
        }
        changed = true;
      }
    }

    if (hasTaskPatch.uploadAssignees) {
      const uploadRequired = hasTaskPatch.uploadRequired
        ? taskPatch.uploadRequired
        : task.upload_required !== false;
      if (uploadRequired && taskPatch.uploadAssignees.length === 0) {
        skipped.push(buildBulkSkip(task, "At least one upload user is required"));
        continue;
      }
      const nextIds = uploadRequired ? taskPatch.uploadAssignees.map((user) => normalizeId(user._id)) : [];
      const currentIds = (Array.isArray(task.upload_assignees) ? task.upload_assignees : [])
        .map(getTaskUserId)
        .filter(Boolean);
      const hasChange =
        currentIds.length !== nextIds.length ||
        currentIds.some((currentId) => !nextIds.includes(currentId)) ||
        nextIds.some((nextId) => !currentIds.includes(nextId));
      if (hasChange) {
        task.upload_required = uploadRequired;
        task.upload_assignees = uploadRequired
          ? taskPatch.uploadAssignees.map((user) => ({ user: user._id }))
          : [];
        task.upload_statuses = buildUploadStatusEntries(task.upload_assignees);
        changed = true;
      }
    }

    if (action) {
      const skipReason = await applyBulkAction({
        task,
        action,
        auditActor,
        note,
        resumeDueDate,
      });
      if (skipReason) {
        skipped.push(buildBulkSkip(task, skipReason));
        continue;
      }
      changed = true;
    }

    if (changed) {
      task.updated_by = auditActor;
      await task.save();
      affectedTasks.push(task);
    }
  }

  if (changedBatchFields.length > 0) {
    batch.updated_by = auditActor;
    await batch.save();
  }

  const recalculatedBatch = await recalculateWorkflowBatchFromTasks(batch._id);
  emitWorkflowBatchMutation({
    realtimeSource,
    batch: recalculatedBatch || batch,
    message: "Workflow batch tasks bulk updated",
    affectedAssigneeIds: collectTaskAssigneeIds(affectedTasks),
    actor,
  });

  return {
    batch: await populateBatchQuery(Batch.findById(batch._id)),
    affected_task_count: affectedTasks.length,
    skipped_task_count: skipped.length,
    skipped,
  };
};

const deleteWorkflowBatch = async (
  id,
  actor = {},
  note = "",
  realtimeSource = null,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }
  if (!isAdmin(actor)) {
    throw new Error("Only admins can delete workflow batches");
  }

  const batch = await getMutableBatchByIdForUser(id, actor);
  if (!batch || batch.is_deleted) {
    throw new Error("Workflow batch not found");
  }

  const auditActor = buildAuditActor(actor);
  const normalizedNote = normalizeText(note) || "Workflow batch deleted by admin";
  const tasks = await Task.find({
    batch: batch._id,
    is_deleted: false,
  }).select("_id batch status assigned_to");

  const taskIds = tasks.map((task) => task._id);

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

    await TaskStatusHistory.insertMany(
      tasks.map((task) => ({
        task: task._id,
        batch: batch._id,
        from_status: task.status,
        to_status: task.status,
        changed_by: auditActor,
        changed_at: new Date(),
        note: normalizedNote,
        metadata: {
          batch_deleted: true,
          deleted_by_admin: true,
          task_deleted: true,
        },
      })),
      { ordered: false },
    ).catch(() => {});

    await TaskAssignment.updateMany(
      {
        batch: batch._id,
        status: { $in: ["active", "completed"] },
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

  emitWorkflowBatchMutation({
    realtimeSource,
    batch,
    message: "Workflow batch deleted",
    affectedAssigneeIds: collectTaskAssigneeIds(tasks),
    actor,
  });

  return {
    _id: batch._id,
    batch_no: batch.batch_no,
    status: batch.status,
    is_deleted: true,
  };
};

const cancelWorkflowBatch = async (
  id,
  actor = {},
  note = "",
  realtimeSource = null,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid batch id");
  }

  const batch = await getMutableBatchByIdForUser(id, actor);
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
    status: { $nin: ["uploaded"] },
  })
    .select("_id batch status assigned_to")
    .lean();

  if (tasks.length > 0) {
    const taskIds = tasks.map((task) => task._id);
    await Task.updateMany(
      { _id: { $in: taskIds } },
      {
        $set: {
          is_deleted: true,
          updated_by: auditActor,
        },
      },
    );

    await TaskAssignment.updateMany(
      {
        task: { $in: taskIds },
        status: { $in: ["active", "completed"] },
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
        to_status: task.status,
        changed_by: auditActor,
        changed_at: new Date(),
        note: normalizeText(note) || "Batch cancelled",
        metadata: { batch_cancelled: true, task_deleted: true },
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

  const recalculatedBatch = await recalculateWorkflowBatchFromTasks(batch._id);

  emitWorkflowBatchMutation({
    realtimeSource,
    batch: recalculatedBatch || batch,
    message: "Workflow batch cancelled",
    affectedAssigneeIds: collectTaskAssigneeIds(tasks),
    actor,
  });

  return populateBatchQuery(Batch.findById(batch._id));
};

module.exports = {
  bulkUpdateWorkflowBatchTasks,
  cancelWorkflowBatch,
  createWorkflowBatchFromFolderManifest,
  deleteWorkflowBatch,
  getWorkflowBatchById,
  listWorkflowBatches,
  updateWorkflowBatch,
};
