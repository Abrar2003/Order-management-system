const XLSX = require("xlsx");
const { getWorkflowRows, performAction } = require("../services/masterWorkflow.service");
const { CYCLE_VERSION } = require("../helpers/masterWorkflow");
const { invalidateItemCaches } = require("../services/cacheInvalidation.service");

const sendError = (res, error) => {
  if (!error.status) console.error("Master workflow:", error);
  return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Unable to load or save the master workflow." });
};
const positiveInt = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const list = (view) => async (req, res) => {
  try {
    const rows = await getWorkflowRows({ view, filters: req.query, user: req.user });
    const limit = Math.min(200, positiveInt(req.query.limit, 20));
    const page = positiveInt(req.query.page, 1);
    return res.json({ success: true, cycle_version: CYCLE_VERSION, data: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, totalRecords: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / limit)) } });
  } catch (error) { return sendError(res, error); }
};
const action = (name) => async (req, res) => {
  try {
    const row = await performAction({ id: req.params.id, user: req.user, payload: req.body, action: name });
    await invalidateItemCaches();
    return res.json({ success: true, message: name === "finalize" ? "Final Master is permanently locked." : "Master review saved.", data: row });
  } catch (error) { return sendError(res, error); }
};
const exportRows = (rows) => rows.map((row) => ({
  "Item code": row.code, Description: row.description || row.name, Brand: row.brand_label, Vendors: row.vendor_labels.join(", "),
  Stage: row.master_workflow.stage, Status: row.status, "Approved POs": row.evidence.count, "Required POs": row.evidence.required,
  "Review evidence": row.evidence.inspections.map((r) => `${r.po} (${r.inspection_date})`).join(", "),
  "Completed reviews": row.master_workflow.reviews.map((r) => `${r.stage}: ${r.evidence.map((e) => e.po).join(", ")} / ${r.reviewed_by.name} / ${r.reviewed_at}`).join("; "),
  "Master item sizes": JSON.stringify(row.master_item_sizes || []), "Master box sizes": JSON.stringify(row.master_box_sizes || []), "Master box mode": row.master_box_mode,
  "PD issues": row.comparison?.issue_count ?? "", "PD review current": row.comparison?.reviewed ? "Yes" : "No", "Finalized at": row.master_workflow.finalized_at || "",
}));
const report = (view, download = false) => async (req, res) => {
  try {
    const rows = await getWorkflowRows({ view, filters: req.query, user: req.user });
    if (!download) return res.json({ success: true, data: { generated_at: new Date().toISOString(), cycle_version: CYCLE_VERSION, rows, summary: { total_items: rows.length } } });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows(rows)), "Master Workflow");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${view}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  } catch (error) { return sendError(res, error); }
};
const options = async (req, res) => {
  try {
    const rows = await getWorkflowRows({ view: "final-pis-check", user: req.user });
    return res.json({ success: true, data: { brands: [...new Set(rows.map((r) => r.brand_label))], vendors: [...new Set(rows.flatMap((r) => r.vendor_labels))] } });
  } catch (error) { return sendError(res, error); }
};
const rejectLegacyMasterWrite = (req, res) => res.status(409).json({ success: false, message: "Use the current master workflow review with its revision and approved PO evidence. Direct master updates are disabled." });

module.exports = { list, action, report, options, rejectLegacyMasterWrite, exportRows };
