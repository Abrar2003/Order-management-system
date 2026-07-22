const assert = require("node:assert/strict");
const test = require("node:test");

const {
  __test__: {
    syncQcCurrentRequestFieldsFromHistory,
    syncRequestHistoryInspectorsFromInspections,
  },
} = require("../controllers/qc.controller");

test("inspection inspector edits update the linked request and current QC inspector", () => {
  const requestHistory = [
    {
      _id: "request-1",
      request_date: "2026-07-21",
      request_type: "FULL",
      quantity_requested: 400,
      inspector: "old-inspector",
      remarks: "",
    },
  ];
  const inspections = [
    {
      _id: "inspection-old",
      request_history_id: "request-1",
      inspection_date: "2026-07-20",
      inspector: "old-inspector",
    },
    {
      _id: "inspection-latest",
      request_history_id: "request-1",
      inspection_date: "2026-07-21",
      inspector: "new-inspector",
    },
  ];
  const qc = {
    inspector: "old-inspector",
    request_date: "2026-07-21",
    request_type: "FULL",
    request_history: requestHistory,
    quantities: { quantity_requested: 400 },
    remarks: "",
  };

  const changedEntries = syncRequestHistoryInspectorsFromInspections(
    requestHistory,
    inspections,
  );

  assert.deepEqual(changedEntries, [requestHistory[0]]);
  assert.equal(requestHistory[0].inspector, "new-inspector");
  assert.equal(syncQcCurrentRequestFieldsFromHistory(qc, inspections), true);
  assert.equal(qc.inspector, "new-inspector");
  assert.deepEqual(
    syncRequestHistoryInspectorsFromInspections(requestHistory, inspections),
    [],
  );
});

test("inspector sync does not use or update another request on the same date", () => {
  const editedRequest = {
    _id: "request-edited",
    request_date: "2026-07-21",
    inspector: "old-inspector",
  };
  const untouchedRequest = {
    _id: "request-untouched",
    request_date: "2026-07-21",
    inspector: "untouched-inspector",
  };
  const inspections = [
    {
      _id: "inspection-foreign",
      request_history_id: "request-untouched",
      requested_date: "2026-07-21",
      inspection_date: "2026-07-21",
      inspector: "foreign-inspector",
      checked: 0,
    },
  ];

  assert.deepEqual(
    syncRequestHistoryInspectorsFromInspections([editedRequest], inspections),
    [],
  );
  assert.equal(editedRequest.inspector, "old-inspector");
  assert.equal(untouchedRequest.inspector, "untouched-inspector");
});

test("inspector sync changes only the request entries passed by the edit route", () => {
  const editedRequest = {
    _id: "request-edited",
    request_date: "2026-07-21",
    inspector: "old-inspector",
  };
  const untouchedRequest = {
    _id: "request-untouched",
    request_date: "2026-07-20",
    inspector: "untouched-inspector",
  };
  const inspections = [
    {
      request_history_id: "request-edited",
      inspection_date: "2026-07-21",
      inspector: "new-inspector",
    },
    {
      request_history_id: "request-untouched",
      inspection_date: "2026-07-20",
      inspector: "different-inspector",
    },
  ];

  assert.deepEqual(
    syncRequestHistoryInspectorsFromInspections([editedRequest], inspections),
    [editedRequest],
  );
  assert.equal(editedRequest.inspector, "new-inspector");
  assert.equal(untouchedRequest.inspector, "untouched-inspector");
});
