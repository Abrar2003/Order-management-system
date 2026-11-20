import assert from "node:assert/strict";
import test from "node:test";
import { ITEM_DISCUSSION_TOPICS, getDiscussionFileError, mergeDiscussionReplies } from "./itemDiscussions.js";
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
