const assert = require("node:assert/strict");
const test = require("node:test");

const QC = require("../models/qc.model");

test("QC reminders keep a comment and optional image attachment", () => {
  const qc = new QC({
    reminders: [
      {
        comment: "Verify the carton artwork before inspection.",
        image: { key: "qc-reminders/example.jpg", originalName: "example.jpg" },
      },
    ],
  });

  assert.equal(qc.reminders[0].comment, "Verify the carton artwork before inspection.");
  assert.equal(qc.reminders[0].image.key, "qc-reminders/example.jpg");

  const withoutComment = new QC({ reminders: [{}] });
  assert.ok(withoutComment.validateSync().errors["reminders.0.comment"]);
});
