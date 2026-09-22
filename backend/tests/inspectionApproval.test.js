const assert = require("node:assert/strict");
const test = require("node:test");
const Inspection = require("../models/inspection.model");

test("inspection records require approval by default", () => {
  const inspection = new Inspection();

  assert.equal(inspection.is_approved, false);
});
