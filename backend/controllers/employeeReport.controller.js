const EmployeeTaskAssignment = require("../models/employeeTaskAssignment.model");
const User = require("../models/user.model");
const { normalizeUserRoleKey } = require("../helpers/userRole");
const {
  CONFIGURABLE_TASK_KEYS,
  QC_APPROVAL_TASKS,
  TASK_CATALOG,
  ensureObjectIdList,
  getTaskMetrics,
} = require("../services/employeeReport.service");

const userId = (user = {}) => String(user?._id || user?.id || "").trim();
const safeEmployee = (user = {}) => ({
  _id: String(user?._id || ""),
  name: user?.name || "",
  role: user?.role || "",
  email: user?.email || "",
});

const getAssignments = async () => {
  const assignments = await EmployeeTaskAssignment.find({}).lean();
  return new Map(assignments.map((assignment) => [
    assignment.task_key,
    (assignment.assignee_ids || []).map((id) => String(id)),
  ]));
};

exports.getMyEmployeeReport = async (req, res) => {
  try {
    const [metrics, assignments] = await Promise.all([getTaskMetrics(), getAssignments()]);
    const currentUserId = userId(req.user);
    const isQc = normalizeUserRoleKey(req.user?.role) === "qc";
    const tasks = TASK_CATALOG.filter((task) =>
      task.qc_shared ? isQc : assignments.get(task.key)?.includes(currentUserId),
    ).map((task) => ({
      ...task,
      total_count: Number(metrics[task.key]?.total || 0),
      pending_count: Number(metrics[task.key]?.pending || 0),
    }));
    return res.json({ tasks });
  } catch (error) {
    console.error("Get employee report error:", error);
    return res.status(500).json({ message: "Failed to load employee report" });
  }
};

exports.getEmployeeManagement = async (_req, res) => {
  try {
    const [metrics, assignments, users] = await Promise.all([
      getTaskMetrics(),
      getAssignments(),
      User.find({}).select("name role email").sort({ name: 1 }).lean(),
    ]);
    const tasks = TASK_CATALOG.map((task) => ({
      ...task,
      total_count: Number(metrics[task.key]?.total || 0),
      pending_count: Number(metrics[task.key]?.pending || 0),
      assignee_ids: task.configurable ? (assignments.get(task.key) || []) : [],
    }));
    return res.json({ tasks, employees: users.map(safeEmployee) });
  } catch (error) {
    console.error("Get employee management error:", error);
    return res.status(500).json({ message: "Failed to load employee management" });
  }
};

exports.updateTaskAssignment = async (req, res) => {
  try {
    const taskKey = String(req.params.taskKey || "").trim();
    if (!CONFIGURABLE_TASK_KEYS.includes(taskKey)) {
      return res.status(400).json({ message: "This task cannot be assigned manually" });
    }
    const assigneeIds = ensureObjectIdList(req.body?.assignee_ids);
    const existingUsers = assigneeIds.length
      ? await User.countDocuments({ _id: { $in: assigneeIds } })
      : 0;
    if (existingUsers !== assigneeIds.length) {
      return res.status(400).json({ message: "One or more selected employees no longer exist" });
    }
    if (assigneeIds.length === 0) {
      await EmployeeTaskAssignment.deleteOne({ task_key: taskKey });
      return res.json({ task_key: taskKey, assignee_ids: [] });
    }
    const assignment = await EmployeeTaskAssignment.findOneAndUpdate(
      { task_key: taskKey },
      {
        $set: {
          assignee_ids: assigneeIds,
          updated_by: {
            user: req.user?._id || req.user?.id || null,
            name: req.user?.name || req.user?.email || req.user?.username || "",
            updated_at: new Date(),
          },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    return res.json({
      task_key: assignment.task_key,
      assignee_ids: assignment.assignee_ids.map((id) => String(id)),
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    console.error("Update employee task assignment error:", error);
    return res.status(statusCode).json({ message: error?.message || "Failed to save task assignment" });
  }
};
