const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LiveLabelProjectionService,
} = require('../services/labels/liveLabelProjection.service');

const createProjector = () => {
  const labelWrites = [];
  const transactionWrites = [];
  return {
    labelWrites,
    transactionWrites,
    projector: new LiveLabelProjectionService({
      LabelModel: {
        async bulkWrite(operations, options) {
          labelWrites.push({ operations, options });
        },
      },
      LabelTransactionModel: {
        async updateOne(filter, update, options) {
          transactionWrites.push({ filter, update, options });
        },
      },
    }),
  };
};

test('live replace mirrors ownership changes and an idempotent transaction', async () => {
  const { projector, labelWrites, transactionWrites } = createProjector();

  await projector.mirrorInspectorChange({
    inspectorId: 'inspector-1',
    history: {
      _id: 'history-1',
      action: 'replace',
      labels: [2, 3],
      previous_labels: [1, 2],
      next_labels: [2, 3],
      recorded_at: new Date('2026-09-28T00:00:00.000Z'),
    },
  });

  assert.equal(labelWrites.length, 1);
  assert.deepEqual(labelWrites[0].operations.map((entry) => entry.updateOne.filter), [
    { number: 3 },
    { number: 1, owner_inspector: 'inspector-1' },
  ]);
  assert.equal(labelWrites[0].operations[0].updateOne.update.$set.owner_inspector, 'inspector-1');
  assert.equal(labelWrites[0].operations[1].updateOne.update.$set.owner_inspector, null);
  assert.deepEqual(transactionWrites[0].filter, {
    'migration.legacy_inspector': 'inspector-1',
    'migration.legacy_history_id': 'history-1',
  });
  assert.equal(transactionWrites[0].update.$set.action, 'replace');
  assert.deepEqual(transactionWrites[0].options, { upsert: true });
});

test('live rejection clears ownership and retains a rejection projection', async () => {
  const { projector, labelWrites } = createProjector();

  await projector.mirrorInspectorChange({
    inspectorId: 'inspector-1',
    history: {
      _id: 'history-2',
      action: 'reject',
      labels: [7],
      previous_labels: [7],
      next_labels: [],
    },
  });

  const update = labelWrites[0].operations[0].updateOne.update.$set;
  assert.equal(update.owner_inspector, null);
  assert.equal(update.rejected_by_inspector, 'inspector-1');
  assert.ok(update.rejected_at instanceof Date);
});
