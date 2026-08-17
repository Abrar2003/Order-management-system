const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildStorageDeletionAuditEntry,
} = require("../services/storageDeletionAudit.service");

test("storage deletion audit records the key and version marker", () => {
  const entry = buildStorageDeletionAuditEntry({
    key: "items/old-pis.pdf",
    versionId: "delete-marker-version",
    deleteMarker: true,
  });

  assert.equal(entry.resource_type, "storage_object");
  assert.equal(entry.resource_id, "items/old-pis.pdf");
  assert.equal(entry.metadata.delete_marker_version_id, "delete-marker-version");
  assert.equal(entry.metadata.delete_marker_created, true);
  assert.equal(entry.user, null);
  assert.equal(entry.username, "System");
});
