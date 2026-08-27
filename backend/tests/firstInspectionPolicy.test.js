const assert = require("node:assert/strict");
const test = require("node:test");

const QC = require("../models/qc.model");
const {
  __test__: {
    buildFirstInspectionAlignmentPolicy,
    getFirstInspectionAssignmentError,
  },
} = require("../controllers/qc.controller");

const ALLOWED_ID = "507f1f77bcf86cd799439011";
const OTHER_ID = "507f1f77bcf86cd799439012";
const NON_QC_ID = "507f1f77bcf86cd799439013";
const qcUsers = [
  { _id: ALLOWED_ID, name: "Allowed QC", role: "QC" },
  { _id: OTHER_ID, name: "Other QC", role: "QC" },
  { _id: NON_QC_ID, name: "Manager", role: "manager" },
];

test("first inspections keep only configured QC users", () => {
  const policy = buildFirstInspectionAlignmentPolicy({
    hasPassedQuantity: false,
    qcUsers,
    allowedUserIds: ` ${ALLOWED_ID.toUpperCase()},invalid,${ALLOWED_ID} `,
  });

  assert.equal(policy.first_inspection, true);
  assert.equal(policy.can_align, true);
  assert.deepEqual(policy.inspectors.map((user) => String(user._id)), [ALLOWED_ID]);
  assert.equal(policy.message, "");
});

test("first inspections fail closed without a valid configured QC user", () => {
  const policy = buildFirstInspectionAlignmentPolicy({
    hasPassedQuantity: false,
    qcUsers,
    allowedUserIds: `invalid,${NON_QC_ID}`,
  });

  assert.equal(policy.first_inspection, true);
  assert.equal(policy.can_align, false);
  assert.deepEqual(policy.inspectors, []);
  assert.match(policy.message, /first_inspection_allowed_users/);
});

test("passed items allow every QC user", () => {
  const policy = buildFirstInspectionAlignmentPolicy({
    hasPassedQuantity: true,
    qcUsers,
    allowedUserIds: "",
  });

  assert.equal(policy.first_inspection, false);
  assert.equal(policy.can_align, true);
  assert.deepEqual(
    policy.inspectors.map((user) => String(user._id)),
    [ALLOWED_ID, OTHER_ID],
  );
});

test("assignment enforcement rejects missing configuration and tampered users", () => {
  const unavailablePolicy = buildFirstInspectionAlignmentPolicy({
    hasPassedQuantity: false,
    qcUsers,
    allowedUserIds: "",
  });
  assert.deepEqual(
    getFirstInspectionAssignmentError(unavailablePolicy, ALLOWED_ID),
    {
      status: 503,
      code: "FIRST_INSPECTION_ALLOWLIST_NOT_CONFIGURED",
      message: unavailablePolicy.message,
    },
  );

  const restrictedPolicy = buildFirstInspectionAlignmentPolicy({
    hasPassedQuantity: false,
    qcUsers,
    allowedUserIds: ALLOWED_ID,
  });
  assert.equal(
    getFirstInspectionAssignmentError(restrictedPolicy, ALLOWED_ID),
    null,
  );
  assert.equal(
    getFirstInspectionAssignmentError(restrictedPolicy, OTHER_ID)?.status,
    403,
  );
});

test("request history defaults existing and ordinary requests to non-first-time", () => {
  const requestSchema = QC.schema.path("request_history").schema;
  assert.equal(requestSchema.path("is_first_inspection").defaultValue, false);
});
