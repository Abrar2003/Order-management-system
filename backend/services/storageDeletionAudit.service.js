const { AsyncLocalStorage } = require("node:async_hooks");
const mongoose = require("mongoose");
const SecurityActivityLog = require("../models/securityActivityLog.model");

const storageDeletionContext = new AsyncLocalStorage();
const normalizeText = (value) => String(value ?? "").trim();

const withStorageDeletionContext = (req, _res, next) =>
  storageDeletionContext.run({ req }, next);

const buildStorageDeletionAuditEntry = ({
  key = "",
  versionId = "",
  deleteMarker = false,
} = {}) => {
  const req = storageDeletionContext.getStore()?.req;
  const userId = req?.user?._id || req?.user?.id || null;
  const username = normalizeText(
    req?.user?.name || req?.user?.username || req?.user?.email || "System",
  );

  return {
    user: mongoose.Types.ObjectId.isValid(String(userId)) ? userId : null,
    username,
    action: "delete",
    resource_type: "storage_object",
    resource_id: normalizeText(key),
    ip: normalizeText(req?.ip),
    user_agent: normalizeText(req?.get?.("user-agent")),
    metadata: {
      source: req ? `${req.method} ${req.originalUrl}` : "background worker",
      delete_marker_version_id: normalizeText(versionId),
      delete_marker_created: Boolean(deleteMarker),
    },
  };
};

const logStorageDeletion = (details = {}) =>
  SecurityActivityLog.create(buildStorageDeletionAuditEntry(details));

module.exports = {
  buildStorageDeletionAuditEntry,
  logStorageDeletion,
  withStorageDeletionContext,
};
