import { useEffect, useState } from "react";
import api from "../../api/axios";
import { STAGE_FIELDS, STAGE_DOCUMENTS, STAGE_LABELS, requestError } from "../../utils/eudrDocuments";
import EudrDialog from "./EudrDialog";

export default function StageEditor({ chain, stage, canVerifyCft, onChange, onError, onClose }) {
  const [fields, setFields] = useState(stage.fields || {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedUploads, setSelectedUploads] = useState({});
  useEffect(() => setFields(stage.fields || {}), [stage]);
  const isCurrent = String(stage._id) === chain.current_stage_id;
  const canEdit = isCurrent || Boolean(stage.verified_at);
  const reportError = (error) => { const text = requestError(error); setMessage(text); onError(text); };
  const run = async (operation) => {
    try { setBusy(true); setMessage(""); await operation(); }
    catch (error) { reportError(error); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!isCurrent && !window.confirm("Editing this verified step will supersede later steps and require verification again. Continue?")) return;
    await run(async () => { const response = await api.put(`/eudr/${chain._id}/stages/${stage._id}`, { fields }); onChange(response.data.data); });
  };
  const verify = () => run(async () => {
    const saved = await api.put(`/eudr/${chain._id}/stages/${stage._id}`, { fields });
    const next = await api.post(`/eudr/${chain._id}/stages/${stage._id}/verify`);
    onChange(next.data.data || saved.data.data);
    onClose();
  });
  const upload = async (type, file) => {
    if (!isCurrent && !window.confirm("Replacing this document will supersede later steps and require verification again. Continue?")) return;
    setSelectedUploads((previous) => ({ ...previous, [type]: { file, status: "uploading" } }));
    setBusy(true); setMessage("");
    try {
      await api.put(`/eudr/${chain._id}/stages/${stage._id}`, { fields });
      const form = new FormData(); form.append("type", type); form.append("file", file);
      const response = await api.post(`/eudr/${chain._id}/stages/${stage._id}/documents`, form);
      setSelectedUploads((previous) => ({ ...previous, [type]: { file, status: "uploaded" } }));
      onChange(response.data.data);
    } catch (error) {
      setSelectedUploads((previous) => ({ ...previous, [type]: { file, status: "failed", error: requestError(error) } }));
      reportError(error);
    } finally { setBusy(false); }
  };
  return <EudrDialog titleId="eudr-edit-title" className="eudr-drawer" onClose={() => { if (!busy) onClose(); }}>
    <header className="eudr-dialog-header"><div><span className="eudr-eyebrow">Edit stage details</span><h2 id="eudr-edit-title">{STAGE_LABELS[stage.kind]}</h2></div><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>Close</button></header>
    <div className="eudr-dialog-body">
      {message && <div className="alert alert-danger" role="alert">{message}</div>}
      {!isCurrent && <p className="alert alert-warning">Changes to this verified stage supersede later steps and require verification again.</p>}
      <div className="row g-3">{STAGE_FIELDS[stage.kind].map(([name, label, type = "text"]) => <div className="col-12 col-sm-6" key={name}>
        <label className="form-label" htmlFor={`${stage._id}-${name}`}>{label}</label>
        <input id={`${stage._id}-${name}`} type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.001" : undefined} className="form-control" value={fields[name] ?? ""} onChange={(event) => setFields((previous) => ({ ...previous, [name]: event.target.value }))} disabled={!canEdit || busy} />
      </div>)}</div>
      {stage.kind === "receiver" && <p className="small text-muted mt-3">Received CFT differences between legs do not block verification. Receiver GST and PAN must both match the shipping vendor to end the chain.</p>}
      <h3 className="h5 mt-4">Documents</h3>
      {STAGE_DOCUMENTS[stage.kind].filter(([type]) => type !== "truck_registration" || fields.truck_registration_number || stage.documents.some((document) => document.type === type)).map(([type, label]) => {
        const document = stage.documents.find((entry) => entry.type === type);
        const selected = selectedUploads[type];
        return <div className="eudr-upload-row" key={type}>
          <label className="form-label" htmlFor={`${stage._id}-${type}`}>{label}{type === "truck_registration" && " (required when number entered)"}</label>
          {document && <p className="small mb-2">Currently uploaded: <strong>{document.name}</strong></p>}
          <input id={`${stage._id}-${type}`} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.csv" className="form-control" disabled={!canEdit || busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(type, file); }} />
          {selected?.status === "uploading" && <div className="small mt-1" role="status">Uploading {selected.file.name}…</div>}
          {selected?.status === "uploaded" && <div className="small text-success mt-1" role="status">Uploaded {selected.file.name}</div>}
          {selected?.status === "failed" && <div className="small text-danger mt-1" role="alert">Upload failed: {selected.error} <button type="button" className="btn btn-link btn-sm p-0" disabled={busy} onClick={() => upload(type, selected.file)}>Retry upload</button></div>}
        </div>;
      })}
    </div>
    <footer className="eudr-dialog-footer">{STAGE_FIELDS[stage.kind].length > 0 && <button type="button" className="btn btn-outline-secondary" disabled={!canEdit || busy} onClick={save}>Save step</button>}{isCurrent && <button type="button" className="btn btn-dark" disabled={busy || !canVerifyCft} onClick={verify}>{busy ? "Working…" : "Verify and continue"}</button>}</footer>
  </EudrDialog>;
}
