const mongoose = require("mongoose");
const { DISCUSSION_TOPICS, MAX_DISCUSSION_TEXT } = require("../helpers/itemDiscussions");

// The fixed (item, topic) pair is the thread; users cannot create additional threads.
const schema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: "items", required: true },
  topic: { type: String, enum: Object.keys(DISCUSSION_TOPICS), required: true },
  text: { type: String, trim: true, maxlength: MAX_DISCUSSION_TEXT, default: "" },
  author: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
    name: { type: String, required: true },
  },
  client_message_id: { type: String, required: true },
  deleted_at: { type: Date, default: null },
  deleted_by: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    name: { type: String, default: "" },
  },
  attachments: [{
    name: { type: String, required: true }, content_type: { type: String, required: true },
    size: { type: Number, required: true }, key: { type: String, required: true },
  }],
}, { timestamps: { createdAt: "created_at", updatedAt: false }, collection: "item_discussion_messages" });

schema.index({ item: 1, topic: 1, _id: -1 });
schema.index({ item: 1, topic: 1, "author.user": 1, client_message_id: 1 }, { unique: true });
module.exports = mongoose.model("item_discussion_messages", schema);
