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
  const reachedSteps = getWorkflowReachedStageKeys(task);
  const activeStage = getWorkflowDisplayStageKey(task);

  return (
    <div className={["workflow-stage-rail-scroller", className].filter(Boolean).join(" ")}>
      <div className="workflow-stage-rail" role="group" aria-label="Workflow stages">
        {WORKFLOW_STAGE_BAR_STEPS.map((step, index) => {
          const nextStep = WORKFLOW_STAGE_BAR_STEPS[index + 1] || null;
          const isActive = activeStage === step.key && step.key !== "completed";
          const isComplete = reachedSteps.has(step.key) && !isActive;
          const isClickable =
            !disabled
            && typeof onStepClick === "function"
            && Boolean(isStepClickable(step.key));
          const hasCompleteConnector =
            Boolean(nextStep)
            && (reachedSteps.has(nextStep.key) || activeStage === nextStep.key);

          return (
            <button
              key={step.key}
              type="button"
              className={[
                "workflow-stage-rail-step",
                isComplete ? "is-complete" : "",
                isActive ? "is-active" : "",
                isClickable ? "is-clickable" : "",
                hasCompleteConnector ? "has-complete-connector" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!isClickable}
              onClick={() => onStepClick?.(step.key)}
            >
              <span className="workflow-stage-rail-node">
                {isComplete ? "✓" : ""}
              </span>
              <span className="workflow-stage-rail-label">{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowTaskStageBar;
