import assert from "node:assert/strict";
import test from "node:test";
import { ITEM_DISCUSSION_TOPICS, getDiscussionFileError, mergeDiscussionReplies, loadDiscussionThread } from "./itemDiscussions.js";
import { isStrictAdminRole } from "../auth/permissions.js";

test("discussion deletion controls are limited to admins and super admins", () => {
  for (const role of ["admin", "super admin", "super_admin"]) assert.equal(isStrictAdminRole(role), true);
  for (const role of ["QC", "manager", "product manager", "inspection manager", "viewer", "user", "dev"]) assert.equal(isStrictAdminRole(role), false);
});

test("exactly three item topics and supported attachment types", () => {
  assert.deepEqual(ITEM_DISCUSSION_TOPICS.map((topic) => topic.key), ["autocad", "shipping_marks", "finish"]);
  for (const extension of ["PDF", "jpg", "jpeg", "png", "webp", "mp4", "mov", "mkv", "xls", "xlsx"]) {
    assert.equal(getDiscussionFileError([{ name: `file.${extension}`, size: 20 }]), "");
  }
});
test("attachment limits reject bad formats, empty files, oversized files and batches", () => {
  for (const files of [[{ name: "a.exe", size: 5 }], [{ name: "a.pdf", size: 0 }], [{ name: "a.mp4", size: 51 * 1024 * 1024 }], Array(11).fill({ name: "a.pdf", size: 1 }), Array(3).fill({ name: "a.pdf", size: 50 * 1024 * 1024 })]) {
    assert.ok(getDiscussionFileError(files));
  }
});
test("loading earlier replies merges overlaps without duplicating messages", () => {
  assert.deepEqual(mergeDiscussionReplies([{ _id: "01", text: "first" }, { _id: "02", text: "old" }], [{ _id: "02", text: "fresh" }, { _id: "03", text: "last" }]), [
    { _id: "01", text: "first" }, { _id: "02", text: "fresh" }, { _id: "03", text: "last" },
  ]);
});

test("live reconciliation preserves loaded history and refreshes old deletions across missed pages", async () => {
  const pages = [
    { root: { _id: "01" }, replies: [{ _id: "06" }, { _id: "07" }], before: "06" },
    { root: { _id: "01" }, replies: [{ _id: "04" }, { _id: "05" }], before: "04" },
    { root: { _id: "01", deleted_at: "now" }, replies: [{ _id: "02", deleted_at: "now" }, { _id: "03" }], before: null },
  ];
  const cursors = [];
  const result = await loadDiscussionThread(async (cursor) => { cursors.push(cursor); return pages.shift(); }, "", "02", () => true);
  assert.deepEqual(cursors, ["", "06", "04"]);
  assert.deepEqual(result.replies.map((message) => message._id), ["02", "03", "04", "05", "06", "07"]);
  assert.equal(result.root.deleted_at, "now"); assert.equal(result.replies[0].deleted_at, "now");
});

test("superseded live requests stop fetching older pages", async () => {
  let count = 0;
  await loadDiscussionThread(async () => { count++; return { replies: [{ _id: "06" }], before: "06" }; }, "", "02", () => false);
  assert.equal(count, 1);
});
