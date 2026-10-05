import assert from "node:assert/strict";
import test from "node:test";
import { getEmployeeTaskDrilldownPath } from "./employeeTaskDrilldown.js";

test("employee task drill-down maps each workload family to its filtered page", () => {
  assert.equal(
    getEmployeeTaskDrilldownPath({ taskKey: "cad_upload", status: "pending", country: "Germany" }),
    "/item-files?file_type=cad_file&country=Germany&file_status=missing",
  );
  assert.equal(
    getEmployeeTaskDrilldownPath({ taskKey: "shipping_marks_updated", status: "completed", country: "all" }),
    "/items?workload_task=shipping_marks_approval&workload_status=completed&country=all",
  );
  assert.equal(
    getEmployeeTaskDrilldownPath({ taskKey: "inspection_approval", status: "all", country: "India" }),
    "/qc?workload_task=inspection_approval&workload_status=all&country=India",
  );
  assert.equal(
    getEmployeeTaskDrilldownPath({ taskKey: "cad_approval", status: "pending", country: "Germany" }),
    "/item-files?file_type=cad_file&country=India&approval_status=pending",
  );
});
