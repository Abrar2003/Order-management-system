const FILE_TASKS = Object.freeze({
  cad_upload: "cad_file",
  assembly_upload: "assembly_file",
  mounting_upload: "mounting_file",
  shipping_marks_upload: "shipping_marks",
  packaging_ppt_upload: "packeging_ppt",
});

const QC_APPROVAL_TASKS = Object.freeze({
  cad_approval: "cad_file",
  assembly_approval: "assembly_file",
  mounting_approval: "mounting_file",
});

const queryPath = (pathname, params) => `${pathname}?${new URLSearchParams(params)}`;

export const getEmployeeTaskDrilldownPath = ({ taskKey, status = "all", country = "all" } = {}) => {
  const normalizedStatus = ["all", "pending", "completed"].includes(status) ? status : "all";
  if (FILE_TASKS[taskKey]) {
    return queryPath("/item-files", {
      file_type: FILE_TASKS[taskKey],
      country,
      file_status: normalizedStatus === "pending" ? "missing" : normalizedStatus === "completed" ? "uploaded" : "all",
    });
  }
  if (QC_APPROVAL_TASKS[taskKey]) {
    return queryPath("/item-files", {
      file_type: QC_APPROVAL_TASKS[taskKey],
      country: "India",
      approval_status: normalizedStatus,
    });
  }
  if (taskKey === "shipping_marks_updated") {
    return queryPath("/items", { workload_task: "shipping_marks_approval", workload_status: normalizedStatus, country });
  }
  if (taskKey === "product_database_creation") {
    return queryPath("/items", { workload_task: "product_database_creation", workload_status: normalizedStatus, country });
  }
  if (taskKey === "inspection_approval") {
    return queryPath("/qc", { workload_task: "inspection_approval", workload_status: normalizedStatus, country });
  }
  return "";
};
