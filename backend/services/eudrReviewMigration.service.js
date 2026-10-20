const mongoose=require("mongoose");
const R=require("../models/eudrReview.model"),M=require("../models/eudrInventory.model");
const {fail,id,composition,hsCode}=require("../helpers/timberSpecies");
async function report() {
  const Item=require("../models/item.model"),Sample=require("../models/sample.model");
  const missing={items:await Item.find({$or:[{hs_code:{$in:[null,""]}},{"species_composition.0":{$exists:false}}]}).select("code hs_code species_composition").limit(2000).lean(),samples:await Sample.find({$or:[{hs_code:{$in:[null,""]}},{"species_composition.0":{$exists:false}}]}).select("code hs_code species_composition").limit(2000).lean(),lots:await M.Lot.countDocuments({species:null}),sources:await M.SourceBatch.countDocuments({species:null}),invoice_lines:await M.Invoice.countDocuments({lines:{$elemMatch:{$or:[{species:null},{species:{$type:"string"}}]}}})};
  const knownSpecies=new Set((await R.Species.find({}).select("_id").lean()).map(id));
  const invalid_metadata=[];
  for(const Model of [Item,Sample])for await(const record of Model.find({$or:[{"species_composition.0":{$exists:true}},{hs_code:{$nin:[null,""]}}]}).select("code hs_code species_composition").cursor()){try{if(record.species_composition?.length){const rows=composition(record.species_composition);if(rows.some(r=>!knownSpecies.has(r.species)))throw fail("SPECIES_MISMATCH","Composition references an unrecorded species");}if(record.hs_code)hsCode(record.hs_code);}catch(e){invalid_metadata.push({collection:Model.collection.name,id:id(record),code:record.code,error:e.message});}}
  for(const Model of [M.Lot,M.SourceBatch,M.Transfer])for await(const record of Model.find({species:{$ne:null}}).select("species").cursor())if(!knownSpecies.has(id(record.species)))invalid_metadata.push({collection:Model.collection.name,id:id(record),error:"Unrecorded species reference"});
  const ownership=new Map(),conflicts=[];
  const sources=await M.SourceBatch.find({}).select("identity_key production_reference_key production_documents documents").lean();
  for(const source of sources){const reference=source.production_reference_key||source.identity_key.split("|species:")[0];const docs=await M.Document.find({_id:{$in:source.documents},purpose:{$in:["production","correction"]}}).select("_id").lean();for(const docId of [...(source.production_documents||[]),...docs.map(d=>d._id)]){const key=id(docId),prior=ownership.get(key);if(prior&&prior.reference!==reference)conflicts.push({document:key,references:[prior.reference,reference]});else if(prior)prior.sources.add(id(source));else ownership.set(key,{reference,sources:new Set([id(source)])});}}
  return {missing,invalid_metadata,conflicts,proofs:[...ownership].map(([document,p])=>({document,production_reference_key:p.reference,sources:[...p.sources]})),state:await M.State.findById("global").lean()};
}
function validateSeed(seed) {
  if(!seed||!Array.isArray(seed.species)||!Number.isInteger(seed.exporter_wastage_bp)||seed.exporter_wastage_bp<0||seed.exporter_wastage_bp>9999)throw fail("INVALID_SEED","Seed requires species[] and exporter_wastage_bp (0–9999)");
  for(const sp of seed.species)if(!String(sp.name||"").trim()||!String(sp.scientific_name||"").trim()||!Number.isInteger(sp.max_yield_bp)||sp.max_yield_bp<1||sp.max_yield_bp>10000)throw fail("INVALID_SEED","Every operator-supplied species requires name, scientific_name and max_yield_bp");
  if(new Set(seed.species.map(s=>s.name.trim().toLowerCase())).size!==seed.species.length)throw fail("INVALID_SEED","Species names must be unique");
  return seed;
}
async function apply(seed,{rollback=false}={}) {
  if(rollback){const shared=await R.Proof.exists({"sources.1":{$exists:true}});if(shared)throw fail("ROLLBACK_UNSAFE","Species roots already share proof; retain ownership registry and use forward recovery",409);await M.SourceBatch.collection.createIndex({production_documents:1},{name:"production_documents_1",unique:true,sparse:true});await M.State.updateOne({_id:"global"},{$set:{production_proof_index_transitioned:false,review_layer_ready:false}});return {rollback:true,history_retained:true};}
  validateSeed(seed);const preview=await report();if(preview.conflicts.length)throw fail("PROOF_OWNERSHIP_CONFLICT","Resolve production-proof ownership conflicts before migration",409);
  for(const model of Object.values(R)){await model.createCollection();await model.createIndexes();}
  const I=require("./eudrInventory.service");
  await I.withInventory({name:"Review migration operator"},async(session,state)=>{
    for(const sp of seed.species){const existing=await R.Species.findOne({name:sp.name.trim()}).collation({locale:"en",strength:2}).session(session);if(existing){if(existing.scientific_name!==sp.scientific_name||existing.max_yield_bp!==sp.max_yield_bp)throw fail("SEED_CONFLICT","Existing species differs; use an audited Rules change",409);}else await R.Species.create([{...sp,name:sp.name.trim()}],{session});}
    const existing=await R.Rules.findById("global").session(session);if(existing&&existing.exporter_wastage_bp!==seed.exporter_wastage_bp)throw fail("SEED_CONFLICT","Existing wastage differs; use Rules",409);if(!existing)await R.Rules.create([{_id:"global",exporter_wastage_bp:seed.exporter_wastage_bp}],{session});
    for(const proof of preview.proofs){const prior=await R.Proof.findById(proof.document).session(session);if(prior&&prior.production_reference_key!==proof.production_reference_key)throw fail("PROOF_OWNERSHIP_CONFLICT","Permanent proof ownership conflicts",409);await R.Proof.updateOne({_id:proof.document},{$setOnInsert:{production_reference_key:proof.production_reference_key},$addToSet:{sources:{$each:proof.sources}}},{session,upsert:true});}
    for(const model of [M.Lot,M.SourceBatch,M.Transfer])await model.updateMany({species:{$exists:false}},{$set:{species:null}},{session});
    const invoices=await M.Invoice.find({}).session(session);for(const invoice of invoices){let changed=false;for(const line of invoice.lines){if(typeof line.species==="string"&&!(mongoose.isValidObjectId(line.species)&&await R.Species.exists({_id:line.species}).session(session))){line.legacy_species=line.species;line.species=null;changed=true;}else if(typeof line.species==="string"){line.species=new mongoose.Types.ObjectId(line.species);changed=true;}else if(line.species===undefined){line.species=null;changed=true;}}if(changed)await invoice.save({session});}
    await I.audit(session,{name:"Review migration operator"},"review_layer_migrated","state",undefined,state.revision,{details:{seed_species:seed.species.map(s=>s.name),proof_count:preview.proofs.length}});
  },{preparation:true});
  const indexes=await M.SourceBatch.collection.indexes();const old=indexes.find(i=>i.name==="production_documents_1");
  if(old&&(!old.unique||!old.sparse||Object.keys(old.key).length!==1||old.key.production_documents!==1))throw fail("INDEX_REVIEW_REQUIRED","Unexpected production proof index; no index was dropped",409);
  if(old)await M.SourceBatch.collection.dropIndex(old.name);
  await M.State.updateOne({_id:"global"},{$set:{production_proof_index_transitioned:true,review_layer_ready:true}});
  return {...await report(),applied:true};
}
async function validate(){const result=await report();const proofs=await R.Proof.find({}).lean();const missing=result.proofs.filter(p=>!proofs.some(r=>id(r)===p.document&&r.production_reference_key===p.production_reference_key&&p.sources.every(s=>r.sources.some(x=>id(x)===s))));const indexes=await M.SourceBatch.collection.indexes();return {...result,missing_proof_ownership:missing,valid:!result.invalid_metadata.length&&!result.conflicts.length&&!missing.length&&Boolean(result.state?.review_layer_ready)&&!indexes.some(i=>i.unique&&i.key.production_documents===1)};}
module.exports={report,validateSeed,apply,validate};
