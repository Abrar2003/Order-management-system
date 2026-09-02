const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const Item = require("../models/item.model");
const {
  isConfigured,
  createStorageKey,
  uploadBuffer,
  deleteObject,
} = require("../services/wasabiStorage.service");

const text = (v) => String(v || "").trim();
const codeFrom = (file) =>
  (path.basename(file, path.extname(file)).match(/^(\d+)/) || [])[1] || "";
const mime = (file) =>
  ({
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  })[path.extname(file).toLowerCase()] || "";

function options(args) {
  const value = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? "" : text(args[i + 1]);
  };
  return {
    folder:
      value("--folder") || text(args.find((arg) => !arg.startsWith("--"))),
    mongo: value("--mongo") || "script",
    dryRun: args.includes("--dry-run"),
  };
}

async function files(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(folder, entry.name);
      return entry.isDirectory() ? files(full) : entry.isFile() ? [full] : [];
    }),
  );
  return nested.flat().filter((file) => mime(file));
}

async function main() {
  loadEnvFiles({ cwd: path.resolve(__dirname, "..") });
  const opt = options(process.argv.slice(2));
  if (!opt.folder || !["main", "script"].includes(opt.mongo))
    throw new Error(
      "Usage: node scripts/uploadLogisticsEanToMongo.js --folder <path> --mongo <main|script> [--dry-run]",
    );
  const uri = text(
    process.env[opt.mongo === "script" ? "MONGO_URI_SCRIPT" : "MONGO_URI"],
  );
  console.log(
    `Uploading logistics EAN files from ${opt.folder} to ${opt.mongo} database${opt.dryRun ? " (dry run)" : ""}`,
  );
  if (!uri)
    throw new Error(
      `Missing ${opt.mongo === "script" ? "MONGO_URI_SCRIPT" : "MONGO_URI"} in .env`,
    );
  if (!opt.dryRun && !isConfigured())
    throw new Error("Wasabi storage is not configured");
  await mongoose.connect(uri);
  const list = await files(path.resolve(opt.folder));
  const total = {
    uploaded: 0,
    matched: 0,
    skipped: 0,
    missing: 0,
    invalid: 0,
    failed: 0,
  };
  for (const file of list) {
    const code = codeFrom(file);
    if (!code) {
      total.invalid++;
      console.warn(`[missing-code] ${file}`);
      continue;
    }
    const item = await Item.findOne({
      code: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
    if (!item) {
      total.missing++;
      console.warn(`[missing-item] ${code}`);
      continue;
    }
    total.matched++;
    if (opt.dryRun) {
      console.log(`[matched] ${code}`);
      continue;
    }
    let uploaded;
    try {
      const buffer = await fs.readFile(file);
      uploaded = await uploadBuffer({
        buffer,
        key: createStorageKey({
          folder: "item-logistics-ean",
          originalName: path.basename(file),
        }),
        originalName: path.basename(file),
        contentType: mime(file),
      });
      const oldKey = text(item.logistics_ean?.key);
      item.logistics_ean = uploaded;
      await item.save();
      if (oldKey && oldKey !== uploaded.key)
        deleteObject(oldKey).catch(() => {});
      total.uploaded++;
      console.log(`[uploaded] ${code}`);
    } catch (error) {
      if (uploaded?.key) await deleteObject(uploaded.key).catch(() => {});
      total.failed++;
      console.error(`[failed] ${code}: ${error.message}`);
    }
  }
  console.log(`Upload summary for ${opt.folder}:`, total);
  await mongoose.disconnect();
  if (total.failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
