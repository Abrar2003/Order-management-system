// Integer lower-bound circulation. A feasible witness is never recorded as physical provenance.
const ACTIVE = new Set(["RESERVED", "COMMITTED", "ON_HOLD"]);
const error = (code, message, details, statusCode = 409) => Object.assign(new Error(message), { code, statusCode, details });
const integer = (value, label = "milli-CFT") => {
  if (!Number.isSafeInteger(value) || value < 0) throw error("INVALID_QUANTITY", `${label} must be a non-negative safe integer`, null, 400);
  return value;
};
const sum = (values) => values.reduce((a, b) => integer(a + integer(b)), 0);
const date = (value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw error("INVALID_DATE", "A valid documentary date is required", null, 400);
  return value;
};
const id = (value) => String(value?._id ?? value ?? "");

function circulation(edges, size, budget = { steps: 0 }) {
  const graph = Array.from({ length: size + 2 }, () => []);
  const balance = Array(size).fill(0);
  const add = (u, v, capacity) => {
    const a = { v, capacity, reverse: graph[v].length };
    const b = { v: u, capacity: 0, reverse: graph[u].length };
    graph[u].push(a); graph[v].push(b);
  };
  for (const [u, v, lower, upper] of edges) {
    if (lower > upper) return false;
    add(u, v, upper - lower); balance[u] -= lower; balance[v] += lower;
  }
  const source = size, sink = size + 1;
  let required = 0;
  for (let i = 0; i < size; i++) {
    if (balance[i] > 0) { add(source, i, balance[i]); required = sum([required, balance[i]]); }
    if (balance[i] < 0) add(i, sink, -balance[i]);
  }
  let flow = 0;
  // Iterative augmenting paths avoid recursion limits on adversarial graphs.
  for (;;) {
    const prev = Array(graph.length).fill(null), queue = [source]; prev[source] = [-1, -1];
    for (let q = 0; q < queue.length && !prev[sink]; q++) {
      const u = queue[q];
      graph[u].forEach((edge, index) => {
        if (++budget.steps > 5000000) throw error("SOLVER_WORK_LIMIT", "Reconciliation exceeds the work limit; narrow the requested ranges or review the network", null, 413);
        if (edge.capacity > 0 && !prev[edge.v]) { prev[edge.v] = [u, index]; queue.push(edge.v); }
      });
    }
    if (!prev[sink]) return flow === required;
    let amount = required - flow;
    for (let v = sink; v !== source; v = prev[v][0]) amount = Math.min(amount, graph[prev[v][0]][prev[v][1]].capacity);
    for (let v = sink; v !== source; v = prev[v][0]) {
      const [u, index] = prev[v], edge = graph[u][index];
      edge.capacity -= amount; graph[v][edge.reverse].capacity += amount;
    }
    flow += amount;
    if (flow === required) return true;
  }
}

function model({ lots = [], operations = [], invoice_limits = [] }) {
  for(const op of operations)if(op.species_allocations?.length&&(sum(op.species_allocations.map(r=>r.quantity_milli))!==op.quantity_milli||new Set(op.species_allocations.map(r=>id(r.species))).size!==op.species_allocations.length||op.species_allocations.some(r=>!r.species)))throw error("SPECIES_MISMATCH","Species suballocations must be distinct and sum to the commitment",null,400);
  operations=operations.flatMap(op=>op.species_allocations?.length?op.species_allocations.map(row=>({...op,_id:`${id(op)}:${id(row.species)}`,species:row.species,quantity_milli:row.quantity_milli,inputs:row.inputs,mode:row.mode||op.mode,species_allocations:undefined})): [op]);
  if (lots.length > 2000 || operations.length > 4000 || sum(operations.map(o => (o.inputs || []).length)) > 16000) throw error("GRAPH_LIMIT", "Documentary network exceeds the reconciliation limit; split the review workload", null, 413);
  const byId = new Map(lots.map(lot => [id(lot), lot]));
  if (byId.size !== lots.length) throw error("DUPLICATE_LOT", "Duplicate lot identity");
  const active = operations.filter(o => ACTIVE.has(o.status));
  sum(active.map(o=>o.quantity_milli));
  const opById = new Map(operations.map(o => [id(o), o]));
  if (opById.size !== operations.length) throw error("DUPLICATE_TRANSACTION", "Duplicate transaction identity");
  const warnings = [];
  let invoiceConflict = false;
  for (const invoice of invoice_limits) {
    const transfers = active.filter(o => id(o.invoice) === id(invoice));
    for (const op of transfers) if (op.date !== invoice.date) throw error("CHRONOLOGY_CONFLICT", "Sale allocation date must match its canonical invoice date", { transaction: id(op), invoice: id(invoice),sale_date:op.date,invoice_date:invoice.date });
    for (const op of transfers) {
      const line = invoice.lines.find(l => l.line_id === op.line_id);
      if(/^[a-f\d]{24}$/i.test(id(line?.species))&&id(line.species)!==id(op.species))throw error("SPECIES_MISMATCH","Transfer species must match its canonical invoice line",{transaction:id(op),invoice:id(invoice)});
      if (!line || sum(transfers.filter(t => t.line_id === op.line_id).map(t => t.quantity_milli)) > line.quantity_milli) invoiceConflict = true;
    }
  }
  const parents = new Map();
  for (const lot of lots) {
    integer(lot.quantity_milli); date(lot.available_date);
    if (lot.incoming_operation) {
      const incoming = opById.get(id(lot.incoming_operation));
      if(incoming&&(lot.species||incoming.species)&&id(lot.species)!==id(incoming.species))throw error("SPECIES_MISMATCH","Receipt species must match its incoming operation",{lot:id(lot)});
      if (!incoming || id(incoming.output_lot) !== id(lot) || incoming.buyer !== lot.owner || lot.quantity_milli > (incoming.output_quantity_milli ?? incoming.quantity_milli)) throw error("INVALID_RECEIPT", "Receipt lot does not match its incoming transaction", { lot: id(lot) });
      parents.set(id(lot), (incoming.inputs || []).map(input => id(input.lot)));
    } else if (lot.kind !== "SOURCE") throw error("UNBACKED_LOT", "Only evidenced production can be a root capacity", { lot: id(lot) });
  }
  const visited = new Set(), visiting = new Set();
  const visit = (lotId, depth) => {
    if (depth > 200) throw error("GRAPH_LIMIT", "Lineage depth exceeds 200", null, 413);
    if (visiting.has(lotId)) throw error("LINEAGE_CYCLE", "Self-supplying lineage is prohibited", { lot: lotId });
    if (visited.has(lotId)) return;
    visiting.add(lotId); (parents.get(lotId) || []).forEach(p => visit(p, depth + 1)); visiting.delete(lotId); visited.add(lotId);
  };
  lots.forEach(lot => visit(id(lot), 0));
  const edges = [], nodes = new Map();
  const budget = { steps: 0 };
  const node = name => { if (!nodes.has(name)) nodes.set(name, nodes.size); return nodes.get(name); };
  const s = node("s"), t = node("t");
  const capacity = sum(lots.map(lot => lot.quantity_milli));
  for (const lot of lots) node(`lot:${id(lot)}`);
  for (const op of active) {
    integer(op.quantity_milli); date(op.date);
    if (op.output_quantity_milli != null && integer(op.output_quantity_milli) > op.quantity_milli) throw error("RECEIPT_EXCEEDS_SUPPLY","Output cannot exceed its documented transfer or processing input",{transaction:id(op)});
    if (!op.quantity_milli || !op.inputs?.length || !["EXACT", "PARTIAL", "UNKNOWN"].includes(op.mode)) throw error("INVALID_INPUTS", "Active transactions require quantity, sources and an allocation mode");
    const demand = node(`op:${id(op)}`);
    edges.push([demand, t, op.quantity_milli, op.quantity_milli]);
    const seen = new Set();
    const minimumTotal=sum(op.inputs.map(input=>input.exact_milli??input.min_milli??0));
    if(minimumTotal>op.quantity_milli)invoiceConflict=true;
    for (const input of op.inputs) {
      const lotId = id(input.lot), lot = byId.get(lotId);
      if (!lot || seen.has(lotId) || lot.owner !== op.seller || lot.material !== op.input_material) throw error("INVALID_SOURCE", "Source must be a distinct linked lot of the seller with the correct material basis", { transaction: id(op), lot: lotId });
      if ((lot.species || op.species) && id(lot.species)!==id(op.species)) throw error("SPECIES_MISMATCH","Source and output must have the same recorded species",{transaction:id(op),lot:lotId});
      seen.add(lotId);
      if (lot.available_date > op.date) throw error("CHRONOLOGY_CONFLICT", "A future receipt cannot support an earlier transaction", { transaction: id(op), lot: lotId, available_date: lot.available_date, transaction_date: op.date });
      if (lot.available_date === op.date) warnings.push({ code: "SAME_DAY_REVIEW", transaction: id(op), lot: lotId });
      if (!ACTIVE.has(lot.status) || (lot.incoming_operation && !ACTIVE.has(opById.get(id(lot.incoming_operation))?.status))) throw error("UNSPENDABLE_SOURCE", "Draft, cancelled or rejected supply cannot support commitments", { lot: lotId });
      if (op.mode === "UNKNOWN" && (input.exact_milli != null || input.min_milli != null || input.max_milli != null)) throw error("INVALID_BOUNDS", "Unknown inputs must not assert quantities", null, 400);
      if (op.mode === "EXACT" && input.exact_milli == null) throw error("INVALID_BOUNDS", "Exact mode requires every evidenced quantity", null, 400);
      const low = integer(input.exact_milli ?? input.min_milli ?? 0);
      const high = integer(input.exact_milli ?? input.max_milli ?? op.quantity_milli);
      if ((low || input.max_milli != null || input.exact_milli != null) && !input.evidence_note) throw error("BOUNDS_EVIDENCE_REQUIRED", "Contribution bounds require an evidence explanation", null, 400);
      edges.push([node(`lot:${lotId}`), demand, low, high]);
    }
  }
  edges.push([t, s, 0, capacity]);
  const feasible = (selected = new Set(), lower = 0, upper = capacity) => {
    if (invoiceConflict) return false;
    const e = [...edges], pool = nodes.size;
    if (selected.size) e.push([s, pool, lower, upper]);
    for (const lot of lots) e.push([selected.has(id(lot)) ? pool : s, node(`lot:${id(lot)}`), 0, lot.quantity_milli]);
    return circulation(e, nodes.size + (selected.size ? 1 : 0), budget);
  };
  return { feasible, warnings, byId, active };
}

function reconcile(graph, rangeIds = []) {
  const m = model(graph), feasible = m.feasible();
  const result = { feasible, status: feasible ? "QUANTITY_FEASIBLE" : "CONFLICT_DETECTED", warnings: m.warnings, transaction_ids: m.active.map(id), ranges: [], allocation_is_provenance: false };
  if (!feasible) return result;
  if (rangeIds.length > 50) throw error("RANGE_LIMIT", "Request at most 50 range groups", null, 413);
  for (const group of rangeIds) {
    const ids = Array.isArray(group) ? group.map(id) : [id(group)];
    if (new Set(ids).size !== ids.length || ids.some(i => !m.byId.has(i))) throw error("INVALID_RANGE", "Range contains duplicate or missing lots", null, 400);
    const selected = new Set(ids), capacity = sum(ids.map(i => m.byId.get(i).quantity_milli));
    let lo = 0, hi = capacity;
    while (lo < hi) { const mid = lo + Math.floor((hi - lo) / 2); if (m.feasible(selected, 0, mid)) hi = mid; else lo = mid + 1; }
    const minimumUse = lo; lo = 0; hi = capacity;
    while (lo < hi) { const mid = lo + Math.ceil((hi - lo) / 2); if (m.feasible(selected, mid, capacity)) lo = mid; else hi = mid - 1; }
    result.ranges.push({ lot_ids: ids, documented_milli: capacity, committed_min_milli: minimumUse, committed_max_milli: lo, uncommitted_min_milli: capacity - lo, uncommitted_max_milli: capacity - minimumUse, additive: false });
  }
  return result;
}

module.exports = { ACTIVE, error, integer, sum, date, id, reconcile, circulation };
