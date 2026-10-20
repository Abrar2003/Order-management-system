const mongoose=require("mongoose");
const R=require("../models/eudrReview.model");
const review=require("./eudrReview.service");
const {id,splitLineBySpecies,fail}=require("../helpers/timberSpecies");
const HEADERS=["container","vendor","vendor_gstin","vendor_pan","hs_code","product_description","quantity_units","net_mass_kg","volume_m3","scientific_name","common_name","country_of_production","production_places","production_date_from","production_date_to","supply_chain","report_submission_id"];
const CFT_M3_FACTOR=process.env.EUDR_CFT_M3_FACTOR||"0.028316846592";
function volumeM3(milli,factor=CFT_M3_FACTOR) {
  if(!/^0\.\d{1,15}$/.test(factor)||Number(factor)<=0)throw fail("INVALID_CONVERSION_FACTOR","CFT conversion factor must be a positive decimal below one",503);
  const digits=factor.split(".")[1],den=10n**BigInt(digits.length),rounded=(BigInt(milli)*BigInt(digits)+den/2n)/den;
  return Number(rounded)/1000;
}
function csv(lines) {return [HEADERS,...lines.map(row=>HEADERS.map(h=>row[h]??""))].map(row=>row.map(v=>/[",\r\n]/.test(String(v))?`"${String(v).replace(/"/g,'""')}"`:String(v)).join(",")).join("\r\n");}
function geojson(plots,parties) {return {type:"FeatureCollection",features:plots.map(p=>({type:"Feature",geometry:p.coords.length===1?{type:"Point",coordinates:[p.coords[0][1],p.coords[0][0]]}:{type:"Polygon",coordinates:[[...p.coords,...(JSON.stringify(p.coords[0])===JSON.stringify(p.coords.at(-1))?[]:[p.coords[0]])].map(([lat,lng])=>[lng,lat])]},properties:{ProducerName:parties.find(x=>id(x)===id(p.generator))?.name||"",ProducerCountry:"IN",ProductionPlace:`${id(p)} ${p.village}`,Area:p.area_ha,SatelliteResult:p.satellite?.result||"Pending"}}))};}
function supplyChain(networks,species) {
  const paths=new Set();
  for(const {graph} of networks){const lots=new Map(graph.lots.map(l=>[id(l),l])),ops=new Map(graph.operations.map(o=>[id(o),o]));
    const walk=(key,suffix=[],depth=0)=>{if(depth>200||paths.size>2000)throw fail("GRAPH_LIMIT","Supply-chain report exceeds its path limit",413);const lot=lots.get(key);if(!lot||id(lot.species)!==species)return;const name=lot.holder_snapshot?.name||lot.owner;const next=suffix[0]===name?suffix:[name,...suffix];const parent=ops.get(id(lot.incoming_operation));if(!parent){paths.add(next.join(" > "));return;}for(const input of parent.inputs||[])walk(id(input.lot),next,depth+1);};
    for(const op of graph.operations.filter(o=>o.container))for(const input of op.inputs||[])walk(id(input.lot));
  }
  return [...paths].sort().join("; ");
}
function build(loaded,submissionId="") {
  const {group,species,networks,plots,parties}=loaded,rows=new Map();
  for(const row of group.rows){
    const masses=splitLineBySpecies(Math.round(row.quantity*row.net_weight_kg_per_unit*1000),row.species_composition);
    for(const part of splitLineBySpecies(row.line_milli_cft,row.species_composition)){
      const sp=species.find(s=>id(s)===part.species),key=`${row.source}:${row.code}:${part.species}`;
      if(!sp)throw fail("SPECIES_MISMATCH","Report species no longer exists");
      const sources=networks.flatMap(n=>n.sources).filter(s=>id(s.species)===part.species);
      const places=[...new Set(sources.flatMap(s=>s.origins.map(o=>id(o.plot_ref))).filter(Boolean))].sort();
      const dates=sources.map(s=>s.harvest_date||s.production_date).filter(Boolean).sort();
      if(!rows.has(key))rows.set(key,{container:group.container,vendor:group.vendor.name,vendor_gstin:group.vendor.gst,vendor_pan:group.vendor.pan,hs_code:row.hs_code,product_description:row.description||row.code,quantity_units:0,net_mass_milli:0,volume_milli:0,scientific_name:sp.scientific_name,common_name:sp.name,country_of_production:"IN",production_places:places.join("; "),production_date_from:dates[0]||"",production_date_to:dates.at(-1)||"",supply_chain:supplyChain(networks,part.species),report_submission_id:submissionId});
      const line=rows.get(key);line.quantity_units+=row.quantity;line.net_mass_milli+=masses.find(m=>m.species===part.species).milli;line.volume_milli+=part.milli;
      if(!Number.isSafeInteger(line.net_mass_milli)||!Number.isSafeInteger(line.volume_milli))throw fail("INVALID_QUANTITY","Report quantity exceeds safe arithmetic");
    }
  }
  const lines=[...rows.values()].map(({net_mass_milli,volume_milli,...row})=>({...row,net_mass_kg:net_mass_milli/1000,volume_m3:volumeM3(volume_milli)}));
  return {lines,csv:csv(lines),geojson:geojson(plots,parties)};
}
async function groups(session) {
  const Chain=require("../models/eudrChain.model");
  const groups=await Chain.aggregate([{$group:{_id:{container_key:"$container_key",vendor:"$vendor"}}},{$sort:{"_id.container_key":1,"_id.vendor":1}},{$limit:2001}]).session(session);
  if(groups.length>2000)throw fail("REPORT_LIMIT","Review reporting in a smaller operator-selected batch",413);
  return groups.map(g=>g._id);
}
async function reportSnapshot(session) {
  const ready=[],not_ready=[],already_sent=[],lines=[],plots=new Map(),parties=new Map();
  for(const group of await groups(session)){
    const result=await review.reviewGroup(group.container_key,id(group.vendor),{session});
    const row={...group,vendor:id(group.vendor),review:result};
    if(result.status[0]==="Complete"){const loaded=await review.loadGroup(group.container_key,id(group.vendor),{session});const built=build(loaded);ready.push(row);lines.push(...built.lines);loaded.plots.forEach(p=>plots.set(id(p),p));loaded.parties.forEach(p=>parties.set(id(p),p));}
    else if(result.status[0]==="Sent to Europe office")already_sent.push(row);else not_ready.push(row);
  }
  return {ready,not_ready,already_sent,lines,csv:csv(lines),geojson:geojson([...plots.values()],[...parties.values()]),submissions:await R.Submission.find({}).sort({submitted_at:-1}).limit(100).session(session).lean()};
}
async function report(){return mongoose.connection.transaction(session=>reportSnapshot(session),{readConcern:{level:"snapshot"}});}
async function fence(loaded,session) {
  const Item=require("../models/item.model"),Sample=require("../models/sample.model"),Order=require("../models/order.model"),Vendor=require("../models/vendor.model");
  for(const [Model,query] of [[Item,{code:{$in:loaded.group.rows.filter(r=>r.source==="order").map(r=>r.code)}}],[Sample,{_id:{$in:loaded.group.rows.filter(r=>r.source==="sample").map(r=>r.source_id)}}],[Order,{_id:{$in:loaded.group.rows.filter(r=>r.source==="order").map(r=>r.source_id)}}],[Vendor,{_id:{$in:[loaded.group.vendor._id,...loaded.parties.map(p=>p._id)]}}]]){
    const docs=await Model.find(query).select("_id").sort({_id:1}).session(session).lean();
    for(const doc of docs)await Model.updateOne({_id:doc._id},{$inc:{eudr_review_fence:1}},{session,timestamps:false,strict:false});
  }
}
async function submit(requested,user) {
  if(!Array.isArray(requested)||!requested.length||requested.length>100)throw fail("INVALID_GROUPS","Select 1–100 container/vendor groups");
  const keys=new Set(requested.map(g=>`${g.container_key}|${id(g.vendor)}`));if(keys.size!==requested.length)throw fail("INVALID_GROUPS","Select distinct groups");
  const I=require("./eudrInventory.service"),Allocation=require("../models/eudrAllocation.model"),Chain=require("../models/eudrChain.model");
  return I.withInventory(user,async(session,state)=>{
    const submitted=[];
    for(const group of [...requested].sort((a,b)=>`${a.container_key}|${a.vendor}`.localeCompare(`${b.container_key}|${b.vendor}`))){
      I.objectId(group.vendor);await Allocation.findOneAndUpdate({_id:`${group.container_key}|${group.vendor}`},{$inc:{revision:1}},{session,upsert:true});
      const loaded=await review.loadGroup(group.container_key,id(group.vendor),{session});await fence(loaded,session);
      const current=await review.reviewGroup(group.container_key,id(group.vendor),{session});
      if(current.status[0]!=="Complete")throw fail("REPORT_GROUP_NOT_READY",`${group.container_key}: ${current.status[0]}`,409);
      const _id=new mongoose.Types.ObjectId(),built=build(loaded,id(_id)),submitted_at=new Date();
      const snapshot={lines:built.lines,geojson:built.geojson,container_key:group.container_key,vendor:id(group.vendor)};
      const [record]=await R.Submission.create([{_id,...group,chains:loaded.chains.map(c=>c._id),submitted_at,submitted_by:user?._id||user?.id,snapshot,csv:built.csv,geojson:built.geojson,rules_revision:loaded.rules.revision,ledger_revision:state.revision,input_fingerprint:current.input_fingerprint,sha256:review.fingerprint([snapshot,built.csv])}],{session});
      await Chain.updateMany({_id:{$in:loaded.chains.map(c=>c._id)}},{$set:{europe_reported_at:submitted_at,europe_report_submission:_id},$push:{history:{event:"europe_report_sent",actor:user?._id||user?.id,at:submitted_at,detail:{submission:_id}}}},{session});
      await I.audit(session,user,"report_submitted","report",_id,state.revision,{after:record.toObject()});submitted.push(record);
    }
    return submitted;
  });
}
module.exports={CFT_M3_FACTOR,HEADERS,volumeM3,csv,geojson,build,report,submit,fence,groups};
