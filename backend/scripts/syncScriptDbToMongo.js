const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvFiles } = require("../config/loadEnv");

const HELP = `Sync MONGO_URI_SCRIPT (source) into MONGO_URI (destination).

Usage:
  npm run sync:script-db             Validate only; changes nothing
  npm run sync:script-db -- --apply  Dump the source and restore the destination

The destination collections included in the dump are replaced with mongorestore --drop.
Stop application writes before applying the sync.`;

function parseMongoTarget(uri, envName) {
  const value = String(uri || "").trim();
  const match = /^(mongodb(?:\+srv)?):\/\/([^/]+)\/([^?#]+)(\?.*)?$/i.exec(value);
  if (!match) {
    throw new Error(`${envName} must be a MongoDB URI containing a database name`);
  }

  const host = match[2].slice(match[2].lastIndexOf("@") + 1).toLowerCase();
  let database;
  try {
    database = decodeURIComponent(match[3]);
  } catch {
    throw new Error(`${envName} contains an invalid encoded database name`);
  }

  if (!host || !database.trim()) {
    throw new Error(`${envName} must contain a host and database name`);
  }

  const protocol = match[1].toLowerCase();
  return {
    uri: value,
    serverUri: `${protocol}://${match[2]}/${match[4] || ""}`,
    host,
    database,
    identity: `${protocol}://${host}/${database}`,
  };
}

function assertSafeSync(source, destination) {
  if (`${source.host}/${source.database}`.toLowerCase() === `${destination.host}/${destination.database}`.toLowerCase()) {
    throw new Error("MONGO_URI_SCRIPT and MONGO_URI resolve to the same database; sync cancelled");
  }

  if (["admin", "config", "local"].includes(destination.database.toLowerCase())) {
    throw new Error(`Refusing to restore into MongoDB system database '${destination.database}'`);
  }
}

function buildDumpArgs(source, archivePath) {
  return [`--uri=${source.uri}`, `--archive=${archivePath}`, "--gzip"];
}

function buildRestoreArgs(source, destination, archivePath) {
  const args = [
    `--uri=${destination.serverUri}`,
    `--archive=${archivePath}`,
    "--gzip",
    "--drop",
    "--stopOnError",
  ];

  if (source.database !== destination.database) {
    args.push(`--nsFrom=${source.database}.*`, `--nsTo=${destination.database}.*`);
  }
  return args;
}

function requireTool(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} is required. Install MongoDB Database Tools and add it to PATH`);
  }
}

function runTool(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function removeTempDirectory(tempDirectory) {
  const resolvedTemp = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(tempDirectory);
  if (
    path.dirname(resolvedDirectory) !== resolvedTemp ||
    !path.basename(resolvedDirectory).startsWith("oms-script-db-sync-")
  ) {
    throw new Error("Refusing to remove an unexpected temporary directory");
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log(HELP);
    return;
  }

  const unknownArgs = args.filter((arg) => arg !== "--apply");
  if (unknownArgs.length) throw new Error(`Unknown argument: ${unknownArgs.join(", ")}`);

  loadEnvFiles({ cwd: path.resolve(__dirname, ".."), preserveExistingEnv: true });
  const source = parseMongoTarget(process.env.MONGO_URI_SCRIPT, "MONGO_URI_SCRIPT");
  const destination = parseMongoTarget(process.env.MONGO_URI, "MONGO_URI");
  assertSafeSync(source, destination);

  console.log(`[sync] Source:      ${source.identity}`);
  console.log(`[sync] Destination: ${destination.identity}`);

  if (!args.includes("--apply")) {
    console.log("[sync] Validation passed. No data changed. Re-run with --apply to sync.");
    return;
  }

  requireTool("mongodump");
  requireTool("mongorestore");

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "oms-script-db-sync-"));
  const archivePath = path.join(tempDirectory, "script-db.archive.gz");

  try {
    console.log("[sync] Downloading source database into a temporary compressed archive...");
    runTool("mongodump", buildDumpArgs(source, archivePath));
    if (!fs.existsSync(archivePath) || fs.statSync(archivePath).size === 0) {
      throw new Error("mongodump completed without creating a usable archive");
    }

    console.log("[sync] Restoring archive into the destination database...");
    runTool("mongorestore", buildRestoreArgs(source, destination, archivePath));
    console.log("[sync] Sync completed successfully.");
  } finally {
    removeTempDirectory(tempDirectory);
    console.log("[sync] Temporary archive removed.");
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[sync] Failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { assertSafeSync, buildDumpArgs, buildRestoreArgs, parseMongoTarget };
