import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductTypePayload,
  isTemplateFieldVisible,
  validateProductTypeFormState,
} from "./productTypeTemplates.js";

const template = {
  _id: "cabinet-template",
  key: "cabinet",
  label: "Cabinet",
  version: 2,
  groups: [
    {
      key: "hardware",
      label: "Hardware",
      fields: [
        { key: "hinges_type", label: "Hinges Type", input_type: "select", value_type: "string", options: ["Butt Hinge", "Cupboard Hinge"] },
        { key: "hinge_mounting_type", label: "Hinge Mounting Type", input_type: "select", value_type: "string", options: ["Clip On", "Normal"], validation: { visible_when: { hinges_type: ["Cupboard Hinge"] } } },
        { key: "hinge_sub_type", label: "Hinge Sub Type", input_type: "select", value_type: "string", options: ["Self Closing", "Normal"], validation: { visible_when: { hinges_type: ["Cupboard Hinge"], hinge_mounting_type: ["Clip On", "Normal"] } } },
      ],
    },
  ],
};

const payloadKeys = (fieldValues) =>
  buildProductTypePayload({
    template,
    selectedProductTypeKey: "cabinet",
    formState: { fieldValues },
  }).product_specs.fields.map((field) => field.key);

test("conditional template fields are visible and saved only when their parents match", () => {
  const mountingField = template.groups[0].fields[1];
  const subtypeField = template.groups[0].fields[2];

  assert.equal(isTemplateFieldVisible(mountingField, { hinges_type: "Butt Hinge" }), false);
  assert.equal(isTemplateFieldVisible(mountingField, { hinges_type: "Cupboard Hinge" }), true);
  assert.equal(isTemplateFieldVisible(subtypeField, { hinges_type: "Cupboard Hinge" }), false);
  assert.equal(
    isTemplateFieldVisible(subtypeField, {
      hinges_type: "Cupboard Hinge",
      hinge_mounting_type: "Clip On",
    }),
    true,
  );

  const staleChildren = {
    hinges_type: "Butt Hinge",
    hinge_mounting_type: "Clip On",
    hinge_sub_type: "Self Closing",
  };
  assert.deepEqual(payloadKeys(staleChildren), ["hinges_type"]);
  assert.deepEqual(
    payloadKeys({
      hinges_type: "Cupboard Hinge",
      hinge_sub_type: "Self Closing",
    }),
    ["hinges_type"],
  );
  assert.equal(
    validateProductTypeFormState({
      template,
      selectedProductTypeKey: "cabinet",
      formState: { fieldValues: staleChildren },
    }).valid,
    true,
  );
  assert.deepEqual(
    payloadKeys({
      hinges_type: "Cupboard Hinge",
      hinge_mounting_type: "Normal",
      hinge_sub_type: "Normal",
    }),
    ["hinges_type", "hinge_mounting_type", "hinge_sub_type"],
  );
});
