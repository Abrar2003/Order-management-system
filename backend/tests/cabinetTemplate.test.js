const assert = require("node:assert/strict");
const test = require("node:test");
const {
  HINGE_FIELDS,
  ensureCabinetHingeFields,
} = require("../scripts/addCabinetSubProductTypeTemplate");

test("Cabinet hinge fields are additive, ordered, and idempotent", () => {
  const template = {
    version: 1,
    groups: [
      {
        _id: "hardware-group-id",
        key: "hardware",
        fields: [
          { _id: "hinges-id", key: "hinges", label: "Hinges", order: 10 },
          { _id: "handles-id", key: "handles_on_door", label: "Handles", order: 20 },
        ],
      },
    ],
  };
  const originalFields = template.groups[0].fields.map((field) => ({ ...field }));

  assert.equal(ensureCabinetHingeFields(template), true);
  assert.deepEqual(
    template.groups[0].fields.slice(0, 4).map((field) => field.key),
    ["hinges", ...HINGE_FIELDS.map((field) => field.key)],
  );
  assert.deepEqual(
    template.groups[0].fields.filter((field) => originalFields.some(({ key }) => key === field.key)),
    originalFields,
  );

  assert.equal(ensureCabinetHingeFields(template), false);
  HINGE_FIELDS.forEach(({ key }) => {
    assert.equal(template.groups[0].fields.filter((field) => field.key === key).length, 1);
  });
});
