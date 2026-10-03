const assert = require("node:assert/strict");
const test = require("node:test");
const controller = require("../controllers/employeeReport.controller");
const itemController = require("../controllers/item.controller");
const Item = require("../models/item.model");
const Order = require("../models/order.model");
const User = require("../models/user.model");
const EmployeeTaskAssignment = require("../models/employeeTaskAssignment.model");

const firstId = "507f1f77bcf86cd799439011";
const secondId = "507f191e810c19729de860ea";
const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("employee task assignments create, replace, and remove", async () => {
  const originalCountDocuments = User.countDocuments;
  const originalFindOneAndUpdate = EmployeeTaskAssignment.findOneAndUpdate;
  const originalDeleteOne = EmployeeTaskAssignment.deleteOne;
  const writes = [];
  try {
    User.countDocuments = async ({ _id }) => _id.$in.length;
    EmployeeTaskAssignment.findOneAndUpdate = (filter, update) => {
      writes.push({ filter, update });
      return {
        lean: async () => ({ task_key: filter.task_key, assignee_ids: update.$set.assignee_ids }),
      };
    };
    EmployeeTaskAssignment.deleteOne = async (filter) => {
      writes.push({ deleted: filter.task_key });
    };

    const created = response();
    await controller.updateTaskAssignment({
      params: { taskKey: "cad_upload" },
      body: { assignee_ids: [firstId] },
      user: { _id: firstId, name: "Admin" },
    }, created);
    assert.deepEqual(created.body.assignee_ids, [firstId]);

    const replaced = response();
    await controller.updateTaskAssignment({
      params: { taskKey: "cad_upload" },
      body: { assignee_ids: [secondId] },
      user: { _id: firstId, name: "Admin" },
    }, replaced);
    assert.deepEqual(replaced.body.assignee_ids, [secondId]);

    const removed = response();
    await controller.updateTaskAssignment({
      params: { taskKey: "cad_upload" },
      body: { assignee_ids: [] },
      user: { _id: firstId, name: "Admin" },
    }, removed);
    assert.equal(removed.body.task_key, "cad_upload");
    assert.deepEqual(writes.at(-1), { deleted: "cad_upload" });
  } finally {
    User.countDocuments = originalCountDocuments;
    EmployeeTaskAssignment.findOneAndUpdate = originalFindOneAndUpdate;
    EmployeeTaskAssignment.deleteOne = originalDeleteOne;
  }
});

test("personal employee report includes assignments and fixed QC queues only", async () => {
  const originalItemFind = Item.find;
  const originalOrderDistinct = Order.distinct;
  const originalAssignmentFind = EmployeeTaskAssignment.find;
  try {
    Item.find = () => ({ select() { return this; }, lean: async () => [] });
    Order.distinct = async () => [];
    EmployeeTaskAssignment.find = () => ({ lean: async () => [
      { task_key: "cad_upload", assignee_ids: [firstId] },
      { task_key: "assembly_upload", assignee_ids: [secondId] },
    ] });

    const employee = response();
    await controller.getMyEmployeeReport({ user: { _id: firstId, role: "user" } }, employee);
    assert.deepEqual(employee.body.tasks.map((task) => task.key), ["cad_upload"]);

    const qc = response();
    await controller.getMyEmployeeReport({ user: { _id: secondId, role: "QC" } }, qc);
    assert.deepEqual(qc.body.tasks.map((task) => task.key), [
      "assembly_upload",
      "cad_approval",
      "assembly_approval",
      "mounting_approval",
    ]);
  } finally {
    Item.find = originalItemFind;
    Order.distinct = originalOrderDistinct;
    EmployeeTaskAssignment.find = originalAssignmentFind;
  }
});

test("QC approval stores audit metadata and clears the pending file state", async () => {
  const originalFindById = Item.findById;
  const item = {
    _id: firstId,
    country_of_origin: "India",
    cad_file: { key: "cad-v1" },
    file_approvals: {},
    update_history: [],
    toObject() {
      return JSON.parse(JSON.stringify({
        _id: this._id,
        country_of_origin: this.country_of_origin,
        cad_file: this.cad_file,
        file_approvals: this.file_approvals,
      }));
    },
    set(path, value) {
      const [root, child] = path.split(".");
      if (child) this[root] = { ...(this[root] || {}), [child]: value };
      else this[root] = value;
    },
    async save() { this.saved = true; },
  };
  try {
    Item.findById = async () => item;
    const approved = response();
    await itemController.approveItemFile({
      params: { id: firstId, fileType: "cad_file" },
      user: { _id: secondId, name: "QC User", role: "QC" },
    }, approved);
    assert.equal(approved.statusCode, 200);
    assert.equal(item.file_approvals.cad_file.file_key, "cad-v1");
    assert.equal(item.file_approvals.cad_file.approved_by.user, secondId);
    assert.equal(item.update_history.at(-1).action, "file_approval");
    assert.equal(item.saved, true);

    const duplicate = response();
    await itemController.approveItemFile({
      params: { id: firstId, fileType: "cad_file" },
      user: { _id: secondId, name: "QC User", role: "QC" },
    }, duplicate);
    assert.equal(duplicate.statusCode, 409);
  } finally {
    Item.findById = originalFindById;
  }
});
