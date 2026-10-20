import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../../api/axios";
import { normalizeChainDocuments } from "../../utils/eudrDocuments";
import { milliLabel, rangeLabel } from "../../utils/eudrInventory";
import { createDocumentStore } from "./documentStore";
import { DocumentGallery, FullDocumentViewer } from "./DocumentWorkspace";
import { EvidenceForm } from "./InventoryEditor";
import { Select, ReviewRecord, QuantityConflict, LineageGraph, modes } from "./InventoryCommon";
import { InventoryActions, DraftTransferEditor } from "./InventoryRecordActions";
import "./eudr.css";

export function BatchDetail({ batch, onOpen, onBack, onReload }) {
  const [tab,setTab]=useState("Overview"),[viewer,setViewer]=useState(null),[store,setStore]=useState(null);
  const network=batch.network||{}, ranges=network.reconciliation?.ranges||[];
  const docs=useMemo(()=>normalizeChainDocuments({stages:[],inventory_documents:network.documents||[]}),[network.documents]);
  useEffect(()=>{const s=createDocumentStore("inventory");setStore(s);return()=>s.dispose();},[batch._id]);
  const source=network.sources?.find(s=>s._id===batch.source_batch),transfer=network.operations?.find(t=>t._id===batch.incoming_operation),invoice=network.invoices?.find(i=>i._id===batch.invoice);
  return <section className="card om-card card-body"><div className="d-flex justify-content-between gap-2"><div><h2 className="h4">{batch.holder_snapshot?.name||batch.owner}</h2><p>{batch._id} · {invoice?.identity_key||batch.identity_key} · {batch.status}</p></div><button className="btn btn-outline-secondary align-self-start" onClick={onBack}>Back to registry</button></div>
    <div className="d-flex flex-wrap gap-2 mb-3">{["Overview","Upstream sources","Downstream usage","Documents","Verification","History"].map(t=><button className={"btn btn-sm "+(tab===t?"btn-dark":"btn-outline-secondary")} key={t} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {tab==="Overview"&&<><div className="row g-3"><div className="col-md-4">Documented quantity<strong className="d-block">{milliLabel(batch.quantity_milli)} CFT · {batch.material}</strong></div><div className="col-md-4">Potentially uncommitted documentary capacity<strong className="d-block">{rangeLabel(ranges[0])}</strong></div><div className="col-md-4">Shared holder capacity in this network<strong className="d-block">{rangeLabel(ranges[1])}</strong></div></div>
      <p className="mt-3">{network.reconciliation?.status||"Conflict Detected"} · Documentary verification: {batch.verification?.status} · Origin evidence: {batch.origin_status} · Potential origins: {network.potential_origins?.length||0}</p><p className="small text-muted">Feasible ranges share one global constraint system. Their individual maxima must not be added. Balances describe use inside this OMS.</p>{network.reconciliation?.message&&<p className="text-danger">{network.reconciliation.message}</p>}
    </>}
    {tab==="Upstream sources"&&<><LineageGraph network={network} onOpen={onOpen} /><ul className="mt-3">{network.potential_origins?.map((o,i)=><li key={i}>{o.plot} · {o.latitude}, {o.longitude} · Permission {o.permission} · Source {o.source_batch}</li>)}</ul></>}
    {tab==="Downstream usage"&&<div className="table-responsive"><table className="table"><thead><tr><th>Transaction</th><th>Quantity CFT</th><th>Allocation knowledge</th><th>Status</th><th>Container / output lot</th></tr></thead><tbody>{network.operations?.map(o=><tr key={o._id}><td>{o._id}</td><td>{milliLabel(o.quantity_milli)}</td><td>{o.mode}</td><td>{o.status}</td><td>{o.container||o.output_lot}</td></tr>)}</tbody></table></div>}
    {tab==="Downstream usage"&&network.operations?.filter(o=>o.container).map(o=><InventoryActions key={o._id} resource="commitments" record={o} onDone={onReload} />)}
    {tab==="Documents"&&store&&<DocumentGallery documents={docs} chainId="inventory" store={store} onPreview={(d,sequence)=>setViewer({initialId:d.id,documents:sequence})} />}
    {tab==="Verification"&&<>{invoice&&<><ReviewRecord resource="invoices" record={invoice} onDone={onReload} /><InventoryActions resource="invoices" record={invoice} onDone={onReload} /></>}{source&&<><ReviewRecord resource="batches" record={source} onDone={onReload} /><InventoryActions resource="batches" record={source} onDone={onReload} /></>}{transfer&&<><ReviewRecord resource="transfers" record={transfer} onDone={onReload} />{transfer.status==="DRAFT"&&<DraftTransferEditor record={transfer} onDone={onReload} />}<InventoryActions resource="transfers" record={transfer} onDone={onReload} /></>}{network.mixes?.map(m=><div key={m._id}><ReviewRecord resource="mixes" record={m} onDone={onReload} /><InventoryActions resource="mixes" record={m} onDone={onReload} /></div>)}</>}
    {tab==="History"&&<ol>{batch.audit?.map(a=><li key={a._id}>{a.event.replaceAll("_"," ")} · {a.actor_name||"Migration"} · {new Date(a.createdAt).toLocaleString("en-IN")} {a.reason}</li>)}</ol>}
    {viewer&&store&&<FullDocumentViewer chain={{_id:"inventory",stages:[],vendor:{name:batch.holder_snapshot?.name}}} {...viewer} store={store} onClose={()=>setViewer(null)} />}
  </section>;
}

export default function InventoryWorkspace() {
  const [rows,setRows]=useState([]),[search,setSearch]=useState(""),[status,setStatus]=useState(""),[mode,setMode]=useState(""),[page,setPage]=useState(1),[pages,setPages]=useState(1),[total,setTotal]=useState(0),[error,setError]=useState(null),[batch,setBatch]=useState(null),[view,setView]=useState("registry"),[quantity,setQuantity]=useState(""),[container,setContainer]=useState("");
  const requestRevision=useRef(0);
  const load=useCallback(async()=>{const revision=++requestRevision.current;try{const r=await api.get("/eudr/inventory/batches",{params:{search,status,mode,page,quantity,container,limit:25}});if(revision!==requestRevision.current)return;setError(null);setRows(r.data.data);setPages(r.data.pagination.pages);setTotal(r.data.pagination.total);}catch(e){if(revision===requestRevision.current)setError(e);}},[search,status,mode,page,quantity,container]);
  useEffect(()=>{load();},[load]);
  const open=async id=>{try{setError(null);const r=await api.get("/eudr/inventory/batches/"+id);setBatch(r.data.data);}catch(e){setError(e);}};
  return <div><nav className="d-flex flex-wrap gap-2 mb-3" aria-label="Inventory workflows">{[["registry","Batch registry"],["source","Production source"],["invoice","Canonical invoice"],["sale","Mixed sale"],["transformation","Processing conversion"],["mix","Mix evidence"]].map(([v,label])=><button key={v} className={"btn btn-sm "+(view===v?"btn-dark":"btn-outline-secondary")} onClick={()=>{setView(v);setBatch(null);}}>{label}</button>)}</nav>
    <QuantityConflict error={error} />
    {view!=="registry"?<EvidenceForm key={view} type={view} onCreated={load} />:batch?<BatchDetail batch={batch} onOpen={open} onBack={()=>{setBatch(null);load();}} onReload={()=>open(batch._id)} />:<div className="card om-card card-body">
      <h2 className="h5">Documentary timber batch registry</h2><p className="small text-muted">Documented quantities and OMS commitments. Unknown source proportions remain uncertain until supported by evidence.</p>
      <form className="row g-2 mb-3" onSubmit={e=>{e.preventDefault();setPage(1);load();}}><div className="col-md-6"><input aria-label="Search inventory" className="form-control" placeholder="Invoice number, batch or party" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} /></div>
        <div className="col-md-3"><Select aria-label="Inventory verification state" values={["","DRAFT","RESERVED","COMMITTED","ON_HOLD","CANCELLED"]} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} /></div><div className="col-md-3"><Select aria-label="Source allocation mode" values={["",...modes]} value={mode} onChange={e=>{setMode(e.target.value);setPage(1);}} /></div>
      </form>
      <div className="row g-2 mb-3"><div className="col-md-6"><Select aria-label="Quantity feasibility" values={["","QUANTITY_FEASIBLE","FULLY_COMMITTED","CONFLICT_DETECTED","REVIEW_REQUIRED"]} value={quantity} onChange={e=>{setQuantity(e.target.value);setPage(1);}} /></div><div className="col-md-6"><input aria-label="Filter inventory by container" className="form-control" placeholder="Linked container number" value={container} onChange={e=>{setContainer(e.target.value);setPage(1);}} /></div></div>
      <div className="table-responsive"><table className="table table-hover"><thead><tr><th>Batch / invoice</th><th>Holder</th><th>Documented CFT</th><th>Committed CFT</th><th>Uncommitted documentary capacity</th><th>Material</th><th>Verification / quantity</th><th>Origin review</th><th>Documents / links</th><th></th></tr></thead><tbody>{rows.map(l=><tr key={l._id}><td>{l.invoice_detail?.number||l.identity_key}<small className="d-block text-muted">{l._id}</small></td><td>{l.holder_snapshot?.name||l.owner}</td><td>{milliLabel(l.quantity_milli)}</td><td>{l.quantity_range?milliLabel(l.quantity_range.committed_min_milli)+(l.quantity_range.committed_min_milli!==l.quantity_range.committed_max_milli?"–"+milliLabel(l.quantity_range.committed_max_milli):""):"Pending"}</td><td>{rangeLabel(l.quantity_range)}</td><td>{l.material}</td><td>{l.status} · {l.verification?.status}<small className="d-block">{l.quantity_status} · {l.source_allocation_mode}</small></td><td>{l.origin_status} · {l.potential_source_count||0} sources</td><td>{l.documents?.length||0} files · {l.linked_transaction_count||0} links</td><td><button className="btn btn-sm btn-outline-dark" onClick={()=>open(l._id)}>View batch</button></td></tr>)}</tbody></table></div>
      {!rows.length&&<p>No matching documentary batches.</p>}<div className="d-flex gap-3 align-items-center"><button className="btn btn-sm btn-outline-secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><span>{total} records · Page {page} / {Math.max(1,pages)}</span><button className="btn btn-sm btn-outline-secondary" disabled={page>=pages} onClick={()=>setPage(page+1)}>Next</button></div>
    </div>}
  </div>;
}
