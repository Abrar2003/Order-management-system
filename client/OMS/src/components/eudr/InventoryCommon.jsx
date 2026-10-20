import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../../api/axios";

import { EUDR_FILE_ACCEPT, requestError } from "../../utils/eudrDocuments";

import { lineageLayout, milliLabel, rangeLabel, sourcePayload } from "../../utils/eudrInventory";



export const modes = ["UNKNOWN", "PARTIAL", "EXACT"];

export const materials = ["RAW", "PROCESSING_INPUT", "FINISHED"];

export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function Field({ label, children, ...props }) { return <label className="d-block mb-2"><span className="form-label">{label}</span>{children || <input className="form-control" {...props} />}</label>; }

export const Select = ({ values, ...props }) => <select className="form-select" {...props}>{values.map(v => <option key={v} value={v}>{v ? v.replaceAll("_"," ") : "All"}</option>)}</select>;



export function QuantityConflict({ error }) {

  if (!error) return null;

  const data = error.response?.data || { message: requestError(error) }, d = data.details;

  return <div className="alert alert-danger" role="alert"><strong>{data.code || "Request failed"}</strong><p className="mb-1">{data.message}</p>

    {d?.lots && <div className="table-responsive"><table className="table table-sm"><caption>Documentary capacity involved in this conflict</caption><thead><tr><th>Batch</th><th>Documented CFT</th></tr></thead><tbody>{d.lots.map(l => <tr key={l.id}><td>{l.id}</td><td>{milliLabel(l.documented_milli)}</td></tr>)}</tbody></table></div>}

    {d?.transactions && <ul>{d.transactions.map(t => <li key={t.id}>{t.id} · {milliLabel(t.quantity_milli)} CFT · {t.date} · {t.container || ""}</li>)}</ul>}

    {d && !d.lots && <details><summary>Review details</summary><pre className="small text-wrap mb-0">{JSON.stringify(d,null,2)}</pre></details>}

  </div>;

}



export function PartyPicker({ label, value, onChange }) {
  const [reviewOn,setReviewOn]=useState(false);
  useEffect(()=>{api.get("/eudr/capabilities").then(r=>setReviewOn(Boolean(r.data?.data?.review_layer))).catch(()=>{});},[]);

  const [kind,setKind] = useState("vendor"), [search,setSearch] = useState(""), [rows,setRows] = useState([]), [error,setError] = useState("");

  useEffect(() => {

    const controller = new AbortController();

    const timer = setTimeout(() => api.get("/eudr/directory",{params:{kind,search},signal:controller.signal}).then(r=>{setRows(r.data.data);setError("");}).catch(e=>{if(!controller.signal.aborted)setError(requestError(e));}),200);

    return()=>{clearTimeout(timer);controller.abort();};

  },[kind,search]);

  return <fieldset className="border rounded p-2 mb-2"><legend className="float-none w-auto fs-6 px-1">{label}</legend><div className="row g-2">

    <div className="col-md-4"><Select aria-label={label+" directory"} values={reviewOn?["vendor","sawmill","buyer","generator"]:["vendor","sawmill","buyer"]} value={kind} onChange={e=>{setKind(e.target.value);onChange(null);}} /></div>

    <div className="col-md-8"><input aria-label={"Search "+label} className="form-control" placeholder="Search existing parties" value={search} onChange={e=>setSearch(e.target.value)} /></div>

    <div className="col-12"><select aria-label={label} className="form-select" value={value?.id || ""} onChange={e=>onChange(e.target.value?{kind:kind==="vendor"?"vendor":"party",id:e.target.value}:null)}><option value="">Select {label.toLowerCase()}</option>{rows.map(r=><option key={r._id} value={r._id}>{r.name} · {r.fields?.gst || r.fields?.buyer_gst || "GST unavailable"}</option>)}</select></div>

  </div>{error&&<p role="alert" className="text-danger small">{error}</p>}</fieldset>;

}



export function DocumentPicker({ label="Supporting documents", value=[], onChange, purpose="invoice" }) {

  const [rows,setRows] = useState([]), [search,setSearch] = useState(""), [busy,setBusy]=useState(false), [error,setError]=useState(null), [reuse,setReuse]=useState(null);

  const load=useCallback(()=>api.get("/eudr/inventory/documents",{params:{search,limit:100}}).then(r=>setRows(r.data.data)).catch(setError),[search]);

  useEffect(()=>{load();},[load]);

  const upload=async file=>{

    if(!file)return;setBusy(true);setError(null);

    try{const form=new FormData();form.append("file",file);form.append("purpose",purpose);const r=await api.post("/eudr/inventory/documents",form);onChange([...new Set([...value,r.data.data._id])]);await load();}

    catch(e){if(e.response?.data?.code==="DOCUMENT_REUSE_AVAILABLE")setReuse(e.response.data.details.document);else setError(e);}finally{setBusy(false);}

  };

  return <fieldset className="border rounded p-2 mb-2"><legend className="float-none w-auto fs-6 px-1">{label}</legend>

    <input className="form-control mb-2" aria-label={"Search "+label} placeholder="Search existing private files" value={search} onChange={e=>setSearch(e.target.value)} />

    <div style={{maxHeight:160,overflow:"auto"}}>{rows.map(d=><label key={d._id} className="d-block small mb-1"><input type="checkbox" checked={value.includes(d._id)} onChange={e=>onChange(e.target.checked?[...value,d._id]:value.filter(id=>id!==d._id))} /> {d.name} · {d.purpose}</label>)}</div>

    <label className="d-block small mt-2">Upload {purpose.replaceAll("_"," ")} evidence<input aria-label={"Upload "+purpose} type="file" accept={EUDR_FILE_ACCEPT} className="form-control" disabled={busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value="";}} /></label>

    {reuse&&<div className="alert alert-warning small mt-2">Existing file: {reuse.name}. Confirm this is the same documentary evidence.<button type="button" className="btn btn-sm btn-outline-dark ms-2" onClick={()=>{onChange([...new Set([...value,reuse._id])]);setReuse(null);}}>Link existing file</button></div>}

    <QuantityConflict error={error} />

  </fieldset>;

}



export function SourceSelector({ owner, mode, rows, onChange, material, proposal, species, spendableOnly=false }) {

  const [lots,setLots]=useState([]), [search,setSearch]=useState(""), [error,setError]=useState(null), [page,setPage]=useState(1), [pages,setPages]=useState(1);

  const [reconciliation,setReconciliation]=useState(null);

  useEffect(()=>setReconciliation(null),[rows,mode,proposal?.quantity_cft,proposal?.date]);

  const reconcile=async()=>{

    try{setError(null);const selected=sourcePayload(rows,mode);const r=await api.post("/eudr/inventory/reconcile",{lot_ids:selected.map(i=>i.lot),...(proposal?.quantity_cft?{proposal:{...proposal,mode,inputs:selected}}:{})});setReconciliation(r.data.data);}

    catch(e){setError(e);}

  };

  useEffect(()=>{

    if(!owner)return;

    let active=true;

    api.get("/eudr/inventory/batches",{params:{...(owner.kind==="vendor"?{vendor:owner.id}:{party:owner.id}),...(spendableOnly?{status:"COMMITTED",verification:"VERIFIED"}:{}),search,material,species,page,limit:25}}).then(r=>{if(active){setLots(r.data.data);setPages(r.data.pagination.pages);}}).catch(e=>{if(active)setError(e);});

    return()=>{active=false;};

  },[owner,search,material,species,page,spendableOnly]);

  const change=(lot,patch)=>{const row=rows.find(r=>r.lot===lot);patch={...patch,_species:lots.find(l=>l._id===lot)?.species||row?._species};onChange(row?rows.map(r=>r.lot===lot?{...r,...patch}:r):[...rows,{lot,participation:"POSSIBLE",selected:true,...patch}]);};

  return <fieldset className="border rounded p-2 mb-3"><legend className="float-none w-auto fs-6 px-1">Supporting documentary lots</legend>

    <input aria-label="Search source lots" className="form-control mb-2" placeholder="Invoice number or party" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />

    {!owner&&<p>Select the holder first.</p>}

    {lots.map(l=>{const row=rows.find(r=>r.lot===l._id)||{};return <div className="border-bottom py-2" key={l._id}>

      <label><input type="checkbox" checked={Boolean(row.selected)} onChange={e=>change(l._id,{selected:e.target.checked})} /> {l.invoice_detail?.number||l.identity_key} · {milliLabel(l.quantity_milli)} CFT documented · {l.status} · {l.material}</label>

      {row.selected&&<div className="row g-2 mt-1"><div className="col-md-3"><Select aria-label={"Participation "+l._id} values={["POSSIBLE","CONFIRMED"]} value={row.participation||"POSSIBLE"} onChange={e=>change(l._id,{participation:e.target.value})} /></div>

        {mode!=="UNKNOWN"&&<><div className="col-md-3"><input aria-label={"Exact CFT "+l._id} className="form-control" placeholder="Evidenced exact CFT" value={row.exact_cft||""} onChange={e=>change(l._id,{exact_cft:e.target.value})} /></div>

          {mode==="PARTIAL"&&["min","max"].map(bound=><div key={bound} className="col-md-2"><input aria-label={bound+" CFT "+l._id} className="form-control" placeholder={bound+" CFT"} value={row[bound+"_cft"]||""} onChange={e=>change(l._id,{[bound+"_cft"]:e.target.value})} /></div>)}

          <div className="col-12"><input aria-label={"Bounds evidence "+l._id} className="form-control" placeholder="Evidence supporting these contribution amounts" value={row.evidence_note||""} onChange={e=>change(l._id,{evidence_note:e.target.value})} /></div>

        </>}

      </div>}

    </div>;})}

    <p className="small mt-2 mb-1">{mode==="UNKNOWN"?"Source Allocation Unknown: no per-invoice quantities are required.":"Enter only contribution quantities supported by evidence."} Individual ranges share constraints and must not be added.</p>

    <button type="button" className="btn btn-sm btn-outline-dark mb-2" disabled={!rows.some(r=>r.selected)} onClick={reconcile}>Check global quantity feasibility</button>

    {reconciliation&&<p role="status" className={reconciliation.feasible?"text-success":"text-danger"}>{reconciliation.status} · Combined uncommitted documentary capacity: {rangeLabel(reconciliation.ranges?.[0])}</p>}

    <div className="d-flex gap-2"><button type="button" className="btn btn-sm btn-outline-secondary" disabled={page===1} onClick={()=>setPage(page-1)}>Previous sources</button><button type="button" className="btn btn-sm btn-outline-secondary" disabled={page>=pages} onClick={()=>setPage(page+1)}>Next sources</button></div>

    <QuantityConflict error={error} />

  </fieldset>;

}



export function LineageGraph({ network, onOpen }) {

  const layout=useMemo(()=>lineageLayout(network),[network]);

  if(layout.error)return <p className="text-danger">{layout.error}</p>;

  const colors={source:"#d9ead3",lot:"#e4edf5",transfer:"#fff2cc",transformation:"#eadcf2",container:"#f4e3d7",mix:"#dce8e6",party:"#f2f0ec"};

  return <div className="overflow-auto border rounded" aria-label="Branching supply chain lineage"><svg role="img" aria-label="Documentary lots merge into transfers and branch to downstream uses" width={layout.width} height={layout.height}>

    <defs><marker id="inventory-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#777" /></marker></defs>

    {layout.edges.map(([a,b,type])=>{const from=layout.nodes.find(n=>n.id===a),to=layout.nodes.find(n=>n.id===b);return <path key={a+":"+b} d={"M"+(from.x+230)+","+(from.y+45)+" C"+(from.x+260)+","+(from.y+45)+" "+(to.x-30)+","+(to.y+45)+" "+to.x+","+(to.y+45)} fill="none" stroke="#777" strokeDasharray={type==="ownership"?"4 4":undefined} markerEnd={type==="ownership"?undefined:"url(#inventory-arrow)"} />;})}

    {layout.nodes.map(n=><g key={n.id} transform={"translate("+n.x+","+n.y+")"} role={n.lotId?"button":undefined} tabIndex={n.lotId?0:undefined} aria-label={n.kind+" "+n.label+" "+n.detail} onClick={()=>n.lotId&&onOpen?.(n.lotId)} onKeyDown={e=>{if(n.lotId&&(e.key==="Enter"||e.key===" ")){e.preventDefault();onOpen?.(n.lotId);}}}>

      <rect width="230" height="90" rx="7" fill={colors[n.kind]} stroke="#a3a3a3" /><text x="10" y="18" fontSize="11">{n.kind.toUpperCase()} · {n.status}</text><text x="10" y="40" fontSize="13">{String(n.label).slice(0,29)}</text><text x="10" y="61" fontSize="11">{n.detail}</text><text x="10" y="79" fontSize="10">{n.id.slice(-24)}</text><title>{n.label} · {n.id}</title>

    </g>)}

  </svg></div>;

}



export function ReviewRecord({ resource, record, onDone }) {

  const [note,setNote]=useState(""),[origins,setOrigins]=useState(false),[sameDay,setSameDay]=useState(false),[error,setError]=useState(null),[busy,setBusy]=useState(false);

  const [reviewOn,setReviewOn]=useState(false);useEffect(()=>{api.get("/eudr/capabilities").then(r=>setReviewOn(r.data?.data?.review_layer)).catch(()=>{});},[]);

  const documentCheck=async()=>{setBusy(true);try{const r=await api.post(`/eudr/inventory/${resource}/${record._id}/document-checks`);onDone(r.data.data);}catch(e){setError(e);}finally{setBusy(false);}};

  const verify=async()=>{setBusy(true);try{const r=await api.post("/eudr/inventory/"+resource+"/"+record._id+"/verify",{revision:record.revision,note,origins_reviewed:origins,same_day_reviewed:sameDay});onDone(r.data.data);}catch(e){setError(e);}finally{setBusy(false);}};

  return <section className="border rounded p-3 my-3"><h3 className="h6">Verify {resource} · Revision {record.revision}</h3><p>{record.identity_key} · {record.status} · Origin review: {record.origin_status}</p>

    <Field label="Evidence review conclusion" value={note} onChange={e=>setNote(e.target.value)} />

    <label className="d-block mb-2"><input type="checkbox" checked={origins} onChange={e=>setOrigins(e.target.checked)} /> All potential origin evidence and physical source claims reviewed</label>

    <label className="d-block mb-2"><input type="checkbox" checked={sameDay} onChange={e=>setSameDay(e.target.checked)} /> Same-day receipt ordering reviewed, where applicable</label>

    {reviewOn&&["invoices","transfers"].includes(resource)&&<button type="button" className="btn btn-outline-dark me-2" disabled={busy} onClick={documentCheck}>Run document checks</button>}

    {record.document_checks&&<p className="small">{Object.values(record.document_checks).filter(v=>v&&typeof v==="object").map(v=>`${v.result} · ${v.provider}${v.simulated?" · Simulated":""}`).join("; ")}</p>}

    <button type="button" className="btn btn-dark" disabled={busy||!note} onClick={verify}>Record manual verification</button><QuantityConflict error={error} />

  </section>;

}

