const assert = require("node:assert/strict");
const test = require("node:test");

const QC = require("../models/qc.model");
const Inspection = require("../models/inspection.model");
const { __test__ } = require("../controllers/qc.controller");

test("shift deadline is requested-date midnight IST plus 96 hours", () => {
  assert.equal(
    __test__.buildShiftedRequestDeadline("2026-08-24").toISOString(),
    "2026-08-27T18:30:00.000Z",
  );
});

test("shifted records stay shifted during status derivation and sync", () => {
  assert.equal(
    __test__.resolveInspectionRecordStatus({
      checked: 0,
      explicitStatus: "shifted for later",
    }),
    "shifted for later",
  );
  assert.equal(
    __test__.hasInspectionRecordActivity({ status: "shifted for later" }),
    true,
  );

  const qc = {
    request_history: [{ _id: "request-1", status: "open" }],
  };
  __test__.syncQcRequestHistoryStatuses(qc, [
    {
      request_history_id: "request-1",
      status: "shifted for later",
    },
  ]);
  assert.equal(qc.request_history[0].status, "shifted for later");
});

test("shift schemas preserve transfer compatibility", () => {
  const inspectionStatuses = Inspection.schema.path("status").enumValues;
  const requestStatuses =
    QC.schema.path("request_history").schema.path("status").enumValues;

  for (const statuses of [inspectionStatuses, requestStatuses]) {
    assert.ok(statuses.includes("transfered"));
    assert.ok(statuses.includes("transferred"));
    assert.ok(statuses.includes("shifted for later"));
  }
  assert.equal(
    QC.schema.path("request_history").schema.path("deadline").instance,
    "Date",
  );
});

test("backend availability honors shifted deadlines", () => {
  const request = {
    _id: "request-1",
    request_date: "2020-01-01",
    inspector: "qc-user",
    status: "open",
  };
  const inspection = {
    request_history_id: "request-1",
    requested_date: "2020-01-01",
    inspector: "qc-user",
    status: "pending",
  };

  const active = __test__.getQcUserLatestRequestAvailability(
    {
      request_history: [{
        ...request,
        deadline: new Date(Date.now() + 60_000),
      }],
    },
    [inspection],
    { currentUserId: "qc-user" },
  );
  assert.equal(active.isAvailable, true);

  const expired = __test__.getQcUserLatestRequestAvailability(
    {
      request_history: [{
        ...request,
        deadline: new Date(Date.now() - 1),
      }],
    },
    [inspection],
    { currentUserId: "qc-user" },
  );
  assert.equal(expired.isAvailable, false);
  assert.match(expired.reason, /deadline has expired/i);
});
