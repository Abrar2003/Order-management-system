const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const buildInfo = require("../config/buildInfo");

const markerPath = path.resolve(__dirname, "..", ".deploy-commit-sha");
const originalMarker = fs.existsSync(markerPath)
  ? fs.readFileSync(markerPath)
  : null;
const originalAppCommit = process.env.APP_COMMIT_SHA;
const originalGitCommit = process.env.GIT_COMMIT_SHA;

test.afterEach(() => {
  if (originalAppCommit === undefined) {
    delete process.env.APP_COMMIT_SHA;
  } else {
    process.env.APP_COMMIT_SHA = originalAppCommit;
  }

  if (originalGitCommit === undefined) {
    delete process.env.GIT_COMMIT_SHA;
  } else {
    process.env.GIT_COMMIT_SHA = originalGitCommit;
  }

  if (originalMarker === null) {
    fs.rmSync(markerPath, { force: true });
  } else {
    fs.writeFileSync(markerPath, originalMarker);
  }
});

test("APP_COMMIT_SHA has first priority when valid", () => {
  process.env.APP_COMMIT_SHA = "a".repeat(40);
  process.env.GIT_COMMIT_SHA = "b".repeat(40);

  assert.equal(buildInfo.getAppCommitSha(), "a".repeat(40));
  assert.equal(buildInfo.getCommitSource(), "APP_COMMIT_SHA");
});

test("invalid APP_COMMIT_SHA does not mask a valid GIT_COMMIT_SHA", () => {
  process.env.APP_COMMIT_SHA = "unknown";
  process.env.GIT_COMMIT_SHA = "c".repeat(40);

  assert.equal(buildInfo.getAppCommitSha(), "c".repeat(40));
  assert.equal(buildInfo.getCommitSource(), "GIT_COMMIT_SHA");
});

test("deployment marker is used when environment SHAs are unavailable", () => {
  process.env.APP_COMMIT_SHA = "unknown";
  process.env.GIT_COMMIT_SHA = "not-a-sha";
  fs.writeFileSync(markerPath, `${"d".repeat(40)}\n`);

  assert.equal(buildInfo.getAppCommitSha(), "d".repeat(40));
  assert.equal(buildInfo.getCommitSource(), "deployment marker");
});
