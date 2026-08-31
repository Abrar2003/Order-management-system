const BLOCKING_CONFLICT_TYPES = new Set([
  'invalid_serial',
  'invalid_allocation_history_action',
  'inspector_identity_unresolved',
  'usage_inspector_unresolved',
  'usage_inspector_ambiguous',
  'multiple_current_allocation_claims',
  'multiple_current_rejection_claims',
  'ambiguous_current_reservation',
  'current_allocation_rejection_conflict',
  'duplicate_modern_label',
  'modern_label_incompatible',
  'phase1_status_record_requires_review',
  'modern_transaction_incompatible',
  'modern_usage_incompatible',
  'unsafe_storage_state',
]);

const QUARANTINE_CONFLICT_TYPES = new Set([
  'multiple_current_allocation_claims',
  'multiple_current_rejection_claims',
  'ambiguous_current_reservation',
  'current_allocation_rejection_conflict',
]);

const isBlockingConflict = (conflict = {}) =>
  String(conflict.severity || '') === 'error' ||
  BLOCKING_CONFLICT_TYPES.has(String(conflict.conflict_type || ''));

const isOpenBlockingConflict = (conflict = {}) =>
  String(conflict.status || 'open') === 'open' && isBlockingConflict(conflict);

const getBlockingLabelNumbers = (conflicts = []) =>
  new Set(
    (Array.isArray(conflicts) ? conflicts : [])
      .filter(isOpenBlockingConflict)
      .map((entry) => Number(entry.label_number))
      .filter((number) => Number.isInteger(number) && number > 0),
  );

const getQuarantineLabelNumbers = (conflicts = []) =>
  new Set(
    (Array.isArray(conflicts) ? conflicts : [])
      .filter(
        (entry) =>
          isOpenBlockingConflict(entry) &&
          QUARANTINE_CONFLICT_TYPES.has(String(entry.conflict_type || '')),
      )
      .map((entry) => Number(entry.label_number))
      .filter((number) => Number.isInteger(number) && number > 0),
  );

const isLabelReserved = (label = {}, conflicts = []) =>
  String(label?.allocation_state || 'active') === 'conflicted' ||
  (Array.isArray(conflicts) &&
    conflicts.some(
      (entry) =>
        isOpenBlockingConflict(entry) &&
        Number(entry.label_number) === Number(label?.number),
    ));

const isLabelAvailable = (label = {}, conflicts = []) =>
  !isLabelReserved(label, conflicts) &&
  !label?.owner_inspector &&
  !label?.rejected_by_inspector;

module.exports = {
  BLOCKING_CONFLICT_TYPES,
  QUARANTINE_CONFLICT_TYPES,
  getBlockingLabelNumbers,
  getQuarantineLabelNumbers,
  isBlockingConflict,
  isLabelAvailable,
  isLabelReserved,
  isOpenBlockingConflict,
};
