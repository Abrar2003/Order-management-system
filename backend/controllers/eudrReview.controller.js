const express=require("express");
const R=require("../models/eudrReview.model"),I=require("../services/eudrInventory.service"),review=require("../services/eudrReview.service"),report=require("../services/eudrReport.service"),providers=require("../services/eudrProviders.service");
const Party=require("../models/eudrParty.model"),Chain=require("../models/eudrChain.model"),Allocation=require("../models/eudrAllocation.model");
const {enabled,fail,id,composition}=require("../helpers/timberSpecies");
const {normalizeIdentifier}=require("../helpers/timberCft");
const {normalizeUserRoleKey}=require("../helpers/userRole");
const router=express.Router();
const run=fn=>async(req,res)=>{try{const data=await fn(req,res);if(!res.headersSent)res.json({data:I.publicRecord(data)});}catch(e){res.status(e.statusCode||(e.code===11000?409:["ValidationError","CastError"].includes(e.name)?400:500)).json({code:typeof e.code==="string"?e.code:"REVIEW_REQUEST_FAILED",message:e.message});}};
const admin=(req,_res,next)=>["admin","super_admin"].includes(normalizeUserRoleKey(req.user?.role))?next():next(fail("FORBIDDEN","Rules and species changes require an administrator",403));
const revision=(body,rules)=>{if(body.revision!==(rules?.revision||0))throw fail("RULES_STALE_REVISION","Rules changed; reload and preview again",409);};
const bp=(value,maximum)=>{if(!Number.isInteger(value)||value<0||value>maximum)throw fail("INVALID_RULE","Enter a valid basis-point percentage");return value;};
router.get("/capabilities",run(async()=>({review_layer:enabled()})));
router.use((req,res,next)=>{
  if(enabled())return next();
  const isReview=/^\/(species|rules|parties|plots|report(?:\.csv|\.geojson)?)(?:\/|$)/.test(req.path)||/^\/[^/]+\/(caution|requests|declaration-lines)$/.test(req.path)||/^\/inventory\/(invoices|transfers)\/[^/]+\/document-checks$/.test(req.path);
  return isReview?res.status(404).json({message:"Not found"}):next("router");
});
router.get("/species",run(async()=>({species:await R.Species.find({}).sort({name:1}).lean(),rules_revision:(await R.Rules.findById("global").lean())?.revision||0})));
router.post("/species",admin,run(req=>I.withInventory(req.user,async(session,state)=>{
  let rules=await R.Rules.findById("global").session(session);revision(req.body,rules);
  if(!rules)rules=new R.Rules({_id:"global",exporter_wastage_bp:1500,revision:0});
  if(req.body.max_yield_bp!=null&&bp(req.body.max_yield_bp,10000)===0)throw fail("INVALID_RULE","Yield must be positive");
  const [species]=await R.Species.create([{name:req.body.name,scientific_name:req.body.scientific_name,max_yield_bp:req.body.max_yield_bp??6500}],{session});
  rules.revision++;await rules.save({session});await I.audit(session,req.user,"species_created","species",species._id,state.revision,{after:species.toObject(),reason:req.body.reason});return species;
})));
router.patch("/species/:id",admin,run(req=>I.withInventory(req.user,async(session,state)=>{
  const rules=await R.Rules.findById("global").session(session);revision(req.body,rules);
  const species=await R.Species.findById(I.objectId(req.params.id)).session(session);if(!species)throw fail("NOT_FOUND","Species not found",404);
  const before=species.toObject();for(const key of ["name","scientific_name","active","max_yield_bp"])if(Object.hasOwn(req.body,key))species[key]=req.body[key];species.revision++;await species.save({session});rules.revision++;await rules.save({session});await I.audit(session,req.user,"species_changed","species",species._id,state.revision,{before,after:species.toObject(),reason:req.body.reason});return species;
})));
router.get("/rules",run(async()=>await R.Rules.findById("global").lean()||{revision:0,exporter_wastage_bp:1500,unconfigured:true}));
router.post("/rules/preview",admin,run(async req=>{
  const rules=await R.Rules.findById("global").lean();revision(req.body,rules);if(!rules)throw fail("RULES_UNCONFIGURED","Create the first species before editing rules");
  const proposed={...rules,exporter_wastage_bp:bp(req.body.exporter_wastage_bp,9999),species:await R.Species.find({}).lean()};
  for(const change of req.body.species||[]){const row=proposed.species.find(s=>id(s)===id(change.species));if(!row||bp(change.max_yield_bp,10000)===0)throw fail("INVALID_RULE","Choose a recorded species and positive yield");row.max_yield_bp=change.max_yield_bp;}
  let changed_groups=0;const containers=new Set();for(const group of await report.groups()){const old=await review.reviewGroup(group.container_key,id(group.vendor));const next=await review.reviewGroup(group.container_key,id(group.vendor),{rulesOverride:proposed});if(old.status[0]!==next.status[0]){changed_groups++;containers.add(group.container_key);}}
  return {changed_groups,changed_containers:containers.size,revision:rules.revision};
}));
router.put("/rules",admin,run(req=>I.withInventory(req.user,async(session,state)=>{
  const rules=await R.Rules.findById("global").session(session);revision(req.body,rules);if(!rules)throw fail("RULES_UNCONFIGURED","Create a species first");const before=rules.toObject();rules.exporter_wastage_bp=bp(req.body.exporter_wastage_bp,9999);
  for(const change of req.body.species||[]){const row=await R.Species.findById(I.objectId(change.species)).session(session);if(!row||bp(change.max_yield_bp,10000)===0)throw fail("INVALID_RULE","Choose a recorded species and positive yield");const prior=row.toObject();row.max_yield_bp=change.max_yield_bp;row.revision++;await row.save({session});await I.audit(session,req.user,"species_changed","species",row._id,state.revision,{before:prior,after:row.toObject(),reason:req.body.reason});}
  rules.revision++;await rules.save({session});await I.audit(session,req.user,"rules_changed","rules",undefined,state.revision,{before,after:rules.toObject(),reason:req.body.reason});return rules;
})));
router.get("/parties",run(async()=>({parties:await Party.find({}).sort({name:1}).limit(2000).lean(),vendors:await require("../models/vendor.model").find({deleted_at:null}).select("name gst pan gst_snapshot").limit(2000).lean()})));
router.post("/parties/gst-lookup",run(async req=>{
  const gst=normalizeIdentifier(req.body.gstin);if(await Party.exists({$or:[{"fields.gst":gst},{"fields.buyer_gst":gst}]}))throw fail("PARTY_EXISTS","GSTIN is already recorded",409);
  return {...await providers.GstLookupService.lookup(gst),pan:gst.slice(2,12)};
}));
for(const isVendor of [false,true])router.post(isVendor?"/parties/vendor/:id/gst-check":"/parties/:id/gst-check",run(async req=>{
  const Model=isVendor?require("../models/vendor.model"):Party,before=await Model.findById(I.objectId(req.params.id)).lean();if(!before)throw fail("NOT_FOUND","Party not found",404);
  const gst=isVendor?before.gst:before.fields?.gst||before.fields?.buyer_gst,snapshot=await providers.GstLookupService.lookup(gst);
  snapshot.fetched_at=snapshot.checked_at;snapshot.input_fingerprint=review.fingerprint([gst]);
  return I.withInventory(req.user,async(session,state)=>{const row=await Model.findById(before._id).session(session);if(String(row.updatedAt)!==String(before.updatedAt))throw fail("STALE_REVISION","Party changed while checking",409);row.gst_snapshot=snapshot;await row.save({session});await I.audit(session,req.user,"gst_snapshot_changed",isVendor?"vendor":"party",row._id,state.revision,{before:before.gst_snapshot,after:snapshot});return row;});
}));
router.post("/parties",run(async req=>{
  const roles={Generator:"generator",Trader:"buyer",Transporter:"transporter",Sawmill:"sawmill"};const kind=roles[req.body.role];if(!kind)throw fail("INVALID_ROLE","Shipping exporters must use existing Vendor records");
  const gst=normalizeIdentifier(req.body.gstin),pan=normalizeIdentifier(req.body.pan||gst.slice(2,12));if(!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)||(gst&&(!providers.gstinValid(gst)||gst.slice(2,12)!==pan))||(!gst&&kind!=="generator"))throw fail("PARTY_IDENTITY_INVALID","Provide a valid matching GSTIN/PAN; only generators may omit GSTIN");
  const snapshot=gst?await providers.GstLookupService.lookup(gst):{status:"Unregistered",fetched_at:new Date()};snapshot.fetched_at=snapshot.checked_at||snapshot.fetched_at;snapshot.input_fingerprint=review.fingerprint([gst]);
  return I.withInventory(req.user,async(session,state)=>{
    if(gst&&(await Party.exists({$or:[{"fields.gst":gst},{"fields.buyer_gst":gst}]}).session(session)||await require("../models/vendor.model").exists({gst}).session(session)))throw fail("PARTY_EXISTS","GSTIN is already recorded",409);
    const name=String(req.body.name||snapshot.legal_name||"").trim();if(!name)throw fail("PARTY_NAME_REQUIRED","Legal name is required");
    const [party]=await Party.create([{kind,role:req.body.role,name,identity_key:gst?`${gst}|${pan}`:`PAN:${pan}`,fields:{gst,pan,name,place:String(req.body.place||snapshot.address||"")},gst_snapshot:snapshot}],{session});await I.audit(session,req.user,"party_created","party",party._id,state.revision,{after:party.toObject()});return party;
  });
}));
router.patch("/parties/:id",run(async req=>{
  const before=await Party.findById(I.objectId(req.params.id)).lean();if(!before)throw fail("NOT_FOUND","Party not found",404);
  const snapshot=req.body.refresh_gst?await providers.GstLookupService.lookup(before.fields.gst||before.fields.buyer_gst):undefined;
  return I.withInventory(req.user,async(session,state)=>{const party=await Party.findById(before._id).session(session);if((party.revision||1)!==req.body.revision)throw fail("STALE_REVISION","Party changed; reload",409);if(req.body.role){const kinds={Generator:"generator",Trader:"buyer",Transporter:"transporter",Sawmill:"sawmill"};if(!kinds[req.body.role])throw fail("INVALID_ROLE","Choose a recorded party role");if(req.body.role!=="Generator"&&await R.Plot.exists({generator:party._id}).session(session))throw fail("GENERATOR_IN_USE","A party with production plots must remain a Generator",409);party.role=req.body.role;party.kind=kinds[req.body.role];}if(Object.hasOwn(req.body,"name")){if(!String(req.body.name).trim())throw fail("PARTY_NAME_REQUIRED","Legal name is required");party.name=String(req.body.name).trim();party.fields.name=party.name;}if(Object.hasOwn(req.body,"place"))party.fields.place=String(req.body.place).trim();if(snapshot)party.gst_snapshot=snapshot;party.revision=(party.revision||1)+1;await party.save({session});await I.audit(session,req.user,"party_changed","party",party._id,state.revision,{before,after:party.toObject()});return party;});
}));
router.get("/plots",run(async()=>await R.Plot.find({}).sort({createdAt:-1}).limit(2000).lean()));
router.get("/plots/:id",run(async req=>{const plot=await R.Plot.findById(I.objectId(req.params.id)).lean();if(!plot)throw fail("NOT_FOUND","Plot not found",404);return plot;}));
async function holdPlot(plot,session,state,user) {
  const sources=await I.M.SourceBatch.find({"origins.plot_ref":plot._id}).session(session);for(const source of sources){source.origin_status="REVIEW_REQUIRED";for(const origin of source.origins)if(id(origin.plot_ref)===id(plot)){origin.latitude=plot.coords[0][0];origin.longitude=plot.coords[0][1];}source.revision++;await source.save({session});await I.holdDependents([source.output_lot],session,user,state.revision,"Plot or satellite review changed");}
}
router.post("/plots",run(req=>I.withInventory(req.user,async(session,state)=>{
  const generator=await Party.findOne({_id:I.objectId(req.body.generator),$or:[{kind:"generator"},{role:"Generator"}]}).session(session);if(!generator)throw fail("INVALID_GENERATOR","Choose a recorded generator");
  const [plot]=await R.Plot.create([{generator:generator._id,village:req.body.village,...providers.plotData(req.body)}],{session});await I.audit(session,req.user,"plot_created","plot",plot._id,state.revision,{after:plot.toObject()});return plot;
})));
router.patch("/plots/:id",run(req=>I.withInventory(req.user,async(session,state)=>{
  const plot=await R.Plot.findById(I.objectId(req.params.id)).session(session);if(!plot)throw fail("NOT_FOUND","Plot not found",404);if(plot.revision!==req.body.revision)throw fail("STALE_REVISION","Plot changed; reload",409);const before=plot.toObject();if(req.body.generator){const generator=await Party.findOne({_id:I.objectId(req.body.generator),kind:"generator"}).session(session);if(!generator)throw fail("INVALID_GENERATOR","Choose a recorded generator");plot.generator=generator._id;}Object.assign(plot,providers.plotData({...before,...req.body}));if(req.body.village)plot.village=req.body.village;plot.satellite={result:"Pending",forest_2020:"Not checked"};plot.revision++;await plot.save({session});await holdPlot(plot,session,state,req.user);await I.audit(session,req.user,"plot_changed","plot",plot._id,state.revision,{before,after:plot.toObject()});return plot;
})));
router.post("/plots/:id/satellite-check",run(async req=>{
  const before=await R.Plot.findById(I.objectId(req.params.id)).lean();if(!before)throw fail("NOT_FOUND","Plot not found",404);const result=await providers.SatelliteCheckService.check(before);result.checked_revision=before.revision;result.input_fingerprint=review.fingerprint([before.generator,before.coords,before.area_ha,before.village]);
  return I.withInventory(req.user,async(session,state)=>{const plot=await R.Plot.findById(before._id).session(session);if(plot.revision!==before.revision)throw fail("STALE_REVISION","Plot changed while checking",409);plot.satellite=result;plot.check_history.push(result);plot.revision++;await plot.save({session});await holdPlot(plot,session,state,req.user);await I.audit(session,req.user,"satellite_checked","plot",plot._id,state.revision,{before,after:plot.toObject()});return plot;});
}));
for(const resource of ["invoices","transfers"])router.post(`/inventory/${resource}/:id/document-checks`,run(async req=>{
  const Model=I.resources[resource],before=await Model.findById(I.objectId(req.params.id)).lean();if(!before)throw fail("NOT_FOUND","Record not found",404);
  const check=resource==="invoices"?{einvoice:await providers.EInvoiceVerificationService.verify(before.einvoice_irn),input_fingerprint:review.fingerprint([before.revision,before.einvoice_irn||""])}:{eway:await providers.EwayBillVerificationService.verify(before.transport?.eway_bill_no),input_fingerprint:review.fingerprint([before.revision,before.transport?.eway_bill_no||""])};
  return I.withInventory(req.user,async(session,state)=>{const row=await Model.findById(before._id).session(session);if(row.revision!==before.revision)throw fail("STALE_REVISION","Document changed while checking",409);row.document_checks=check;await row.save({session});await I.audit(session,req.user,"document_checked",resource,row._id,state.revision,{after:check});return row;});
}));
router.get("/report",run(()=>report.report()));
router.get("/report.csv",run(async(_req,res)=>{const data=await report.report();res.type("text/csv").attachment("eudr-europe-report.csv").send(data.csv);}));
router.get("/report.geojson",run(async(_req,res)=>{const data=await report.report();res.type("application/geo+json").attachment("eudr-europe-report.geojson").send(JSON.stringify(data.geojson));}));
router.post("/report/submit",run(req=>report.submit(req.body.groups,req.user)));
router.post("/:id/caution",run(req=>I.withInventory(req.user,async(session,state)=>{
  if(!String(req.body.reason||"").trim())throw fail("CAUTION_REASON_REQUIRED","A written reason is required");const chain=await Chain.findById(I.objectId(req.params.id)).session(session);if(!chain)throw fail("NOT_FOUND","Chain not found",404);
  const current=await review.reviewGroup(chain.container_key,id(chain.vendor),{session}),caution=current.cautions.find(c=>c.code===req.body.code);if(!caution)throw fail("STALE_CAUTION","Caution changed; reload",409);
  const accepted={code:caution.code,fingerprint:caution.fingerprint,reason:String(req.body.reason).trim().slice(0,5000),actor:req.user._id,at:new Date()};await Allocation.findOneAndUpdate({_id:`${chain.container_key}|${chain.vendor}`},{$inc:{revision:1},$push:{caution_acceptances:accepted}},{session,upsert:true});chain.history.push({event:"caution_accepted",actor:req.user._id,detail:accepted});await chain.save({session});await I.audit(session,req.user,"caution_accepted","chain",chain._id,state.revision,{after:accepted});return accepted;
})));
router.post("/:id/requests",run(req=>I.withInventory(req.user,async(session,state)=>{const text=String(req.body.text||"").trim();if(!text||text.length>30000)throw fail("REQUEST_TEXT_INVALID","Request text is required and must be at most 30000 characters");const chain=await Chain.findById(I.objectId(req.params.id)).session(session);if(!chain)throw fail("NOT_FOUND","Chain not found",404);chain.history.push({event:"document_request_sent",actor:req.user._id,detail:{text}});await chain.save({session});await I.audit(session,req.user,"request_letter_logged","chain",chain._id,state.revision,{details:{text}});return {logged:true};})));
router.put("/:id/declaration-lines",run(req=>I.withInventory(req.user,async(session,state)=>{
  const chain=await Chain.findById(I.objectId(req.params.id)).session(session);if(!chain?.inventory_backed)throw fail("DECLARATION_VERSION_REQUIRED","Declaration lines require an inventory-backed version-3 declaration",409);
  const loaded=await review.loadGroup(chain.container_key,id(chain.vendor),{session}),lines=req.body.lines;
  if(!Array.isArray(lines)||lines.length>1000)throw fail("DECLARATION_LINES_INVALID","Provide at most 1000 declaration lines");const seen=new Set();
  for(const line of lines)for(const share of composition(line.species_shares))await require("../services/eudrReviewRecords.service").species(share.species,session);
  chain.declaration_lines=lines.map(line=>{const ref=line.shipment_ref||{},key=`${ref.source}|${ref.source_id}|${ref.shipment_id}`,row=loaded.group.rows.find(r=>r.source===ref.source&&r.source_id===ref.source_id&&r.shipment_id===ref.shipment_id);if(!row||seen.has(key)||!Number.isFinite(line.qty)||line.qty<0||!Number.isSafeInteger(line.declared_cft_per_unit_milli)||line.declared_cft_per_unit_milli<0)throw fail("DECLARATION_LINES_INVALID","Use distinct real shipment references and valid quantities");seen.add(key);return {...line,item_or_sample_code:row.code,species_shares:composition(line.species_shares)};});
  for(const stage of chain.stages.filter(s=>s.kind==="declaration")){stage.verified_at=null;stage.verification_result="pending";}chain.history.push({event:"declaration_lines_changed",actor:req.user._id});await chain.save({session});await I.audit(session,req.user,"declaration_lines_changed","chain",chain._id,state.revision,{after:chain.declaration_lines});return chain;
})));
router.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({code:e.code,message:e.message}));
module.exports={router};
