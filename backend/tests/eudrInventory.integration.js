// Isolated loopback replica set only; never reads MONGO_URI or connects to OMS data.
const test=require("node:test"),assert=require("node:assert/strict");
const mongoose=require("mongoose");
const replicaSet=require("./helpers/eudrReplicaSet");
const I=require("../services/eudrInventory.service"),{M}=I;
const migration=require("../services/eudrInventoryMigration.service");
const Vendor=require("../models/vendor.model"),Chain=require("../models/eudrChain.model"),Party=require("../models/eudrParty.model");
const Order=require("../models/order.model"),Sample=require("../models/sample.model"),Item=require("../models/item.model");
const User=require("../models/user.model");
const {signAccessToken}=require("../services/authToken.service");
const {lineage}=require("../controllers/eudrInventory.controller");

test("inventory ledger transaction, migration and API integration",async t=>{
  const previousFlag=process.env.EUDR_CANONICAL_INVOICES;process.env.EUDR_CANONICAL_INVOICES="true";
  t.after(()=>{if(previousFlag===undefined)delete process.env.EUDR_CANONICAL_INVOICES;else process.env.EUDR_CANONICAL_INVOICES=previousFlag;});
  const db=await replicaSet();t.after(db.close);
  await Chain.createCollection();await Chain.createIndexes();await Vendor.createCollection();await Party.createCollection();
  await I.ensureIndexes();await M.State.updateOne({_id:"global"},{$set:{registry_ready:true,allocation_enabled:true}});
  const user={_id:new mongoose.Types.ObjectId(),name:"Inventory admin",role:"admin"};
  const vendors=[];
  for(const [i,name] of ["Sawmill","Party X","Boranada","Other customer"].entries()){
    const pan="ABCDE"+String(1000+i)+"F",gst="08"+pan+"1Z5";
    vendors.push(await Vendor.create({name,pan,gst}));
  }
  const party=index=>({kind:"vendor",id:String(vendors[index]._id)});
  const doc=async purpose=>M.Document.create({key:"test/"+purpose+"/"+new mongoose.Types.ObjectId(),name:purpose+".pdf",purpose,sha256:String(new mongoose.Types.ObjectId()),size:10,content_type:"application/pdf"});
  const sourceDocs=await Promise.all(["production","license","permission","forest_image"].map(doc));
  const review={revision:1,note:"Reviewed test documentary evidence",origins_reviewed:true,same_day_reviewed:true};
  let source,A,B,C,transformation;
  const sourceBody={owner:party(0),production_reference:"PROD-1000",quantity_cft:"1000",production_date:"2026-01-01",documents:sourceDocs.map(d=>String(d._id)),origins:[{plot:"Forest 1",latitude:26,longitude:73,permission:"P1",species:""}]};
  const newInvoice=async(number,seller,buyer,qty,date="2026-01-02",material="RAW")=>{
    const file=await doc("invoice");
    const body={issuer:party(seller),buyer:party(buyer),number,date,total_cft:String(qty),lines:[{line_id:"1",quantity_cft:String(qty),material}],documents:[String(file._id)]};
    return {body,invoice:await I.registerInvoice(body,user)};
  };
  const newTransfer=async(invoice,seller,buyer,qty,lots,date=invoice.date,received=qty,fulfillment="full")=>{
    const docs=await Promise.all(["weight_slip","billty","driver_license","ewaybill","receipt"].map(doc));
    return I.createTransfer({seller:party(seller),buyer:party(buyer),invoice:String(invoice._id),line_id:"1",fulfillment,sold_cft:String(qty),received_cft:String(received),date,receipt_date:date,inputs:lots.map(lot=>({lot:String(lot),participation:"POSSIBLE"})),mode:"UNKNOWN",documents:invoice.documents.map(String),transport_documents:docs.slice(0,4).map(d=>String(d._id)),receipt_documents:[String(docs[4]._id)],discrepancy_note:received!==qty?"Documented transport shortage":""},user);
  };
  await t.test("source evidence gates activation, unique production creates only one root",async()=>{
    source=await I.createSource(sourceBody,user);
    assert.equal(String((await I.createSource(sourceBody,user))._id),String(source._id));
    assert.equal(await M.SourceBatch.countDocuments(),1);
    await assert.rejects(()=>I.createSource({...sourceBody,production_reference:"DUPLICATE"},user),e=>e.code==="SOURCE_EVIDENCE_REUSED");
    source=await I.verify("batches",source._id,review,user);
    assert.equal((await M.Lot.findById(source.output_lot)).status,"COMMITTED");
    const pending=await I.createSource({...sourceBody,production_reference:"UNVERIFIED-DRAFT",documents:[],origins:[]},user);
    await assert.rejects(()=>I.verify("batches",pending._id,review,user),e=>e.code==="EVIDENCE_REQUIRED");
    const freshDocs=await Promise.all(["production","license","permission","forest_image"].map(doc));
    const incomplete=await I.createSource({...sourceBody,production_reference:"INCOMPLETE-FOREST",documents:freshDocs.map(d=>String(d._id)),origins:[]},user);
    await assert.rejects(()=>I.verify("batches",incomplete._id,review,user),e=>e.code==="ORIGIN_EVIDENCE_PENDING");
  });
  await t.test("canonical normalization, reuse, conflict, lines and financial years",async()=>{
    const a=await newInvoice("a-001",0,1,500);
    assert.equal(String((await I.registerInvoice({...a.body,number:"A / 001"},user))._id),String(a.invoice._id));
    await assert.rejects(()=>I.registerInvoice({...a.body,total_cft:"501",lines:[{line_id:"1",quantity_cft:"501",material:"RAW"}]},user),e=>e.code==="INVOICE_IDENTITY_CONFLICT");
    await assert.rejects(()=>I.registerInvoice({...a.body,number:"OTHER"},user),e=>e.code==="DOCUMENT_IDENTITY_CONFLICT");
    const multiFile=await doc("invoice"),body={...a.body,number:"MULTI",documents:[String(multiFile._id)],total_cft:"30",lines:[{line_id:"1",quantity_cft:"10",material:"RAW"},{line_id:"2",quantity_cft:"20",material:"RAW"}]};
    const multi=await I.registerInvoice(body,user);assert.equal(multi.lines.length,2);
    await assert.rejects(()=>I.registerInvoice({...body,lines:[...body.lines,{line_id:"1",quantity_cft:"1",material:"RAW"}]},user),e=>e.code==="INVALID_LINES");
    const multiTransfer=await newTransfer(multi,0,1,10,[source.output_lot]);
    const retry={seller:party(0),buyer:party(1),invoice:String(multi._id),line_id:"1",sold_cft:"10",received_cft:"10",date:multi.date,receipt_date:multi.date,mode:"UNKNOWN",inputs:[{lot:String(source.output_lot),participation:"POSSIBLE"}],documents:multi.documents.map(String),transport_documents:multiTransfer.transport_documents.map(String),receipt_documents:multiTransfer.receipt_documents.map(String)};
    assert.equal(String((await I.createTransfer(retry,user))._id),String(multiTransfer._id));
    await I.editDraft(multiTransfer._id,{revision:1,discrepancy_note:"Updated draft receipt explanation"},user);
    await assert.rejects(()=>I.createTransfer(retry,user),e=>e.code==="TRANSACTION_IDENTITY_CONFLICT");
    await assert.rejects(()=>I.createTransfer({seller:party(0),buyer:party(1),invoice:String(multi._id),line_id:"1",fulfillment:"part-2",sold_cft:"1",received_cft:"1",date:multi.date,inputs:[{lot:String(source.output_lot)}]},user),e=>e.code==="INVOICE_LINE_EXCEEDED");
    const previous=await newInvoice("a-001",0,1,500,"2025-03-31");assert.notEqual(previous.invoice.identity_key,a.invoice.identity_key);
    await I.verify("invoices",a.invoice._id,review,user);A=await newTransfer(a.invoice,0,1,500,[source.output_lot],"2026-01-02");A=await I.verify("transfers",A._id,review,user);
    const b=await newInvoice("B",0,1,300,"2026-01-04");await I.verify("invoices",b.invoice._id,review,user);B=await newTransfer(b.invoice,0,1,300,[source.output_lot],"2026-01-04");B=await I.verify("transfers",B._id,review,user);
  });
  await t.test("unknown 600 sale, receipt lot, conservation and conservative origin set",async()=>{
    const c=await newInvoice("C600",1,2,600,"2026-01-05");await I.verify("invoices",c.invoice._id,review,user);
    C=await newTransfer(c.invoice,1,2,600,[A.output_lot,B.output_lot]);C=await I.verify("transfers",C._id,review,user);
    const graph=await I.component([C.output_lot]),r=I.Q.reconcile(graph,[[String(A.output_lot),String(B.output_lot)]]);
    assert.equal(r.ranges[0].uncommitted_max_milli,200000);
    assert.ok(C.inputs.every(i=>i.exact_milli==null));
    const network=await lineage(String(C.output_lot));assert.equal(network.potential_origins.length,1);assert.equal(network.potential_origins[0].plot,"Forest 1");
  });
  await t.test("an earlier invoice cannot borrow a later purchase or a caller-selected later sale date",async()=>{
    const sale=await newInvoice("EARLY-SALE",1,3,1,"2026-01-03");await I.verify("invoices",sale.invoice._id,review,user);
    const draft=await newTransfer(sale.invoice,1,3,1,[B.output_lot]);
    await assert.rejects(()=>I.verify("transfers",draft._id,review,user),e=>e.code==="CHRONOLOGY_CONFLICT");
    assert.equal((await M.Transfer.findById(draft._id)).status,"DRAFT");
    await assert.rejects(()=>newTransfer(sale.invoice,1,3,1,[B.output_lot],"2026-01-10"),e=>e.code==="CHRONOLOGY_CONFLICT");
  });
  await t.test("competing sales serialize globally; idempotency, no partial writes",async()=>{
    const d=await newInvoice("D200",1,3,200,"2026-01-05"),e=await newInvoice("E200",1,3,200,"2026-01-05");
    await I.verify("invoices",d.invoice._id,review,user);await I.verify("invoices",e.invoice._id,review,user);
    const td=await newTransfer(d.invoice,1,3,200,[A.output_lot]),te=await newTransfer(e.invoice,1,3,200,[B.output_lot]);
    const results=await Promise.allSettled([I.reserveTransfer(td._id,user),I.reserveTransfer(te._id,user)]);
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(results.find(r=>r.status==="rejected").reason.code,"GLOBAL_QUANTITY_CONFLICT");
    const winner=results[0].status==="fulfilled"?td:te,loser=winner===td?te:td;
    assert.equal((await M.Transfer.findById(loser._id)).status,"DRAFT");
    assert.equal((await M.Lot.findById(loser.output_lot)).status,"DRAFT");
    await I.reserveTransfer(winner._id,user);
    const r=I.Q.reconcile(await I.component([A.output_lot]),[String(A.output_lot),String(B.output_lot)]);
    assert.ok(r.ranges.every(x=>x.uncommitted_max_milli===0));
    await I.cancel("transfers",winner._id,{revision:1,reason:"Release test reservation",documents:[String(sourceDocs[0]._id)]},user);
    const count=await M.Audit.countDocuments();
    await assert.rejects(()=>I.withInventory(user,async(session)=>{await M.Audit.create([{event:"must_rollback"}],{session});throw new Error("rollback");}),/rollback/);
    assert.equal(await M.Audit.countDocuments(),count);
  });
  await t.test("processing conversion consumes once; unsupported yield and raw container sources blocked",async()=>{
    const file=await doc("transformation");
    transformation=await I.createTransfer({kind:"TRANSFORMATION",seller:party(2),idempotency_key:"PROCESS-1",sold_cft:"600",received_cft:"500",date:"2026-01-11",receipt_date:"2026-01-11",input_material:"RAW",output_material:"FINISHED",mode:"UNKNOWN",inputs:[{lot:String(C.output_lot)}],documents:[String(file._id)],discrepancy_note:"Verified 100 CFT processing loss"},user);
    transformation=await I.verify("transfers",transformation._id,review,user);
    const r=I.Q.reconcile(await I.component([source.output_lot]),[String(source.output_lot),String(C.output_lot),String(transformation.output_lot)]);
    assert.deepEqual(r.ranges.map(x=>x.uncommitted_max_milli),[200000,0,500000]);
    const unsupported=await I.createTransfer({kind:"TRANSFORMATION",seller:party(2),idempotency_key:"BAD-YIELD",sold_cft:"600",received_cft:"601",date:"2026-01-11",input_material:"RAW",output_material:"FINISHED",inputs:[],documents:[]},user);
    assert.equal(unsupported.status,"DRAFT");assert.equal((await M.Lot.findById(unsupported.output_lot)).status,"DRAFT");
    await assert.rejects(()=>I.verify("transfers",unsupported._id,review,user),e=>e.code==="RECEIPT_EXCEEDS_SUPPLY");
  });
  await t.test("concurrent unknown mixes connecting independent source graphs cannot overspend",async()=>{
    const roots=[];
    for(let index=0;index<2;index++){
      const files=await Promise.all(["production","license","permission","forest_image"].map(doc));
      let root=await I.createSource({...sourceBody,owner:party(1),production_reference:"CONCURRENT-ROOT-"+index,quantity_cft:"50",documents:files.map(d=>String(d._id))},user);
      root=await I.verify("batches",root._id,review,user);roots.push(root.output_lot);
    }
    const ia=await newInvoice("MIX80",1,2,80),ib=await newInvoice("BRANCH30",1,3,30);
    await I.verify("invoices",ia.invoice._id,review,user);await I.verify("invoices",ib.invoice._id,review,user);
    const mixed=await newTransfer(ia.invoice,1,2,80,roots),branch=await newTransfer(ib.invoice,1,3,30,[roots[0]]);
    const outcomes=await Promise.allSettled([I.reserveTransfer(mixed._id,user),I.reserveTransfer(branch._id,user)]);
    assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
    assert.equal(outcomes.find(o=>o.status==="rejected").reason.code,"GLOBAL_QUANTITY_CONFLICT");
    const winner=outcomes[0].status==="fulfilled"?mixed:branch;
    await I.cancel("transfers",winner._id,{revision:1,reason:"Release isolated concurrency fixture",documents:[String(sourceDocs[0]._id)]},user);
  });
  await t.test("receipt shortage consumes seller's 300 but creates only 290 for the buyer",async()=>{
    const files=await Promise.all(["production","license","permission","forest_image"].map(doc));
    let root=await I.createSource({...sourceBody,production_reference:"RECEIPT-DISCREPANCY",quantity_cft:"300",documents:files.map(d=>String(d._id))},user);
    root=await I.verify("batches",root._id,review,user);
    const purchase=await newInvoice("SHORT-300",0,3,300,"2026-01-10");await I.verify("invoices",purchase.invoice._id,review,user);
    let transfer=await newTransfer(purchase.invoice,0,3,300,[root.output_lot],"2026-01-10",290);
    transfer=await I.editDraft(transfer._id,{revision:1,discrepancy_note:""},user);
    await assert.rejects(()=>I.verify("transfers",transfer._id,{...review,revision:2},user),e=>e.code==="RECEIPT_DISCREPANCY");
    transfer=await I.editDraft(transfer._id,{revision:2,discrepancy_note:"Verified transport shortage of 10 CFT"},user);
    transfer=await I.verify("transfers",transfer._id,{...review,revision:3},user);
    const ranges=I.Q.reconcile(await I.component([root.output_lot]),[String(root.output_lot),String(transfer.output_lot)]).ranges;
    assert.equal(ranges[0].uncommitted_max_milli,0);assert.equal(ranges[1].uncommitted_max_milli,290000);
  });
  await t.test("partial fulfillments on separate input graphs share one canonical invoice constraint",async()=>{
    const roots=[];
    for(let index=0;index<2;index++){
      const files=await Promise.all(["production","license","permission","forest_image"].map(doc));
      let root=await I.createSource({...sourceBody,owner:party(1),production_reference:"PARTIAL-ROOT-"+index,quantity_cft:"100",documents:files.map(d=>String(d._id))},user);
      root=await I.verify("batches",root._id,review,user);roots.push(root.output_lot);
    }
    const registered=await newInvoice("PARTIAL-80",1,2,80);await I.verify("invoices",registered.invoice._id,review,user);
    const first=await newTransfer(registered.invoice,1,2,40,[roots[0]]),second=await newTransfer(registered.invoice,1,2,40,[roots[1]],registered.invoice.date,40,"part-2");
    await I.verify("transfers",first._id,review,user);await I.verify("transfers",second._id,review,user);
    const component=await I.component([first.output_lot]);assert.ok(component.operations.some(o=>String(o._id)===String(second._id)));
    const proof=await doc("correction");
    const changed=await I.correct("transfers",first._id,{revision:1,sold_cft:"50",received_cft:"50",documents:[String(proof._id)],reason:"Corrected partial receipt"},user);
    assert.equal(changed.reconciliation.feasible,false);
    assert.equal(I.Q.reconcile(await I.component([second.output_lot])).feasible,false);
    await I.cancel("transfers",first._id,{revision:2,documents:[String(proof._id)],reason:"Reverse corrected fulfillment pending investigation"},user);
  });
  let chains=[];
  await t.test("two containers share one vendor lot; final clearance and missing timber guard",async()=>{
    const query=rows=>({select(){return this;},session(){return this;},lean:async()=>rows});
    t.mock.method(Order,"find",()=>query(chains.map(c=>({_id:String(c._id),vendor:{vendor_id:String(vendors[2]._id)},item:{item_code:"TABLE"},shipment:[{_id:String(c._id),container:c.container,quantity:(c.contribution_milli_cft??c.declared_milli_cft)/1000,stuffing_date:"2026-01-12"}]}))));
    t.mock.method(Sample,"find",()=>query([]));t.mock.method(Item,"find",()=>query([{code:"TABLE",timber_cft:1}]));
    for(const [container,q] of [["C1",250],["C2",250],["C3",1]])chains.push(await Chain.create({container,container_key:container.toLowerCase(),vendor:vendors[2]._id,declared_milli_cft:q*1000,contribution_milli_cft:q*1000,stages:[{kind:"declaration",documents:[{type:"declaration",key:"test/declaration",name:"declaration.pdf"}]}]}));
    const body=c=>({chain:String(c._id),quantity_cft:String(c.contribution_milli_cft/1000),date:"2026-01-12",mode:"UNKNOWN",inputs:[{lot:String(transformation.output_lot)}]});
    const outcomes=await Promise.allSettled(chains.slice(0,2).map(c=>I.reserve(body(c),user)));assert.ok(outcomes.every(o=>o.status==="fulfilled"),outcomes.filter(o=>o.status==="rejected").map(o=>o.reason.stack).join("\n"));
    const commitment=await I.reserve(body(chains[0]),user);assert.equal(await M.Commitment.countDocuments(),2);
    await assert.rejects(()=>I.reserve(body(chains[2]),user),e=>e.code==="GLOBAL_QUANTITY_CONFLICT");
    await I.clearance(chains[0]._id,user);assert.equal((await M.Commitment.findById(commitment._id)).status,"COMMITTED");
    t.mock.method(Item,"find",()=>query([{code:"TABLE",timber_cft:null}]));
    await assert.rejects(()=>I.clearance(chains[1]._id,user),e=>e.code==="TIMBER_COVERAGE_INCOMPLETE");
    t.mock.method(Item,"find",()=>query([{code:"TABLE",timber_cft:1}]));
    const releaseFile=await doc("reversal");await I.release(commitment._id,{revision:1,reason:"Controlled reversal",documents:[String(releaseFile._id)]},user);
    await I.reserve(body(chains[2]),user);
    const competing=[];
    for(const container of ["RACE-C4","RACE-C5"]){
      const c=await Chain.create({container,container_key:container.toLowerCase(),vendor:vendors[2]._id,declared_milli_cft:200000,contribution_milli_cft:200000});
      chains.push(c);competing.push(c);
    }
    const race=await Promise.allSettled(competing.map(c=>I.reserve(body(c),user)));
    assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(race.find(r=>r.status==="rejected").reason.code,"GLOBAL_QUANTITY_CONFLICT");
  });
  await t.test("canonical document and API permission checks preserve verification; pagination has no hard ceiling",async()=>{
    const express=require("express"),router=require("../routers/eudrChain.routes");
    process.env.JWT_SECRET="isolated-ledger-secret";
    const manager={...user,role:"manager"},viewer={...user,_id:new mongoose.Types.ObjectId(),role:"viewer"};
    t.mock.method(User,"findById",id=>({select:()=>({populate:()=>({lean:async()=>String(id)===String(viewer._id)?viewer:manager})})}));
    const app=express();app.use(express.json());app.use("/eudr",router);
    const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(()=>{server.closeAllConnections();server.close();});
    const base="http://127.0.0.1:"+server.address().port+"/eudr/inventory";
    const headers={Authorization:"Bearer "+signAccessToken(manager)};
    assert.equal((await fetch(base+"/batches")).status,401);
    assert.equal((await fetch(base+"/batches",{headers:{Authorization:"Bearer "+signAccessToken(viewer)}})).status,403);
    const list=await fetch(base+"/batches?limit=2",{headers});assert.equal(list.status,200);const result=await list.json();assert.equal(result.data.length,2);assert.ok(result.pagination.total>2);assert.ok(!JSON.stringify(result).includes('"key":'));
    const restricted=await fetch(base+"/invoices/"+A.invoice+"/correction",{method:"PATCH",headers:{...headers,"Content-Type":"application/json"},body:"{}"});assert.equal(restricted.status,403);
    delete process.env.EUDR_CANONICAL_INVOICES;
    try {
      const blocked=await fetch(base.replace("/inventory","")+"/"+chains[0]._id+"/stages/anything/verify",{method:"POST",headers});
      assert.equal(blocked.status,503);assert.equal((await blocked.json()).code,"CANONICAL_ROLLOUT_REQUIRED");
    }finally{process.env.EUDR_CANONICAL_INVOICES="true";}
    const before=JSON.stringify(await M.SourceBatch.findById(source._id).lean());
    t.mock.method(require("../services/wasabiStorage.service"),"getSignedObjectUrl",async()=>"https://private.example.test/temporary");
    const download=await fetch(base+"/documents/"+sourceDocs[0]._id+"/url?download=1",{headers});assert.equal(download.status,200);assert.match(download.headers.get("cache-control"),/no-store/);
    assert.equal(JSON.stringify(await M.SourceBatch.findById(source._id).lean()),before);
    assert.equal((await fetch(base+"/batches/not-an-id",{headers})).status,400);
  });
  await t.test("correction preserves commitments and places downstream approvals on hold",async()=>{
    const evidence=await doc("correction"),count=await M.Commitment.countDocuments();
    const r=await I.correct("batches",source._id,{revision:1,quantity_cft:"700",reason:"Corrected production evidence",documents:[String(evidence._id)]},user);
    assert.equal(r.reconciliation.feasible,false);assert.equal(await M.Commitment.countDocuments(),count);
    await assert.rejects(()=>I.createSource({...sourceBody,production_reference:"OLD-PROOF-REUSE"},user),e=>e.code==="SOURCE_EVIDENCE_REUSED");
    assert.ok(await M.Commitment.countDocuments({status:"ON_HOLD"}));
    await assert.rejects(()=>I.verify("batches",source._id,{...review,revision:2},user),e=>e.code==="SOURCE_EVIDENCE_PENDING");
    await assert.rejects(()=>I.cancel("batches",source._id,{revision:2,reason:"Cannot delete completed history",documents:[String(evidence._id)]},user),e=>e.code==="DOWNSTREAM_REVERSAL_REQUIRED");
  });
  await t.test("reviewed corrections recover held reservations without releasing historical usage",async()=>{
    const count=await M.Commitment.countDocuments();
    await I.correct("batches",source._id,{revision:2,quantity_cft:"1000",reason:"Restore quantity from reviewed original production evidence",documents:sourceDocs.map(d=>String(d._id))},user);
    await I.verify("batches",source._id,{...review,revision:3},user);
    for(const record of [A,B,C,transformation])await I.verify("transfers",record._id,review,user);
    const held=await M.Commitment.find({status:"ON_HOLD"});
    assert.ok(held.length>1);
    for(const commitment of held)await I.reserve({chain:String(commitment.chain),quantity_cft:String(commitment.quantity_milli/1000),date:commitment.date,mode:commitment.mode,inputs:commitment.inputs.map(i=>({lot:String(i.lot),participation:i.participation}))},user);
    assert.equal(await M.Commitment.countDocuments(),count);
    assert.equal(I.Q.reconcile(await I.component([transformation.output_lot]),[String(transformation.output_lot)]).ranges[0].uncommitted_max_milli,49000);
  });
  await t.test("invoice proof remains owned after replacement; non-quantity evidence can be shared",async()=>{
    const registered=await newInvoice("PROOF-OWNER",0,1,50),replacement=await doc("invoice"),licence=await doc("license");
    await I.correct("invoices",registered.invoice._id,{revision:1,total_cft:"50",lines:registered.body.lines,documents:[String(replacement._id),String(licence._id)],reason:"Replace illegible invoice evidence"},user);
    await assert.rejects(()=>I.registerInvoice({...registered.body,number:"STOLEN-OLD-PROOF"},user),e=>e.code==="DOCUMENT_IDENTITY_CONFLICT");
    const distinct=await doc("invoice");
    await I.registerInvoice({...registered.body,number:"SHARED-LICENCE",documents:[String(distinct._id),String(licence._id)]},user);
    assert.ok(await M.Invoice.exists({invoice_documents:registered.invoice.documents[0]}));
  });
  await t.test("leaf reversals can unwind an already infeasible held network in audited steps",async()=>{
    const files=await Promise.all(["production","license","permission","forest_image"].map(doc));
    let root=await I.createSource({...sourceBody,production_reference:"REVERSAL-ROOT",quantity_cft:"100",documents:files.map(d=>String(d._id))},user);
    root=await I.verify("batches",root._id,review,user);
    const leaves=[];
    for(let index=0;index<2;index++){
      const registered=await newInvoice("REVERSAL-LEAF-"+index,0,1,50);await I.verify("invoices",registered.invoice._id,review,user);
      const leaf=await newTransfer(registered.invoice,0,1,50,[root.output_lot]);leaves.push(await I.verify("transfers",leaf._id,review,user));
    }
    const proof=await doc("correction");
    await I.correct("batches",root._id,{revision:1,quantity_cft:"1",reason:"Disputed root quantity",documents:[String(proof._id)]},user);
    await I.cancel("transfers",leaves[0]._id,{revision:1,reason:"Reverse first disputed leaf",documents:[String(proof._id)]},user);
    assert.equal((await M.Transfer.findById(leaves[1]._id)).status,"ON_HOLD");
    assert.equal(I.Q.reconcile(await I.component([root.output_lot])).feasible,false);
    await I.cancel("transfers",leaves[1]._id,{revision:1,reason:"Reverse remaining disputed leaf",documents:[String(proof._id)]},user);
    assert.equal(I.Q.reconcile(await I.component([root.output_lot])).feasible,true);
    assert.equal((await M.Lot.findById(root.output_lot)).status,"ON_HOLD");
    assert.equal(await M.Transfer.countDocuments({_id:{$in:leaves.map(l=>l._id)},status:"CANCELLED"}),2);
    const audit=await M.Audit.findOne({event:"transaction_reversed",entity:leaves[0]._id});assert.equal(audit.details.reconciliationAfter.feasible,false);
  });
  await t.test("transaction support failure closes before writes",async child=>{
    const count=await M.Audit.countDocuments();mongoose.connection.$supportsTransactions=false;
    await assert.rejects(()=>I.createSource({...sourceBody,production_reference:"NO-TX"},user),e=>e.code==="MONGODB_TRANSACTIONS_REQUIRED");
    mongoose.connection.$supportsTransactions=true;assert.equal(await M.Audit.countDocuments(),count);
    child.mock.method(mongoose.connection,"transaction",async()=>{throw Object.assign(new Error("Transaction numbers are only allowed on a replica set member or mongos"),{code:20});});
    await assert.rejects(()=>I.createSource({...sourceBody,production_reference:"SERVER-NO-TX"},user),e=>e.code==="MONGODB_TRANSACTIONS_REQUIRED");
    assert.equal(await M.SourceBatch.countDocuments({identity_key:/SERVERNOTX/}),0);
  });
  await t.test("migration dry run, incomplete history, idempotent rerun and safe index transition",async()=>{
    const legacy=await Chain.create({container:"LEGACY",container_key:"legacy",vendor:vendors[2]._id,declared_milli_cft:1000,stages:[{kind:"sawmill",fields:{name:"Old mill",gst:vendors[0].gst,pan:vendors[0].pan,invoice_number:"LEGACY-1",invoice_date:"2026-01-02",sold_cft:"10",buyer_gst:vendors[2].gst,buyer_pan:vendors[2].pan,sold_to:"Boranada"},documents:[{type:"cutting_invoice",key:"old/private/invoice",name:"old.pdf"}],verified_at:new Date()}]});
    const prior=await M.Invoice.countDocuments();const dry=await migration.report();assert.ok(dry.reviews.some(r=>r.chain===String(legacy._id)));assert.equal(await M.Invoice.countDocuments(),prior);
    await migration.migrate(user);const count=await M.Invoice.countDocuments();await migration.migrate(user);assert.equal(await M.Invoice.countDocuments(),count);
    let invoice=await M.Invoice.findOne({number:"LEGACY-1"});assert.equal(invoice.status,"DRAFT");assert.equal(invoice.legacy,true);
    await assert.rejects(()=>I.verify("invoices",invoice._id,review,user),e=>e.code==="LEGACY_CHECKSUM_REVIEW_REQUIRED");
    const hashedProof=await doc("invoice");
    invoice=(await I.correct("invoices",invoice._id,{revision:1,total_cft:"10",lines:[{line_id:"1",quantity_cft:"10",material:"RAW"}],documents:[String(hashedProof._id)],reason:"Reviewed hashed legacy invoice evidence"},user)).record;
    const updated=await Chain.findById(legacy._id);assert.ok(updated.stages[0].verified_at);assert.equal(updated.inventory_backed,false);
    const sourceEvidence=await Promise.all(["production","license","permission","forest_image"].map(doc));
    let fresh=await I.createSource({...sourceBody,production_reference:"MANUAL-LEGACY-ROOT",quantity_cft:"10",documents:sourceEvidence.map(d=>String(d._id))},user);
    fresh=await I.verify("batches",fresh._id,review,user);
    const legacyTransfer=await newTransfer(invoice,0,2,10,[fresh.output_lot]);
    assert.equal(legacyTransfer.legacy,true);
    await assert.rejects(()=>I.reserveTransfer(legacyTransfer._id,user),e=>e.code==="LEGACY_ALLOCATION_REVIEW_REQUIRED");
    await assert.rejects(()=>I.verify("transfers",legacyTransfer._id,review,user),e=>e.code==="LEGACY_ALLOCATION_REVIEW_REQUIRED");
    const conversionDoc=await doc("transformation");
    const converted=await I.createTransfer({kind:"TRANSFORMATION",seller:party(2),idempotency_key:"LEGACY-REVIEW-CONVERSION",sold_cft:"10",received_cft:"10",date:"2026-01-11",receipt_date:"2026-01-11",input_material:"RAW",output_material:"FINISHED",inputs:[{lot:String(legacyTransfer.output_lot)}],documents:[String(conversionDoc._id)]},user);
    chains.push(legacy);
    const records=[{resource:"invoices",id:String(invoice._id),...review,revision:invoice.revision},{resource:"transfers",id:String(legacyTransfer._id),...review},{resource:"transfers",id:String(converted._id),...review}];
    await assert.rejects(()=>I.reviewLegacyNetwork({reason:"Map historical usage",records,allocations:[]},user),e=>e.code==="HISTORICAL_USES_MISSING");
    await M.State.updateOne({_id:"global"},{$set:{allocation_enabled:false}});
    const imported=await I.reviewLegacyNetwork({reason:"Explicit full historical evidence review",records,allocations:[{chain:String(legacy._id),quantity_cft:"1",date:"2026-01-12",mode:"UNKNOWN",inputs:[{lot:String(converted.output_lot)}]}]},user);
    assert.equal(imported.commitments.length,1);assert.equal((await Chain.findById(legacy._id)).inventory_status,"RESERVED");
    assert.equal(I.Q.reconcile(await I.component([converted.output_lot]),[String(converted.output_lot)]).ranges[0].uncommitted_max_milli,9000);
    await migration.transitionIndex();
    assert.ok(!(await Chain.collection.indexes()).some(i=>i.name==="invoice_keys_1"));
    assert.ok((await M.Invoice.collection.indexes()).some(i=>i.name==="identity_key_1"&&i.unique));
  });
  await t.test("physical mix expands potential origins; logical views create no capacity",async()=>{
    const files=await Promise.all(["production","license","permission","forest_image"].map(doc));
    let additional=await I.createSource({...sourceBody,owner:party(1),production_reference:"FOREST-2-LOT",quantity_cft:"50",documents:files.map(d=>String(d._id)),origins:[{plot:"Forest 2",latitude:25,longitude:74,permission:"P2",species:""}]},user);
    additional=await I.verify("batches",additional._id,review,user);
    const mixDoc=await doc("mix"),before=await M.Lot.countDocuments();
    const mix=await I.createMix({owner:party(1),reference:"PHYSICAL-1",inputs:[{lot:String(A.output_lot)},{lot:String(additional.output_lot)}],physical_mixing:true,documents:[String(mixDoc._id)],note:"Evidence confirms physical mixing"},user);
    assert.equal(await M.Lot.countDocuments(),before);
    const network=await lineage(String(C.output_lot));assert.deepEqual(network.potential_origins.map(o=>o.plot).sort(),["Forest 1","Forest 2"]);
    assert.equal(mix.mode,"UNKNOWN");assert.ok(mix.inputs.every(i=>i.min_milli==null));
    await assert.rejects(()=>I.createMix({owner:party(1),reference:"UNAPPLIED-BOUND",inputs:[{lot:String(A.output_lot),min_cft:"1"},{lot:String(additional.output_lot)}],mode:"PARTIAL"},user),e=>e.code==="MIX_BOUNDS_REQUIRE_TRANSFER");
    await I.cancel("mixes",mix._id,{revision:1,reason:"Audited withdrawal of incorrect physical mixing claim",documents:[String(mixDoc._id)]},user);
    assert.deepEqual((await lineage(String(C.output_lot))).potential_origins.map(o=>o.plot),["Forest 1"]);
    assert.equal((await M.Transfer.findById(C._id)).status,"ON_HOLD");
  });
  await t.test("legacy stage can explicitly reuse a canonical invoice file without another object or entitlement",async()=>{
    const sourceInvoice=await M.Invoice.findById(A.invoice);
    const linked=await Chain.create({container:"LINK",container_key:"link",vendor:vendors[2]._id,declared_milli_cft:1000,contribution_milli_cft:1000,stages:[{kind:"sawmill",workflow_version:2,fields:{name:vendors[0].name,gst:vendors[0].gst,pan:vendors[0].pan,invoice_number:sourceInvoice.number,invoice_date:sourceInvoice.date,sold_to:vendors[1].name,buyer_gst:vendors[1].gst,buyer_pan:vendors[1].pan,sold_cft:"500"}}]});
    chains.push(linked);
    const count=await M.Document.countDocuments(),transfers=await M.Transfer.countDocuments();
    const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
    const req={params:{id:String(linked._id),stageId:String(linked.stages[0]._id)},user,body:{invoice_id:String(sourceInvoice._id),confirmed:true}};
    process.env.EUDR_CANONICAL_INVOICES="true";
    try {
      const res=response();await require("../controllers/eudrChain.controller").reuseInvoice(req,res);
      assert.ok(res.body.data,res.body.message);
      const saved=await Chain.findById(linked._id),document=await M.Document.findById(sourceInvoice.documents[0]);
      assert.equal(saved.stages[0].documents[0].key,document.key);
      assert.equal(await M.Document.countDocuments(),count);assert.equal(await M.Transfer.countDocuments(),transfers);
      assert.equal((await M.Transfer.findById(A._id)).status,"ON_HOLD");
    }finally{delete process.env.EUDR_CANONICAL_INVOICES;}
  });
});
