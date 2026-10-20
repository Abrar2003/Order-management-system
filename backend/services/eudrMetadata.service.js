const mongoose=require("mongoose");
const {enabled,applyMetadata,fail}=require("../helpers/timberSpecies");
async function save(record,user,before={}) {
  if(!enabled())return record.save();
  const {State,Audit}=require("../models/eudrInventory.model");
  return mongoose.connection.transaction(async session=>{
    const state=await State.findOneAndUpdate({_id:"global",review_layer_ready:true},{$inc:{revision:1}},{new:true,session});
    if(!state)throw fail("REVIEW_MIGRATION_REQUIRED","Apply the review migration before saving review metadata",503);
    const fields=["timber_cft","timber_cft_history","hs_code","species_composition","pis_item_sizes","item_sizes"];
    const snapshot=value=>Object.fromEntries(fields.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
    if(!record.isNew){const current=await record.constructor.findById(record._id).select(fields.join(" ")).session(session);const digest=require("./eudrInventory.service").digest;if(!current||digest(snapshot(current.toObject()))!==digest(snapshot(before)))throw fail("METADATA_STALE_REVISION","Item/Sample review data changed; reload before saving",409);}
    await record.save({session});
    await Audit.create([{event:"item_review_metadata_changed",entity_type:record.constructor.modelName,entity:record._id,actor:user?._id||user?.id,actor_name:user?.name,revision:state.revision,before:snapshot(before),after:snapshot(record.toObject())}],{session});
    return record;
  });
}
module.exports={save,applyMetadata};
