const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

export const WORKFLOW_STAGE_BAR_STEPS = Object.freeze([
  { key: "assigned", label: "Assigned" },
  { key: "started", label: "Started" },
  { key: "complete", label: "Complete" },
  { key: "approved", label: "Approved" },
  { key: "uploaded", label: "Uploaded" },
]);

const STAGE_LABELS = WORKFLOW_STAGE_BAR_STEPS.reduce((acc, entry) => {
  acc[entry.key] = entry.label;
  return acc;
}, {});

export const formatWorkflowStageLabel = (value) =>
  STAGE_LABELS[normalizeText(value)]
  || String(value ?? "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const isWorkflowUploadRequired = (task = {}) => task?.upload_required !== false;

export const getWorkflowStageBarSteps = (task = {}) =>
  isWorkflowUploadRequired(task)
    ? WORKFLOW_STAGE_BAR_STEPS
    : WORKFLOW_STAGE_BAR_STEPS.filter((entry) => entry.key !== "uploaded");

export const getWorkflowDisplayStageKey = (task = {}) => {
  const currentStatus = normalizeText(task?.status);
  const steps = getWorkflowStageBarSteps(task);
  return steps.some((entry) => entry.key === currentStatus)
    ? currentStatus
    : "assigned";
};

export const getWorkflowReachedStageKeys = (task = {}) => {
  const activeKey = getWorkflowDisplayStageKey(task);
  const steps = getWorkflowStageBarSteps(task);
  const activeIndex = steps.findIndex((entry) => entry.key === activeKey);
  return new Set(
    steps.slice(0, activeIndex + 1).map((entry) => entry.key),
  );
};
