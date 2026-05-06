const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

export const WORKFLOW_PROGRESS_STEPS = Object.freeze([
  { key: "pending", label: "Pending" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "submitted", label: "Submitted" },
  { key: "review", label: "Review" },
  { key: "rework", label: "Rework" },
  { key: "completed", label: "Completed" },
]);

export const WORKFLOW_STAGE_BAR_STEPS = Object.freeze([
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "submitted", label: "Submitted" },
  { key: "review", label: "Review" },
  { key: "rework", label: "Rework" },
  { key: "completed", label: "Complete" },
]);

const LINEAR_PROGRESS_KEYS = Object.freeze([
  "pending",
  "assigned",
  "in_progress",
  "submitted",
  "review",
  "completed",
]);

const STAGE_LABELS = WORKFLOW_PROGRESS_STEPS.reduce((acc, entry) => {
  acc[entry.key] = entry.label;
  return acc;
}, {});

export const formatWorkflowStageLabel = (value) =>
  STAGE_LABELS[normalizeText(value)]
  || String(value ?? "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const getWorkflowReachedStageKeys = (task = {}) => {
  const reached = new Set(["pending"]);
  const currentStatus = normalizeText(task?.status);
  const linearIndex = LINEAR_PROGRESS_KEYS.indexOf(currentStatus);

  if (linearIndex >= 0) {
    LINEAR_PROGRESS_KEYS.slice(0, linearIndex + 1).forEach((key) => reached.add(key));
  }

  if (currentStatus === "rework") {
    ["pending", "assigned", "in_progress", "submitted", "review", "rework"].forEach((key) =>
      reached.add(key),
    );
  }

  if (Array.isArray(task?.assigned_to) && task.assigned_to.length > 0) {
    reached.add("assigned");
  }

  (Array.isArray(task?.status_history) ? task.status_history : []).forEach((entry) => {
    const historyStatus = normalizeText(entry?.to_status);
    if (historyStatus) {
      reached.add(historyStatus);
    }
  });

  if (currentStatus) {
    reached.add(currentStatus);
  }

  return reached;
};

export const getWorkflowActiveStageKey = (task = {}) => normalizeText(task?.status);

const STAGE_BAR_KEYS = new Set(WORKFLOW_STAGE_BAR_STEPS.map((entry) => entry.key));

export const getWorkflowDisplayStageKey = (task = {}) => {
  const currentStatus = normalizeText(task?.status);
  if (currentStatus === "pending") {
    return "assigned";
  }

  return STAGE_BAR_KEYS.has(currentStatus) ? currentStatus : "";
};
