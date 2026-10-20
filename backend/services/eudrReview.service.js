const {enabled,id,composition,splitLineBySpecies,fail}=require("../helpers/timberSpecies");
const Q=require("./eudrQuantity.service");
const R=require("../models/eudrReview.model");
const active=r=>Q.ACTIVE.has(r.status);
const fingerprint=value=>require("./eudrInventory.service").digest(value);
const ceilDiv=(n,d)=>Number((BigInt(n)+BigInt(d)-1n)/BigInt(d));
const ratioNeed=(quantity,bp)=>{const n=BigInt(quantity)*10000n;const result=ceilDiv(n,BigInt(bp));return Q.integer(result);};
const fmt=milli=>(milli/1000).toFixed(3);
const sum=rows=>Q.sum(rows.map(r=>r.quantity_milli));

function networkReview(graph,sources,species,rules,acceptances=[],targetLotIds) {
  const parent=new Map(graph.lots.map(l=>[id(l),id(l)]));
  const root=key=>{while(parent.get(key)!==key)key=parent.get(key);return key;};
  const join=ids=>{const known=ids.filter(x=>parent.has(x));for(const key of known.slice(1))parent.set(root(key),root(known[0]));};
  const invoiceLots=new Map();
  for(const op of graph.operations.filter(o=>active(o)&&!o.container)){const ids=[...(op.inputs||[]).map(i=>id(i.lot)),id(op.output_lot)];join(ids);if(op.invoice){const key=`${id(op.invoice)}:${id(op.species)}`;if(!invoiceLots.has(key))invoiceLots.set(key,[]);invoiceLots.get(key).push(...ids);}}
  for(const ids of invoiceLots.values())join(ids);
  for(const mix of graph.mixes||[])if(mix.physical_mixing&&active(mix))join(mix.inputs.map(i=>id(i.lot)));
  const targets=new Set((targetLotIds||graph.operations.filter(o=>o.container&&active(o)).flatMap(o=>o.inputs.map(i=>id(i.lot)))).filter(i=>parent.has(i)).map(root));
  const segments=new Map();for(const lot of graph.lots){const key=root(id(lot));if(targets.has(key)){if(!segments.has(key))segments.set(key,[]);segments.get(key).push(lot);}}
  const result={species:[],numberIssues:[],cautions:[],scope:"Network-level; not attributed to this container"};
  for(const lots of segments.values()){
    const ids=new Set(lots.map(id)),operations=graph.operations.filter(o=>o.inputs?.some(i=>ids.has(id(i.lot)))).map(o=>o.container?{...o,inputs:o.inputs.filter(i=>ids.has(id(i.lot)))}:o);
    const part=reviewSegment({...graph,lots,operations},sources.filter(s=>ids.has(id(s.output_lot))),species,rules,acceptances);
    for(const key of ["species","numberIssues","cautions"])result[key].push(...part[key]);
  }
  return result;
}
function reviewSegment(graph,sources,species,rules,acceptances=[]) {
  const out={species:[],numberIssues:[],cautions:[],scope:"Network-level; not attributed to this container"};
  const ops=graph.operations.filter(active),lots=graph.lots.filter(active),byLot=new Map(lots.map(l=>[id(l),l]));
  const byOp=new Map(ops.map(o=>[id(o),o])),ancestors=new Set(),pending=ops.filter(o=>o.container).flatMap(o=>(o.inputs||[]).map(i=>id(i.lot)));
  while(pending.length){const l=pending.pop();if(ancestors.has(l))continue;ancestors.add(l);for(const input of byOp.get(id(byLot.get(l)?.incoming_operation))?.inputs||[])pending.push(id(input.lot));}
  const network_key=fingerprint([...byLot.keys()].sort()).slice(0,16);
  for(const sp of species) {
    const sid=id(sp),matching=lots.filter(l=>id(l.species)===sid),operations=ops.filter(o=>id(o.species)===sid);
    const saw=operations.filter(o=>o.kind==="TRANSFORMATION"&&o.input_material==="RAW"&&o.output_material==="PROCESSING_INPUT");
    const factories=operations.filter(o=>o.kind==="TRANSFORMATION"&&o.input_material==="PROCESSING_INPUT"&&o.output_material==="FINISHED");
    const finished=matching.filter(l=>ancestors.has(id(l))&&factories.some(o=>id(o.output_lot)===id(l)));
    if(!finished.length)continue;
    const finishedTotal=sum(finished),yieldBp=sp.max_yield_bp;
    const incomingIds=new Set(factories.flatMap(o=>o.inputs.map(i=>id(i.lot))));
    const rawIds=new Set(saw.flatMap(o=>o.inputs.map(i=>id(i.lot))));
    const millOwners=new Set(saw.map(o=>o.seller));
    const soldIds=new Set([...factories.flatMap(o=>o.inputs.map(i=>id(i.lot))).filter(l=>saw.some(o=>id(o.output_lot)===l)),...operations.filter(o=>o.kind==="TRANSFER"&&o.input_material==="PROCESSING_INPUT"&&millOwners.has(o.seller)).map(o=>id(o.output_lot))]);
    const sawn=sum(matching.filter(l=>incomingIds.has(id(l)))),millOut=Q.sum(saw.map(o=>o.output_quantity_milli));
    const logs=sum(matching.filter(l=>rawIds.has(id(l)))),felled=Q.sum(sources.filter(s=>active(s)&&s.material==="RAW"&&id(s.species)===sid).map(s=>s.quantity_milli));
    const needLogs=ratioNeed(finishedTotal,yieldBp);
    const steps=[
      {label:"Finished documented output supporting reserved/committed containers",have:finishedTotal,need:null},
      {label:"Sawn wood received for manufacturing",have:sawn,need:finishedTotal,ask:"sawn wood purchase invoices and e-way bills"},
      {label:"Sawn wood sold by saw mills",have:sum(matching.filter(l=>soldIds.has(id(l)))),need:finishedTotal,ask:"saw mill sales invoices and e-way bills"},
      {label:"Sawn output at saw mills",have:millOut,need:finishedTotal,ask:"sawing records / production registers"},
      {label:"Logs feeding saw mills",have:logs,need:needLogs,ask:"log purchase invoices into the saw mills"},
      {label:"Logs felled",have:felled,need:needLogs,ask:"transit passes and felling permissions"},
    ];
    steps.forEach(step=>{if(step.need!=null){step.gap=step.have-step.need;if(step.gap < -50)out.numberIssues.push({code:`SHORTFALL:${network_key}:${sid}:${step.label}`,species:sid,sp:sp.name,text:`${step.label}: ${fmt(step.have)} CFT documented, at least ${fmt(step.need)} CFT needed for the network.`,short:-step.gap,ask:step.ask});}});
    const extra=[];
    for(const op of saw){const bad=BigInt(op.output_quantity_milli)*10000n>BigInt(op.quantity_milli)*BigInt(yieldBp);const text=`Saw mill ${id(op)}: ${fmt(op.output_quantity_milli)} CFT sawn from ${fmt(op.quantity_milli)} CFT logs; maximum yield ${(yieldBp/100).toFixed(2)}%.`;extra.push({ok:!bad,text});if(bad)out.numberIssues.push({code:`YIELD:${id(op)}`,species:sid,sp:sp.name,text,short:Math.max(0,ratioNeed(op.output_quantity_milli,yieldBp)-op.quantity_milli),ask:"a corrected sawing record or evidence for the extra logs"});}
    for(const op of factories){const loss=op.quantity_milli-op.output_quantity_milli;const bad=BigInt(loss)*10000n<BigInt(op.quantity_milli)*BigInt(rules.exporter_wastage_bp);const text=`Factory ${id(op)} recorded ${fmt(loss)} CFT loss from ${fmt(op.quantity_milli)} CFT input; usual wastage ${(rules.exporter_wastage_bp/100).toFixed(2)}%.`;extra.push({ok:!bad,warn:bad,text});if(bad){const code=`WASTAGE:${id(op)}`,fp=fingerprint([id(op),op.revision,op.quantity_milli,op.output_quantity_milli,rules.exporter_wastage_bp,sid]);const accepted=acceptances.find(a=>a.code===code&&a.fingerprint===fp);out.cautions.push({code,fingerprint:fp,species:sid,sp:sp.name,text,ask:"purchase evidence or an explanation of the low wastage",accepted:accepted?{reason:accepted.reason,actor:accepted.actor,at:accepted.at}:null});}}
    out.species.push({species:sid,name:sp.name,scientific_name:sp.scientific_name,network_key,networkFinishedMilli:finishedTotal,maxYieldBp:yieldBp,steps,extra,scope:out.scope});
  }
  return out;
}

function evaluate({group,chains=[],networks=[],species=[],rules,acceptances=[],coverage={},unassigned=[],plots=[],parties=[],priorDeclarations=[]}) {
  const out={status:["Documents missing","warn"],exportedMilliCft:group?.stuffed_milli_cft||0,species:[],numberIssues:[],cautions:[],checkIssues:[],missing:[],reviewable:true,notReviewableReasons:[],final_blockers:[],scope:"Network-level; not attributed to this container"};
  const missing=text=>out.missing.push({text}),issue=(text,ask,code)=>out.checkIssues.push({text,ask,code});
  const splitTotals=new Map();
  for(const row of group?.rows||[]) {
    try{for(const part of splitLineBySpecies(row.line_milli_cft,composition(row.species_composition)))splitTotals.set(part.species,Q.sum([splitTotals.get(part.species)||0,part.milli]));}
    catch{out.reviewable=false;out.notReviewableReasons.push(`${row.code}: species composition missing or invalid`);out.final_blockers.push(`${row.code}: species composition missing or invalid`);}
    if(!row.hs_code){missing(`HS code for ${row.code}`);out.final_blockers.push(`HS code missing for ${row.code}`);}
    if(row.net_weight_kg_per_unit==null)missing(`Net weight for ${row.code}`);
  }
  if(!chains.length||chains.some(c=>!c.inventory_backed)){out.reviewable=false;out.notReviewableReasons.push("species and ledger data not recorded");}
  if(!rules){out.reviewable=false;out.notReviewableReasons.push("Rules have not been configured");}
  if(!networks.length)missing("No inventory allocation yet");
  for(const {graph,sources=[],invoices=[],documents=[],target_lot_ids} of networks) {
    if(graph.lots.some(l=>active(l)&&!l.species)||sources.some(s=>!s.species)){out.reviewable=false;out.notReviewableReasons.push("species and ledger data not recorded in the connected network");continue;}
    const result=Q.reconcile(graph);if(!result.feasible){out.numberIssues.push({code:"QUANTITY_CONFLICT",text:"Connected network has a quantity conflict",ask:"corrected documentary evidence",short:0});continue;}
    if(rules){const review=networkReview(graph,sources,species,rules,acceptances,target_lot_ids);out.species.push(...review.species);out.numberIssues.push(...review.numberIssues);out.cautions.push(...review.cautions);}
    for(const record of [...sources,...invoices,...graph.operations.filter(o=>!o.container)]){
      if(active(record)&&record.verification?.status!=="VERIFIED")missing(`Manual verification for ${id(record)}`);
      if(active(record)&&record.origin_status!=="VERIFIED")missing(`Origin review for ${id(record)}`);
    }
    for(const op of graph.operations.filter(o=>!o.container&&active(o))) {
      if(op.kind==="TRANSFER"){
        for(const purpose of ["weight_slip","billty","driver_license","ewaybill"])if(!documents.some(d=>(op.transport_documents||[]).some(x=>id(x)===id(d))&&d.purpose===purpose))missing(`${purpose} for transfer ${id(op)}`);
        if(!documents.some(d=>(op.receipt_documents||[]).some(x=>id(x)===id(d))&&d.purpose==="receipt"))missing(`Receipt for transfer ${id(op)}`);
        const check=op.document_checks;
        const expected=fingerprint([op.revision,op.transport?.eway_bill_no||""]);
        if(!check||check.input_fingerprint!==expected||check.eway?.result!=="Verified")issue(`E-way bill ${op.transport?.eway_bill_no||"number not recorded"}: ${check?.input_fingerprint===expected?check?.eway?.result||"Not checked":"Not checked"}`,"a portal copy and the correct e-way bill number",`EWAY:${id(op)}`);
        if(check?.eway?.simulated)issueSimulation(out,`Transfer ${id(op)} e-way bill`);
      }
    }
    for(const invoice of invoices){if(invoice.einvoice_irn&&(!invoice.document_checks||invoice.document_checks.input_fingerprint!==fingerprint([invoice.revision,invoice.einvoice_irn])||!["Valid","Invalid"].includes(invoice.document_checks.einvoice?.result)))issue(`E-invoice ${invoice.number}: Not checked`,"a verified QR/IRN reference",`IRN:${id(invoice)}`);if(invoice.document_checks?.einvoice?.result==="Invalid")issue(`E-invoice ${invoice.number} is Invalid`,"an e-invoice with a valid QR/IRN",`IRN:${id(invoice)}`);if(invoice.document_checks?.einvoice?.simulated)issueSimulation(out,`Invoice ${invoice.number}`);}
    for(const source of sources)for(const origin of source.origins||[]){const plot=plots.find(p=>id(p)===id(origin.plot_ref));if(!plot){missing(`Plot coordinates for production ${source.identity_key}`);continue;}if(plot.area_ha>4&&plot.coords.length<3)missing(`Boundary polygon missing for plot ${id(plot)}`);if(plot.satellite?.result!=="Pass")issue(`Plot ${id(plot)} satellite: ${plot.satellite?.result||"Pending"}`,"evidence the plot was not deforested after 31 Dec 2020",`PLOT:${id(plot)}`);if(plot.satellite?.simulated)issueSimulation(out,`Plot ${id(plot)}`);const generator=parties.find(p=>id(p)===id(plot.generator));if(generator){const pan=generator.fields?.pan||generator.fields?.buyer_pan;const gst=generator.fields?.gst||generator.fields?.buyer_gst;const owner=gst?`${gst}|${pan}`:`PAN:${pan}`;if(source.owner!==owner)out.numberIssues.push({code:`GENERATOR:${id(source)}`,text:`Production ${source.identity_key} is attributed to a plot owned by a different generator`,ask:"production evidence matching the plot's generator",short:0});}}
  }
  for(const party of parties){const gst=party.fields?.gst||party.fields?.buyer_gst;if(party.gst_snapshot?.status==="Cancelled")issue(`${party.name} has a cancelled GSTIN`,"proof GSTIN was active on the invoice date",`GST:${id(party)}`);else if(gst&&party.gst_snapshot?.status!=="Active")issue(`${party.name}: GST status Not checked`,"GST status evidence",`GST:${id(party)}`);if(party.gst_snapshot?.simulated)issueSimulation(out,`${party.name} GST`);}
  for(const chain of chains) {
    const decl=chain.stages?.find(s=>s.kind==="declaration");
    if(!decl?.documents?.length)missing(`Declaration file for chain ${id(chain)}`);
    if(!chain.declaration_lines?.length)missing(`Declaration lines for chain ${id(chain)}`);
    for(const row of group?.rows||[]) {
      const line=chain.declaration_lines?.find(l=>l.shipment_ref?.source===row.source&&l.shipment_ref?.source_id===row.source_id&&l.shipment_ref?.shipment_id===row.shipment_id);
      if(!line){missing(`Declaration line for ${row.code} (${row.shipment_id})`);continue;}
      if(line.qty!==row.quantity)issue(`Declared quantity for ${row.code} differs from shipment quantity`,"a corrected declaration",`DECL_QTY:${row.shipment_id}`);
      if(row.timber_cft!=null&&Math.abs(line.declared_cft_per_unit_milli-Math.round(row.timber_cft*1000))>1)issue(`Declared CFT for ${row.code} differs from Item/Sample CFT; history: ${JSON.stringify(row.timber_cft_history||[])}; other container declarations: ${priorDeclarations.filter(d=>d.code===row.code).map(d=>`${d.container}: ${fmt(d.milli)} CFT/unit`).join("; ")||"none recorded"}`,"the reason the CFT changed or a corrected declaration",`DECL_CFT:${row.shipment_id}`);
      try{if(JSON.stringify(composition(line.species_shares))!==JSON.stringify(composition(row.species_composition)))issue(`Declared species shares for ${row.code} differ from composition`,"a corrected species declaration",`DECL_SPECIES:${row.shipment_id}`);}catch{issue(`Declared species shares for ${row.code} are invalid`,"a corrected species declaration",`DECL_SPECIES:${row.shipment_id}`);}
    }
  }
  const allocations=new Map();for(const n of networks)for(const c of n.graph.operations.filter(o=>o.container_key===group.container_key&&id(o.vendor)===id(group.vendor)))for(const a of c.species_allocations||[])allocations.set(id(a.species),Q.sum([allocations.get(id(a.species))||0,a.quantity_milli]));
  for(const [sp,amount] of allocations)if(amount>(splitTotals.get(sp)||0))out.final_blockers.push("Species allocations exceed shipped composition");
  if([...splitTotals].some(([sp,amount])=>allocations.get(sp)!==amount)){missing("Species allocations matching live shipment composition");out.final_blockers.push("Species allocations must match live shipment composition");}
  if(!coverage.complete)missing("Exact container coverage and all final declarations verified");
  if(unassigned.length)missing("Unassigned shipments");
  for(const reason of out.notReviewableReasons)missing(`Not reviewable: ${reason}`);
  out.final_blockers.push(...out.numberIssues.map(i=>i.text),...out.cautions.filter(i=>!i.accepted).map(i=>i.text));
  if(!out.reviewable)out.final_blockers.push(...out.notReviewableReasons);
  out.status=out.numberIssues.length?["Numbers don't justify","bad"]:out.cautions.some(c=>!c.accepted)?["Caution: low wastage","warn"]:out.checkIssues.length?["Document check issue","warn"]:out.missing.length?["Documents missing","warn"]:["Complete","good"];
  return out;
}
function issueSimulation(out,label){(out.simulated_checks||=[]).push(`${label}: Simulated`);}
function requestText(group,review) {
  const lines=[`To: ${group.vendor.name}`,`Subject: Documents needed for EUDR file — container ${group.container||group.container_key}`,"",`Thank you for the documents for container ${group.container||group.container_key}. Based on Item/Sample data, this export uses ${fmt(review.exportedMilliCft)} CFT of wood. To complete the EUDR file, we need the following.`];let n=1;
  for(const [heading,items] of [["A. Volumes not yet covered by documents",review.numberIssues],["B. Please confirm",review.cautions.filter(c=>!c.accepted)],["C. Documents we could not confirm",review.checkIssues],["D. Papers missing from the file",review.missing]])if(items.length){lines.push("",heading);if(heading.startsWith("A."))lines.push("Network-level; not attributed to this container. We have used the highest allowed sawing yield and no assumed wastage; recorded saw mill wastage is accepted.");for(const i of items)lines.push(`${n++}. ${i.sp?i.sp+": ":""}${i.text}${i.short?` Shortfall ${fmt(i.short)} CFT.`:""}${i.ask?` Please send ${i.ask}.`:""}`);}
  lines.push("","Please share these by reply. Once received, we will re-run the checks and confirm.");return lines.join("\n");
}
async function loadGroup(containerKey,vendorId,{session,rulesOverride}={}) {
  const I=require("./eudrInventory.service"),S=require("./eudrChain.service"),Chain=require("../models/eudrChain.model"),Allocation=require("../models/eudrAllocation.model");
  const data=await S.loadContainer(containerKey,session),group=S.findGroup(data,vendorId);
  if(!group)throw fail("NOT_FOUND","Container/vendor group no longer exists",404);
  group.container=data.container;group.container_key=containerKey;group.rows.sort((a,b)=>`${a.source}|${a.source_id}|${a.shipment_id}`.localeCompare(`${b.source}|${b.source_id}|${b.shipment_id}`));
  const chains=await Chain.find({container_key:containerKey,vendor:vendorId}).sort({_id:1}).session(session).lean();
  const commits=await I.M.Commitment.find({chain:{$in:chains.map(c=>c._id)},status:{$in:[...Q.ACTIVE]}}).sort({_id:1}).session(session).lean();
  const networks=[],seen=new Set();
  for(const commit of commits){const seed=commit.inputs.map(i=>i.lot);if(seed.every(l=>seen.has(id(l))))continue;const graph=await I.component(seed,session);for(const list of [graph.lots,graph.operations,graph.mixes,graph.invoice_limits])list.sort((a,b)=>id(a).localeCompare(id(b)));graph.lots.forEach(l=>seen.add(id(l)));const sources=await I.M.SourceBatch.find({_id:{$in:graph.lots.map(l=>l.source_batch).filter(Boolean)}}).sort({_id:1}).session(session).lean();const invoices=await I.M.Invoice.find({_id:{$in:graph.operations.map(o=>o.invoice).filter(Boolean)}}).sort({_id:1}).session(session).lean();const documents=await I.networkEvidence(graph,sources,invoices,session);networks.push({graph,sources,invoices,documents,target_lot_ids:commits.flatMap(c=>c.inputs.map(i=>id(i.lot))).filter(l=>graph.lots.some(x=>id(x)===l))});}
  const species=await R.Species.find({}).sort({_id:1}).session(session).lean();
  const rules=rulesOverride||await R.Rules.findById("global").session(session).lean();
  const allocation=await Allocation.findById(`${containerKey}|${vendorId}`).session(session).lean();
  const plots=await R.Plot.find({_id:{$in:networks.flatMap(n=>n.sources.flatMap(s=>s.origins.map(o=>o.plot_ref))).filter(Boolean)}}).sort({_id:1}).session(session).lean();
  const refs=networks.flatMap(n=>[...n.graph.lots.map(l=>l.holder_snapshot?.reference),...n.invoices.flatMap(i=>[i.issuer_snapshot?.reference,i.buyer_snapshot?.reference])]).filter(r=>r?.kind==="party").map(r=>r.id);
  const parties=await require("../models/eudrParty.model").find({_id:{$in:[...refs,...plots.map(p=>p.generator)]}}).sort({_id:1}).session(session).lean();
  const vendorRefs=networks.flatMap(n=>[...n.graph.lots.map(l=>l.holder_snapshot?.reference),...n.invoices.flatMap(i=>[i.issuer_snapshot?.reference,i.buyer_snapshot?.reference])]).filter(r=>r?.kind==="vendor").map(r=>r.id);
  const vendors=await require("../models/vendor.model").find({_id:{$in:[...vendorRefs,vendorId]}}).select("name gst pan gst_snapshot").session(session).lean();parties.push(...vendors.map(v=>({...v,fields:{gst:v.gst,pan:v.pan}})));
  const priorChains=await Chain.find({container_key:{$ne:containerKey},"declaration_lines.item_or_sample_code":{$in:group.rows.map(r=>r.code)}}).select("container declaration_lines").sort({_id:1}).session(session).lean();
  const priorDeclarations=priorChains.flatMap(c=>c.declaration_lines.filter(l=>group.rows.some(r=>r.code===l.item_or_sample_code)).map(l=>({container:c.container,code:l.item_or_sample_code,milli:l.declared_cft_per_unit_milli})));
  return {group,chains,networks,priorDeclarations,species:rulesOverride?.species||species,rules,acceptances:allocation?.caution_acceptances||[],coverage:S.chainCoverage(chains,group,data.unassigned),unassigned:data.unassigned,plots,parties};
}
async function reviewGroup(containerKey,vendorId,options={}) {
  const loaded=await loadGroup(containerKey,vendorId,options),review=evaluate(loaded);
  for(const n of loaded.networks){for(const op of n.graph.operations.filter(o=>o.transport)){for(const [field,label] of [["bilty_no","Bilty"],["eway_bill_no","E-way bill"]]){const number=op.transport[field];if(number&&await require("../models/eudrInventory.model").Transfer.exists({[`transport.${field}`]:number,invoice:{$ne:op.invoice}}).session(options.session))review.checkIssues.push({code:`REUSED:${field}:${id(op)}`,text:`${label} ${number} appears on different canonical invoices`,ask:`the correct ${label.toLowerCase()} for this invoice`});}}}
  if(review.status[0]==="Complete"&&review.checkIssues.length)review.status=["Document check issue","warn"];
  const relevantSpecies=new Set([...loaded.group.rows.flatMap(r=>(r.species_composition||[]).map(s=>id(s.species))),...loaded.networks.flatMap(n=>n.graph.lots.map(l=>id(l.species)))]);
  review.input_fingerprint=fingerprint([require("./eudrReport.service").CFT_M3_FACTOR,loaded.group.rows,loaded.group.vendor,loaded.chains.map(c=>[id(c),c.declaration_lines,c.stages.map(s=>[s.kind,s.verified_at,s.documents.map(d=>[d.sha256,d.type])]),c.inventory_status]),loaded.networks.map(n=>[n.graph,n.sources,n.invoices]),loaded.plots,loaded.parties,loaded.species.filter(s=>relevantSpecies.has(id(s))),{exporter_wastage_bp:loaded.rules?.exporter_wastage_bp},loaded.acceptances,loaded.priorDeclarations,loaded.unassigned,loaded.coverage,review.missing,review.numberIssues,review.cautions,review.checkIssues]);
  const latest=await R.Submission.findOne({container_key:containerKey,vendor:vendorId}).sort({submitted_at:-1}).session(options.session).lean();
  review.report_status=latest?(latest.input_fingerprint===review.input_fingerprint?"Sent to Europe office":"Changed after sending"):"Not sent";
  if(review.report_status==="Sent to Europe office")review.status=["Sent to Europe office","neutral"];
  review.vendor_name=loaded.group.vendor.name;review.request_text=requestText(loaded.group,review);return review;
}
module.exports={enabled,networkReview,evaluate,reviewGroup,loadGroup,requestText,fingerprint,ratioNeed};
