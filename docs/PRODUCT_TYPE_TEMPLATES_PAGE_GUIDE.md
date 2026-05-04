# Product Type Templates Page Guide

This guide explains how to use the **Product Type Templates** page exactly as it works in the current OMS frontend and backend.

Route:

`/settings/product-type-templates`

Menu path:

`Settings -> Product Type Templates`

Purpose:

This page is used to define reusable product-type schemas such as `table`, `chair`, `cabinet`, `sofa`, and similar product families. A template controls:

- which dynamic fields appear in the Product Database modal
- which groups those fields belong to
- which fields are simple values vs. modular size blocks
- how uploaded sheet headers map into product specs
- which fields are required, searchable, filterable, or visible in tables

The page does **not** upload products by itself. It defines the template structure used by Product Database and import logic.

---

## 1. Who Can Use This Page

Current access behavior:

- `admin` and `manager` can open and read the page if they have `product_type_templates.view`
- only `admin` users with create/edit rights see the management controls
- managers can view templates, but they do not get `Create Template`, `Edit Template`, status update, or archive controls in the current UI

Practical result:

- admins create and maintain templates
- managers can inspect templates and confirm configuration

---

## 2. What You See On The Page

The page has two main columns.

### Left column: template list

This shows all readable templates as separate rows.

Each row shows:

- template label
- template key
- template version
- template status

Important behavior:

- each version appears as its own row
- the first returned template is auto-selected when the page loads
- clicking a row loads that exact key/version combination

### Right column: selected template details

When you select a template, the right side shows:

- label
- key
- version
- description
- status
- number of groups
- all configured groups and fields

For each field, the page shows:

- field label
- field key
- input type
- value type
- required flag, if enabled
- unit, if set
- size remark, if set
- box type, if set
- options, if set
- source headers, if set

### Top action buttons

Visible to everyone with page access:

- `Refresh`

Visible only to admins with template create/edit rights:

- `Create Template`
- `Edit Template`
- `Status` dropdown
- `Archive`

---

## 3. Template Statuses

The page supports these statuses:

- `draft`
- `active`
- `inactive`
- `archived`

What they mean in practice:

- `draft`: still being prepared
- `active`: ready to use
- `inactive`: saved but not currently active
- `archived`: retired, not deleted

Important backend behavior:

- when a template version is saved as `active`, other versions with the same template key are automatically changed to `inactive`
- archive is a status change, not a hard delete

---

## 4. How To Create A New Product Type Template

### Step 1: Open the page

Go to:

`Settings -> Product Type Templates`

### Step 2: Click `Create Template`

This opens the template editor modal.

### Step 3: Fill the template header

You will see these top-level fields:

| Field | What to enter |
|---|---|
| `Key` | Stable technical key, for example `table` or `tv_unit` |
| `Label` | User-facing name, for example `Table` |
| `Version` | Numeric version such as `1`, `2`, `3` |
| `Status` | Usually start with `draft`, later change to `active` |
| `Description` | Short explanation of the template |

Important notes:

- if you type a key with spaces or symbols, the backend normalizes it to lowercase underscore format
- example: `TV Unit` becomes `tv_unit`
- key + version must be unique

Recommended pattern:

- keep the same key for the same product family
- increase version when the schema changes significantly

Example:

| Template | Key | Version |
|---|---|---|
| Table v1 | `table` | `1` |
| Table v2 | `table` | `2` |
| Chair v1 | `chair` | `1` |

---

## 5. How To Add Groups

Groups organize fields into sections shown in Product Database.

### Step 1: Click `Add Group`

Each new group starts with blank values.

### Step 2: Fill the group fields

| Group field | Meaning |
|---|---|
| `Key` | Technical key for the group |
| `Label` | User-visible group title |
| `Order` | Lower number appears first |
| `Active Group` | If unchecked, the group is kept in the template but hidden from dynamic Product Database rendering |
| `Description` | Optional helper text for the section |

Examples:

- `basic_info`
- `sizes`
- `materials`
- `hardware`
- `documents`

Important behavior:

- group order is controlled by the `Order` number
- there is no drag-and-drop reorder right now
- to move a group earlier, give it a smaller order number

### Step 3: Remove a group if needed

Click `Remove Group`.

Important:

- this removes the group from the draft in the editor before save
- once you save, the template is updated with that new structure

---

## 6. How To Add Fields Inside A Group

### Step 1: Click `Add Field`

Each group can contain multiple fields.

### Step 2: Fill the field definition

Every field has these editor controls:

| Field setting | Meaning |
|---|---|
| `Key` | Stable technical field key |
| `Label` | UI label shown in Product Database |
| `Order` | Lower number appears first inside the group |
| `Unit` | Optional display unit like `mm`, `cm`, `kg`, `pcs` |
| `Input Type` | Which UI control is rendered |
| `Value Type` | How the value is stored in `product_specs` |
| `Box Type` | For box-size fields, default box type |
| `Description` | Helper text shown near the field |
| `Options` | For select/multiselect fields |
| `Source Headers` | Excel/import header matches for normal fields |
| `Size Remark` | Remark used to identify a size entry |
| `Default Value` | Optional prefilled value |
| `Validation JSON` | Extra JSON config for parsing or validation |
| `L/B/H/net_weight/gross_weight/item_count_in_inner/box_count_in_master` | Header mapping for modular size fields |
| `Required` | Must be filled before submit |
| `Searchable` | Metadata flag for future/search usage |
| `Filterable` | Metadata flag for future/filter usage |
| `Show In Table` | Metadata flag for list/table display |
| `Active` | Keeps the field usable if checked |

### Step 3: Remove a field if needed

Click `Remove Field`.

Just like groups, this removes it from the draft editor before save.

---

## 7. Input Types And What They Do

These are the input types supported by the current page and dynamic form renderer.

| Input type | What the user sees in Product Database | Typical value type |
|---|---|---|
| `text` | Single-line text input | `string` |
| `textarea` | Multi-line text area | `string` |
| `number` | Numeric input | `number` |
| `boolean` | Switch/checkbox | `boolean` |
| `select` | Single-select dropdown | `string` |
| `multiselect` | Checkbox group | `array` |
| `date` | Date picker | `date` |
| `item_size` | Modular item size card | `array` |
| `box_size` | Modular box size card | `array` |
| `file` | File picker placeholder storing metadata | `object` |

Important:

- `item_size` and `box_size` are the correct way to store dimensional data
- do not model dimensions as loose fields like `width`, `height`, `box_1_length`, and similar schema-specific columns

---

## 8. How To Use `item_size` Fields

Use `item_size` when the field represents one logical measured object.

Examples:

- article size
- table top size
- leg distance
- cushion size

In Product Database, an `item_size` field renders a size card with:

- `L`
- `B`
- `H`
- `Net Weight`
- `Gross Weight`

How it is identified:

- the template uses `size_remark`
- that remark is used to match and save the correct item size entry in `product_specs.item_sizes`

Recommended setup:

| Use case | Field key | Size remark |
|---|---|---|
| Article size | `article_size` | `article` |
| Table top size | `table_top_size` | `table_top` |
| Leg distance | `leg_distance` | `leg_distance` |

Important validation behavior:

- if the size card is completely empty and not required, it is allowed
- if the user starts entering values, `L`, `B`, and `H` become required for that size card
- numeric values must be non-negative

---

## 9. How To Use `box_size` Fields

Use `box_size` when the field represents one packaging or carton measurement block.

Examples:

- box 1
- box 2
- box 3
- inner carton
- master carton

In Product Database, a `box_size` field renders:

- `L`
- `B`
- `H`
- `Net Weight`
- `Gross Weight`
- `Box Type`
- `Item Count In Inner`
- `Box Count In Master`

Supported box types:

- `individual`
- `inner`
- `master`

How it works:

- `size_remark` identifies which logical box this is, for example `box1`
- `box_type` sets the default box type
- if box type is `inner`, `Item Count In Inner` is enabled and required once that size is used
- if box type is `master`, `Box Count In Master` is enabled and required once that size is used

Validation behavior:

- a completely empty box-size card is allowed if the field is not required
- if any box value is entered, `L`, `B`, and `H` are required
- all numeric values must be non-negative
- count fields must be greater than `0` when required by the chosen box type

---

## 10. How To Fill `Options`

Use `Options` only for:

- `select`
- `multiselect`

Format:

- comma-separated text
- example: `Oak, Walnut, Ash`

What happens:

- the page splits options by commas or new lines
- blank entries are ignored

---

## 11. How To Fill `Source Headers`

`Source Headers` is used for normal non-size fields.

Use it when you want imports to map sheet headers into that field.

Format:

- comma-separated or line-separated header names

Example:

`Material, Main Material, Body Material`

What happens:

- import logic tries those headers when mapping uploaded rows into `product_specs.fields`

---

## 12. How To Fill The Size Header Mapping Fields

For `item_size` and `box_size` fields, use the dedicated size header inputs:

- `L`
- `B`
- `H`
- `net_weight`
- `gross_weight`
- `item_count_in_inner`
- `box_count_in_master`

These fields accept:

- comma-separated header names
- line-separated header names

Example for an article size:

| Size mapping field | Example headers |
|---|---|
| `L` | `Length, Article Length` |
| `B` | `Width, Article Width` |
| `H` | `Height, Article Height` |
| `net_weight` | `Weight, Net Weight` |
| `gross_weight` | `Gross Weight` |

Example for a box:

| Size mapping field | Example headers |
|---|---|
| `L` | `Packing Length Box 1` |
| `B` | `Packing Width Box 1` |
| `H` | `Packing Height Box 1` |
| `gross_weight` | `Gross Weight Box 1` |

Important:

- these mappings are not stored as loose schema columns
- they only tell the import logic how to build modular size entries

---

## 13. How To Fill `Default Value`

The editor stores default values as text, then converts them based on field type.

Current behavior:

| Field type | How to write the default value |
|---|---|
| `text`, `textarea`, `select`, `date` | plain text |
| `number` | numeric text, for example `12.5` |
| `boolean` | `true` or `false` |
| `multiselect` | comma-separated values |
| `file` or object-like values | JSON text |

Examples:

- number: `25`
- boolean: `true`
- multiselect: `Indoor, Outdoor`
- file/object: `{"name":"spec-sheet.pdf"}`

Important:

- invalid JSON in object-like defaults will cause save failure

---

## 14. How To Fill `Validation JSON`

`Validation JSON` accepts raw JSON text.

Use it only when you need extra parser or validation hints.

Examples:

### Boolean aliases

```json
{
  "true_values": ["yes", "y", "1"],
  "false_values": ["no", "n", "0"]
}
```

### Multiselect separators

```json
{
  "separators": [",", ";", "|"]
}
```

Important:

- this field must contain valid JSON
- invalid JSON will block saving

---

## 15. How Ordering Works

There is no drag-and-drop sorting right now.

Ordering is controlled manually with numeric `Order` fields.

Rules:

- groups are sorted by group `Order`
- fields are sorted by field `Order`
- if two entries have the same order, label sorting is used as a fallback in backend normalization

Recommended practice:

- use spaced values like `10`, `20`, `30`
- this makes it easier to insert a new item later without renumbering everything

---

## 16. How To Save A Template

When you finish editing:

1. Click `Create Template` for a new template, or `Save Template` for an edit.
2. The frontend converts text inputs into the API payload.
3. The backend validates the full structure.

Common save failures:

- missing template key
- missing template label
- missing group key or label
- missing field key or label
- duplicate group keys
- duplicate field keys anywhere in the template
- invalid `input_type`
- invalid `value_type`
- invalid JSON in `Validation JSON`
- duplicate template `key + version`

Typical backend error:

- `A template with the same key and version already exists`

---

## 17. How To Edit An Existing Template

### Step 1: Select the template version

Click the exact row on the left side.

### Step 2: Click `Edit Template`

This opens the selected version in the editor modal.

### Step 3: Update the configuration

You can change:

- template header fields
- groups
- fields
- order values
- active toggles
- source mapping
- default values
- validation JSON

### Step 4: Save

Click `Save Template`.

Important:

- editing a template updates that same saved version
- the current UI does not provide a dedicated “clone as new version” button
- if you want a true new version, create another template row with the same key and a higher version number

---

## 18. How To Change Template Status

Admins can change status from the template detail panel.

### Status dropdown

Select:

- `draft`
- `active`
- `inactive`
- `archived`

Behavior:

- the change is saved immediately
- if you set one version to `active`, sibling versions of the same key are automatically changed to `inactive`

### Archive button

The `Archive` button:

- asks for confirmation
- changes the selected template status to `archived`
- does not delete the record

---

## 19. How This Affects Product Database

Once a template is active and selected in Product Database:

- groups render in group order
- fields render in field order
- inactive groups and inactive fields are hidden from the dynamic Product Database form
- normal fields save into `product_specs.fields`
- `item_size` fields save into `product_specs.item_sizes`
- `box_size` fields save into `product_specs.box_sizes`

Current dynamic Product Database rendering behavior:

- first two groups open by default
- other groups can be expanded with `Show`
- required fields display inline validation

Important:

- the Product Type Templates page is the configuration page
- Product Database is the data-entry page that uses that configuration

---

## 20. Recommended Workflow For A New Product Type

Use this sequence.

1. Create the template with status `draft`.
2. Add the groups that describe the product family.
3. Add normal fields first.
4. Add `item_size` fields for measured product parts.
5. Add `box_size` fields for packaging.
6. Fill source header mappings if import will be used.
7. Save the template.
8. Reopen and review the selected version on the right side.
9. Test it in Product Database with one sample item.
10. Change status to `active` only after verification.

---

## 21. Recommended Naming Pattern

To keep templates clean, use stable lowercase-style names.

Examples:

| Type | Good example |
|---|---|
| Template key | `table` |
| Group key | `table_details` |
| Field key | `table_shape` |
| Item size remark | `article` |
| Box size remark | `box1` |

Try to keep:

- keys stable across versions
- labels user-friendly
- remarks short and unique

---

## 22. Practical Example: Table Template

A table template might look like this:

### Template header

- Key: `table`
- Label: `Table`
- Version: `1`
- Status: `draft`

### Groups

- `basic_info`
- `sizes`
- `materials`
- `table_details`
- `tests_usage`
- `colors`
- `storage`
- `hardware`
- `documents`

### Example fields

| Group | Field | Input type | Notes |
|---|---|---|---|
| Basic Info | `collection_name` | `text` | plain text |
| Materials | `primary_material` | `select` | uses options |
| Table Details | `extendable` | `boolean` | switch |
| Sizes | `article_size` | `item_size` | remark `article` |
| Sizes | `table_top_size` | `item_size` | remark `table_top` |
| Sizes | `leg_distance` | `item_size` | remark `leg_distance` |
| Sizes | `box1` | `box_size` | remark `box1` |
| Sizes | `box2` | `box_size` | remark `box2` |
| Documents | `care_instructions` | `textarea` | long text |

---

## 23. Troubleshooting

### The page says templates are not available for my access level

Your user does not have the required `product_type_templates.view` access.

### I can open the page but cannot create or edit anything

This is expected for managers in the current UI. Editing controls are admin-only.

### Save fails with duplicate key/version

You are trying to save a template with a `key + version` combination that already exists.

Fix:

- change the version number, or
- edit the existing template row instead

### Save fails with JSON-related errors

Check:

- `Validation JSON`
- object-style `Default Value`

Both must be valid JSON if used that way.

### A size field is not showing correctly in Product Database

Check:

- field `input_type` is `item_size` or `box_size`
- field `is_active` is checked
- parent group `is_active` is checked
- the template version you activated is the one Product Database is using

### A select or multiselect value fails validation

The chosen value must exist in the template `Options` list.

---

## 24. Current Limitations

These are real current limitations of the page:

- no drag-and-drop reordering
- no clone button for “save as new version”
- no search or filter inside the templates page
- no hard delete
- manager users are read-only in the current frontend
- file-type fields only store selected file metadata in product specs; they do not replace the existing dedicated item file upload flows

---

## 25. Summary

Use the Product Type Templates page to define product-type-specific structures before data entry or import.

The simplest way to work safely is:

1. build in `draft`
2. test in Product Database
3. activate the correct version
4. archive old versions instead of deleting them

That keeps the template system predictable while preserving compatibility with the existing OMS item, PIS, QC, and Product Database flows.
