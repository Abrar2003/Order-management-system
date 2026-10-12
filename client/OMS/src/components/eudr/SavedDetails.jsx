import { useEffect, useState } from "react";
import api from "../../api/axios";
import { requestError } from "../../utils/eudrDocuments";

function DirectorySelect({ kind, label, id = `saved-${kind}`, parentKey, disabled, onSelect }) {
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
  return <div className="mb-3"><label className="form-label" htmlFor={id}>{label}</label><input type="search" className="form-control mb-2" aria-label={`Search ${label}`} placeholder="Search saved names" value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} /><select id={id} className="form-select" disabled={disabled} value={selected} onChange={(event) => { setSelected(event.target.value); onSelect(entries.find((entry) => entry._id === event.target.value) || null); }}><option value="">Enter new details or select saved details</option>{entries.map((entry) => <option key={entry._id} value={entry._id}>{entry.name}{entry.fields.gst ? ` · ${entry.fields.gst}` : ""}</option>)}</select>{error && <p role="alert" className="small text-danger">Saved details unavailable: {error}</p>}</div>;
}

export default function SavedDetails({ kind, disabled, onFill, onReuse }) {
  const [party, setParty] = useState(null);
  const [truck, setTruck] = useState(null);
  const [driver, setDriver] = useState(null);
  const selectParty = (entry) => { setParty(entry); setTruck(null); setDriver(null); if (entry) onFill(entry.fields); };
  const evidence = [[party, ["license", "permission"]], [truck, ["truck_registration"]], [driver, ["driver_license"]]].flatMap(([entry, types]) => (entry?.evidence || []).filter((file) => types.includes(file.type)).map((file) => ({ ...file, partyId: entry._id })));
  return <section className="border rounded p-3 mb-4"><h3 className="h6">Saved details</h3><DirectorySelect kind={kind === "sawmill" ? "sawmill" : "transporter"} label={kind === "sawmill" ? "Saved sawmill" : "Saved transporter"} disabled={disabled} onSelect={selectParty} />{kind === "transport" && party && <div key={party._id}><DirectorySelect kind="vehicle" id="saved-truck" label="Saved truck" parentKey={party.identity_key} disabled={disabled} onSelect={(entry) => { setTruck(entry); if (entry) onFill({ truck_number: entry.fields.truck_number, truck_registration_number: entry.fields.truck_registration_number }); }} /><DirectorySelect kind="vehicle" id="saved-driver" label="Saved driver" parentKey={party.identity_key} disabled={disabled} onSelect={(entry) => { setDriver(entry); if (entry) onFill({ driver_license_number: entry.fields.driver_license_number }); }} /></div>}<p className="small text-muted">Complete identity details are saved automatically when you save the step. Transaction numbers, CFT and transaction files are not reused.</p>{evidence.map((file) => <div className="small mb-2" key={file._id}><span>{file.type.replace(/_/g, " ")}: {file.name} </span><button type="button" className="btn btn-sm btn-outline-secondary" disabled={disabled} onClick={() => { if (window.confirm(`Confirm ${file.name} is still valid for this chain before reusing it.`)) onReuse(file.partyId, file._id); }}>Confirm validity and reuse</button></div>)}</section>;
}
