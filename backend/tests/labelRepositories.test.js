const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const {
  LegacyLabelRepository,
} = require("../services/labels/legacyLabel.repository");
const {
  ModernLabelRepository,
} = require("../services/labels/modernLabel.repository");

const queryReturning = (value) => ({
  select() { return this; },
  sort() { return this; },
  populate() { return this; },
  async lean() { return value; },
});

test("legacy used-label reads derive from Inspection evidence", async () => {
  const repository = new LegacyLabelRepository({
    InspectorModel: {
      findById: () => queryReturning({
        user: "user-1",
        used_labels: [999],
      }),
    },
    InspectionModel: {
      find: () => queryReturning([
        { labels_added: [3, 2, 3] },
        { labels_added: [5] },
      ]),
    },
  });

  assert.deepEqual(await repository.getUsedLabels("inspector-1"), [2, 3, 5]);
});

test("legacy summary computes unused as allocation minus forensic usage", async () => {
  const inspectorId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  let capturedPipeline = null;
  const repository = new LegacyLabelRepository({
    InspectorModel: {
      base: mongoose,
      async aggregate(pipeline) {
        capturedPipeline = pipeline;
        return [{
          user: userId,
          total_allocated: 3,
          total_used: 3,
          total_unused: 1,
          total_rejected: 1,
        }];
      },
    },
    InspectionModel: {
      collection: { name: "inspections" },
    },
  });

  assert.deepEqual(await repository.getSummary(inspectorId), {
    inspector: userId,
    total_allocated: 3,
    total_used: 3,
    total_unused: 1,
    total_rejected: 1,
    usage_percentage: "100.00",
  });
  assert.equal(capturedPipeline[1].$lookup.from, "inspections");
  assert.deepEqual(
    capturedPipeline[3].$project.total_unused,
    { $size: { $setDifference: ["$allocated_labels", "$used_labels"] } },
  );
});

test("modern current-state reads filter in MongoDB and preserve empty results", async () => {
  const calls = {};
  const repository = new ModernLabelRepository({
    LabelModel: {
      find(filter) {
        calls.filter = filter;
        return {
          select(fields) { calls.select = fields; return this; },
          sort(fields) { calls.sort = fields; return this; },
          async lean() { return []; },
        };
      },
    },
  });

  assert.deepEqual(await repository.getRejectedLabels("inspector-1"), []);
  assert.deepEqual(calls, {
    filter: { rejected_by_inspector: "inspector-1" },
    select: "number -_id",
    sort: { number: 1 },
  });
});

test("modern summary preserves used labels outside current allocation", async () => {
  const filters = [];
  const counts = [3, 3, 1, 0];
  const repository = new ModernLabelRepository({
    InspectorModel: {
      findById: () => queryReturning({ user: "user-1" }),
    },
    LabelModel: {
      countDocuments(filter) {
        filters.push(filter);
        return Promise.resolve(counts[filters.length - 1]);
      },
    },
  });

  assert.deepEqual(await repository.getSummary("inspector-1"), {
    inspector: "user-1",
    total_allocated: 3,
    total_used: 3,
    total_unused: 1,
    total_rejected: 0,
    usage_percentage: "100.00",
  });
  assert.deepEqual(filters[2], {
    owner_inspector: "inspector-1",
    "usage.inspector": { $ne: "inspector-1" },
  });
});
