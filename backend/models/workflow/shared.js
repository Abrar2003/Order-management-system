const mongoose = require("mongoose");

const AuditActorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    name: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const UserReferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
  },
  { _id: false },
);

const SourceFileMetadataSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    relative_path: { type: String, required: true, trim: true },
    folder_path: { type: String, required: true, trim: true },
    extension: { type: String, default: "", trim: true, lowercase: true },
    mime_type: { type: String, default: "", trim: true, lowercase: true },
    size_bytes: { type: Number, default: 0, min: 0 },
    file_type: { type: String, default: "other", trim: true, lowercase: true },
  },
  { _id: false },
);

module.exports = {
  AuditActorSchema,
  SourceFileMetadataSchema,
  UserReferenceSchema,
};
