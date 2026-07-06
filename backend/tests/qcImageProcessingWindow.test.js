const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isWithinProcessingWindow,
} = require("../services/qcImageProcessingWindow");

test("QC image processing window includes 9 PM Asia/Kolkata", () => {
  assert.equal(
    isWithinProcessingWindow({
      now: new Date("2026-07-06T15:31:00.000Z"),
      timeZone: "Asia/Kolkata",
      start: "21:00",
      end: "07:00",
    }),
    true,
  );
});

test("QC image processing window includes early morning before 7 AM Asia/Kolkata", () => {
  assert.equal(
    isWithinProcessingWindow({
      now: new Date("2026-07-06T01:00:00.000Z"),
      timeZone: "Asia/Kolkata",
      start: "21:00",
      end: "07:00",
    }),
    true,
  );
});

test("QC image processing window excludes daytime Asia/Kolkata", () => {
  assert.equal(
    isWithinProcessingWindow({
      now: new Date("2026-07-06T07:00:00.000Z"),
      timeZone: "Asia/Kolkata",
      start: "21:00",
      end: "07:00",
    }),
    false,
  );
});
