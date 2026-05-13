import Navbar from "../components/Navbar";
import WorkflowTasksPanel from "../components/workflow/WorkflowTasksPanel";

const WorkflowUploadPending = () => (
  <>
    <Navbar />
    <WorkflowTasksPanel
      fixedStatusFilter="upload_pending"
      title="Upload Pending"
      description="Tasks approved and waiting for your upload action."
    />
  </>
);

export default WorkflowUploadPending;
