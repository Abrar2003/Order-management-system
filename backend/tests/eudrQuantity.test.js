const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcile, integer, sum } = require("../services/eudrQuantity.service");
const lot = (_id, owner, quantity, available_date = "2026-01-01", incoming_operation) => ({ _id, owner, quantity_milli: quantity * 1000, available_date, kind: incoming_operation ? "RECEIPT" : "SOURCE", material: "RAW", status: "COMMITTED", incoming_operation });
const op = (_id, seller, buyer, quantity, inputs, date = "2026-01-10") => ({ _id, seller, buyer, quantity_milli: quantity * 1000, output_quantity_milli: quantity * 1000, inputs: inputs.map(lot => ({ lot })), date, mode: "UNKNOWN", status: "COMMITTED", input_material: "RAW" });
const base = () => {
  const a = { ...op("a", "mill", "X", 500, ["root"], "2026-01-02"), output_lot: "A" };
  const b = { ...op("b", "mill", "X", 300, ["root"], "2026-01-04"), output_lot: "B" };
  const sale = { ...op("sale", "X", "Boranada", 600, ["A", "B"]), output_lot: "C" };
  return { lots: [lot("root", "mill", 1000), lot("A", "X", 500, "2026-01-02", "a"), lot("B", "X", 300, "2026-01-04", "b"), lot("C", "Boranada", 600, "2026-01-10", "sale")], operations: [a, b, sale] };
};
test("mandatory production 1000 / purchases 500 + 300 / unknown sale 600: global ranges", () => {
  const graph = base(), before = JSON.stringify(graph);
  const r = reconcile(graph, ["root", "A", "B", ["A", "B"], "C"]);
  assert.equal(r.feasible, true);
  assert.deepEqual(r.ranges.map(x => [x.uncommitted_min_milli, x.uncommitted_max_milli]), [[200000,200000],[0,200000],[0,200000],[200000,200000],[600000,600000]]);
  assert.equal(JSON.stringify(graph), before); assert.equal(r.allocation_is_provenance, false);
});
for (const selected of ["A", "B"]) {
  test(`mandatory A/B/D/E: final 200 from ${selected} passes; both globally exhausted`, () => {
    const graph = base(); graph.operations.push(op("final", "X", "other", 200, [selected]));
    const r = reconcile(graph, ["A", "B", ["A", "B"]]);
    assert.equal(r.feasible, true); assert.ok(r.ranges.every(x => x.uncommitted_max_milli === 0));
    graph.operations.push(op("extra1", "X", "other", 1, ["B"])); assert.equal(reconcile(graph).feasible, false);
    graph.operations.pop(); graph.operations.push(op("new-chain", "X", "container", 100, ["A", "B"])); assert.equal(reconcile(graph).feasible, false);
  });
}
test("mandatory C: another 300 cannot fit the shared network", () => { const g = base(); g.operations.push(op("extra", "X", "other", 300, ["A"])); assert.equal(reconcile(g).feasible, false); });
test("mandatory F: downstream 250 + 350 accounts once; another 1 fails", () => {
  const g = base(); g.operations.push(op("b250", "Boranada", "one", 250, ["C"]), op("b350", "Boranada", "two", 350, ["C"]));
  assert.equal(reconcile(g, ["root"]).ranges[0].committed_min_milli, 800000);
  g.operations.push(op("b1", "Boranada", "three", 1, ["C"])); assert.equal(reconcile(g).feasible, false);
});
test("mandatory G/H: original production cannot reopen; fresh distinct evidence adds capacity", () => {
  const g = base(); g.operations.push(op("excess", "mill", "other", 201, ["root"])); assert.equal(reconcile(g).feasible, false);
  g.lots.push(lot("fresh", "mill", 50)); g.operations.at(-1).inputs.push({ lot: "fresh" }); assert.equal(reconcile(g).feasible, true);
});
test("exact / partial bounds constrain the same global equations", () => {
  const g = base(), sale = g.operations.at(-1); sale.mode = "PARTIAL"; sale.inputs[0] = { lot: "A", min_milli: 400000, evidence_note: "weighed source" };
  assert.equal(reconcile(g, ["A"]).ranges[0].uncommitted_max_milli, 100000);
  g.operations.push(op("extra", "X", "other", 200, ["A"])); assert.equal(reconcile(g).feasible, false);
  sale.mode = "EXACT"; sale.inputs = [{ lot: "A", exact_milli: 300000, evidence_note: "weighed" }, { lot: "B", exact_milli: 300000, evidence_note: "weighed" }]; assert.equal(reconcile(g).feasible, true);
});
test("three inputs, nested mixes and shared branches reconcile simultaneously", () => {
  const g = base(); g.lots.push(lot("D", "X", 100));
  g.operations.at(-1).inputs.push({ lot: "D" });
  g.operations.push({ ...op("onward", "Boranada", "Z", 550, ["C"], "2026-01-11"), output_lot: "Z" });
  g.lots.push(lot("Z", "Z", 550, "2026-01-11", "onward"), lot("Z2", "Z", 50));
  g.operations.push(op("nested", "Z", "final", 600, ["Z", "Z2"], "2026-01-12"), op("branch", "X", "other", 300, ["A", "B", "D"]));
  assert.equal(reconcile(g).feasible, true); g.operations.at(-1).quantity_milli++; assert.equal(reconcile(g).feasible, false);
});
test("chronology, ownership and material cannot borrow unrelated supply", () => {
  for (const change of [g => g.operations.at(-1).date = "2026-01-03", g => g.lots[1].owner = "stranger", g => g.operations.at(-1).input_material = "FINISHED"]) {
    const g = base(); change(g); assert.throws(() => reconcile(g));
  }
  const g = base(); g.operations.at(-1).date = "2026-01-04"; assert.equal(reconcile(g).warnings[0].code, "SAME_DAY_REVIEW");
});
test("cycle, phantom receipts, draft and duplicate sources fail closed", () => {
  const g = base(); g.operations[0].inputs = [{ lot: "A" }]; assert.throws(() => reconcile(g), e => e.code === "LINEAGE_CYCLE");
  for (const change of [g => g.operations[0].status = "DRAFT", g => g.lots[1].quantity_milli++, g => g.operations.at(-1).inputs.push({ lot: "A" })]) { const g = base(); change(g); assert.throws(() => reconcile(g)); }
});
test("held commitments keep consuming historical capacity; cancellation explicitly releases", () => {
  const g = base(); g.operations.at(-1).status = "ON_HOLD";
  assert.equal(reconcile(g, [["A","B"]]).ranges[0].uncommitted_max_milli, 200000);
  g.operations.at(-1).status = "CANCELLED"; g.lots.pop(); assert.equal(reconcile(g, [["A","B"]]).ranges[0].uncommitted_max_milli, 800000);
});
test("integer arithmetic rejects unsafe quantities and overflow", () => {
  for (const q of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => integer(q));
  assert.throws(() => sum([Number.MAX_SAFE_INTEGER, 1]));
});
test("corrected canonical line limits and dates constrain existing transfer entitlements",()=>{
  const g=base();g.operations[0].invoice="invoice-A";g.operations[0].line_id="1";
  g.invoice_limits=[{_id:"invoice-A",date:"2026-01-02",lines:[{line_id:"1",quantity_milli:400000}]}];
  assert.equal(reconcile(g).feasible,false);
  g.invoice_limits[0].lines[0].quantity_milli=500000;assert.equal(reconcile(g).feasible,true);
  g.invoice_limits[0].date="2026-01-03";assert.throws(()=>reconcile(g),e=>e.code==="CHRONOLOGY_CONFLICT");
});
test("individually feasible source range maxima cannot be spent together",()=>{
  const g=base();
  g.operations.push(op("a200","X","other",200,["A"]),op("b200","X","other",200,["B"]));
  assert.equal(reconcile(g).feasible,false);
});
test("minimum contributions cannot exceed a sale even when each source has capacity",()=>{
  const g=base();g.operations.at(-1).mode="PARTIAL";
  g.operations.at(-1).inputs.forEach(i=>{i.min_milli=400000;i.evidence_note="documented bound";});
  assert.equal(reconcile(g).feasible,false);
});
test("one container can consume exact partial quantities from several lots",()=>{
  const g={lots:[lot("V1","vendor",100),lot("V2","vendor",250)],operations:[{...op("container","vendor","container",300,["V1","V2"]),mode:"EXACT",inputs:[{lot:"V1",exact_milli:100000,evidence_note:"container contribution"},{lot:"V2",exact_milli:200000,evidence_note:"container contribution"}]}]};
  const r=reconcile(g,["V1","V2"]);assert.equal(r.feasible,true);assert.deepEqual(r.ranges.map(x=>x.uncommitted_max_milli),[0,50000]);
});
test("small random graphs match exhaustive integer assignments including partial bounds", () => {
  let seed = 391; const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < 200; run++) {
    const capacities = [random(5), random(5), random(5)];
    const demands = Array.from({ length: 3 }, () => ({ qty: 1 + random(4), eligible: [0,1,2].filter(() => random(2)) }));
    const solve = (i, left) => {
      if (i === demands.length) return true;
      const d = demands[i];
      const distribute = (j, qty, current) => {
        if (j === d.eligible.length) return qty === 0 && solve(i + 1, current);
        const index = d.eligible[j];
        for (let x = 0; x <= Math.min(qty, current[index]); x++) { const next = [...current]; next[index] -= x; if (distribute(j + 1, qty - x, next)) return true; }
        return false;
      };
      return distribute(0, d.qty, left);
    };
    const g = { lots: capacities.map((q,i) => ({ ...lot(String(i), "X", q), quantity_milli: q })), operations: demands.map((d,i) => ({ ...op(`d${i}`, "X", "Y", d.qty, d.eligible.map(String)), quantity_milli: d.qty, output_quantity_milli: d.qty })) };
    if (demands.some(d => !d.eligible.length)) { assert.throws(() => reconcile(g)); continue; }
    assert.equal(reconcile(g).feasible, solve(0, capacities), `random graph ${run}`);
  }
});
test("feasible range extrema match exhaustive bounded assignments",()=>{
  for(let a=1;a<=4;a++)for(let b=1;b<=4;b++)for(let demand=1;demand<=5;demand++){
    const operations=[{...op("mix","X","Y",demand,["A","B"]),quantity_milli:demand,output_quantity_milli:demand,mode:"PARTIAL",inputs:[{lot:"A",min_milli:1,max_milli:3,evidence_note:"bound"},{lot:"B"}]},{...op("branch","X","Z",1,["A"]),quantity_milli:1,output_quantity_milli:1}];
    const graph={lots:[{...lot("A","X",a),quantity_milli:a},{...lot("B","X",b),quantity_milli:b}],operations};
    const witnesses=[];
    for(let x=1;x<=3;x++)if(x<=demand&&demand-x<=b&&x+1<=a)witnesses.push(x+1);
    const r=reconcile(graph,["A","B",["A","B"]]);
    assert.equal(r.feasible,witnesses.length>0);
    if(witnesses.length){assert.equal(r.ranges[0].committed_min_milli,Math.min(...witnesses));assert.equal(r.ranges[0].committed_max_milli,Math.max(...witnesses));assert.equal(r.ranges[2].uncommitted_max_milli,a+b-demand-1);}
  }
});
