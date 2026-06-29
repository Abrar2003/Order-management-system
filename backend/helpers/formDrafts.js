const mongoose = require("mongoose");

const FORM_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const formDraftSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },
    mode: { type: String, required: true, trim: true },
    record_id: { type: String, default: "", trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    updated_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true },
  },
  { _id: false },
);

const normalizeDraftMode = (value) => String(value || "").trim().toLowerCase();
const normalizeDraftRecordId = (value) => String(value || "").trim();

const getDraftUserId = (user = {}) =>
  String(user?._id || user?.id || "").trim();

const isDraftExpired = (draft = {}, now = new Date()) => {
  const expiresAt = draft?.expires_at ? new Date(draft.expires_at) : null;
  return !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= now;
};

const cleanupExpiredFormDrafts = (doc, now = new Date()) => {
  const drafts = Array.isArray(doc?.form_drafts) ? doc.form_drafts : [];
  const nextDrafts = drafts.filter((draft) => !isDraftExpired(draft, now));
  if (nextDrafts.length !== drafts.length) {
    doc.form_drafts = nextDrafts;
    return true;
  }
  return false;
};

const findFormDraft = (
  doc,
  { userId = "", mode = "", recordId = "" } = {},
  now = new Date(),
) => {
  const normalizedUserId = String(userId || "").trim();
  const normalizedMode = normalizeDraftMode(mode);
  const normalizedRecordId = normalizeDraftRecordId(recordId);

  if (!normalizedUserId || !normalizedMode) return null;

  return (Array.isArray(doc?.form_drafts) ? doc.form_drafts : []).find((draft) => {
    if (isDraftExpired(draft, now)) return false;
    return (
      String(draft?.user || "").trim() === normalizedUserId &&
      normalizeDraftMode(draft?.mode) === normalizedMode &&
      normalizeDraftRecordId(draft?.record_id) === normalizedRecordId
    );
  }) || null;
};

const upsertFormDraft = (
  doc,
  { userId = "", mode = "", recordId = "", payload = {} } = {},
  now = new Date(),
) => {
  const normalizedUserId = String(userId || "").trim();
  const normalizedMode = normalizeDraftMode(mode);
  const normalizedRecordId = normalizeDraftRecordId(recordId);

  if (!mongoose.Types.ObjectId.isValid(normalizedUserId)) {
    throw new Error("Valid user is required for draft storage");
  }
  if (!normalizedMode) {
    throw new Error("Draft mode is required");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Draft payload must be an object");
  }

  cleanupExpiredFormDrafts(doc, now);
  if (!Array.isArray(doc.form_drafts)) {
    doc.form_drafts = [];
  }

  const expiresAt = new Date(now.getTime() + FORM_DRAFT_TTL_MS);
  const existing = findFormDraft(
    doc,
    { userId: normalizedUserId, mode: normalizedMode, recordId: normalizedRecordId },
    now,
  );

  if (existing) {
    existing.payload = payload;
    existing.updated_at = now;
    existing.expires_at = expiresAt;
    return existing;
  }

  const draft = {
    user: normalizedUserId,
    mode: normalizedMode,
    record_id: normalizedRecordId,
    payload,
    updated_at: now,
    expires_at: expiresAt,
  };
  doc.form_drafts.push(draft);
  return draft;
};

const deleteFormDraft = (
  doc,
  { userId = "", mode = "", recordId = "" } = {},
  now = new Date(),
) => {
  const normalizedUserId = String(userId || "").trim();
  const normalizedMode = normalizeDraftMode(mode);
  const normalizedRecordId = normalizeDraftRecordId(recordId);
  const drafts = Array.isArray(doc?.form_drafts) ? doc.form_drafts : [];
  const nextDrafts = drafts.filter((draft) => {
    if (isDraftExpired(draft, now)) return false;
    return !(
      String(draft?.user || "").trim() === normalizedUserId &&
      normalizeDraftMode(draft?.mode) === normalizedMode &&
      normalizeDraftRecordId(draft?.record_id) === normalizedRecordId
    );
  });

  const changed = nextDrafts.length !== drafts.length;
  if (changed) {
    doc.form_drafts = nextDrafts;
  }
  return changed;
};

const serializeFormDraft = (draft = null) => {
  if (!draft) return null;
  return {
    mode: normalizeDraftMode(draft.mode),
    record_id: normalizeDraftRecordId(draft.record_id),
    payload: draft.payload && typeof draft.payload === "object" ? draft.payload : {},
    updated_at: draft.updated_at || null,
    expires_at: draft.expires_at || null,
  };
};

const createStoredDraftArrayExpression = () => ({
  $cond: [{ $isArray: "$form_drafts" }, "$form_drafts", []],
});

const createDraftIdentityExpression = ({ userId = "", mode = "", recordId = "" } = {}) => {
  const normalizedUserId = String(userId || "").trim();
  const normalizedMode = normalizeDraftMode(mode);
  const normalizedRecordId = normalizeDraftRecordId(recordId);

  return {
    $and: [
      { $eq: [{ $toString: "$$draft.user" }, normalizedUserId] },
      { $eq: ["$$draft.mode", normalizedMode] },
      { $eq: ["$$draft.record_id", normalizedRecordId] },
    ],
  };
};

const createActiveDraftsExpression = ({ now = new Date(), exclude = null } = {}) => {
  const conditions = [{ $gt: ["$$draft.expires_at", now] }];
  if (exclude) {
    conditions.push({ $not: [exclude] });
  }

  return {
    $filter: {
      input: createStoredDraftArrayExpression(),
      as: "draft",
      cond: conditions.length === 1 ? conditions[0] : { $and: conditions },
    },
  };
};

const toStoredFormDraft = (draft = {}) => {
  const userId = String(draft?.user || "").trim();
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Valid user is required for draft storage");
  }

  return {
    user: new mongoose.Types.ObjectId(userId),
    mode: normalizeDraftMode(draft.mode),
    record_id: normalizeDraftRecordId(draft.record_id),
    payload: draft.payload && typeof draft.payload === "object" ? draft.payload : {},
    updated_at: draft.updated_at || new Date(),
    expires_at: draft.expires_at,
  };
};

const buildFormDraftCleanupPipeline = (now = new Date()) => [
  {
    $set: {
      form_drafts: createActiveDraftsExpression({ now }),
    },
  },
];

const buildFormDraftUpsertPipeline = ({ draft = {}, now = new Date() } = {}) => {
  const nextDraft = toStoredFormDraft(draft);
  const exclude = createDraftIdentityExpression({
    userId: nextDraft.user,
    mode: nextDraft.mode,
    recordId: nextDraft.record_id,
  });

  return {
    nextDraft,
    pipeline: [
      {
        $set: {
          form_drafts: {
            $concatArrays: [
              createActiveDraftsExpression({ now, exclude }),
              [{ $literal: nextDraft }],
            ],
          },
        },
      },
    ],
  };
};

const buildFormDraftDeletePipeline = ({
  userId = "",
  mode = "",
  recordId = "",
  now = new Date(),
} = {}) => [
  {
    $set: {
      form_drafts: createActiveDraftsExpression({
        now,
        exclude: createDraftIdentityExpression({ userId, mode, recordId }),
      }),
    },
  },
];

module.exports = {
  FORM_DRAFT_TTL_MS,
  buildFormDraftCleanupPipeline,
  buildFormDraftDeletePipeline,
  buildFormDraftUpsertPipeline,
  formDraftSchema,
  cleanupExpiredFormDrafts,
  deleteFormDraft,
  findFormDraft,
  getDraftUserId,
  normalizeDraftMode,
  normalizeDraftRecordId,
  serializeFormDraft,
  upsertFormDraft,
};
