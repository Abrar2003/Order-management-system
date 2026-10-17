const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const replicaSet = require('./helpers/labelReplicaSet');
const Inspector = require('../models/inspector.model');
const Inspection = require('../models/inspection.model');
const Label = require('../models/label.model');
const QC = require('../models/qc.model');
const projector = require('../services/labels/liveLabelProjection.service');
const controller = require('../controllers/inspector.controller');
const qcController = require('../controllers/qc.controller');

// Uses a disposable loopback replica set; never connects to the application database.
test('serial labels have one owner and one inspection under concurrent writes', async (t) => {
  const db = await replicaSet();
  t.after(db.close);
  for (const model of [Inspector, Inspection, Label]) await model.createCollection();
  await Label.createIndexes();
  const oid = () => new mongoose.Types.ObjectId();
  const userA = oid(), userB = oid(), ownerA = oid(), ownerB = oid(), actor = oid();
  await mongoose.connection.db.collection('users').insertMany([
    { _id: userA, name: 'QC A' }, { _id: userB, name: 'QC B' },
  ]);
  await Inspector.collection.insertMany([
    { _id: ownerA, user: userA, alloted_labels: [101, 102, 103, 104, 105], rejected_labels: [] },
    { _id: ownerB, user: userB, alloted_labels: [201], rejected_labels: [] },
  ]);
  await mongoose.connection.transaction(async () => {
    await projector.claimAllocation({ inspectorId: ownerA, labels: [101, 102, 103, 104, 105] });
    await projector.claimAllocation({ inspectorId: ownerB, labels: [201] });
  });
  const visit = (number, inspector = userA) => {
    const doc = new Inspection({
      qc: oid(), inspector, labels_added: [number],
      inspection_date: '2026-10-17', requested_date: '2026-10-17',
      vendor_requested: 1, vendor_offered: 1, checked: 1, passed: 1,
      rejected: 0, pending_after: 0, createdBy: actor,
    });
    doc.$locals.qcDoc = { request_type: 'FULL' };
    return doc;
  };
  const save = (doc) => mongoose.connection.transaction(() => doc.save());

  await t.test('two simultaneous allocations produce exactly one owner', async () => {
    const allocate = async (owner) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await controller.allocateLabels({ params: { id: String(owner) }, body: { labels: [900] }, user: { _id: actor, name: 'Admin' } }, res);
      return res;
    };
    const results = await Promise.all([allocate(ownerA), allocate(ownerB)]);
    assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
    assert.equal(await Inspector.countDocuments({ alloted_labels: 900 }), 1);
    assert.equal(await Label.countDocuments({ number: 900 }), 1);
  });

  await t.test('two simultaneous uses by the same QC produce one inspection', async () => {
    const results = await Promise.allSettled([save(visit(101)), save(visit(101))]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await Inspection.countDocuments({ labels_added: 101 }), 1);
  });

  await t.test('another inspector cannot use or take over an allocated label', async () => {
    await assert.rejects(save(visit(102, userB)), /allocated exclusively/);
    const doc = await Inspection.findOne({ labels_added: 101 });
    doc.inspector = userB;
    doc.$locals.qcDoc = { request_type: 'FULL' };
    await assert.rejects(save(doc), /allocated exclusively/);
    assert.equal(String((await Inspection.findById(doc._id)).inspector), String(userA));
  });

  await t.test('legacy usage blocks reuse even without a modern claim', async () => {
    await Inspection.collection.insertOne(visit(103).toObject());
    await assert.rejects(save(visit(103)), /already used in another inspection/);
  });

  await t.test('a failed multi-label edit rolls back every claim and inspection change', async () => {
    const doc = visit(104);
    doc.labels_added = [104, 201];
    await assert.rejects(save(doc), /allocated exclusively/);
    assert.equal(await Inspection.countDocuments({ _id: doc._id }), 0);
    assert.equal((await Label.findOne({ number: 104 })).usage.inspection_record, null);
  });

  await t.test('unused transfer and a concurrent use cannot both succeed', async () => {
    const history = { _id: oid(), action: 'transfer_out', labels: [105], previous_labels: [105], next_labels: [] };
    const transfer = mongoose.connection.transaction(async () => {
      await projector.mirrorTransfer({ sourceInspectorId: ownerA, targetInspectorId: ownerB,
        sourceHistory: history, targetHistory: { ...history, _id: oid(), action: 'transfer_in' } });
      await Inspector.updateOne({ _id: ownerA }, { $pull: { alloted_labels: 105 } });
      await Inspector.updateOne({ _id: ownerB }, { $addToSet: { alloted_labels: 105 } });
    });
    const results = await Promise.allSettled([transfer, save(visit(105))]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const label = await Label.findOne({ number: 105 });
    if (await Inspection.exists({ labels_added: 105 })) assert.equal(String(label.owner_inspector), String(ownerA));
    else assert.equal(String(label.owner_inspector), String(ownerB));
  });

  await t.test('moving a use between records is atomic and releases the original claim', async () => {
    const original = await Inspection.findOne({ labels_added: 101 });
    const replacement = visit(101);
    await mongoose.connection.transaction(async () => {
      original.labels_added = [];
      await original.save();
      await replacement.save();
    });
    assert.equal(await Inspection.countDocuments({ labels_added: 101 }), 1);
    assert.equal(String((await Label.findOne({ number: 101 })).usage.inspection_record), String(replacement._id));
  });

  await t.test('label writes outside a transaction fail closed', async () => {
    await assert.rejects(visit(104).save(), /require an atomic database transaction/);
  });

  await t.test('inspection edit rejects the production 364-label range for four passed pieces', async () => {
    const qcId = oid(), orderId = oid();
    const raw = visit(104).toObject();
    raw.qc = qcId;
    raw.labels_added = [];
    raw.vendor_requested = 5;
    raw.vendor_offered = 5;
    raw.checked = 5;
    raw.passed = 4;
    raw.inspected_box_mode = 'Individual Packing';
    raw.inspected_box_sizes = [{ L: 1, B: 1, H: 1 }];
    await mongoose.connection.db.collection('orders').insertOne({ _id: orderId, status: 'Open', order_id: 'LABEL-TEST', quantity: 5 });
    await mongoose.connection.db.collection('items').insertOne({ _id: oid(), code: 'LABEL-TEST', barcode_exempted: true });
    await QC.collection.insertOne({ _id: qcId, order: orderId, item: { item_code: 'LABEL-TEST' }, quantities: { quantity_requested: 5 }, request_type: 'FULL', request_history: [] });
    await Inspection.collection.insertOne(raw);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await qcController.editInspectionRecords({
      params: { id: String(qcId) }, user: { _id: actor, name: 'Admin', role: 'admin' },
      body: { records: [{ _id: String(raw._id), label_ranges: [{ start: 72481, end: 72844 }] }] },
    }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /Total labels.*\(4\).*364/);
    assert.deepEqual((await Inspection.findById(raw._id)).labels_added, []);
  });
});
