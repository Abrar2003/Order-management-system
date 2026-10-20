export const milliLabel = value => {
  const milli=Math.abs(Number(value||0));
  return (Number(value)<0?"-":"")+Math.floor(milli/1000)+"."+String(milli%1000).padStart(3,"0");
};
export const rangeLabel = range => !range ? "Reconciliation pending" : range.uncommitted_min_milli === range.uncommitted_max_milli ? milliLabel(range.uncommitted_min_milli) + " CFT" : milliLabel(range.uncommitted_min_milli) + "–" + milliLabel(range.uncommitted_max_milli) + " CFT (feasible range)";
export const sourcePayload = (rows, mode) => rows.filter(r => r.selected).map(r => ({
  lot: r.lot, participation: r.participation || "POSSIBLE",
  ...(mode !== "UNKNOWN" ? Object.fromEntries(["exact_cft", "min_cft", "max_cft", "evidence_note"].filter(k => r[k] != null && r[k] !== "").map(k => [k, r[k]])) : {}),
}));
export function lineageLayout(network) {
  const nodes = new Map(), edges = [];
  const invoices=new Map((network.invoices||[]).map(i=>[String(i._id),i]));
  for (const lot of network.lots || []) nodes.set(String(lot._id), { id: String(lot._id), kind: lot.kind === "SOURCE" ? "source" : "lot", label: invoices.get(String(lot.invoice))?.number || (lot.kind==="SOURCE"?"Production source":lot.kind==="TRANSFORMED"?"Processing output":lot.holder_snapshot?.name || lot.owner), detail: lot.material + " · " + milliLabel(lot.quantity_milli) + " CFT", status: lot.status, lotId: String(lot._id) });
  for (const lot of network.lots || []) if(lot.owner) {
    const partyId="party:"+lot.owner;
    if(!nodes.has(partyId))nodes.set(partyId,{id:partyId,kind:"party",label:lot.holder_snapshot?.name||lot.owner,detail:"Holder identity · no quantity entitlement",status:""});
    edges.push([partyId,String(lot._id),"ownership"]);
  }
  for (const op of network.operations || []) {
    const id = "op:" + op._id;
    nodes.set(id, { id, kind: op.kind === "TRANSFORMATION" ? "transformation" : op.container ? "container" : "transfer", label: op.container || op.kind || "Transfer", detail: milliLabel(op.quantity_milli) + " CFT · " + op.mode, status: op.status, recordId: op._id });
    for (const input of op.inputs || []) if (nodes.has(String(input.lot))) edges.push([String(input.lot), id]);
    if (op.output_lot && nodes.has(String(op.output_lot))) edges.push([id, String(op.output_lot)]);
  }
  for (const mix of network.mixes || []) {
    const id = "mix:" + mix._id;
    nodes.set(id, { id, kind: "mix", label: mix.physical_mixing ? "Physical mixing evidence" : "Logical grouping", detail: "Shared inputs · creates no capacity", status: mix.status });
    for (const input of mix.inputs || []) if (nodes.has(String(input.lot))) edges.push([String(input.lot), id]);
  }
  const levels = new Map([...nodes.keys()].map(id => [id,0]));
  for (let pass = 0; pass < nodes.size; pass++) {
    let changed = false;
    for (const [from,to] of edges) if (levels.get(to) <= levels.get(from)) { levels.set(to, levels.get(from) + 1); changed = true; }
    if (!changed) break;
    if (pass === nodes.size - 1) return { nodes: [], edges: [], error: "Lineage contains a cycle; review required" };
  }
  const counts = new Map();
  for (const node of nodes.values()) { const level = levels.get(node.id), row = counts.get(level) || 0; counts.set(level,row+1); Object.assign(node,{x:20+level*270,y:20+row*120}); }
  return { nodes: [...nodes.values()], edges, width: 280 + Math.max(0,...levels.values())*270, height: 40+Math.max(1,...counts.values())*120 };
}
