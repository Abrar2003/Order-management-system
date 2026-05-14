const normalizeText = (value) => String(value ?? "").trim().toLowerCase();
const normalizeRoleKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const getUserId = (entry = {}) =>
  String(entry?.user?._id || entry?.user?.id || entry?.user || entry?._id || entry?.id || "").trim();
const getUserLabel = (entry = {}) =>
  String(entry?.user?.name || entry?.user?.email || entry?.name || entry?.email || "Upload").trim();
const getAuditActorLabel = (actor = {}) =>
  String(actor?.name || actor?.email || actor?.user?.name || actor?.user?.email || "").trim();

const WORKFLOW_UPLOAD_ROLE_RANK = Object.freeze({
  super_admin: 10,
  admin: 20,
  manager: 30,
  product_manager: 40,
  inspection_manager: 50,
  qc: 60,
  dev: 70,
  user: 80,
});

const getWorkflowUploadRoleRank = (entry = {}) =>
  WORKFLOW_UPLOAD_ROLE_RANK[normalizeRoleKey(entry?.user?.role || entry?.role)] || 999;

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

export const getWorkflowUploadStatuses = (task = {}) => {
  if (!isWorkflowUploadRequired(task)) return [];

  const statusByUserId = new Map(
    (Array.isArray(task?.upload_statuses) ? task.upload_statuses : [])
      .map((entry) => [getUserId(entry), entry])
      .filter(([userId]) => Boolean(userId)),
  );

  return (Array.isArray(task?.upload_assignees) ? task.upload_assignees : [])
    .map((entry) => {
      const userId = getUserId(entry);
      if (!userId) return null;

      const existingStatus = statusByUserId.get(userId) || {};
      return {
        ...existingStatus,
        user: entry?.user || entry,
        status: normalizeText(existingStatus?.status) === "uploaded"
          ? "uploaded"
          : "pending",
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftRank = getWorkflowUploadRoleRank(left);
      const rightRank = getWorkflowUploadRoleRank(right);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return getUserLabel(left).localeCompare(getUserLabel(right));
    });
};

export const getWorkflowUploadStepKey = (entry = {}) => `uploaded:${getUserId(entry)}`;

export const isWorkflowUploadStepKey = (key = "") =>
  String(key || "").startsWith("uploaded:");

export const getWorkflowStageBarSteps = (task = {}) => {
  if (!isWorkflowUploadRequired(task)) {
    return WORKFLOW_STAGE_BAR_STEPS.filter((entry) => entry.key !== "uploaded");
  }

  const uploadStatuses = getWorkflowUploadStatuses(task);
  if (uploadStatuses.length <= 1) return WORKFLOW_STAGE_BAR_STEPS;

  return [
    ...WORKFLOW_STAGE_BAR_STEPS.filter((entry) => entry.key !== "uploaded"),
    ...uploadStatuses.map((entry, index) => {
      const assignedUserLabel = getUserLabel(entry);
      const uploadedByLabel = getAuditActorLabel(entry?.uploaded_by);

      return {
        key: getWorkflowUploadStepKey(entry),
        label: normalizeText(entry?.status) === "uploaded"
          ? `Upload ${index + 1}: ${uploadedByLabel || assignedUserLabel || "Uploaded"}`
          : `Upload ${index + 1}: ${assignedUserLabel}`,
        uploadUserId: getUserId(entry),
        uploadStatus: entry.status,
      };
    }),
  ];
};

export const getWorkflowDisplayStageKey = (task = {}) => {
  const currentStatus = normalizeText(task?.status);
  const steps = getWorkflowStageBarSteps(task);
  const uploadStatuses = getWorkflowUploadStatuses(task);
  const uploadSteps = steps.filter((entry) => isWorkflowUploadStepKey(entry.key));
  const lastUploadedStatus = [...uploadStatuses]
    .reverse()
    .find((entry) => normalizeText(entry?.status) === "uploaded");

  if (currentStatus === "approved" && uploadSteps.length > 0) {
    return lastUploadedStatus
      ? getWorkflowUploadStepKey(lastUploadedStatus)
      : "approved";
  }

  if (currentStatus === "uploaded" && uploadSteps.length > 0) {
    return lastUploadedStatus
      ? getWorkflowUploadStepKey(lastUploadedStatus)
      : "approved";
  }

  return steps.some((entry) => entry.key === currentStatus)
    ? currentStatus
    : "assigned";
};

export const getWorkflowReachedStageKeys = (task = {}) => {
  const activeKey = getWorkflowDisplayStageKey(task);
  const steps = getWorkflowStageBarSteps(task);
  const activeIndex = steps.findIndex((entry) => entry.key === activeKey);
  const approvedIndex = steps.findIndex((entry) => entry.key === "approved");
  const uploadedActive = isWorkflowUploadStepKey(activeKey);
  const reachedKeys = new Set(steps.slice(0, activeIndex + 1).map((entry) => entry.key));

  if (uploadedActive && approvedIndex >= 0) {
    reachedKeys.clear();
    steps.slice(0, approvedIndex + 1).forEach((entry) => {
      reachedKeys.add(entry.key);
    });
  }

  getWorkflowUploadStatuses(task).forEach((entry) => {
    if (normalizeText(entry?.status) === "uploaded") {
      reachedKeys.add(getWorkflowUploadStepKey(entry));
    }
  });

  return reachedKeys;
};
