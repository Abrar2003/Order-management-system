import Navbar from "../components/Navbar";
import WorkflowTasksPanel from "../components/workflow/WorkflowTasksPanel";

const WorkflowTasks = () => (
  <>
    <Navbar />
    <WorkflowTasksPanel
      title="Workflow Task Board"
      description="View all accessible production workflow tasks in a table-first board."
    />
  </>
);

export default WorkflowTasks;
