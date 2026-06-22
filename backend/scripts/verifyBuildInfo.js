const { execFileSync } = require("child_process");
const http = require("http");
const path = require("path");

const { getAppCommitSha } = require("../config/buildInfo");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const safePath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

const gitCommit = String(
  execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: safePath },
  }),
).trim();
const helperCommit = getAppCommitSha();

const requestHealth = () =>
  new Promise((resolve, reject) => {
    const request = http.get(
      "http://127.0.0.1:8008/healthz",
      { timeout: 5000 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Invalid /healthz JSON: ${error.message}`));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("/healthz timed out")));
    request.on("error", reject);
  });

const main = async () => {
  const health = await requestHealth();
  const healthCommit = String(health?.commit || "").trim();

  console.log("git:", gitCommit);
  console.log("helper:", helperCommit);
  console.log("healthz:", healthCommit);

  if (gitCommit !== helperCommit || gitCommit !== healthCommit) {
    throw new Error("Build commit verification failed: SHA values do not match");
  }

  console.log("Build commit verification passed.");
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
