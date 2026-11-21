# PIMS table export

Product Database → **Export PIMS** downloads an `.xlsx` workbook with one row per
Table product, including Coffee Tables. It uses the current search, brand, vendor,
type, subtype, status and completion filters across all pages. Existing Product
Database export permissions and data access restrictions apply. Export XLS stays unchanged.

The 20 columns follow the supplied PIMS list in order. Colors and materials are
comma-separated, deduplicated values across components. Package sizes use
`L x W x H`; package weights use gross weight. Values retain the stored units
(OMS size inputs use cm and weights use kg); no unit conversion occurs.
Blank values remain blank. Numbered box remarks keep their colli slots even when
one is missing; other box remarks use their saved order. PIMS has three colli slots.

Article Name falls back to the existing product name and description. Finish falls
back to coating/treatment and enabled brush/sandblasting/sealer values. Maintenance
Instruction is a boolean and is never exported as maintenance text. Leg Clearance
From Floor is not assumed to mean underside height. Underside height and leg
distance are exported only for the Dining Table subtype.

To add the five optional PIMS fields to active Table templates, run from `backend/`:

```sh
npm run update:pims-template-fields
```

This adds Article Name, Season, Finish, Maintenance Text and Height to Underside of
Tabletop in a PIMS group. It does not rename, overwrite, remove or backfill existing
fields or products. Repeated runs do not duplicate fields. New seeded Table
templates also include these fields. Refresh the Product Database after setup.
Existing products need the new values entered before those values can export.

The supplied image specifies headings, but no PIMS import specification was
provided. File type, units and package-size syntax must be validated with PIMS
before relying on automated imports.
