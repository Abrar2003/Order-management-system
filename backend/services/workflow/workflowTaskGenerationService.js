const mongoose = require("mongoose");
const User = require("../../models/user.model");
const { buildAuditActor } = require("../../helpers/permissions");
const {
  IMAGE_EXTENSIONS,
  WORKFLOW_AUTO_CREATE_MODES,
  buildEmptyTaskCounts,
  buildWorkflowTaskNo,
  getDirectSubfolderName,
  normalizeKey,
  normalizeText,
} = require("../../helpers/workflow");
const {
  Task,
  TaskAssignment,
  TaskStatusHistory,
  TaskType,
} = require("../../models/workflow");

const normalizeId = (value) => String(value || "").trim();

const uniqueIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))];

const toLowerSet = (values = []) =>
  new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value).toLowerCase()).filter(Boolean));

const matchesPatternList = (value, patterns = []) => {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!patterns.length) return true;
  return patterns.some((pattern) => normalizedValue.includes(normalizeText(pattern).toLowerCase()));
};

const matchesTaskTypeRule = (entry = {}, taskType = {}) => {
  const rule = taskType?.file_match_rule || {};
  const extensionMatches =
    !Array.isArray(rule.extensions) ||
    rule.extensions.length === 0 ||
    toLowerSet(rule.extensions).has(normalizeText(entry?.extension).toLowerCase());
  const mimeMatches =
    !Array.isArray(rule.mime_types) ||
    rule.mime_types.length === 0 ||
    toLowerSet(rule.mime_types).has(normalizeText(entry?.mime_type).toLowerCase());
  const nameMatches = matchesPatternList(entry?.name, rule.name_patterns || []);
  const folderMatches = matchesPatternList(entry?.folder_path, rule.folder_patterns || []);
  return extensionMatches && mimeMatches && nameMatches && folderMatches;
};

const ensureTaskGenerationModeSupported = (taskType = {}) => {
  if (!WORKFLOW_AUTO_CREATE_MODES.includes(taskType?.auto_create_mode)) {
    throw new Error("Task type has an invalid auto_create_mode");
  }
  if (taskType?.auto_create_mode === "manual") {
    throw new Error("This task type is configured for manual task creation and cannot generate tasks from a folder manifest");
  }
};

const findActiveTaskTypeByKey = async (taskTypeKey = "") => {
  const normalizedTaskTypeKey = normalizeKey(taskTypeKey);
  if (!normalizedTaskTypeKey) {
    throw new Error("task_type_key is required");
  }

  const taskType = await TaskType.findOne({
    key: normalizedTaskTypeKey,
    is_active: true,
  }).lean();

  if (!taskType) {
    throw new Error("Selected task type was not found or is inactive");
  }

  ensureTaskGenerationModeSupported(taskType);
  return taskType;
};

const validateAssigneeUsers = async (assigneeIds = []) => {
  const normalizedIds = uniqueIds(assigneeIds);
  if (normalizedIds.length === 0) {
    return [];
  }

  const invalidId = normalizedIds.find((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidId) {
    throw new Error("One or more assignee_ids are invalid");
  }

  const users = await User.find({ _id: { $in: normalizedIds } })
    .select("_id name email role")
    .lean();

  if (users.length !== normalizedIds.length) {
    throw new Error("One or more assignee users do not exist");
  }

  const userById = new Map(users.map((user) => [normalizeId(user._id), user]));
  return normalizedIds.map((id) => userById.get(id)).filter(Boolean);
};

const createPerFileTaskDefinitions = ({ batch, taskType, manifestEntries = [] }) => {
  const filteredEntries = manifestEntries.filter((entry) => matchesTaskTypeRule(entry, taskType));
  const supportedEntries =
    taskType?.key === "picture_cleaning"
      ? filteredEntries.filter((entry) => IMAGE_EXTENSIONS.has(normalizeText(entry.extension).toLowerCase()))
      : filteredEntries;

  if (supportedEntries.length === 0) {
    throw new Error(`No matching files found for ${taskType.name || taskType.key}`);
  }

  return supportedEntries.map((entry) => ({
    titleSuffix: entry.name,
    source_folder_path: entry.folder_path,
    source_files: [entry],
  }));
};

const createPerDirectSubfolderDefinitions = ({
  batch,
  taskType,
  manifestEntries = [],
}) => {
  const filteredEntries = manifestEntries.filter((entry) => matchesTaskTypeRule(entry, taskType));
  const grouped = new Map();

  filteredEntries.forEach((entry) => {
    const subfolderName = getDirectSubfolderName(entry, batch?.source_folder_name);
    if (!subfolderName) return;
    if (!grouped.has(subfolderName)) {
      grouped.set(subfolderName, []);
    }
    grouped.get(subfolderName).push(entry);
  });

  const definitions = [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([subfolderName, entries]) => ({
      titleSuffix: subfolderName,
      source_folder_path: entries[0]?.folder_path || `${batch?.source_folder_name}/${subfolderName}`,
      source_files: entries,
    }));

  if (definitions.length === 0) {
    throw new Error(
      `No direct subfolders with files were found for ${taskType.name || taskType.key}`,
    );
  }

  return definitions;
};

const createOncePerBatchDefinition = ({ batch, taskType, manifestEntries = [] }) => {
  const filteredEntries = manifestEntries.filter((entry) => matchesTaskTypeRule(entry, taskType));
  if (!filteredEntries.length) {
    throw new Error("No matching files were found for this workflow task type");
  }

  return [
    {
      titleSuffix: batch?.source_folder_name || batch?.name || "Batch",
      source_folder_path: batch?.source_folder_name || "",
      source_files: filteredEntries,
    },
  ];
};

const buildTaskDefinitions = ({ batch, taskType, manifestEntries = [] }) => {
  switch (taskType?.auto_create_mode) {
    case "per_file":
      return createPerFileTaskDefinitions({ batch, taskType, manifestEntries });
    case "per_direct_subfolder":
      return createPerDirectSubfolderDefinitions({ batch, taskType, manifestEntries });
    case "once_per_batch":
      return createOncePerBatchDefinition({ batch, taskType, manifestEntries });
    default:
      throw new Error("Unsupported task generation mode");
  }
};

const previewTaskDefinitionsForBatch = ({ batch, taskType, manifestEntries = [] }) =>
  buildTaskDefinitions({ batch, taskType, manifestEntries });

const countTaskStatuses = (tasks = []) => {
  const counts = buildEmptyTaskCounts();
  counts.total_tasks = tasks.length;

  tasks.forEach((task) => {
    if (!task?.status) return;
    const key = `${task.status}_tasks`;
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] += 1;
    }
  });

  return counts;
};

const ensureBatchHasNoGeneratedTasks = async (batchId) => {
  const existingTaskCount = await Task.countDocuments({
    batch: batchId,
    is_deleted: false,
  });

  if (existingTaskCount > 0) {
    throw new Error("Tasks have already been generated for this batch");
  }
};

const createInitialHistoryEntries = (tasks = [], actor = {}, note = "") =>
  tasks.map((task) => ({
    task: task._id,
    batch: task.batch,
    from_status: "",
    to_status: task.status,
    changed_by: buildAuditActor(actor),
    changed_at: new Date(),
    note: normalizeText(note),
    metadata: {
      initial_creation: true,
      generated_from_manifest: true,
    },
  }));

const generateTasksForBatch = async ({
  batch,
  taskType,
  manifestEntries = [],
  assignees = [],
  actor = {},
}) => {
  if (!batch?._id) {
    throw new Error("A persisted batch reference is required before task generation");
  }

  await ensureBatchHasNoGeneratedTasks(batch._id);

  const taskDefinitions = buildTaskDefinitions({ batch, taskType, manifestEntries });
  const auditActor = buildAuditActor(actor);
  const initialStatus = assignees.length > 0 ? "assigned" : "pending";
  const assignedUsers = assignees.map((user) => ({ user: user._id }));
  const now = new Date();

  const taskDocs = taskDefinitions.map((definition, index) => ({
    batch: batch._id,
    batch_no: batch.batch_no,
    task_no: buildWorkflowTaskNo(batch.batch_no, index),
    title: `${taskType.name} - ${definition.titleSuffix}`,
    description: normalizeText(batch.description),
    task_type: taskType._id,
    task_type_key: taskType.key,
    task_type_name: taskType.name,
    department: taskType.default_department || null,
    brand: normalizeText(batch.brand),
    source_folder_name: batch.source_folder_name,
    source_folder_path: definition.source_folder_path,
    source_files: definition.source_files,
    status: initialStatus,
    priority: taskType.default_priority || "normal",
    assigned_to: assignedUsers,
    assigned_by: assignees.length > 0 ? auditActor : {},
    assigned_at: assignees.length > 0 ? now : null,
    review_required: taskType.requires_review !== false,
    tags: [taskType.key],
    created_by: auditActor,
    updated_by: auditActor,
  }));

  const insertedTasks = await Task.insertMany(taskDocs, { ordered: true });

  const assignmentDocs = assignees.flatMap((assignee) =>
    insertedTasks.map((task) => ({
      task: task._id,
      batch: batch._id,
      assignee: assignee._id,
      department: task.department || null,
      status: "active",
      assigned_at: now,
      assigned_by: auditActor,
      note: "Assigned during batch creation",
    })),
  );

  if (assignmentDocs.length > 0) {
    await TaskAssignment.insertMany(assignmentDocs, { ordered: false });
  }

  const historyDocs = createInitialHistoryEntries(
    insertedTasks,
    actor,
    assignees.length > 0 ? "Task created and assigned during batch creation" : "Task created from folder manifest",
  );
  await TaskStatusHistory.insertMany(historyDocs, { ordered: true });

  return {
    tasks: insertedTasks,
    task_counts: countTaskStatuses(insertedTasks),
  };
};

module.exports = {
  findActiveTaskTypeByKey,
  generateTasksForBatch,
  previewTaskDefinitionsForBatch,
  validateAssigneeUsers,
};
