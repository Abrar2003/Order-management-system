import test from "node:test";
import assert from "node:assert/strict";
import {lineageLayout,sourcePayload,rangeLabel,milliLabel} from "./eudrInventory.js";
import {normalizeChainDocuments} from "./eudrDocuments.js";
test("unknown contribution selection never submits hidden exact amounts",()=>{
  assert.deepEqual(sourcePayload([{lot:"A",selected:true,participation:"CONFIRMED",exact_cft:"500"},{lot:"B",selected:false}],"UNKNOWN"),[{lot:"A",participation:"CONFIRMED"}]);
});
test("partial source bounds preserve evidence and explicit numeric zero",()=>{
  assert.deepEqual(sourcePayload([{lot:"A",selected:true,min_cft:"0",max_cft:"200",evidence_note:"reviewed"}],"PARTIAL"),[{lot:"A",participation:"POSSIBLE",min_cft:"0",max_cft:"200",evidence_note:"reviewed"}]);
});
test("range labels retain uncertainty and fully committed zero",()=>{
  assert.equal(rangeLabel({uncommitted_min_milli:0,uncommitted_max_milli:200000}),"0.000–200.000 CFT (feasible range)");
  assert.equal(rangeLabel({uncommitted_min_milli:0,uncommitted_max_milli:0}),"0.000 CFT");
});
test("milli-CFT display retains exact thousandths at the safe integer boundary",()=>{
  assert.equal(milliLabel(Number.MAX_SAFE_INTEGER),"9007199254740.991");
  assert.equal(milliLabel(-1001),"-1.001");assert.equal(milliLabel(0),"0.000");
});
test("DAG layout merges branches at one canonical transaction without duplicating lots",()=>{
  const n={lots:[{_id:"A"},{_id:"B"},{_id:"C"}],operations:[{_id:"sale",inputs:[{lot:"A"},{lot:"B"}],output_lot:"C",quantity_milli:600000,mode:"UNKNOWN"}]};
  const r=lineageLayout(n);assert.equal(r.nodes.length,4);assert.equal(r.edges.length,3);assert.ok(r.nodes.find(n=>n.id==="C").x>r.nodes.find(n=>n.id==="op:sale").x);
});
test("lineage cycle and empty networks fail safely",()=>{
  assert.equal(lineageLayout({lots:[]}).nodes.length,0);
  assert.match(lineageLayout({lots:[{_id:"A"}],operations:[{_id:"t",inputs:[{lot:"A"}],output_lot:"A"}]}).error,/cycle/);
});
test("shared canonical evidence uses inventory endpoints and deduplicates local copies",()=>{
  const docs=normalizeChainDocuments({stages:[{_id:"s",kind:"sawmill",documents:[{_id:"local",name:"original.pdf",sha256:"same"}]}],inventory_documents:[{_id:"canonical",name:"original.pdf",sha256:"same",purpose:"invoice"}]});
  assert.equal(docs.length,1);assert.equal(docs[0].inventoryDocumentId,"canonical");assert.equal(docs[0].stageName,"Shared inventory evidence");
});
