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

test('live transfer changes owner only when every serial still belongs to the source', async () => {
  const { projector, transactionWrites } = createProjector();
  const transferWrites = [];
  projector.Label.updateMany = async (filter, update) => {
    transferWrites.push({ filter, update });
    return { matchedCount: 2 };
  };

  await projector.mirrorTransfer({
    sourceInspectorId: 'source',
    targetInspectorId: 'target',
    sourceHistory: {
      _id: 'source-history', action: 'transfer_out', labels: [1, 2],
      previous_labels: [1, 2], next_labels: [], to_inspector: 'target',
    },
    targetHistory: {
      _id: 'target-history', action: 'transfer_in', labels: [1, 2],
      previous_labels: [], next_labels: [1, 2], from_inspector: 'source',
    },
  });

  assert.deepEqual(transferWrites, [{
    filter: { number: { $in: [1, 2] }, owner_inspector: 'source' },
    update: { $set: { owner_inspector: 'target' } },
  }]);
  assert.equal(transactionWrites.length, 2);
});

test('live transfer stops when its modern owner check is stale', async () => {
  const { projector } = createProjector();
  projector.Label.updateMany = async () => ({ matchedCount: 1 });

  await assert.rejects(
    projector.mirrorTransfer({
      sourceInspectorId: 'source', targetInspectorId: 'target',
      sourceHistory: { _id: 'source-history', action: 'transfer_out', labels: [1, 2] },
      targetHistory: { _id: 'target-history', action: 'transfer_in', labels: [1, 2] },
    }),
    /no longer matches/,
  );
});

test('live QC usage replaces one inspection projection and refreshes affected labels', async () => {
  const usageWrites = [];
  const usageDeletes = [];
  const labelWrites = [];
  const sourceUpdatedAt = new Date('2026-10-09T05:00:00.000Z');
  const projector = new LiveLabelProjectionService({
    LabelModel: {
      async bulkWrite(operations, options) {
        labelWrites.push({ operations, options });
      },
    },
    LabelTransactionModel: {},
    LabelUsageModel: {
      findOne() {
        return {
          select() {
            return { lean: async () => ({ labels: [10] }) };
          },
        };
      },
      async updateOne(filter, update, options) {
        usageWrites.push({ filter, update, options });
      },
      async deleteOne(filter) {
        usageDeletes.push(filter);
      },
      async aggregate() {
        return [{
          _id: 11,
          inspectors: ['inspector-1'],
          source_updated_at: sourceUpdatedAt,
        }];
      },
    },
  });

  await projector.syncInspectionUsage({
    inspectorId: 'inspector-1',
    inspection: {
      _id: 'inspection-1',
      qc: 'qc-1',
      labels_added: [11],
      inspection_date: '2026-10-09',
      createdAt: new Date('2026-10-09T04:00:00.000Z'),
      updatedAt: sourceUpdatedAt,
    },
    qc: {
      _id: 'qc-1',
      order_meta: { order_id: 'PO-1', brand: 'Brand' },
      item: { item_code: 'ITEM-1', description: 'Item' },
    },
  });

  assert.equal(usageWrites.length, 1);
  assert.equal(usageDeletes.length, 0);
  assert.deepEqual(usageWrites[0].update.$set.labels, [11]);
  assert.equal(usageWrites[0].update.$set['migration.source'], 'live_qc_usage');
  assert.deepEqual(labelWrites[0].operations.map((entry) => ({
    number: entry.updateOne.filter.number,
    inspectors: entry.updateOne.update.$set['usage.inspectors'],
  })), [
    { number: 10, inspectors: [] },
    { number: 11, inspectors: ['inspector-1'] },
  ]);
  assert.deepEqual(labelWrites[0].options, { ordered: false });
});

test('modern QC validation checks only the requested serials', async () => {
  const queries = [];
  const projector = new LiveLabelProjectionService({
    LabelModel: {
      find(filter) {
        queries.push(filter);
        return {
          select() {
            return {
              lean: async () => [
                { number: 1, allocation_state: 'active', owner_inspector: 'inspector-1' },
                { number: 2, allocation_state: 'active', owner_inspector: 'inspector-1', usage: { inspectors: ['inspector-1'] } },
                { number: 3, allocation_state: 'active', rejected_by_inspector: 'inspector-1' },
                { number: 4, allocation_state: 'conflicted', owner_inspector: 'inspector-1' },
              ],
            };
          },
        };
      },
    },
    LabelTransactionModel: {},
    LabelUsageModel: {},
  });

  const state = await projector.getValidationState(
    'inspector-1',
    [1, 2, 3, 4],
  );

  assert.deepEqual(queries, [{ number: { $in: [1, 2, 3, 4] } }]);
  assert.deepEqual([...state.allocated], [1, 2]);
  assert.deepEqual([...state.used], [2]);
  assert.deepEqual([...state.rejected], [3]);
});
