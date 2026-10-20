// Requires an explicit URI and mode; dry-run/validate disable automatic collection/index writes.
const mongoose = require("mongoose");
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
const migration = require("../services/eudrInventoryMigration.service");
const I = require("../services/eudrInventory.service");
const Chain = require("../models/eudrChain.model");
const argument = name => { const index=process.argv.indexOf("--"+name),value=index>=0?process.argv[index+1]:undefined;return value&&!value.startsWith("--")?value:undefined; };
async function main() {
  const uri=argument("uri"),mode=argument("mode") || "dry-run";
  if(!uri?.trim())throw Object.assign(new Error("Missing --uri value. In PowerShell, set $operatorUri to your MongoDB connection string before running this command."),{code:"MONGODB_URI_REQUIRED"});
  if(!/^mongodb(?:\+srv)?:\/\//.test(uri))throw Object.assign(new Error("Invalid --uri value. Supply a connection string beginning with mongodb:// or mongodb+srv://. The URI was not logged and no connection was attempted."),{code:"MONGODB_URI_INVALID"});
  if (!uri || !["dry-run","apply","validate","transition-index","enable-allocations","disable-allocations","rollback-index","review-layer-dry-run","review-layer-apply","review-layer-validate"].includes(mode)) throw new Error("Usage: node scripts/eudrInventoryMigration.js --uri <mongodb-uri> --mode dry-run|apply|validate|transition-index|enable-allocations|disable-allocations|rollback-index|review-layer-dry-run|review-layer-apply|review-layer-validate [--seed-file operator.json]");
  await mongoose.connect(uri,{autoIndex:false,autoCreate:false});
  try {
    let result;
    if(mode.startsWith("review-layer-")){const review=require("../services/eudrReviewMigration.service");if(mode==="review-layer-dry-run")result=await review.report();if(mode==="review-layer-validate"){result=await review.validate();if(!result.valid)process.exitCode=2;}if(mode==="review-layer-apply"){const file=argument("seed-file"),rollback=process.argv.includes("--rollback-proof-index");if(!file&&!rollback)throw new Error("Review apply requires --seed-file <operator-json>");const seed=file?JSON.parse(require("node:fs").readFileSync(file,"utf8")):undefined;result=await review.apply(seed,{rollback});}}
    if (mode==="dry-run") result=await migration.report();
    if (mode==="apply") result=await migration.migrate();
    if (mode==="transition-index") result=await migration.transitionIndex();
    if (mode==="validate") {
      const report=await migration.report(),state=await I.M.State.findById("global").lean();
      const missing=await Chain.countDocuments({"invoice_keys.0":{$exists:true},"canonical_invoices.0":{$exists:false}});
      const unverifiedCapacity=await I.M.Lot.countDocuments({status:"COMMITTED","verification.status":{$ne:"VERIFIED"}});
      const badLegacy=await I.M.Transfer.countDocuments({legacy:true,status:"COMMITTED","verification.status":{$ne:"VERIFIED"}});
      const conflicts=[];
      const cursor=I.M.Lot.find({status:{$in:[...I.Q.ACTIVE]}}).select("_id").cursor(),seen=new Set();
      for await (const lot of cursor) {
        if(seen.has(String(lot._id)))continue;
        const graph=await I.component([lot._id]);graph.lots.forEach(l=>seen.add(String(l._id)));
        try{const r=I.Q.reconcile(graph);if(!r.feasible)conflicts.push({lot:lot._id,result:r});}catch(e){conflicts.push({lot:lot._id,code:e.code,message:e.message});}
      }
      result={...report,state,missing_canonical_links:missing,unverified_capacity:unverifiedCapacity,unsupported_legacy_capacity:badLegacy,quantity_conflicts:conflicts,valid:!report.conflicts.length&&!missing&&!unverifiedCapacity&&!badLegacy&&!conflicts.length};
      if(!result.valid)process.exitCode=2;
    }
    if (mode==="enable-allocations"||mode==="disable-allocations") {
      result=await I.withInventory({},async(session,state)=>{
        if(mode==="enable-allocations"&&(!state.registry_ready||!state.invoice_index_transitioned))throw new Error("Complete migration, validation and the invoice index transition first");
        await I.M.State.updateOne({_id:"global"},{$set:{allocation_enabled:mode==="enable-allocations"}},{session});
        await I.audit(session,{},"rollout_changed","state",undefined,state.revision,{details:{allocation_enabled:mode==="enable-allocations"}});
        return {allocation_enabled:mode==="enable-allocations"};
      });
    }
    if(mode==="rollback-index"){
      if(await I.M.Commitment.exists({status:{$in:[...I.Q.ACTIVE]}}))throw new Error("Active inventory commitments exist; application rollback requires ledger-aware readers");
      if(await I.M.Lot.exists({status:{$in:[...I.Q.ACTIVE]}}))throw new Error("Active documentary entitlements exist; reverse them before restoring chain-only writes");
      const duplicates=await Chain.aggregate([{$unwind:"$invoice_keys"},{$group:{_id:"$invoice_keys",count:{$sum:1}}},{$match:{count:{$gt:1}}},{$limit:1}]);
      if(duplicates.length)throw new Error("Legitimate cross-chain reuse exists; old uniqueness cannot be restored. Keep the canonical registry and use forward recovery.");
      await Chain.collection.createIndex({invoice_keys:1},{unique:true,sparse:true,name:"invoice_keys_1"});
      await I.M.State.updateOne({_id:"global"},{$set:{allocation_enabled:false,invoice_index_transitioned:false,inventory_enforced:false}});
      result={invoice_index_restored:true,inventory_history_retained:true};
    }
    console.log(JSON.stringify(mode.startsWith("review-layer-")?result:I.publicRecord(result),null,2));
  } finally {await mongoose.disconnect();}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({code:e.code||"MIGRATION_FAILED",message:e.message,details:I.publicRecord(e.details)}));process.exitCode=1;});
module.exports={main};
