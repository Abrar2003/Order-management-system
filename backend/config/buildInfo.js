const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEPLOY_COMMIT_FILE = path.resolve(__dirname, "..", ".deploy-commit-sha");
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const normalizeCommitSha = (value) => {
  const normalized = String(value || "").trim();
  if (normalized.toLowerCase() === "unknown") return "";
  return /^[0-9a-f]{7,64}$/i.test(normalized) ? normalized : "";
};

const resolveCommitInfo = () => {
  const appEnvCommit = normalizeCommitSha(process.env.APP_COMMIT_SHA);
  if (appEnvCommit) {
    return { sha: appEnvCommit, source: "APP_COMMIT_SHA" };
  }

  const gitEnvCommit = normalizeCommitSha(process.env.GIT_COMMIT_SHA);
  if (gitEnvCommit) {
    return { sha: gitEnvCommit, source: "GIT_COMMIT_SHA" };
  }

  try {
    const markerCommit = normalizeCommitSha(
      fs.readFileSync(DEPLOY_COMMIT_FILE, "utf8"),
    );
    if (markerCommit) {
      return { sha: markerCommit, source: "deployment marker" };
    }
  } catch {
    // Continue to the Git CLI fallback.
  }

  try {
    const gitCommit = normalizeCommitSha(
      execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: SAFE_PATH,
        },
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    if (gitCommit) {
      return { sha: gitCommit, source: "git CLI" };
    }
  } catch {
    // All supported commit sources have failed.
  }

  return { sha: "unknown", source: "unavailable" };
};

const getAppCommitSha = () => resolveCommitInfo().sha;
const getCommitSource = () => resolveCommitInfo().source;
const getBuildInfo = () => resolveCommitInfo();

module.exports = {
  getAppCommitSha,
  getBuildInfo,
  getCommitSource,
};
