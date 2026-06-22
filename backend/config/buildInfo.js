const fs = require("fs");
const path = require("path");

const DEPLOY_COMMIT_FILE = path.resolve(__dirname, "..", ".deploy-commit-sha");

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
    // Ignore error if file does not exist.
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

