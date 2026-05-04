import Navbar from "../components/Navbar";
import WorkflowTasksPanel from "../components/workflow/WorkflowTasksPanel";

const WorkflowMyTasks = () => (
  <>
    <Navbar />
    <WorkflowTasksPanel
      mineOnly
      title="My Workflow Tasks"
      description="See tasks assigned to you and move them through the production workflow."
    />
  </>
);

export default WorkflowMyTasks;
