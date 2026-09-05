const assert = require("node:assert/strict");
const test = require("node:test");
const { Notification } = require("../models/notification.model");
const { listNotifications } = require("../services/notificationService");

test("notification reads exclude preserved Production Workflow records", async (t) => {
  let capturedMatch;
  t.mock.method(Notification, "find", (match) => {
    capturedMatch = match;
    return {
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      async lean() { return []; },
    };
  });
  t.mock.method(Notification, "countDocuments", async () => 0);

  await listNotifications("507f1f77bcf86cd799439011");

  assert.deepEqual(capturedMatch.entity_type, {
    $nin: ["workflow_task", "workflow_batch"],
  });
});
