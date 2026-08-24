import assert from "node:assert/strict";
import test from "node:test";

import {
  getQcUserUpdateRequestAvailability,
  resolveLatestInspectionRecordForRequestEntry,
} from "./qcRequests.js";

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

test("a shifted request uses its deadline instead of the old request date", () => {
  const availability = getQcUserUpdateRequestAvailability(
    {
      request_history: [{
        ...request,
        request_date: "2020-01-01",
        deadline: new Date(Date.now() + 60_000),
      }],
      inspection_record: [{
        request_history_id: "request-1",
        requested_date: "2020-01-01",
        inspector: "qc-user",
        status: "pending",
      }],
    },
    { currentUserId: "qc-user" },
  );

  assert.equal(availability.isAvailable, true);
});

test("a shifted request is unavailable at or after its deadline", () => {
  const availability = getQcUserUpdateRequestAvailability(
    {
      request_history: [{
        ...request,
        deadline: new Date(Date.now() - 1),
      }],
      inspection_record: [],
    },
    { currentUserId: "qc-user" },
  );

  assert.equal(availability.isAvailable, false);
  assert.match(availability.reason, /deadline expired/i);
});

test("same-date inspection records resolve by request history id", () => {
  const requestEntry = {
    _id: "request-2",
    request_date: today,
    inspector: "qc-user",
  };
  const resolved = resolveLatestInspectionRecordForRequestEntry(
    [
      {
        _id: "inspection-1",
        request_history_id: "request-1",
        requested_date: today,
      },
      {
        _id: "inspection-2",
        request_history_id: "request-2",
        requested_date: today,
      },
    ],
    requestEntry,
  );

  assert.equal(resolved?._id, "inspection-2");
});
