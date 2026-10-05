import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductTypePayload,
  applyLegacyComponentMaterialMigration,
  createProductTypeFormState,
  getLegacyComponentMaterialMigration,
  getProductTypeTemplateForEdit,
  getProductTypeValidationErrorMessages,
  getUnresolvedLegacyComponentMaterials,
  isTemplateFieldVisible,
  sortTemplateFormFields,
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

test("editing legacy records selects the newest active definition for the same product type", () => {
  for (const key of ["table", "cabinet"]) {
    const v3 = { key, version: 3, status: "active", groups: [] };
    const v2 = { key, version: 2, status: "inactive" };
    const templates = [
      { key: "other", version: 9, status: "active" },
      { key, version: 5, status: "draft" },
      v3,
      { key, version: 4, status: "inactive" },
      { key, version: 1, status: "inactive" },
      v2,
    ];

    for (const version of [undefined, 0, 1, 2, "2", 3]) {
      assert.equal(getProductTypeTemplateForEdit(templates, key.toUpperCase(), version), v3);
      assert.equal(getProductTypeTemplateForEdit([v3], key, version), v3);
    }
    assert.equal(getProductTypeTemplateForEdit([v2], key, 2), v2);
    assert.equal(getProductTypeTemplateForEdit([v3], key, 4), null);
    assert.equal(getProductTypeTemplateForEdit(templates, "", 2), null);
    assert.equal(getProductTypeTemplateForEdit(templates, "missing", 2), null);
    assert.equal(getProductTypeTemplateForEdit([], key, 2), null);
  }
});

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

test("storage details remain hidden until a matching storage type is selected", () => {
  const drawerField = {
    validation: { visible_when: { storage_enabled: [true], storage_type: ["Drawer", "Both"] } },
  };
  const shelfField = {
    validation: { visible_when: { storage_enabled: [true], storage_type: ["Shelf", "Both"] } },
  };
  const generalField = {
    validation: { visible_when: { storage_enabled: [true], storage_type: ["Drawer", "Shelf", "Both"] } },
  };

  assert.equal(isTemplateFieldVisible(drawerField, { storage_enabled: true }), false);
  assert.equal(isTemplateFieldVisible(drawerField, { storage_enabled: true, storage_type: "Shelf" }), false);
  assert.equal(isTemplateFieldVisible(drawerField, { storage_enabled: true, storage_type: "Drawer" }), true);
  assert.equal(isTemplateFieldVisible(shelfField, { storage_enabled: true, storage_type: "Drawer" }), false);
  assert.equal(isTemplateFieldVisible(shelfField, { storage_enabled: true, storage_type: "Both" }), true);
  assert.equal(isTemplateFieldVisible(generalField, { storage_enabled: true }), false);
  assert.equal(isTemplateFieldVisible(generalField, { storage_enabled: true, storage_type: "Shelf" }), true);
});

test("disabled storage and hardware fields save as N/A", () => {
  const sectionTemplate = {
    ...template,
    groups: [
      {
        key: "storage",
        label: "Storage",
        fields: [
          { key: "storage_enabled", label: "Storage", input_type: "boolean", value_type: "boolean" },
          { key: "drawer_count", label: "Drawers", input_type: "number", value_type: "number", validation: { visible_when: { storage_enabled: [true] } } },
        ],
      },
      {
        key: "hardware",
        label: "Hardware",
        fields: [
          { key: "hardware_enabled", label: "Hardware", input_type: "boolean", value_type: "boolean" },
          { key: "allen_bolts", label: "Allen Bolts", input_type: "boolean", value_type: "boolean", validation: { visible_when: { hardware_enabled: [true] } } },
        ],
      },
    ],
  };
  const fields = buildProductTypePayload({
    template: sectionTemplate,
    selectedProductTypeKey: "cabinet",
    formState: { fieldValues: { storage_enabled: false, hardware_enabled: false } },
  }).product_specs.fields;

  assert.deepEqual(
    Object.fromEntries(fields.map((entry) => [
      entry.key,
      entry.value_type === "boolean" ? entry.value_boolean : entry.value_text,
    ])),
    { storage_enabled: false, drawer_count: "N/A", hardware_enabled: false, allen_bolts: "N/A" },
  );
});

test("form fields place booleans last without disturbing the other field order", () => {
  assert.deepEqual(
    sortTemplateFormFields([
      { key: "first", input_type: "text" },
      { key: "top_material_enabled", input_type: "boolean" },
      { key: "enabled", input_type: "boolean" },
      { key: "second", input_type: "select" },
      { key: "visible", input_type: "boolean" },
    ]).map((field) => field.key),
    ["top_material_enabled", "first", "second", "enabled", "visible"],
  );
});

test("a newer template keeps matching v1 values and fills its defaults", () => {
  const form = createProductTypeFormState({
    item: {
      product_type: { key: "table", version: 1 },
      product_specs: {
        fields: [
          { field_id: "v1-material", key: "material", value_type: "string", value_text: "Oak" },
          { key: "legacy_only", value_type: "string", value_text: "Old value" },
        ],
      },
    },
    template: {
      key: "table",
      version: 2,
      groups: [{
        key: "details",
        fields: [
          { _id: "v2-material", key: "material", input_type: "text", value_type: "string" },
          { key: "new_finish", input_type: "text", value_type: "string", default_value: "Natural" },
        ],
      }],
    },
  });

  assert.deepEqual(form.fieldValues, { material: "Oak", new_finish: "Natural" });
});

test("existing component material turns on a newly added material switch", () => {
  const form = createProductTypeFormState({
    item: {
      product_specs: { fields: [
        { key: "top_material_type", input_type: "select", value_type: "string", value_text: "Wood" },
        { key: "top_wood_type", input_type: "text", value_type: "string", value_text: "Oak" },
      ] },
    },
    template: {
      groups: [{ key: "top", fields: [
        { key: "top_material_enabled", input_type: "boolean", value_type: "boolean", default_value: false },
        { key: "top_material_type", input_type: "select", value_type: "string" },
      ] }],
    },
  });

  assert.equal(form.fieldValues.top_material_enabled, true);
});

test("validation messages name the component containing each missing field", () => {
  assert.deepEqual(
    getProductTypeValidationErrorMessages({
      template: {
        groups: [{
          key: "top",
          label: "Top",
          fields: [{ key: "top_wood_type", label: "Type of Wood", input_type: "text" }],
        }],
      },
      errors: {
        fields: { top_wood_type: "Type of Wood is required" },
        item_sizes: {},
        box_sizes: {},
      },
    }),
    ["Top: Type of Wood is required"],
  );
});

test("Product Database validation skips template size fields it does not render", () => {
  const templateWithRequiredBox = {
    key: "table",
    groups: [{
      key: "sizes",
      label: "Sizes",
      fields: [{ key: "packing_box_1", label: "Packing Box 1", input_type: "box_size", required: true }],
    }],
  };

  assert.equal(
    validateProductTypeFormState({
      template: templateWithRequiredBox,
      selectedProductTypeKey: "table",
      formState: { boxSizeValues: {} },
      includeSizeFields: false,
    }).valid,
    true,
  );
});

test("v1 and v2 materials migrate for review without writing a type until chosen", () => {
  const item = {
    product_type: { key: "table", version: 2 },
    product_specs: {
      fields: [
        { key: "material_top", value_type: "string", value_text: "Oak" },
        { key: "backing_material", value_type: "string", value_text: "Plywood" },
        { key: "material_leg", value_type: "string", value_text: "Steel" },
        { key: "top_color", value_type: "string", value_text: "Walnut" },
        { key: "wood_pattern", value_type: "string", value_text: "Chevron" },
        { key: "leg_shape", value_type: "string", value_text: "Tapered" },
        { key: "number_of_legs", value_type: "number", value_number: 4 },
        { key: "material_1", value_type: "string", value_text: "Legacy one" },
      ],
    },
  };
  const migration = getLegacyComponentMaterialMigration({
    item,
    template: { key: "table", version: 3 },
  });
  const form = applyLegacyComponentMaterialMigration(
    createProductTypeFormState({
      item,
      template: {
        key: "table",
        version: 3,
        groups: [{ key: "top", fields: [
          { key: "wood_pattern", input_type: "text", value_type: "string" },
          { key: "leg_shape", input_type: "text", value_type: "string" },
          { key: "number_of_legs", input_type: "number", value_type: "number" },
        ] }],
      },
    }),
    migration,
  );

  assert.deepEqual(migration.components, { top: "Oak", top_backing: "Plywood", legs: "Steel" });
  assert.deepEqual(migration.legacyReview, [{ key: "material_1", label: "Material 1", value: "Legacy one" }]);
  assert.equal(form.fieldValues.top_material_type, undefined);
  assert.equal(form.fieldValues.top_material_enabled, true);
  assert.equal(form.fieldValues.top_backing_material_enabled, true);
  assert.equal(form.fieldValues.top_has_color, true);
  assert.equal(form.fieldValues.top_color_name, "Walnut");
  assert.deepEqual(
    [form.fieldValues.wood_pattern, form.fieldValues.leg_shape, form.fieldValues.number_of_legs],
    ["Chevron", "Tapered", 4],
  );
  assert.deepEqual(getUnresolvedLegacyComponentMaterials(migration, form.fieldValues), [
    ["top", "Oak"],
    ["top_backing", "Plywood"],
    ["legs", "Steel"],
  ]);
  assert.deepEqual(
    getUnresolvedLegacyComponentMaterials(migration, {
      ...form.fieldValues,
      top_material_enabled: false,
    }),
    [["top_backing", "Plywood"], ["legs", "Steel"]],
  );

  assert.deepEqual(
    getLegacyComponentMaterialMigration({
      item: {
        product_type: { key: "cabinet", version: 1 },
        product_specs: { fields: [
          { key: "material_cabinet", value_text: "MDF" },
          { key: "color_cabinet", value_text: "White" },
        ] },
      },
      template: { key: "cabinet", version: 3 },
    }),
    {
      components: { body: "MDF" },
      colors: { body: "White" },
      legacyReview: [],
    },
  );
});
