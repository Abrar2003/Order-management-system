import { useEffect, useState } from "react";
import api from "../../api/axios";
import { requestError } from "../../utils/eudrDocuments";

function DirectorySelect({ kind, label, id = `saved-${kind}`, selectedId, selectedLabel, parentKey, disabled, onSelect }) {
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setError("");
      api.get("/eudr/directory", { params: { kind, search, parent_key: parentKey }, signal: abort.signal })
        .then((response) => setEntries(response.data.data))
        .catch((error) => { if (!abort.signal.aborted) setError(requestError(error)); });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [kind, search, parentKey]);
  return <div className="mb-3"><label className="form-label" htmlFor={id}>{label}</label><input type="search" className="form-control mb-2" aria-label={`Search ${label}`} placeholder="Search saved names" value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} /><select id={id} className="form-select" disabled={disabled} value={selectedId ?? selected} onChange={(event) => { setSelected(event.target.value); onSelect(entries.find((entry) => entry._id === event.target.value) || null); }}><option value="">{kind === "vendor" ? "Select a vendor" : "Enter new details or select saved details"}</option>{selectedId && !entries.some((entry) => entry._id === selectedId) && <option value={selectedId}>{selectedLabel}</option>}{entries.map((entry) => <option key={entry._id} value={entry._id} disabled={kind === "vendor" && (!entry.fields.buyer_gst || !entry.fields.buyer_pan)}>{entry.name}{entry.fields.gst || entry.fields.buyer_gst ? ` · ${entry.fields.gst || entry.fields.buyer_gst}` : ""}{kind === "vendor" && (!entry.fields.buyer_gst || !entry.fields.buyer_pan) ? " · GST / PAN missing" : ""}</option>)}</select>{error && <p role="alert" className="small text-danger">Saved details unavailable: {error}</p>}</div>;
}

export function SaleBuyerDetails({ type, fields, stageId, disabled, onFill }) {
  return <>
    <fieldset className="mb-3" disabled={disabled}><legend className="h6">Buyer type</legend>{[["vendor", "Sold to vendor"], ["other", "Sold to other party"]].map(([value, label]) => <label className="form-check form-check-inline" key={value}><input type="radio" className="form-check-input" name={`${stageId}-buyer-type`} checked={type === value} onChange={() => onFill({ buyer_type: value, buyer_vendor_id: "", sold_to: "", buyer_gst: "", buyer_pan: "" })} />{label}</label>)}</fieldset>
    <DirectorySelect key={type} kind={type === "vendor" ? "vendor" : "buyer"} id={`${stageId}-sold-to-select`} label={type === "vendor" ? "Select buyer vendor" : "Saved other party"} selectedId={type === "vendor" ? fields.buyer_vendor_id || "" : undefined} selectedLabel={fields.sold_to} disabled={disabled} onSelect={(entry) => onFill({ buyer_type: type, buyer_vendor_id: type === "vendor" ? entry?._id || "" : "", sold_to: "", buyer_gst: "", buyer_pan: "", ...entry?.fields })} />
    <p className="small text-muted">{type === "vendor" ? "Buyer name, GST and PAN come from the selected vendor. Enter Sold CFT below. Vendors missing GST or PAN cannot be selected." : "Select a saved party or enter a new name, GST and PAN below. Complete party details are saved with this step and can be selected at any sale step in any chain."} Invoice numbers, quantities and evidence are not reused.</p>
  </>;
}

export default function SavedDetails({ kind, disabled, onFill, onReuse }) {
  const [party, setParty] = useState(null);
  const [truck, setTruck] = useState(null);
  const [driver, setDriver] = useState(null);
  const selectParty = (entry) => { setParty(entry); setTruck(null); setDriver(null); if (entry) onFill(entry.fields); };
  const evidence = [[party, ["license", "permission"]], [truck, ["truck_registration"]], [driver, ["driver_license"]]].flatMap(([entry, types]) => (entry?.evidence || []).filter((file) => types.includes(file.type)).map((file) => ({ ...file, partyId: entry._id })));
  return <section className="border rounded p-3 mb-4"><h3 className="h6">Saved details</h3><DirectorySelect kind={kind === "sawmill" ? "sawmill" : "transporter"} label={kind === "sawmill" ? "Saved sawmill" : "Saved transporter"} disabled={disabled} onSelect={selectParty} />{kind === "transport" && party && <div key={party._id}><DirectorySelect kind="vehicle" id="saved-truck" label="Saved truck" parentKey={party.identity_key} disabled={disabled} onSelect={(entry) => { setTruck(entry); if (entry) onFill({ truck_number: entry.fields.truck_number, truck_registration_number: entry.fields.truck_registration_number }); }} /><DirectorySelect kind="vehicle" id="saved-driver" label="Saved driver" parentKey={party.identity_key} disabled={disabled} onSelect={(entry) => { setDriver(entry); if (entry) onFill({ driver_license_number: entry.fields.driver_license_number }); }} /></div>}<p className="small text-muted">Complete identity details are saved automatically when you save the step. Transaction numbers, CFT and transaction files are not reused.</p>{evidence.map((file) => <div className="small mb-2" key={file._id}><span>{file.type.replace(/_/g, " ")}: {file.name} </span><button type="button" className="btn btn-sm btn-outline-secondary" disabled={disabled} onClick={() => { if (window.confirm(`Confirm ${file.name} is still valid for this chain before reusing it.`)) onReuse(file.partyId, file._id); }}>Confirm validity and reuse</button></div>)}</section>;
}
