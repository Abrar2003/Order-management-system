const {enabled,fail,id}=require("../helpers/timberSpecies");
const R=require("../models/eudrReview.model");
const {normalizeIdentifier}=require("../helpers/timberCft");
async function species(value,session) {
  if(!enabled()&&!/^[a-f\d]{24}$/i.test(id(value)))return undefined;
  if(!/^[a-f\d]{24}$/i.test(id(value))||!await R.Species.exists({_id:value}).session(session))throw fail("SPECIES_MISMATCH","Choose a recorded species");
  return id(value);
}
async function origins(rows,session) {
  if(!Array.isArray(rows)||rows.length>100)throw fail("INVALID_ORIGINS","Provide at most 100 origins");
  return Promise.all(rows.map(async row=>{
    if(!row.plot_ref)return row;
    if(!/^[a-f\d]{24}$/i.test(id(row.plot_ref)))throw fail("INVALID_PLOT","Choose an existing plot");
    const plot=await R.Plot.findById(row.plot_ref).session(session).lean();
    if(!plot)throw fail("INVALID_PLOT","Choose an existing plot");
    return {...row,plot:id(plot),latitude:plot.coords[0][0],longitude:plot.coords[0][1]};
  }));
}
async function claimProofs(source,docs,session) {
  const I=require("./eudrInventory.service");
  const reference=source.production_reference_key||source.identity_key;
  for(const doc of docs.filter(d=>["production","correction"].includes(d.purpose))) {
    const prior=await R.Proof.findById(doc._id).session(session);
    if(prior&&prior.production_reference_key!==reference)throw fail("SOURCE_EVIDENCE_REUSED","Production proof permanently belongs to a different production reference",409);
    await R.Proof.updateOne({_id:doc._id},{$setOnInsert:{production_reference_key:reference},$addToSet:{sources:source._id}},{upsert:true,session});
  }
  if(await I.M.SourceBatch.exists({_id:{$ne:source._id},identity_key:reference,status:{$nin:["CANCELLED","SUPERSEDED","REJECTED"]}}).session(session))throw fail("LEGACY_PRODUCTION_REVIEW_REQUIRED","Reconcile the unsplit legacy production source before recording species roots",409);
}
async function transport(value,invoice,session,except) {
  if(!value)return undefined;
  const out={};
  for(const key of ["eway_bill_no","bilty_no","vehicle_no","driver_licence_no"])if(value[key])out[key]=normalizeIdentifier(value[key]).slice(0,100);
  if(value.net_kg!=null){out.net_kg=Number(value.net_kg);if(!Number.isFinite(out.net_kg)||out.net_kg<0)throw fail("INVALID_TRANSPORT","Net kg must be non-negative");}
  if(out.eway_bill_no){
    if(!/^\d{12}$/.test(out.eway_bill_no))throw fail("INVALID_TRANSPORT","E-way bill number requires 12 digits");
    const {M}=require("./eudrInventory.service");
    if(await M.Transfer.exists({_id:{$ne:except},"transport.eway_bill_no":out.eway_bill_no,invoice:{$ne:invoice}}).session(session))throw fail("EWAY_INVOICE_CONFLICT","E-way bill already belongs to a different canonical invoice",409);
  }
  return out;
}
async function validateRecord(record,type,session) {
  if(!enabled())return;
  const {M}=require("./eudrInventory.service"),sp=await species(record.species,session);
  const selected=await M.Lot.find({_id:{$in:(record.inputs||[]).map(i=>i.lot)}}).session(session).lean();
  if(selected.some(l=>id(l.species)!==sp))throw fail("SPECIES_MISMATCH","Inputs must match the record species");
  if(type==="transfers"&&record.invoice){const invoice=await M.Invoice.findById(record.invoice).session(session).lean();if(id(invoice?.lines.find(l=>l.line_id===record.line_id)?.species)!==sp)throw fail("SPECIES_MISMATCH","Transfer species must match the canonical invoice line");}
  if(record.output_lot){const dependent=await M.Transfer.find({"inputs.lot":record.output_lot,status:{$nin:["CANCELLED","SUPERSEDED","REJECTED"]}}).session(session).lean();const commitments=await M.Commitment.find({"inputs.lot":record.output_lot,status:{$nin:["CANCELLED","SUPERSEDED","REJECTED"]}}).session(session).lean();if(dependent.some(t=>id(t.species)!==sp)||commitments.some(c=>(c.species_allocations||[]).some(a=>a.inputs.some(i=>id(i.lot)===id(record.output_lot))&&id(a.species)!==sp)))throw fail("SPECIES_MISMATCH","Species changes must preserve every dependent transfer and commitment");}
}
async function allocations(body,rows,quantity,session) {
  const I=require("./eudrInventory.service"),lots=await I.M.Lot.find({_id:{$in:rows.map(r=>r.lot)}}).session(session).lean();
  const all=new Map(lots.map(l=>[id(l),l]));
  let out;
  if(body.species_allocations?.length)out=body.species_allocations.map(r=>({species:r.species,quantity_milli:I.cft(r.quantity_cft),mode:r.mode||body.mode||"EXACT",inputs:I.inputs(r.inputs)}));
  else {
    if((body.mode||"EXACT")!=="EXACT"||rows.some(r=>r.exact_milli==null))throw fail("SPECIES_ALLOCATION_REQUIRED","Record a quantity and inputs for each species when contributions are uncertain");
    const grouped=new Map();
    for(const row of rows){const sp=id(all.get(id(row.lot))?.species);if(!sp)throw fail("SPECIES_MISMATCH","Unspecified lots cannot feed a new review allocation");if(!grouped.has(sp))grouped.set(sp,{species:sp,quantity_milli:0,mode:"EXACT",inputs:[]});const g=grouped.get(sp);g.quantity_milli=I.Q.sum([g.quantity_milli,row.exact_milli]);g.inputs.push(row);}
    out=[...grouped.values()];
  }
  if(new Set(out.map(r=>id(r.species))).size!==out.length||I.Q.sum(out.map(r=>r.quantity_milli))!==quantity)throw fail("SPECIES_MISMATCH","Species allocations must be distinct and sum to the contribution");
  for(const row of out){row.species=await species(row.species,session);if(row.inputs.some(i=>id(all.get(id(i.lot))?.species)!==row.species))throw fail("SPECIES_MISMATCH","Each species allocation must use only matching finished lots");}
  return out;
}
module.exports={species,origins,claimProofs,transport,allocations,validateRecord};
