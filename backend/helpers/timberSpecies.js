const fail = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const id = value => String(value?._id ?? value ?? "");
function composition(value) {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw fail("COMPOSITION_INVALID", "Species composition must be an array"); } }
  if (!Array.isArray(value) || value.length > 100) throw fail("COMPOSITION_INVALID", "Choose species whose percentages total 100%");
  if (!value.length) return [];
  const rows = value.map(row => ({ species: id(row?.species).toLowerCase(), share_bp: row?.share_bp }));
  if (rows.some(r => !/^[a-f\d]{24}$/i.test(r.species) || !Number.isInteger(r.share_bp) || r.share_bp < 1 || r.share_bp > 10000) || new Set(rows.map(r => r.species)).size !== rows.length || rows.reduce((s,r) => s+r.share_bp,0) !== 10000) throw fail("COMPOSITION_INVALID", "Species must be unique and percentages must total exactly 100%");
  return rows.sort((a,b) => a.species.localeCompare(b.species));
}
function hsCode(value) {
  const raw=String(value??"").trim(), digits=raw.replace(/[ .]/g,"");
  if(raw && (!/^\d+(?:[ .]\d+)*$/.test(raw)||!/^\d{4,8}$/.test(digits)))throw fail("HS_CODE_INVALID","HS code requires 4–8 digits with single spaces or dots");
  return digits;
}
const metadataFields = mongoose => ({ hs_code:String, timber_volume_input:{value:String,unit:{type:String,enum:["cft","m3"]}}, species_composition:{type:[{species:{type:mongoose.Schema.Types.ObjectId,ref:"WoodSpecies"},share_bp:{type:Number,min:1,max:10000,validate:Number.isInteger}}],default:undefined}, timber_cft_history:{type:[{from:Number,to:Number,at:Date,by:{type:mongoose.Schema.Types.ObjectId,ref:"users"}}],default:undefined} });
async function applyMetadata(record, payload, user, beforeCft) {
  if (Object.hasOwn(payload, "finished_wood_volume")) {
    if (Object.hasOwn(payload, "timber_cft")) throw fail("WOOD_VOLUME_INVALID", "Supply one finished wood volume input");
    let input = payload.finished_wood_volume;
    if (typeof input === "string") { try { input = JSON.parse(input); } catch { throw fail("WOOD_VOLUME_INVALID", "Invalid finished wood volume input"); } }
    const parsed = require("./woodVolume").volumeInput(input);
    record.timber_cft = parsed.cft;
    record.timber_volume_input = parsed.input;
  } else if (Object.hasOwn(payload, "timber_cft")) {
    const parsed = require("./woodVolume").volumeInput({ value: payload.timber_cft, unit: "cft" });
    record.timber_cft = parsed.cft;
    record.timber_volume_input = parsed.input;
  }
  if(Object.hasOwn(payload,"hs_code"))record.hs_code=hsCode(payload.hs_code);
  if(Object.hasOwn(payload,"species_composition")) {
    const rows=composition(payload.species_composition);
    const previous = new Set((record.species_composition || []).map(row => id(row.species)));
    const added = rows.filter(row => !previous.has(row.species));
    if (added.length && await require("../models/woodSpecies.model").countDocuments({ _id: { $in: added.map(row => row.species) }, active: true }) !== added.length) throw fail("COMPOSITION_INVALID", "Choose active recorded wood species");
    record.species_composition=rows;
  }
  if (record.timber_cft === 0 && record.species_composition?.length) throw fail("COMPOSITION_INVALID", "Products with no wood volume must have an empty composition");
  if(beforeCft!==record.timber_cft){if(!record.timber_cft_history)record.timber_cft_history=[];record.timber_cft_history.push({from:beforeCft??null,to:record.timber_cft??null,at:new Date(),by:user?._id||user?.id});}
}
module.exports={composition,hsCode,metadataFields,applyMetadata};
