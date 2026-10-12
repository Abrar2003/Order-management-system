const { isDeepStrictEqual } = require("node:util");
const mongoose = require("mongoose");

mongoose.set("autoIndex", false);

const path = require("node:path");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const LabelTransaction = require("../models/labelTransaction.model");

const LEGACY_KEY_INDEX_NAME = "migration.legacy_inspector_1_migration.legacy_key_1";
const LEGACY_KEY_INDEX = {
  "migration.legacy_inspector": 1,
  "migration.legacy_key": 1,
};
const LEGACY_KEY_INDEX_OPTIONS = {
  name: LEGACY_KEY_INDEX_NAME,
  unique: true,
  partialFilterExpression: {
    "migration.legacy_inspector": { $type: "objectId" },
    "migration.legacy_key": { $gt: "" },
  },
};

const hasExpectedLegacyKeyIndex = (index) =>
  index?.unique === true &&
  isDeepStrictEqual(index.key, LEGACY_KEY_INDEX) &&
  isDeepStrictEqual(
    index.partialFilterExpression,
    LEGACY_KEY_INDEX_OPTIONS.partialFilterExpression,
  );

const repairLegacyKeyIndex = async (collection) => {
  const indexes = await collection.indexes();
  const existing = indexes.find((index) => index.name === LEGACY_KEY_INDEX_NAME);

  if (hasExpectedLegacyKeyIndex(existing)) return false;
  if (existing) await collection.dropIndex(LEGACY_KEY_INDEX_NAME);
  await collection.createIndex(LEGACY_KEY_INDEX, LEGACY_KEY_INDEX_OPTIONS);
  return true;
};

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
    preserveExistingEnv: true,
  });
  await connectDB();
  const changed = await repairLegacyKeyIndex(LabelTransaction.collection);
  console.log(changed ? "Rebuilt label transaction legacy-key index." : "Label transaction legacy-key index is already correct.");
  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}

module.exports = {
  __test__: {
    LEGACY_KEY_INDEX,
    LEGACY_KEY_INDEX_NAME,
    LEGACY_KEY_INDEX_OPTIONS,
    repairLegacyKeyIndex,
  },
};
