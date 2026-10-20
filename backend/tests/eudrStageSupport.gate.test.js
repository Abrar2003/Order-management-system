const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTIVE, reconcile } = require("../services/eudrQuantity.service");

// These fixtures use small integer milli-CFT, not rounded CFT or production data.
const lot = (_id, quantity, owner, material, incoming_operation) => ({
  _id, quantity_milli: quantity, owner, material, incoming_operation,
  kind: incoming_operation ? "RECEIPT" : "SOURCE", status: "COMMITTED",
  available_date: incoming_operation ? "2026-01-04" : "2026-01-01", species: "species-1",
});
const operation = (_id, quantity, inputs, seller, buyer, material, output_lot) => ({
  _id, quantity_milli: quantity, output_quantity_milli: quantity, seller, buyer,
  inputs: inputs.map(lot => ({ lot })), input_material: material, output_lot,
  date: "2026-01-05", mode: "UNKNOWN", status: "COMMITTED", species: "species-1",
});

function branch(graph, suffix, quantity, roots) {
  const sourceIds = roots || [`raw-${suffix}`];
  if (!roots) graph.lots.push(lot(sourceIds[0], quantity, "mill", "RAW"));
  graph.operations.push(
    { ...operation(`saw-${suffix}`, quantity, sourceIds, "mill", "mill", "RAW", `sawn-${suffix}`), date: "2026-01-02", kind: "TRANSFORMATION", output_material: "PROCESSING_INPUT" },
    { ...operation(`sale-${suffix}`, quantity, [`sawn-${suffix}`], "mill", "vendor", "PROCESSING_INPUT", `received-${suffix}`), date: "2026-01-03", kind: "TRANSFER", output_material: "PROCESSING_INPUT" },
    { ...operation(`make-${suffix}`, quantity, [`received-${suffix}`], "vendor", "vendor", "PROCESSING_INPUT", `finished-${suffix}`), date: "2026-01-04", kind: "TRANSFORMATION", output_material: "FINISHED" },
  );
  graph.lots.push(
    { ...lot(`sawn-${suffix}`, quantity, "mill", "PROCESSING_INPUT", `saw-${suffix}`), available_date: "2026-01-02" },
    { ...lot(`received-${suffix}`, quantity, "vendor", "PROCESSING_INPUT", `sale-${suffix}`), available_date: "2026-01-03" },
    lot(`finished-${suffix}`, quantity, "vendor", "FINISHED", `make-${suffix}`),
  );
}

function separateBranches(a, b, demand, competing = 0) {
  const graph = { lots: [], operations: [] };
  branch(graph, "a", a); branch(graph, "b", b);
  graph.operations.push(operation("group", demand, ["finished-a", "finished-b"], "vendor", "container-G", "FINISHED"));
  if (competing) graph.operations.push({
    ...operation("other", competing, ["finished-a"], "vendor", "container-H", "FINISHED"), mode: "EXACT",
    inputs: [{ lot: "finished-a", exact_milli: competing, evidence_note: "Documented H allocation" }],
  });
  return graph;
}

function distributions(bounds, total, visit, row = [], index = 0) {
  if (index === bounds.length) { if (total === 0) visit(row); return; }
  const [low, high] = bounds[index];
  for (let amount = low; amount <= Math.min(high, total); amount++) {
    distributions(bounds, total - amount, visit, [...row, amount], index + 1);
  }
}

// Test-only exhaustive oracle: enumerate full documentary allocations, then all
// target labels compatible with those allocations. No proportional split is assumed.
function losslessStageRange(graph, groupIds, stageLotIds) {
  assert.ok(graph.lots.length <= 10 && graph.lots.every(l => l.quantity_milli <= 10));
  const active = graph.operations.filter(o => ACTIVE.has(o.status));
  assert.ok(active.every(o => o.quantity_milli === o.output_quantity_milli), "Loss attribution requires a separately specified policy");
  const lots = new Map(graph.lots.map(l => [l._id, l]));
  const byId = new Map(active.map(o => [o._id, o]));
  const ordered = [], seen = new Set();
  const order = op => {
    if (seen.has(op._id)) return;
    seen.add(op._id);
    for (const input of op.inputs) {
      const parent = byId.get(lots.get(input.lot)?.incoming_operation);
      if (parent) order(parent);
    }
    ordered.push(op);
  };
  active.forEach(order);
  for (const op of active) for (const input of op.inputs) {
    const source = lots.get(input.lot);
    if (!source || !ACTIVE.has(source.status) || source.owner !== op.seller || source.material !== op.input_material || source.available_date > op.date) return null;
  }
  for (const invoice of graph.invoice_limits || []) {
    const uses = active.filter(o => o.invoice === invoice._id);
    if (uses.some(o => o.date !== invoice.date || !invoice.lines.some(l => l.line_id === o.line_id))) return null;
    for (const line of invoice.lines) if (uses.filter(o => o.line_id === line.line_id).reduce((s, o) => s + o.quantity_milli, 0) > line.quantity_milli) return null;
  }
  const remaining = new Map(graph.lots.map(l => [l._id, l.quantity_milli]));
  const allocations = new Map(), taggedUse = new Map(), values = new Set();
  const reverse = [...ordered].reverse();
  const label = index => {
    if (index === reverse.length) {
      values.add(stageLotIds.reduce((total, lotId) => total + (taggedUse.get(lotId) || 0), 0));
      return;
    }
    const op = reverse[index];
    const demand = groupIds.includes(op._id) ? op.quantity_milli : (taggedUse.get(op.output_lot) || 0);
    distributions(allocations.get(op._id).map(amount => [0, amount]), demand, row => {
      op.inputs.forEach((input, i) => taggedUse.set(input.lot, (taggedUse.get(input.lot) || 0) + row[i]));
      label(index + 1);
      op.inputs.forEach((input, i) => taggedUse.set(input.lot, taggedUse.get(input.lot) - row[i]));
    });
  };
  const allocate = index => {
    if (index === ordered.length) { label(0); return; }
    const op = ordered[index];
    const bounds = op.inputs.map(input => [
      input.exact_milli ?? input.min_milli ?? 0,
      Math.min(input.exact_milli ?? input.max_milli ?? op.quantity_milli, remaining.get(input.lot)),
    ]);
    distributions(bounds, op.quantity_milli, row => {
      allocations.set(op._id, row);
      op.inputs.forEach((input, i) => remaining.set(input.lot, remaining.get(input.lot) - row[i]));
      allocate(index + 1);
      op.inputs.forEach((input, i) => remaining.set(input.lot, remaining.get(input.lot) + row[i]));
    });
  };
  allocate(0);
  return values.size ? { min: Math.min(...values), max: Math.max(...values), additive: false, allocation_is_provenance: false } : null;
}

const extrema = range => [range.min, range.max];
const totalUse = (graph, ids) => {
  const result = reconcile(graph, [ids]);
  assert.equal(result.feasible, true);
  assert.equal(result.allocation_is_provenance, false);
  assert.equal(result.ranges[0].additive, false);
  return [result.ranges[0].committed_min_milli, result.ranges[0].committed_max_milli];
};

test("gate: a shared linear transformation counts six globally but only two for G", () => {
  const graph = { lots: [], operations: [] };
  branch(graph, "shared", 6);
  graph.operations.push(operation("group", 2, ["finished-shared"], "vendor", "container-G", "FINISHED"), operation("other", 4, ["finished-shared"], "vendor", "container-H", "FINISHED"));
  assert.deepEqual(totalUse(graph, ["raw-shared"]), [6, 6]);
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-shared"])), [2, 2]);
});

test("gate: upstream unknown branches cannot be replaced with total lot-use ranges", () => {
  const graph = { lots: [lot("raw-a", 4, "mill", "RAW"), lot("raw-b", 4, "mill", "RAW")], operations: [] };
  branch(graph, "shared", 6, ["raw-a", "raw-b"]);
  graph.operations.push(operation("group", 2, ["finished-shared"], "vendor", "container-G", "FINISHED"), operation("other", 4, ["finished-shared"], "vendor", "container-H", "FINISHED"));
  const before = JSON.stringify(graph);
  assert.deepEqual(totalUse(graph, ["raw-a"]), [2, 4]);
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a"])), [0, 2]);
  assert.deepEqual(totalUse(graph, ["raw-a", "raw-b"]), [6, 6]);
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a", "raw-b"])), [2, 2]);
  assert.equal(JSON.stringify(graph), before);
});

test("gate: an exact competing container can exclude an ancestor still used globally", () => {
  const graph = separateBranches(2, 2, 2, 2);
  assert.deepEqual(totalUse(graph, ["raw-a"]), [2, 2]);
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a"])), [0, 0]);
  graph.operations.at(-1).status = "ON_HOLD";
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a"])), [0, 0]);
  graph.operations.at(-1).status = "CANCELLED";
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a"])), [0, 2]);
});

test("gate: exact and partial commitment bounds constrain the target label", () => {
  const graph = separateBranches(3, 3, 3, 1);
  const group = graph.operations.find(o => o._id === "group");
  group.mode = "PARTIAL";
  group.inputs[0] = { lot: "finished-a", min_milli: 1, max_milli: 2, evidence_note: "Documented G bounds" };
  assert.deepEqual(totalUse(graph, ["raw-a"]), [3, 3]);
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a"])), [1, 2]);
  group.mode = "EXACT";
  group.inputs = [{ lot: "finished-a", exact_milli: 1, evidence_note: "G allocation" }, { lot: "finished-b", exact_milli: 2, evidence_note: "G allocation" }];
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a"])), [1, 1]);
});

test("gate: independent maxima for G remain non-additive", () => {
  const graph = separateBranches(2, 2, 2);
  const a = losslessStageRange(graph, ["group"], ["raw-a"]);
  const b = losslessStageRange(graph, ["group"], ["raw-b"]);
  const union = losslessStageRange(graph, ["group"], ["raw-a", "raw-b"]);
  assert.deepEqual([a.max, b.max, union.max], [2, 2, 2]);
  assert.equal(union.allocation_is_provenance, false);
});

test("gate: exhaustive labelled ranges preserve competing demand over small networks", () => {
  let checked = 0;
  for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let demand = 1; demand <= 6; demand++) for (let other = 0; other <= a; other++) {
    const graph = separateBranches(a, b, demand, other);
    const range = losslessStageRange(graph, ["group"], ["raw-a"]);
    assert.equal(reconcile(graph).feasible, range !== null);
    if (demand > a - other + b) assert.equal(range, null);
    else assert.deepEqual(extrema(range), [Math.max(0, demand - b), Math.min(demand, a - other)]);
    checked++;
  }
  assert.equal(checked, 162);
});

test("gate: the labelled oracle retains canonical invoice limits and chronology", () => {
  const graph = separateBranches(2, 2, 2, 2);
  graph.operations.filter(o => o.kind === "TRANSFER").forEach(o => { o.invoice = "invoice"; o.line_id = "1"; });
  graph.invoice_limits = [{ _id: "invoice", date: "2026-01-03", lines: [{ line_id: "1", quantity_milli: 4 }] }];
  assert.deepEqual(extrema(losslessStageRange(graph, ["group"], ["raw-a"])), [0, 0]);
  assert.equal(reconcile(graph).feasible, true);
  graph.invoice_limits[0].lines[0].quantity_milli = 3;
  assert.equal(losslessStageRange(graph, ["group"], ["raw-a"]), null);
  assert.equal(reconcile(graph).feasible, false);
  graph.invoice_limits[0].lines[0].quantity_milli = 4;
  graph.invoice_limits[0].date = "2026-01-06";
  assert.equal(losslessStageRange(graph, ["group"], ["raw-a"]), null);
  assert.throws(() => reconcile(graph), e => e.code === "CHRONOLOGY_CONFLICT");
});

test("gate: recorded aggregate loss does not define container gross-input attribution", () => {
  const graph = { lots: [], operations: [] };
  branch(graph, "shared", 6);
  graph.lots.find(l => l._id === "raw-shared").quantity_milli = 10;
  const saw = graph.operations.find(o => o._id === "saw-shared");
  saw.quantity_milli = 10; saw.loss_milli = 4;
  graph.operations.push(operation("group", 3, ["finished-shared"], "vendor", "container-G", "FINISHED"), operation("other", 3, ["finished-shared"], "vendor", "container-H", "FINISHED"));
  assert.deepEqual(totalUse(graph, ["raw-shared"]), [10, 10]);
  assert.throws(() => losslessStageRange(graph, ["group"], ["raw-shared"]), /Loss attribution requires/);
  const possibleGross = [];
  for (let groupLoss = 0; groupLoss <= saw.loss_milli; groupLoss++) {
    const grossG = 3 + groupLoss, grossH = 3 + saw.loss_milli - groupLoss;
    assert.equal(grossG + grossH, saw.quantity_milli);
    possibleGross.push(grossG);
  }
  assert.deepEqual([Math.min(...possibleGross), Math.max(...possibleGross)], [3, 7]);
  assert.equal(3 * saw.quantity_milli / saw.output_quantity_milli, 5);
});
