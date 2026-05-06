import {
  WORKFLOW_STAGE_BAR_STEPS,
  getWorkflowDisplayStageKey,
  getWorkflowReachedStageKeys,
} from "./workflowTaskProgress";

const WorkflowTaskStageBar = ({
  task,
  className = "",
  disabled = false,
  isStepClickable = () => false,
  onStepClick,
}) => {
  const activeKey = getWorkflowDisplayStageKey(task);
  const reachedKeys = getWorkflowReachedStageKeys(task);

  return (
    <div className={["workflow-status-line", className].filter(Boolean).join(" ")}>
      <div className="workflow-status-line-track" aria-hidden="true" />
      <div className="workflow-status-line-steps" role="group" aria-label="Task status flow">
        {WORKFLOW_STAGE_BAR_STEPS.map((step, index) => {
          const active = step.key === activeKey;
          const complete = reachedKeys.has(step.key) && !active;
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
                clickable ? "is-clickable" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!clickable}
              onClick={() => onStepClick?.(step.key)}
              style={{ "--workflow-step-index": index }}
            >
              <span className="workflow-status-line-node" />
              <span className="workflow-status-line-label">{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowTaskStageBar;
