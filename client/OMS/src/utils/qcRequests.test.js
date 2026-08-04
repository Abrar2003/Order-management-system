import assert from "node:assert/strict";
import test from "node:test";

import { getQcUserUpdateRequestAvailability } from "./qcRequests.js";

const today = new Date().toISOString().slice(0, 10);
const request = {
  _id: "request-1",
  request_date: today,
  inspector: "qc-user",
  status: "open",
};

test("a placeholder inspection record is not a QC rewrite", () => {
  const availability = getQcUserUpdateRequestAvailability(
    {
      request_history: [request],
      inspection_record: [{
        _id: "inspection-1",
        request_history_id: "request-1",
        requested_date: today,
        inspector: "qc-user",
      }],
    },
    { currentUserId: "qc-user" },
  );

  assert.equal(availability.isAvailable, true);
  assert.equal(availability.currentUpdateCount, 0);
  assert.ok(availability.latestInspectionRecord?._id);
});

test("an inspected record is a QC rewrite", () => {
  const availability = getQcUserUpdateRequestAvailability(
    {
      request_history: [request],
      inspection_record: [{
        _id: "inspection-1",
        request_history_id: "request-1",
        requested_date: today,
        inspection_date: today,
        inspector: "qc-user",
        checked: 1,
        qc_update_count: 1,
        qc_update_window_started_at: new Date(),
      }],
    },
    { currentUserId: "qc-user" },
  );

  assert.equal(availability.isAvailable, true);
  assert.equal(availability.currentUpdateCount, 1);
});
