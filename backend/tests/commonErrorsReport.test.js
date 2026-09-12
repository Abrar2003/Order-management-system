const assert = require("node:assert/strict");
const test = require("node:test");
const {
  __test__: { buildCommonErrorsReportDataset },
} = require("../controllers/reports.controller");
const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");

const query = (rows) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  lean: async () => rows,
});

test("common errors queries only completed inspections", async (t) => {
  let inspectionMatch;
  t.mock.method(QC, "find", () => query([{ _id: "qc-1" }]));
  t.mock.method(Inspection, "find", (match) => {
    inspectionMatch = match;
    return query([]);
  });

  await buildCommonErrorsReportDataset({ user: { role: "admin" } });

  assert.equal(inspectionMatch.status, "Inspection Done");
});
