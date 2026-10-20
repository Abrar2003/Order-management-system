import { useEffect, useMemo, useState } from "react";

import api from "../../api/axios";

import { sourcePayload, milliLabel } from "../../utils/eudrInventory";

import { Field, Select, PartyPicker, DocumentPicker, SourceSelector, ReviewRecord, QuantityConflict, modes, materials, today } from "./InventoryCommon";



export function EvidenceForm({ type, onCreated }) {

  const [owner,setOwner]=useState(null),[buyer,setBuyer]=useState(null),[documents,setDocuments]=useState([]),[transport,setTransport]=useState([]),[receipts,setReceipts]=useState([]),[mode,setMode]=useState("UNKNOWN"),[rows,setRows]=useState([]),[error,setError]=useState(null),[busy,setBusy]=useState(false),[created,setCreated]=useState(null),[invoiceRows,setInvoiceRows]=useState([]);

  const [f,setF]=useState({date:today(),receipt_date:today(),material:"RAW",output_material:"FINISHED",number:"",quantity:"",received:"",invoice:"",line_id:"1",reference:"",note:"",plot:"",latitude:"",longitude:"",permission:"",physical:false,output_transfer:""});

  const [referenceSearch,setReferenceSearch]=useState("");

  const [lines,setLines]=useState([{line_id:"1",quantity_cft:"",material:"RAW",species:""}]);

  const [reviewOn,setReviewOn]=useState(false),[species,setSpecies]=useState([]),[plots,setPlots]=useState([]),[originRows,setOriginRows]=useState([{plot_ref:"",permission:""}]);

  useEffect(()=>{api.get("/eudr/capabilities").then(async r=>{if(r.data.data.review_layer){setReviewOn(true);const [sp,p]=await Promise.all([api.get("/eudr/species"),api.get("/eudr/plots")]);setSpecies(sp.data.data.species);setPlots(p.data.data);}}).catch(setError);},[]);

  const update=(name,value)=>setF(v=>({...v,[name]:value}));

  useEffect(()=>{if(["sale","mix"].includes(type))api.get("/eudr/inventory/"+(type==="sale"?"invoices":"transfers"),{params:{limit:100,search:referenceSearch}}).then(r=>setInvoiceRows(r.data.data)).catch(setError);},[type,referenceSearch]);

  const save=async e=>{

    e.preventDefault();setBusy(true);setError(null);

    try{

      const selected=sourcePayload(rows,mode);

      let path,body;

      if(type==="source"){path="batches";body={owner,production_reference:f.reference,quantity_cft:f.quantity,production_date:f.date,material:f.material,origins:[{plot:f.plot,latitude:Number(f.latitude),longitude:Number(f.longitude),permission:f.permission,species:""}],documents};}

      if(type==="invoice"){path="invoices";body={issuer:owner,buyer,number:f.number,date:f.date,total_cft:f.quantity,lines,documents,identity_note:f.note};}

      if(type==="sale"||type==="transformation"){path="transfers";body={kind:type==="transformation"?"TRANSFORMATION":"TRANSFER",seller:owner,buyer,invoice:f.invoice,line_id:f.line_id,sold_cft:f.quantity,received_cft:f.received,date:f.date,receipt_date:f.receipt_date,mode,inputs:selected,input_material:f.material,output_material:type==="transformation"?f.output_material:f.material,documents,transport_documents:transport,receipt_documents:receipts,discrepancy_note:f.note,idempotency_key:f.reference};}

      if(type==="mix"){path="mixes";body={owner,reference:f.reference,inputs:selected,mode,physical_mixing:f.physical,note:f.note,documents,output_transfer:f.output_transfer||undefined};}

      if(reviewOn){if(type==="source"){body.species=f.species;body.origins=originRows.map(r=>({...r,species:f.species}));}if(type==="transformation")body.species=f.species;if(type==="sale")body.transport={eway_bill_no:f.eway_bill_no,bilty_no:f.bilty_no,vehicle_no:f.vehicle_no,net_kg:f.net_kg||undefined,driver_licence_no:f.driver_licence_no};if(type==="invoice")body.einvoice_irn=f.einvoice_irn;}

      const r=await api.post("/eudr/inventory/"+path,body);setCreated({resource:path,record:r.data.data});onCreated?.();

    }catch(err){setError(err);}finally{setBusy(false);}

  };

  const input=(name,label,props={})=><Field label={label} value={f[name]} onChange={e=>update(name,e.target.value)} {...props} />;

  return <div className="card om-card card-body"><h2 className="h5">{({source:"Record production evidence",invoice:"Register canonical invoice",sale:"Record a mixed sale / purchase",transformation:"Record processing input, loss and output",mix:"Record a logical group or physical mix"})[type]}</h2>

    <form onSubmit={save}><div className="row g-3"><div className="col-lg-6">

      <PartyPicker label={type==="invoice"?"Invoice issuer":"Holder / seller"} value={owner} onChange={v=>{setOwner(v);setRows([]);}} />

      {["invoice","sale"].includes(type)&&<PartyPicker label="Buyer" value={buyer} onChange={setBuyer} />}

      {["sale","mix"].includes(type)&&<Field label={type==="sale"?"Search registered sale invoices":"Search associated sales"} value={referenceSearch} onChange={e=>setReferenceSearch(e.target.value)} />}

      {type!=="mix"&&input("date",type==="source"?"Production date":"Invoice / transaction date",{type:"date",required:true})}

      {type!=="mix"&&input("quantity",type==="invoice"?"Total documented CFT":type==="transformation"?"Processing input CFT":"Documented sold / production CFT",{required:true,inputMode:"decimal"})}

      {type!=="invoice"&&<Field label="Input material basis"><Select values={materials} value={f.material} onChange={e=>{update("material",e.target.value);setRows([]);}} /></Field>}

      {["source","transformation","mix"].includes(type)&&input("reference","Unique evidence / operation reference",{required:true})}

      {reviewOn&&["source","transformation"].includes(type)&&<Field label="Species"><select className="form-select" required value={f.species||""} onChange={e=>{update("species",e.target.value);setRows([]);}}><option value="">Choose species</option>{species.filter(s=>s.active).map(sp=><option value={sp._id} key={sp._id}>{sp.name}</option>)}</select></Field>}

      {type==="source"&&reviewOn&&<fieldset className="border rounded p-2"><legend className="float-none w-auto fs-6">Production origins</legend>{originRows.map((row,i)=><div key={i}><Field label="Plot"><select className="form-select" required value={row.plot_ref} onChange={e=>setOriginRows(rows=>rows.map((r,j)=>j===i?{...r,plot_ref:e.target.value}:r))}><option value="">Choose recorded plot</option>{plots.map(p=><option key={p._id} value={p._id}>{p.village} · {p.area_ha} ha · {p.satellite?.result||"Pending"}</option>)}</select></Field><Field label="Permission reference" required value={row.permission} onChange={e=>setOriginRows(rows=>rows.map((r,j)=>j===i?{...r,permission:e.target.value}:r))}/>{originRows.length>1&&<button type="button" className="btn btn-sm btn-outline-secondary" onClick={()=>setOriginRows(rows=>rows.filter((_,j)=>j!==i))}>Remove origin</button>}</div>)}<button type="button" className="btn btn-outline-dark btn-sm" disabled={originRows.length>=100} onClick={()=>setOriginRows(rows=>[...rows,{plot_ref:"",permission:""}])}>Add origin</button></fieldset>}

      {type==="source"&&!reviewOn&&<>{input("plot","Forest plot reference",{required:true})}{input("latitude","Forest latitude",{type:"number",step:"any",min:-90,max:90,required:true})}{input("longitude","Forest longitude",{type:"number",step:"any",min:-180,max:180,required:true})}{input("permission","Permission reference",{required:true})}</>}

      {type==="invoice"&&<>{input("number","Invoice number",{required:true})}<Field label="Identity clarification, if issuer has no GST" value={f.note} onChange={e=>update("note",e.target.value)} />

        {lines.map((line,i)=><div key={i} className="row g-2 mb-2"><div className="col-2"><Field label="Line" value={line.line_id} onChange={e=>setLines(lines.map((l,j)=>j===i?{...l,line_id:e.target.value}:l))} /></div><div className="col-5"><Field label="Line CFT" value={line.quantity_cft} required onChange={e=>setLines(lines.map((l,j)=>j===i?{...l,quantity_cft:e.target.value}:l))} /></div><div className="col-5"><Field label="Material"><Select values={materials} value={line.material} onChange={e=>setLines(lines.map((l,j)=>j===i?{...l,material:e.target.value}:l))} /></Field></div>{reviewOn&&<div className="col-12"><Field label="Invoice line species"><select required className="form-select" value={line.species||""} onChange={e=>setLines(lines.map((l,j)=>j===i?{...l,species:e.target.value}:l))}><option value="">Choose species</option>{species.filter(sp=>sp.active).map(sp=><option key={sp._id} value={sp._id}>{sp.name}</option>)}</select></Field></div>}</div>)}

        <button type="button" className="btn btn-sm btn-outline-secondary mb-2" onClick={()=>setLines([...lines,{line_id:String(lines.length+1),quantity_cft:"",material:"RAW",species:""}])}>Add genuine invoice line</button>

      </>}

      {reviewOn&&type==="invoice"&&input("einvoice_irn","E-invoice IRN / QR reference (if present)")}

      {reviewOn&&type==="sale"&&<fieldset className="border rounded p-2"><legend className="float-none w-auto fs-6">Optional transport facts</legend>{[["eway_bill_no","E-way bill number"],["bilty_no","Bilty number"],["vehicle_no","Vehicle number"],["net_kg","Net kg"],["driver_licence_no","Driver licence number"]].map(([k,label])=><div key={k}>{input(k,label)}</div>)}</fieldset>}

      {type==="sale"&&<><Field label="Canonical sale invoice"><select className="form-select" required value={f.invoice} onChange={e=>{update("invoice",e.target.value);const inv=invoiceRows.find(i=>i._id===e.target.value);if(inv?.lines?.[0]){update("line_id",inv.lines[0].line_id);update("material",inv.lines[0].material);update("date",inv.date);}}}><option value="">Select registered invoice</option>{invoiceRows.map(i=><option key={i._id} value={i._id}>{i.number} · {i.issuer_snapshot?.name} → {i.buyer_snapshot?.name}</option>)}</select></Field>{input("line_id","Invoice line ID",{required:true})}</>}

      {["sale","transformation"].includes(type)&&<>{input("received",type==="transformation"?"Finished / processed output CFT":"Actual received CFT",{required:true})}{input("receipt_date","Receipt / output availability date",{type:"date",required:true})}{type==="transformation"&&<Field label="Output material basis"><Select values={materials} value={f.output_material} onChange={e=>update("output_material",e.target.value)} /></Field>}{input("note","Loss, shortage or conversion evidence explanation")}</>}

      {type==="mix"&&<><Field label="Associated sale (required for quantified constraints)"><select className="form-select" value={f.output_transfer} onChange={e=>{update("output_transfer",e.target.value);const sale=invoiceRows.find(r=>r._id===e.target.value);if(sale){setMode(sale.mode);setRows(sale.inputs.map(i=>({lot:i.lot,selected:true,participation:i.participation,exact_cft:i.exact_milli==null?"":milliLabel(i.exact_milli),min_cft:i.min_milli==null?"":milliLabel(i.min_milli),max_cft:i.max_milli==null?"":milliLabel(i.max_milli),evidence_note:i.evidence_note})));}else setMode("UNKNOWN");}}><option value="">Logical group without a separate sale demand</option>{invoiceRows.map(r=><option key={r._id} value={r._id}>{r.date} · {milliLabel(r.quantity_milli)} CFT · {r.mode} · {r._id}</option>)}</select></Field><label className="d-block mb-2"><input type="checkbox" checked={f.physical} onChange={e=>update("physical",e.target.checked)} /> Evidence confirms physical mixing</label>{input("note","Mix evidence explanation")}</>}

    </div><div className="col-lg-6">

      {reviewOn&&<p className="small text-muted">RAW = logs; PROCESSING_INPUT = sawn wood; FINISHED = finished goods. Sawing converts RAW to PROCESSING_INPUT; manufacturing converts PROCESSING_INPUT to FINISHED.</p>}

      {["sale","transformation","mix"].includes(type)&&<><Field label="Source contribution knowledge"><Select values={modes} value={mode} onChange={e=>setMode(e.target.value)} /></Field><SourceSelector owner={owner} species={reviewOn?(type==="sale"?invoiceRows.find(i=>i._id===f.invoice)?.lines.find(l=>l.line_id===f.line_id)?.species:f.species):undefined} mode={mode} rows={rows} onChange={setRows} material={f.material} proposal={type!=="mix"?{quantity_cft:f.quantity,date:f.date}:undefined} /></>}

      <DocumentPicker value={documents} onChange={setDocuments} purpose={type==="source"?"production":type==="transformation"?"transformation":type==="mix"?"mix":"invoice"} />

      {type==="source"&&["license","permission","forest_image"].map(p=><DocumentPicker key={p} label={p.replaceAll("_"," ")+" evidence"} value={documents} onChange={setDocuments} purpose={p} />)}

      {type==="sale"&&<>{["weight_slip","billty","driver_license","ewaybill"].map(p=><DocumentPicker key={p} label={p.replaceAll("_"," ")+" transport evidence"} value={transport} onChange={setTransport} purpose={p} />)}<DocumentPicker label="Receiving evidence" value={receipts} onChange={setReceipts} purpose="receipt" /></>}

    </div></div><QuantityConflict error={error} /><button className="btn btn-dark" disabled={busy||!owner}>Save documentary draft</button><p className="small text-muted mt-2 mb-0">Drafts can be collected backward. Activate in origin-to-vendor order after reviewing evidence. Mathematical feasibility does not establish physical origin.</p></form>

    {created&&<ReviewRecord resource={created.resource} record={created.record} onDone={record=>{setCreated({...created,record});onCreated?.();}} />}

  </div>;

}



export function ContainerInventoryAllocation({ chain, onChange }) {

  const [mode,setMode]=useState("EXACT"),[rows,setRows]=useState([]),[date,setDate]=useState(()=>chain.shipment_rows?.map(r=>r.stuffing_date).filter(Boolean).sort()[0]||today()),[error,setError]=useState(null),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[sameDay,setSameDay]=useState(false);

  const owner=useMemo(()=>({kind:"vendor",id:chain.vendor?._id}),[chain.vendor?._id]);
  const [speciesQuantities,setSpeciesQuantities]=useState({});
  const selectedSpecies=[...new Set(rows.filter(r=>r.selected&&r._species).map(r=>r._species))];

  const reserve=async()=>{

    setBusy(true);setError(null);

    try{await api.post("/eudr/inventory/commitments",{chain:chain._id,quantity_cft:String((chain.contribution_milli_cft??chain.declared_milli_cft)/1000),date,mode,inputs:sourcePayload(rows,mode),...(chain.review&&mode!=="EXACT"?{species_allocations:selectedSpecies.map(sp=>({species:sp,quantity_cft:speciesQuantities[sp],mode,inputs:sourcePayload(rows.filter(r=>r._species===sp),mode)}))}:{}),same_day_reviewed:sameDay,use_inherited_lineage:true});const r=await api.get("/eudr/"+chain._id);onChange(r.data.data);setOpen(false);}

    catch(e){setError(e);}finally{setBusy(false);}

  };

  const chronology=<label className="d-block my-2"><input type="checkbox" checked={sameDay} onChange={e=>setSameDay(e.target.checked)} /> Same-day receipt and container allocation ordering reviewed, if applicable</label>;

  return <section className="card om-card card-body mb-3"><div className="d-flex flex-wrap justify-content-between gap-2"><div><h2 className="h5">Documentary inventory allocation</h2><p className="small mb-0">Required stuffed: {Number(chain.stuffed_cft||0).toFixed(3)} CFT · This contribution: {milliLabel(chain.contribution_milli_cft??chain.declared_milli_cft)} CFT · {chain.inventory_status||"Legacy evidence review"}</p></div><button className="btn btn-outline-dark" type="button" onClick={()=>setOpen(!open)}>Select vendor lots</button></div>

    {open&&<div className="mt-3"><Field label="Container allocation date" type="date" value={date} onChange={e=>setDate(e.target.value)} /><Field label="Source contributions"><Select values={modes} value={mode} onChange={e=>setMode(e.target.value)} /></Field><SourceSelector owner={owner} material="FINISHED" mode={mode} rows={rows} onChange={setRows} spendableOnly />{chain.review&&mode!=="EXACT"&&<fieldset className="border rounded p-2"><legend className="float-none w-auto fs-6">Explicit species quantities for this contribution</legend><p className="small">Record each species quantity; the total must equal this chain contribution. No species split is inferred from uncertain lot inputs.</p>{selectedSpecies.map(sp=><Field key={sp} label={`${chain.review.species.find(s=>s.species===sp)?.name||sp} contribution CFT`} value={speciesQuantities[sp]||""} onChange={e=>setSpeciesQuantities(v=>({...v,[sp]:e.target.value}))}/>)}</fieldset>}{chronology}<button type="button" className="btn btn-dark" disabled={busy} onClick={reserve}>Reconcile and reserve contribution</button><p className="small text-muted mt-2">Raw timber requires a verified conversion to finished timber before container allocation. View upstream evidence in Inventory before final review.</p></div>}<QuantityConflict error={error} />

  </section>;

}

