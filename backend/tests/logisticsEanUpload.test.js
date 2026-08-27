const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");

test("Logistics EAN uploads use the shared item-file flow for K/D items", () => {
  const controller = fs.readFileSync(
    path.join(repoRoot, "backend", "controllers", "item.controller.js"),
    "utf8",
  );
  const itemFiles = fs.readFileSync(
    path.join(repoRoot, "client", "OMS", "src", "constants", "itemFiles.js"),
    "utf8",
  );

  assert.match(controller, /logistics_ean:\s*\{[\s\S]*?field: "logistics_ean"[\s\S]*?requiresKd: true/);
  assert.match(controller, /\(!fileConfig\?\.requiresKd \|\| item\?\.kd === true\)/);
  assert.match(controller, /\["assembly_file", "logistics_ean"\]\.includes\(normalizedFileType\)/);
  assert.match(itemFiles, /value: "logistics_ean"[\s\S]*?field: "logistics_ean"[\s\S]*?requiresKd: true/);
  assert.match(itemFiles, /resolvedOption\.requiresKd && item\?\.kd !== true/);
});
