const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  getDefaultPermissionsForRole,
  sanitizePermissionsForRole,
} = require("../helpers/permissions");
const { requireNonViewer } = require("../middlewares/permission.middleware");

test("viewer permissions are read-only even when a mutation is requested", () => {
  const defaults = getDefaultPermissionsForRole("viewer");
  assert.equal(defaults.orders.view, true);
  assert.equal(defaults.orders.edit, false);
  assert.equal(defaults.images_documents.upload, false);
  assert.equal(defaults.pis.view, false);

  const requested = Object.fromEntries(
    PERMISSION_MODULES.map(({ key }) => [
      key,
      Object.fromEntries(PERMISSION_ACTIONS.map((action) => [action, true])),
    ]),
  );
  const sanitized = sanitizePermissionsForRole("viewer", requested);

  PERMISSION_MODULES.forEach(({ key }) => {
    PERMISSION_ACTIONS.filter((action) => action !== "view").forEach((action) => {
      assert.equal(sanitized[key][action], false, `${key}.${action}`);
    });
  });
  assert.equal(sanitized.pis.view, false);
});

test("viewer is rejected from restricted item-detail endpoints", () => {
  let statusCode;
  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: () => {},
  };

  requireNonViewer({ user: { role: "viewer" } }, res, () => {
    throw new Error("viewer must not continue");
  });

  assert.equal(statusCode, 403);
});
