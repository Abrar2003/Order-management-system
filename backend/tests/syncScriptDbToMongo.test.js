const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertSafeSync,
  buildDumpArgs,
  buildRestoreArgs,
  parseMongoTarget,
} = require("../scripts/syncScriptDbToMongo");

test("database sync hides credentials, blocks the same database, and remaps names", () => {
  const source = parseMongoTarget(
    "mongodb+srv://source-user:source-password@source.example/ScriptDb?retryWrites=true",
    "MONGO_URI_SCRIPT"
  );
  const destination = parseMongoTarget(
    "mongodb://target-user:target-password@target.example:27017/OMS?authSource=admin",
    "MONGO_URI"
  );

  assert.equal(source.identity, "mongodb+srv://source.example/ScriptDb");
  assert.equal(source.identity.includes("source-password"), false);
  assert.deepEqual(buildDumpArgs(source, "dump.gz"), [
    "--uri=mongodb+srv://source-user:source-password@source.example/ScriptDb?retryWrites=true",
    "--archive=dump.gz",
    "--gzip",
  ]);
  assert.deepEqual(buildRestoreArgs(source, destination, "dump.gz").slice(-2), [
    "--nsFrom=ScriptDb.*",
    "--nsTo=OMS.*",
  ]);
  assert.equal(
    buildRestoreArgs(source, destination, "dump.gz")[0],
    "--uri=mongodb://target-user:target-password@target.example:27017/?authSource=admin"
  );
  assert.throws(
    () =>
      assertSafeSync(
        source,
        parseMongoTarget(
          "mongodb+srv://different:credentials@source.example/ScriptDb",
          "MONGO_URI"
        )
      ),
    /same database/
  );
});
