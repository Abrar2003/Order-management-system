import {
  getWorkflowStageBarSteps,
  getWorkflowDisplayStageKey,
  getWorkflowReachedStageKeys,
} from "./workflowTaskProgress";
import HoverPortal from "../HoverPortal";

const normalizeText = (value) => String(value ?? "").trim();

const formatDateTime = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
};

const getAuditActorName = (actor = {}) =>
  actor?.name || actor?.user?.name || actor?.user?.email || "User";

const getCompletionRemark = (task = {}) => {
  if (normalizeText(task?.completion_comment?.comment)) {
    return task.completion_comment;
  }

  const completeComment = (Array.isArray(task?.comments) ? task.comments : [])
    .find((entry) =>
      normalizeText(entry?.comment_type).toLowerCase() === "complete"
      && normalizeText(entry?.comment)
    );
  if (completeComment) return completeComment;

  const completeHistory = (Array.isArray(task?.status_history) ? task.status_history : [])
    .find((entry) =>
      normalizeText(entry?.to_status).toLowerCase() === "complete"
      && normalizeText(entry?.note)
    );
  if (!completeHistory) return null;

  return {
    comment: completeHistory.note,
    created_by: completeHistory.changed_by,
    createdAt: completeHistory.changed_at,
  };
};

const WorkflowTaskStageBar = ({
  task,
  className = "",
  disabled = false,
  isStepClickable = () => false,
  onStepClick,
}) => {
  const activeKey = getWorkflowDisplayStageKey(task);
  const reachedKeys = getWorkflowReachedStageKeys(task);
  const steps = getWorkflowStageBarSteps(task);
  const terminalKey = steps[steps.length - 1]?.key || "";
  const completionRemark = getCompletionRemark(task);
  const hasCompletionRemark = Boolean(completionRemark);

  return (
    <div
      className={["workflow-status-line", className].filter(Boolean).join(" ")}
      style={{ "--workflow-step-count": Math.max(1, steps.length) }}
    >
      <div className="workflow-status-line-track" aria-hidden="true" />
      <div className="workflow-status-line-steps" role="group" aria-label="Task status flow">
        {steps.map((step, index) => {
          const active = step.key === activeKey;
          const complete = reachedKeys.has(step.key) && !active;
          const terminalActive = active && step.key === terminalKey;
          const completionRemarkStep = step.key === "complete" && hasCompletionRemark;
          const clickable =
            !disabled
            && typeof onStepClick === "function"
            && Boolean(isStepClickable(step.key));

          return (
            <button
              key={step.key}
              type="button"
              className={[
                "workflow-status-line-step",
                active ? "is-active" : "",
                complete ? "is-complete" : "",
                terminalActive ? "is-terminal" : "",
                completionRemarkStep ? "has-completion-remark" : "",
                clickable ? "is-clickable" : "",
                !clickable ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-disabled={!clickable}
              tabIndex={clickable ? 0 : -1}
              onClick={() => {
                if (clickable) onStepClick?.(step.key);
              }}
              style={{ "--workflow-step-index": index }}
            >
              {completionRemarkStep ? (
                <HoverPortal
                  className="workflow-status-line-node-hover"
                  panelClassName="workflow-completion-hovercard"
                  align="left"
                  openOnFocus={false}
                  trigger={<span className="workflow-status-line-node" />}
                >
                  <span className="workflow-completion-hovercard-title">
                    Completion Comment
                  </span>
                  <span className="workflow-completion-hovercard-comment">
                    {completionRemark.comment}
                  </span>
                  <span className="workflow-completion-hovercard-meta">
                    {getAuditActorName(completionRemark.created_by)}{" "}
                    {formatDateTime(completionRemark.createdAt || completionRemark.created_at)
                      ? `• ${formatDateTime(completionRemark.createdAt || completionRemark.created_at)}`
                      : ""}
                  </span>
                </HoverPortal>
              ) : (
                <span className="workflow-status-line-node" />
              )}
              <span className="workflow-status-line-label">{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowTaskStageBar;
