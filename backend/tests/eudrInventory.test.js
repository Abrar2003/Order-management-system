const test=require("node:test"),assert=require("node:assert/strict");
const mongoose=require("mongoose"),I=require("../services/eudrInventory.service");
const {extract}=require("../services/eudrInventoryMigration.service");
const {chainVerified,assertFinalCft,chainCoverage,externalInvalidation}=require("../services/eudrChain.service");
const {invoiceKey,shipmentMilliCft,toMilliCft,parseTimberCft}=require("../helpers/timberCft");
const id=()=>new mongoose.Types.ObjectId();
for(const [value,expected] of [["0",0],["1.001",1001],["300",300000],["9007199254740.991",Number.MAX_SAFE_INTEGER]]){
  test("canonical milli-CFT parses "+value,()=>assert.equal(I.cft(value,false),expected));
}
for(const value of ["","-1","1.0001","Infinity","NaN","1e3","0x10","9007199254740.992"]){
  test("canonical quantity rejects "+JSON.stringify(value),()=>assert.throws(()=>I.cft(value),e=>e.code==="INVALID_QUANTITY"));
}
test("arithmetic guards protect existing shipment helpers without changing line rounding",()=>{
  assert.equal(shipmentMilliCft(0.333,0.5),167);assert.throws(()=>toMilliCft(Number.MAX_VALUE));assert.throws(()=>shipmentMilliCft(9000000000000,2));assert.throws(()=>parseTimberCft(9007199254741));
});
test("canonical identity retains April boundary, issuer and normalized punctuation",()=>{
  assert.equal(invoiceKey({issuer_gst:" gst / 1 ",invoice_number:"a-1",invoice_date:"2026-03-31"}),"GST1|2025|A1");
  assert.equal(invoiceKey({issuer_gst:"GST1",invoice_number:"A1",invoice_date:"2026-04-01"}),"GST1|2026|A1");
});
test("private storage keys are stripped recursively while identities and BSON references survive",()=>{
  const object=id(),date=new Date(),r=I.publicRecord({key:"secret",identity_key:"invoice",documents:[{key:"other",_id:object}],at:date});
  assert.equal(r.key,undefined);assert.equal(r.documents[0].key,undefined);assert.equal(r.documents[0]._id,object);assert.equal(r.at,date);assert.equal(r.identity_key,"invoice");
});
test("source constraints preserve unknown and confirmed participation without a fabricated minimum",()=>{
  const rows=I.inputs([{lot:String(id()),participation:"CONFIRMED"},{lot:String(id()),participation:"POSSIBLE",min_cft:"0",max_cft:"20",evidence_note:"documented bound"}]);
  assert.equal(rows[0].min_milli,undefined);assert.equal(rows[1].min_milli,0);assert.equal(rows[1].max_milli,20000);
});
test("invalid object references and excessive input lists fail at the API trust boundary",()=>{
  assert.throws(()=>I.objectId("anything"));assert.throws(()=>I.inputs(Array.from({length:101},()=>({lot:String(id())}))));
});
test("new models enforce permanent canonical uniqueness and invoice/lot/transaction indexes",()=>{
  for(const Model of [I.M.Invoice,I.M.SourceBatch,I.M.Lot,I.M.Transfer,I.M.Mix,I.M.Commitment])assert.ok(Model.schema.indexes().some(([f,o])=>f.identity_key===1&&o.unique),Model.modelName);
  assert.ok(I.M.Commitment.schema.indexes().some(([f,o])=>f.chain===1&&o.unique));assert.ok(I.M.Transfer.schema.indexes().some(([f])=>f["inputs.lot"]===1));
});
test("migration discovers sale / receipt links without inferring production or exact mix amounts",()=>{
  const seller={_id:"seller",kind:"sawmill",fields:{gst:"GST1",pan:"PAN1",invoice_number:"A",invoice_date:"2026-01-01",sold_cft:"500",buyer_gst:"G2",buyer_pan:"P2"},documents:[{type:"cutting_invoice",key:"original",name:"invoice.pdf"}]};
  const receiver={_id:"receiver",kind:"receiver",incoming_invoice_stage_id:"seller",fields:{received_cft:"490"}};
  const r=extract({stages:[seller,receiver]});assert.equal(r.invoices.length,1);assert.equal(r.invoices[0].receiver,receiver);assert.equal(r.invoices[0].quantity,500000);assert.ok(r.reasons.some(r=>r.includes("Production quantity")));
});
test("incomplete and malformed legacy invoices become review items",()=>{
  const r=extract({stages:[{_id:"bad",kind:"sawmill",fields:{invoice_number:"A",invoice_date:"bad",gst:"GST"},documents:[]}]});
  assert.equal(r.invoices.length,0);assert.ok(r.reasons.length);
});
test("inventory-backed final review blocks missing CFT and held quantity; zero is not missing",()=>{
  const group={stuffed_milli_cft:1000,stuffed_cft:1,shipment_signature:"s",vendor_signature:"v",excluded:[]};
  const chain={inventory_backed:true,inventory_status:"COMMITTED",declared_milli_cft:1000,contribution_milli_cft:1000,stages:[{kind:"declaration",verified_at:new Date(),shipment_signature:"s"}]};
  assert.equal(chainVerified(chain,group),true);group.excluded=[{timber_cft:null}];
  assert.throws(()=>assertFinalCft(chain,group,[]),/Missing Timber_CFT/);assert.equal(chainCoverage([chain],group).complete,false);
  group.excluded=[];chain.inventory_status="ON_HOLD";assert.equal(chainVerified(chain,group),false);
});
test("model validation rejects unsupported material, lifecycle and floating authoritative quantities",async()=>{
  const lot=new I.M.Lot({identity_key:"x",owner:"party",kind:"RECEIPT",quantity_milli:1.2,available_date:"2026-01-01",material:"PHYSICAL_STOCK",status:"APPROVED"});
  await assert.rejects(()=>lot.validate(),e=>Boolean(e.errors.quantity_milli&&e.errors.material&&e.errors.status));
});
test("stable request digests ignore object key order but retain source constraints",()=>{
  assert.equal(I.digest({b:2,a:1}),I.digest({a:1,b:2}));assert.notEqual(I.digest({min:0}),I.digest({min:1}));
});
test("inherited inventory declarations invalidate when vendor identity or stuffing dates change",()=>{
  const stage={kind:"declaration",workflow_version:3,verified_at:new Date(),vendor_signature:"vendor1",shipment_signature:"dated1"};
  const group={vendor_signature:"vendor1",shipment_signature:"legacy",inventory_shipment_signature:"dated1"};
  assert.equal(externalInvalidation([stage],group),null);
  assert.match(externalInvalidation([stage],{...group,vendor_signature:"vendor2"}).reason,/GST/);
  assert.match(externalInvalidation([stage],{...group,inventory_shipment_signature:"dated2"}).reason,/date/);
});
test("legacy approvals do not silently complete a partially inventory-backed container",()=>{
  const group={stuffed_milli_cft:1000,stuffed_cft:1,shipment_signature:"s",vendor_signature:"v",excluded:[]};
  const common={declared_milli_cft:1000,contribution_milli_cft:500,stages:[{kind:"declaration",verified_at:new Date(),shipment_signature:"s"}]};
  const legacy={...common},inventory={...common,inventory_backed:true,inventory_status:"COMMITTED"};
  const coverage=chainCoverage([legacy,inventory],group);assert.equal(coverage.complete,false);assert.equal(coverage.legacy_review_required_cft,0.5);
  assert.equal(chainCoverage([inventory,{...inventory}],group).complete,true);
});
