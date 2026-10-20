const enabled = () => process.env.EUDR_REVIEW_LAYER === "true";
const fail = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const id = value => String(value?._id ?? value ?? "");
function composition(value) {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw fail("COMPOSITION_INVALID", "Species composition must be an array"); } }
  if (!Array.isArray(value) || !value.length || value.length > 100) throw fail("COMPOSITION_INVALID", "Choose species whose percentages total 100%");
  const rows = value.map(row => ({ species: id(row.species), share_bp: row.share_bp }));
  if (rows.some(r => !/^[a-f\d]{24}$/i.test(r.species) || !Number.isInteger(r.share_bp) || r.share_bp < 1 || r.share_bp > 10000) || new Set(rows.map(r => r.species)).size !== rows.length || rows.reduce((s,r) => s+r.share_bp,0) !== 10000) throw fail("COMPOSITION_INVALID", "Species must be unique and percentages must total exactly 100%");
  return rows.sort((a,b) => a.species.localeCompare(b.species));
}
function splitLineBySpecies(lineMilli, value) {
  if (!Number.isSafeInteger(lineMilli) || lineMilli < 0) throw fail("INVALID_QUANTITY", "Quantity must be a non-negative safe integer");
  const rows = composition(value).map(row => { const n=BigInt(lineMilli)*BigInt(row.share_bp); return { ...row, milli:Number(n/10000n), remainder:Number(n%10000n) }; });
  let remaining = lineMilli-rows.reduce((sum,row)=>sum+row.milli,0);
  [...rows].sort((a,b)=>b.remainder-a.remainder||a.species.localeCompare(b.species)).forEach(row=>{if(remaining>0){row.milli++;remaining--;}});
  return rows.map(({species,milli})=>({species,milli}));
}
function hsCode(value) {
  const raw=String(value??"").trim(), digits=raw.replace(/[ .]/g,"");
  if(raw && (!/^\d+(?:[ .]\d+)*$/.test(raw)||!/^\d{4,8}$/.test(digits)))throw fail("HS_CODE_INVALID","HS code requires 4–8 digits with single spaces or dots");
  return digits;
}
const metadataFields = mongoose => ({ hs_code:String, species_composition:{type:[{species:{type:mongoose.Schema.Types.ObjectId,ref:"EudrSpecies"},share_bp:{type:Number,min:1,max:10000,validate:Number.isInteger}}],default:undefined}, timber_cft_history:{type:[{from:Number,to:Number,at:Date,by:{type:mongoose.Schema.Types.ObjectId,ref:"users"}}],default:undefined} });
async function applyMetadata(record, payload, user, beforeCft) {
  if(!enabled())return;
  if(Object.hasOwn(payload,"hs_code"))record.hs_code=hsCode(payload.hs_code);
  if(Object.hasOwn(payload,"species_composition")) {
    const rows=composition(payload.species_composition);
    const {Species}=require("../models/eudrReview.model");
    if(await Species.countDocuments({_id:{$in:rows.map(r=>r.species)}})!==rows.length)throw fail("COMPOSITION_INVALID","Choose recorded species");
    record.species_composition=rows;
  }
  if(beforeCft!==record.timber_cft){if(!record.timber_cft_history)record.timber_cft_history=[];record.timber_cft_history.push({from:beforeCft??null,to:record.timber_cft??null,at:new Date(),by:user?._id||user?.id});}
}
function netWeight(record, sample=false) {
  const rows=sample?record.item_sizes:record.pis_item_sizes;
  if(!rows?.length||rows.some(r=>!Number.isFinite(r.net_weight)||r.net_weight<=0))return null;
  const total=rows.reduce((sum,r)=>sum+r.net_weight,0);
  return Number.isFinite(total)?total:null;
}
module.exports={enabled,fail,id,composition,splitLineBySpecies,hsCode,metadataFields,applyMetadata,netWeight};
