import { useState } from "react";
import api from "../../api/axios";
import { getUserFromToken } from "../../auth/auth.service";
import { normalizeUserRole } from "../../auth/permissions";
import { milliLabel, sourcePayload } from "../../utils/eudrInventory";
import { Field, Select, PartyPicker, DocumentPicker, SourceSelector, QuantityConflict, modes } from "./InventoryCommon";

export function InventoryActions({ resource, record, onDone }) {
  const [open,setOpen]=useState(false),[reason,setReason]=useState(""),[documents,setDocuments]=useState([]),[quantity,setQuantity]=useState(milliLabel(record.quantity_milli??record.total_milli)),[received,setReceived]=useState(milliLabel(record.output_quantity_milli)),[lines,setLines]=useState(record.lines?.map(l=>({...l,quantity_cft:milliLabel(l.quantity_milli)}))||[]),[error,setError]=useState(null),[busy,setBusy]=useState(false);
  if (!["admin","super_admin"].includes(normalizeUserRole(getUserFromToken()?.role)))return null;
  const apply=async action=>{
    setBusy(true);setError(null);
    try{
      const body={revision:record.revision,reason,documents,...(resource==="invoices"?{total_cft:quantity,lines:lines.map(({line_id,quantity_cft,material,species})=>({line_id,quantity_cft,material,species}))}:resource==="batches"?{quantity_cft:quantity}:{sold_cft:quantity,received_cft:received})};
      if(action==="correction")await api.patch("/eudr/inventory/"+resource+"/"+record._id+"/correction",body);
      else await api.post("/eudr/inventory/"+resource+"/"+record._id+"/"+(resource==="commitments"?"release":"cancel"),body);
      onDone();setOpen(false);
    }catch(e){setError(e);}finally{setBusy(false);}
  };
  return <section className="border rounded p-3 mb-3"><button className="btn btn-sm btn-outline-secondary" onClick={()=>setOpen(!open)}>Audited correction / reversal</button>{open&&<div className="mt-3">
    <p className="small">Historical commitments are retained during evidence corrections. Reversal requires review of downstream dependencies.</p>
    <Field label="Reason and supporting evidence explanation" value={reason} onChange={e=>setReason(e.target.value)} />
    {!["commitments","mixes"].includes(resource)&&<Field label={resource==="invoices"?"Corrected total CFT":"Corrected documented/input CFT"} value={quantity} onChange={e=>setQuantity(e.target.value)} />}
    {resource==="transfers"&&<Field label="Corrected received/output CFT" value={received} onChange={e=>setReceived(e.target.value)} />}
    {resource==="invoices"&&lines.map((l,i)=><Field key={l.line_id} label={"Corrected line "+l.line_id+" CFT"} value={l.quantity_cft} onChange={e=>setLines(lines.map((line,j)=>j===i?{...line,quantity_cft:e.target.value}:line))} />)}
    <DocumentPicker purpose="correction" value={documents} onChange={setDocuments} />
    <div className="d-flex gap-2">{!["commitments","mixes"].includes(resource)&&<button className="btn btn-warning" disabled={busy||!reason||!documents.length} onClick={()=>apply("correction")}>Save correction and hold dependents</button>}<button className="btn btn-outline-danger" disabled={busy||!reason} onClick={()=>apply("cancel")}>{resource==="commitments"?"Release reservation":"Request controlled reversal"}</button></div><QuantityConflict error={error} />
  </div>}</section>;
}

export function DraftTransferEditor({ record, onDone }) {
  const [owner,setOwner]=useState(null),[mode,setMode]=useState(record.mode),[rows,setRows]=useState(record.inputs.map(i=>({lot:i.lot,selected:true,participation:i.participation,exact_cft:i.exact_milli==null?"":milliLabel(i.exact_milli),min_cft:i.min_milli==null?"":milliLabel(i.min_milli),max_cft:i.max_milli==null?"":milliLabel(i.max_milli),evidence_note:i.evidence_note}))),[documents,setDocuments]=useState(record.documents||[]),[transport,setTransport]=useState(record.transport_documents||[]),[receipts,setReceipts]=useState(record.receipt_documents||[]),[note,setNote]=useState(record.discrepancy_note||""),[error,setError]=useState(null);
  const [transportFacts,setTransportFacts]=useState(record.transport||{});
  const [sold,setSold]=useState(milliLabel(record.quantity_milli)),[received,setReceived]=useState(milliLabel(record.output_quantity_milli)),[receiptDate,setReceiptDate]=useState(record.receipt_date);
  const save=async reserve=>{
    try{
      await api.patch("/eudr/inventory/transfers/"+record._id,{revision:record.revision,mode,inputs:sourcePayload(rows,mode),transport:transportFacts,documents,transport_documents:transport,receipt_documents:receipts,discrepancy_note:note,sold_cft:sold,received_cft:received,receipt_date:receiptDate});
      if(reserve)await api.post("/eudr/inventory/transfers/"+record._id+"/reserve");
      onDone();
    }catch(e){setError(e);}
  };
  return <details className="border rounded p-3 mb-3"><summary>Complete this draft's upstream sources and receipt evidence</summary><div className="mt-3">
    <Field label="Documented sold / processing input CFT" value={sold} onChange={e=>setSold(e.target.value)} /><Field label="Claimed receipt / output CFT" value={received} onChange={e=>setReceived(e.target.value)} /><Field label="Receipt / output date" type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)} />
    <PartyPicker label="Draft seller" value={owner} onChange={setOwner} /><Field label="Contribution knowledge"><Select values={modes} value={mode} onChange={e=>setMode(e.target.value)} /></Field>
    <SourceSelector owner={owner} species={record.species} mode={mode} rows={rows} onChange={setRows} material={record.input_material} proposal={{quantity_cft:milliLabel(record.quantity_milli),date:record.date}} />
    <DocumentPicker value={documents} onChange={setDocuments} purpose={record.kind==="TRANSFORMATION"?"transformation":"invoice"} />
    {record.kind!=="TRANSFORMATION"&&<>{["weight_slip","billty","driver_license","ewaybill"].map(p=><DocumentPicker key={p} label={p+" evidence"} value={transport} onChange={setTransport} purpose={p} />)}<DocumentPicker label="Receiving evidence" value={receipts} onChange={setReceipts} purpose="receipt" /></>}
    {record.species&&record.kind!=="TRANSFORMATION"&&<fieldset className="border rounded p-2"><legend className="float-none w-auto fs-6">Optional transport facts</legend>{[["eway_bill_no","E-way bill number"],["bilty_no","Bilty number"],["vehicle_no","Vehicle number"],["net_kg","Net kg"],["driver_licence_no","Driver licence number"]].map(([key,label])=><Field key={key} label={label} value={transportFacts[key]??""} onChange={e=>setTransportFacts(v=>({...v,[key]:e.target.value}))}/>)}</fieldset>}
    <Field label="Discrepancy explanation" value={note} onChange={e=>setNote(e.target.value)} /><div className="d-flex gap-2"><button className="btn btn-outline-dark" onClick={()=>save(false)}>Save draft sources</button><button className="btn btn-dark" onClick={()=>save(true)}>Save and reserve quantity</button></div><QuantityConflict error={error} />
  </div></details>;
}
