const assert = require("node:assert/strict");
const test = require("node:test");

const { __test__ } = require("../routers/eudr.routes");

test("EUDR access is limited to admins and managers", () => {
  assert.equal(__test__.isEudrRoleAllowed("admin"), true);
  assert.equal(__test__.isEudrRoleAllowed("super admin"), true);
  assert.equal(__test__.isEudrRoleAllowed("manager"), true);
  assert.equal(__test__.isEudrRoleAllowed("product manager"), false);
  assert.equal(__test__.isEudrRoleAllowed("inspection manager"), false);
});
