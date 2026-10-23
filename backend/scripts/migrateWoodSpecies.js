// Explicit, non-destructive migration: preserve existing IDs and never copy EUDR wastage.
const mongoose = require("mongoose");
const Species = require("../models/woodSpecies.model");
async function migrate(db, apply = false) {
  const rows = await db.collection("eudr_species").find({}, { projection: { _id: 1, name: 1, scientific_name: 1, active: 1, createdAt: 1, updatedAt: 1 } }).toArray();
  const seenNames = new Set(), seenScientific = new Set(), prepared = [], importedAt = new Date();
  for (const row of rows) {
    const doc = new Species(row);
    const error = doc.validateSync();
    if (error) throw new Error("Legacy species need complete common and scientific names before migration");
    for (const [field, seen] of [["name", seenNames], ["scientific_name", seenScientific]]) {
      const key = doc[field].toLocaleLowerCase("en");
      if (seen.has(key)) throw new Error("Duplicate legacy species identities require manual review; no species were migrated");
      seen.add(key);
      const conflict = await Species.findOne({ [field]: doc[field], _id: { $ne: row._id } }).collation({ locale: "en", strength: 2 }).lean();
      if (conflict) throw new Error("Existing OMS species identity conflicts with a legacy ID; no species were migrated");
    }
    prepared.push({ _id: row._id, name: doc.name, scientific_name: doc.scientific_name, active: doc.active,
      createdAt: row.createdAt || importedAt, updatedAt: row.updatedAt || importedAt });
  }
  if (apply) {
    await Species.createCollection(); await Species.createIndexes();
    for (const row of prepared) await Species.updateOne({ _id: row._id }, { $setOnInsert: row }, { upsert: true, runValidators: true, timestamps: false });
  }
  return { species: rows.length, applied: apply };
}
if (require.main === module) (async () => {
  if (!process.env.OMS_SPECIES_MIGRATION_URI) throw new Error("Set OMS_SPECIES_MIGRATION_URI explicitly; application env files are not loaded");
  await mongoose.connect(process.env.OMS_SPECIES_MIGRATION_URI, { autoCreate: false, autoIndex: false });
  console.log(await migrate(mongoose.connection.db, process.argv.includes("--apply")));
})().catch(() => { console.error("Species migration failed. Review the source identities privately; no legacy data was deleted."); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = { migrate };
