const mongoose=require("mongoose");
const {enabled,fail}=require("../helpers/timberSpecies");

// Source inserts must also take the ledger lock: document fences cannot cover new shipment rows.
async function locked(session,operation) {
  const run=async transaction=>{
    const {State}=require("../models/eudrInventory.model");
    if(!await State.findOneAndUpdate({_id:"global",review_layer_ready:true},{$inc:{revision:1}},{session:transaction}))throw fail("REVIEW_MIGRATION_REQUIRED","Apply and validate the review migration before source-data writes",503);
    return operation(transaction);
  };
  return session?.inTransaction()?run(session):mongoose.connection.transaction(run,{readConcern:{level:"snapshot"},writeConcern:{w:"majority"}});
}
function install(Model) {
  if(Model.$eudrSourceWrites)return Model;
  Model.$eudrSourceWrites=true;
  const save=Model.prototype.save,exec=Model.Query.prototype.exec;
  Model.prototype.save=function(options={}){return enabled()?locked(options.session||this.$session(),session=>save.call(this,{...options,session})):save.call(this,options);};
  Model.Query.prototype.exec=function(...args){
    if(!enabled()||!["updateOne","updateMany","replaceOne","findOneAndUpdate","findOneAndReplace","deleteOne","deleteMany","findOneAndDelete"].includes(this.op))return exec.apply(this,args);
    return locked(this.getOptions().session,session=>exec.apply(this.clone().session(session),args));
  };
  for(const method of ["insertMany","bulkWrite"]){const original=Model[method];Model[method]=function(records,options={}){return enabled()?locked(options.session,session=>original.call(this,records,{...options,session})):original.call(this,records,options);};}
  return Model;
}
module.exports={install};
