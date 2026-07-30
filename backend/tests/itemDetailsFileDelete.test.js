const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");

test("item detail file deletes target the selected storage key", () => {
  const controller = fs.readFileSync(
    path.join(repoRoot, "backend", "controllers", "item.controller.js"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(repoRoot, "client", "OMS", "src", "pages", "ItemDetails.jsx"),
    "utf8",
  );

  assert.match(controller, /req\.query\?\.file_key/);
  assert.match(controller, /file\.key !== fileKey/);
  assert.match(page, /params: \{ file_key: fileKey \}/);
  assert.match(page, /"Delete File"/);
});
