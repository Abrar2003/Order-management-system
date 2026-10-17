const mongoose = require('mongoose');
const { normalizeLabels, difference } = require('./liveLabelProjection.service');

const conflict = (message) => Object.assign(new Error(message), { code: 'LABEL_CLAIM_CONFLICT' });

// Inspection edits and normal QC updates must acquire the same per-label lock.
const guardInspectionLabels = async (inspection) => {
  if (!inspection.isNew && !inspection.isModified('labels_added') && !inspection.isModified('inspector')) return;

  const Inspection = inspection.constructor;
  const Inspector = require('../../models/inspector.model');
  const Label = require('../../models/label.model');
  const session = inspection.$session() || mongoose.transactionAsyncLocalStorage?.getStore()?.session;
  const previous = inspection.isNew ? null : await Inspection.findById(inspection._id)
    .select('inspector labels_added').session(session || null).lean();
  const labels = normalizeLabels(inspection.labels_added);
  const oldLabels = normalizeLabels(previous?.labels_added);
  const inspectorChanged = previous && String(previous.inspector) !== String(inspection.inspector);
  const added = inspectorChanged ? labels : difference(labels, oldLabels);
  const removed = difference(oldLabels, labels);
  if (!added.length && !removed.length) return;
  if (!session?.inTransaction()) {
    throw conflict('Label changes require an atomic database transaction. No changes were saved.');
  }

  if (added.length) {
    const owners = await Inspector.find({ $or: [
      { alloted_labels: { $in: added } },
      { rejected_labels: { $in: added } },
    ] }).select('_id user alloted_labels rejected_labels').session(session).lean();
    const allocations = owners.map((owner) => ({ ...owner, allocated: new Set(normalizeLabels(owner.alloted_labels)) }));
    const rejected = new Set(owners.flatMap((owner) => normalizeLabels(owner.rejected_labels)));
    const inspector = allocations.find((owner) => String(owner.user) === String(inspection.inspector));
    const invalid = added.filter((number) => {
      const allocated = allocations.filter((owner) => owner.allocated.has(number));
      return !inspector || allocated.length !== 1 || String(allocated[0]._id) !== String(inspector._id)
        || rejected.has(number);
    });
    if (invalid.length) throw conflict(`Labels must be allocated exclusively to this inspector and not rejected: ${invalid.slice(0, 10).join(', ')}`);

    const used = await Inspection.find({
      _id: { $ne: inspection._id }, labels_added: { $in: added },
    }).select('labels_added').session(session).lean();
    const usedSet = new Set(used.flatMap((record) => normalizeLabels(record.labels_added)));
    const duplicates = added.filter((number) => usedSet.has(number));
    if (duplicates.length) throw conflict(`Labels are already used in another inspection: ${duplicates.slice(0, 10).join(', ')}`);

    try {
      await Label.bulkWrite(added.map((number) => ({ updateOne: {
        filter: {
          number,
          owner_inspector: { $in: [null, inspector._id] },
          rejected_by_inspector: null,
          allocation_state: { $ne: 'conflicted' },
          'usage.inspection_record': { $in: [null, inspection._id] },
        },
        update: { $set: {
          owner_inspector: inspector._id,
          'usage.inspection_record': inspection._id,
        }, $setOnInsert: { number, allocation_state: 'active' } },
        upsert: true,
      } })), { ordered: true, session });
    } catch (error) {
      if (Number(error.code) === 11000) throw conflict('A label was already claimed by another inspection. Refresh and try again.');
      throw error;
    }
  }

  if (removed.length) {
    await Label.updateMany({ number: { $in: removed }, 'usage.inspection_record': inspection._id },
      { $set: { 'usage.inspection_record': null } }, { session });
  }
};

module.exports = { guardInspectionLabels };
