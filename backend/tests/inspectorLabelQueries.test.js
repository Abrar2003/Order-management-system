const assert = require('node:assert/strict');
const test = require('node:test');

const Inspector = require('../models/inspector.model');
const Inspection = require('../models/inspection.model');
const { __test__ } = require('../controllers/inspector.controller');

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