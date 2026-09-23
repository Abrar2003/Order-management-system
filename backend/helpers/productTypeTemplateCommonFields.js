const normalizeKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const matches = (value, aliases) => aliases.includes(normalizeKey(value));

const findOrCreateGroup = (template, aliases, group) => {
  const groups = Array.isArray(template.groups) ? template.groups : (template.groups = []);
  const matchingGroups = groups.filter((entry) =>
    matches(entry?.key, aliases) || matches(entry?.label, aliases),
  );
  const target = matchingGroups.shift() || { ...group, fields: [] };

  matchingGroups.forEach((entry) => {
    target.fields = [...(target.fields || []), ...(entry.fields || [])];
    groups.splice(groups.indexOf(entry), 1);
  });
  if (!groups.includes(target)) {
    groups.push(target);
    return groups[groups.length - 1];
  }
  Object.assign(target, group, { fields: target.fields || [] });
  return target;
};

const takeField = (template, aliases, targetGroup) => {
  const matchesFound = [];
  (template.groups || []).forEach((group) => {
    (group.fields || []).slice().forEach((field) => {
      if (!matches(field?.key, aliases) && !matches(field?.label, aliases)) return;
      matchesFound.push(field);
      group.fields.splice(group.fields.indexOf(field), 1);
    });
  });

  const field = matchesFound.shift() || {};
  targetGroup.fields.push(field);
  return targetGroup.fields[targetGroup.fields.length - 1];
};

const upsertField = (template, group, aliases, config) => {
  const field = takeField(template, aliases, group);
  Object.assign(field, config);
  return field;
};

const addVisibility = (field, parentKey) => {
  field.validation = {
    ...(field.validation || {}),
    visible_when: {
      ...(field.validation?.visible_when || {}),
      [parentKey]: [true],
    },
  };
};

const addVisibilityOptions = (field, parentKey, values) => {
  field.validation = {
    ...(field.validation || {}),
    visible_when: {
      ...(field.validation?.visible_when || {}),
      [parentKey]: values,
    },
  };
};

const booleanField = (key, label, order, extra = {}) => ({
  key,
  label,
  order,
  input_type: "boolean",
  value_type: "boolean",
  ...extra,
});

const sizeField = (key, label, order, parentKey) => ({
  key,
  label,
  order,
  input_type: "text",
  value_type: "string",
  validation: { visible_when: { hardware_enabled: [true], [parentKey]: [true] } },
});

const applyCommonProductDatabaseFields = (template = {}) => {
  const materials = findOrCreateGroup(template, ["material", "materials"], {
    key: "materials",
    label: "Materials",
    order: 30,
  });
  const tests = findOrCreateGroup(template, ["test", "tests", "tests_usage"], {
    key: "tests",
    label: "Tests",
    order: 50,
  });
  const storage = findOrCreateGroup(template, ["storage"], {
    key: "storage",
    label: "Storage",
    order: 70,
  });
  const hardware = findOrCreateGroup(template, ["hardware"], {
    key: "hardware",
    label: "Hardware",
    order: 80,
  });

  upsertField(template, materials, ["treated"], {
    key: "treated",
    label: "Treated",
    order: 70,
    input_type: "select",
    value_type: "string",
    options: ["Lacquered", "Non Lacquered"],
    validation: {},
  });
  upsertField(template, materials, ["lacquer_type"], {
    key: "lacquer_type",
    label: "Lacquer Type",
    order: 80,
    input_type: "select",
    value_type: "string",
    options: [],
    validation: { visible_when: { treated: ["Lacquered"] } },
  });
  [
    ["sandblasted", "Sandblasted", 90],
    ["wire_brush", "Wire Brush", 100],
    ["sealer", "Sealer", 110],
  ].forEach(([key, label, order]) =>
    upsertField(template, materials, [key], booleanField(key, label, order)),
  );

  [
    ["indoor_outdoor_test", ["indoor_outdoor_test"], "Indoor / Outdoor Test", 10],
    ["coffee_test", ["coffee_test", "coffee"], "Coffee Test", 20],
    ["wine_test", ["wine_test", "wine"], "Wine Test", 30],
    ["mustard_test", ["mustard_test", "mustard"], "Mustard Test", 40],
    ["rust_test", ["rust_test", "rust"], "Rust Test", 50],
    ["nail_scratch_test", ["nail_scratch_test", "nail_scratch"], "Nail Scratch Test", 60],
    ["coke_test", ["coke_test", "coke"], "Coke Test", 70],
  ].forEach(([key, aliases, label, order]) =>
    upsertField(template, tests, aliases, booleanField(key, label, order)),
  );

  upsertField(template, storage, ["storage_enabled", "storage"], booleanField(
    "storage_enabled",
    "Storage",
    0,
  ));
  upsertField(template, storage, ["storage_type"], {
    key: "storage_type",
    label: "Storage Type",
    order: 5,
    input_type: "select",
    value_type: "string",
    required: true,
    options: ["Drawer", "Shelf", "Both"],
    validation: { visible_when: { storage_enabled: [true] } },
  });
  storage.fields.forEach((field) => {
    if (field.key === "storage_enabled") return;
    addVisibility(field, "storage_enabled");
    if (["drawer_count", "drawer_weight_capacity", "handles_on_drawers", "drawer_channels", "extendable"].includes(field.key)) {
      addVisibilityOptions(field, "storage_type", ["Drawer", "Both"]);
    }
    if (["shelf_count", "shelf_load_capacity"].includes(field.key)) {
      addVisibilityOptions(field, "storage_type", ["Shelf", "Both"]);
    }
  });

  upsertField(template, hardware, ["hardware_enabled", "hardware"], booleanField(
    "hardware_enabled",
    "Hardware",
    0,
  ));
  [
    ["allen_bolts", "Allen Bolts", 10],
    ["allen_key", "Allen Key", 30],
    ["washers", "Washers", 50],
    ["spring_washers", "Spring Washers", 70],
    ["adjustable_feet", "Adjustable Feet", 90],
  ].forEach(([key, label, order]) => {
    upsertField(template, hardware, [key], booleanField(key, label, order, {
      validation: { visible_when: { hardware_enabled: [true] } },
    }));
    upsertField(template, hardware, [`${key}_size`], sizeField(
      `${key}_size`,
      `${label} Size`,
      order + 10,
      key,
    ));
  });
  upsertField(template, hardware, ["number_of_levelers", "number_of_levellers"], {
    key: "number_of_levelers",
    label: "Number Of Levelers",
    order: 110,
    input_type: "number",
    value_type: "number",
    validation: { visible_when: { hardware_enabled: [true], adjustable_feet: [true] } },
  });
  hardware.fields.forEach((field) => {
    if (field.key !== "hardware_enabled") addVisibility(field, "hardware_enabled");
  });

  return template;
};

module.exports = { applyCommonProductDatabaseFields };
