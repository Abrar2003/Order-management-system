const Department = require("./Department.model");
const TaskType = require("./TaskType.model");
const Batch = require("./Batch.model");
const Task = require("./Task.model");
const TaskAssignment = require("./TaskAssignment.model");
const TaskStatusHistory = require("./TaskStatusHistory.model");
const Comment = require("./Comment.model");

module.exports = {
  Batch,
  Comment,
  Department,
  Task,
  TaskAssignment,
  TaskStatusHistory,
  TaskType,
};
