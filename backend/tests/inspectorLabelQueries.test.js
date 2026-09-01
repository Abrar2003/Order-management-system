const assert = require('node:assert/strict');
const test = require('node:test');

const Inspector = require('../models/inspector.model');
const Inspection = require('../models/inspection.model');
const inspectorController = require('../controllers/inspector.controller');
const { __test__ } = inspectorController;

test('global label checks query only requested labels', async (t) => {
  const inspectorFind = Inspector.find;
  const inspectionFind = Inspection.find;
  const inspectorQueries = [];
  const inspectionQueries = [];
  t.after(() => {
    Inspector.find = inspectorFind;
    Inspection.find = inspectionFind;
  });
  Inspector.find = (query) => {
    inspectorQueries.push(query);
    return { select() { return this; }, populate() { return this; }, lean: async () => [] };
  };
  Inspection.find = (query) => {
    inspectionQueries.push(query);
    return { select() { return this; }, lean: async () => [] };
  };

  await __test__.collectGlobalInspectorLabelSets({
    excludeInspectorIds: ['source', 'target'],
    labels: [54747, 54760],
  });

  assert.deepEqual(inspectorQueries, [{
    $or: [
      { alloted_labels: { $in: [54747, 54760] } },
      { rejected_labels: { $in: [54747, 54760] } },
    ],
  }]);
  assert.deepEqual(inspectionQueries, [{ labels_added: { $in: [54747, 54760] } }]);
});
test('transfer updates only legacy allocation arrays without hydrating or saving inspectors', async (t) => {
  const find = Inspector.find;
  const findById = Inspector.findById;
  const bulkWrite = Inspector.bulkWrite;
  const inspectionFind = Inspection.find;
  const source = { _id: 'source', user: 'source-user', alloted_labels: [10, 11], rejected_labels: [], labels_allotted_by: null };
  const target = { _id: 'target', user: 'target-user', alloted_labels: [], rejected_labels: [], labels_allotted_by: null };
  const writes = [];
  t.after(() => {
    Inspector.find = find;
    Inspector.findById = findById;
    Inspector.bulkWrite = bulkWrite;
    Inspection.find = inspectionFind;
  });
  Inspector.findById = (id) => ({ lean: async () => (id === 'source' ? source : target) });
  Inspector.find = () => ({ select() { return this; }, populate() { return this; }, lean: async () => [] });
  Inspector.bulkWrite = async (updates) => { writes.push(updates); };
  Inspection.find = () => ({ select() { return this; }, lean: async () => [] });
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

  await inspectorController.transferLabels({
    body: { from_inspector_id: 'source', to_inspector_id: 'target', labels: [10] },
    user: { _id: 'actor', name: 'Manager' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.transferred_labels, [10]);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0][0].updateOne.update.$set.alloted_labels, [11]);
  assert.deepEqual(writes[0][1].updateOne.update.$set.alloted_labels, [10]);
});