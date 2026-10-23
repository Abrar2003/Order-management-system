const { applyMetadata } = require("./timberSpecies");

const badRequest = message => Object.assign(new Error(message), { statusCode: 400 });

function eudrNeeded(value) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw badRequest("EUDR needed must be a checkbox value");
  return value;
}

function requireShipmentWoodMetadata(record) {
  if (!(record.timber_cft > 0) || !record.hs_code || !record.species_composition?.length) {
    throw badRequest("CFT per item, wood type and HSN are required when EUDR is needed");
  }
}

async function applyShipmentWoodMetadata(record, payload, user) {
  if (!eudrNeeded(payload.eudr_needed)) return;
  const metadata = {};
  for (const field of ["finished_wood_volume", "timber_cft", "hs_code", "species_composition"]) {
    if (Object.hasOwn(payload, field)) metadata[field] = payload[field];
  }
  await applyMetadata(record, metadata, user, record.timber_cft);
  requireShipmentWoodMetadata(record);
}

module.exports = { eudrNeeded, requireShipmentWoodMetadata, applyShipmentWoodMetadata };
