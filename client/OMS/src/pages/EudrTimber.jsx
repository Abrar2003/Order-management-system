import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.service";
import { normalizeUserRole } from "../auth/permissions";

const FIELDS = {
  sawmill: [
    ["name", "Ara / sawmill name"], ["gst", "GST"], ["pan", "PAN"],
    ["permission_number", "Permission number"], ["cutting_limit_cft", "Cutting limit (CFT, optional)", "number"],
    ["invoice_number", "Cutting invoice number"], ["invoice_date", "Cutting invoice date", "date"],
  ],
  transport: [
    ["transporter_name", "Transporter name"], ["truck_number", "Truck number"],
    ["truck_registration_number", "Truck registration number (optional)"],
    ["driver_license_number", "Driver licence number"], ["ewaybill_number", "E-way bill number"],
    ["gst", "Transporter GST (optional)"], ["billty_number", "Billty number"],
  ],
  receiver: [
    ["name", "Receiver name"], ["gst", "Receiver GST"], ["pan", "Receiver PAN"],
    ["received_cft", "Received CFT", "number"], ["invoice_number", "Invoice number"],
    ["invoice_date", "Invoice date", "date"], ["issuer_name", "Invoice issuer name"],
    ["issuer_gst", "Invoice issuer GST"], ["issuer_pan", "Invoice issuer PAN"],
  ],
  declaration: [],
};
const DOCUMENTS = {
  sawmill: [["cutting_invoice", "Cutting invoice"], ["license", "Sawmill license"], ["permission", "Sawmill permission / permit"]],
  transport: [["weight_slip", "Weight slip"], ["billty", "Billty"], ["driver_license", "Driver licence"], ["ewaybill", "E-way bill"], ["truck_registration", "Truck registration (required if number entered)"]],
  receiver: [["invoice", "Receiver invoice"]],
  declaration: [["declaration", "Declaration"]],
};
const LABELS = { sawmill: "Ara / Sawmill", transport: "Transport", receiver: "Receiver", declaration: "Declaration" };
const errorText = (error) => error?.response?.data?.message || error?.message || "Request failed";
const declaredMilliCft = (value) => {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && Math.abs(number * 1000 - Math.round(number * 1000)) <= 1e-7
    ? Math.round(number * 1000) : null;
};
const cftMismatchText = (declaredMilli, stuffedMilli) => {
  if (declaredMilli == null || stuffedMilli == null || declaredMilli === stuffedMilli) return "";
  const direction = declaredMilli < stuffedMilli ? "less" : "more";
  return `Declared CFT is ${(Math.abs(declaredMilli - stuffedMilli) / 1000).toFixed(3)} ${direction} than stuffed CFT. Enter exactly ${(stuffedMilli / 1000).toFixed(3)} CFT to continue.`;
};

const StageCard = ({ chain, stage, index, currentId, canVerifyCft, onChange, onError }) => {
  const [fields, setFields] = useState(stage.fields || {});
  const [busy, setBusy] = useState(false);
  const [selectedUploads, setSelectedUploads] = useState({});
  useEffect(() => setFields(stage.fields || {}), [stage]);
  const isCurrent = String(stage._id) === currentId;
  const canEdit = isCurrent || Boolean(stage.verified_at);
  const run = async (operation) => {
    try { setBusy(true); await operation(); }
    catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    const isPast = !isCurrent;
    if (isPast && !window.confirm("Editing this verified step will supersede later steps and require verification again. Continue?")) return;
    await run(async () => {
      const response = await api.put(`/eudr/${chain._id}/stages/${stage._id}`, { fields });
      onChange(response.data.data);
    });
  };
  const verify = () => run(async () => {
    const saved = await api.put(`/eudr/${chain._id}/stages/${stage._id}`, { fields });
    const next = await api.post(`/eudr/${chain._id}/stages/${stage._id}/verify`);
    onChange(next.data.data || saved.data.data);
  });
  const upload = async (type, file) => {
    if (!isCurrent && !window.confirm("Replacing this document will supersede later steps and require verification again. Continue?")) return;
    setSelectedUploads((previous) => ({ ...previous, [type]: { file, status: "uploading" } }));
    setBusy(true);
    try {
      await api.put(`/eudr/${chain._id}/stages/${stage._id}`, { fields });
      const form = new FormData();
      form.append("type", type);
      form.append("file", file);
      const response = await api.post(`/eudr/${chain._id}/stages/${stage._id}/documents`, form);
      setSelectedUploads((previous) => ({ ...previous, [type]: { file, status: "uploaded" } }));
      onChange(response.data.data);
    } catch (error) {
      const message = errorText(error);
      setSelectedUploads((previous) => ({ ...previous, [type]: { file, status: "failed", error: message } }));
      onError(message);
    } finally { setBusy(false); }
  };
  const openDocument = async (document) => {
    const tab = window.open("", "_blank");
    try {
      const response = await api.get(`/eudr/${chain._id}/stages/${stage._id}/documents/${document._id}/url`);
      if (tab) tab.location.href = response.data.url;
      else window.location.href = response.data.url;
    } catch (error) { tab?.close(); onError(errorText(error)); }
  };
  return (
    <section className="card om-card mb-3" aria-label={`${LABELS[stage.kind]} step ${index + 1}`}>
      <div className="card-body">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <h3 className="h5 mb-0">{index + 1}. {LABELS[stage.kind]}</h3>
          <span className={`badge ${stage.verified_at ? "bg-success" : isCurrent ? "bg-warning text-dark" : "bg-secondary"}`}>
            {stage.verified_at ? `Verified by ${stage.verified_by_name || "user"} · ${new Date(stage.verified_at).toLocaleString()}` : isCurrent ? "Needs verification" : "Locked"}
          </span>
        </div>
        <div className="row g-3">
          {FIELDS[stage.kind].map(([name, label, type = "text"]) => (
            <div className="col-12 col-md-6 col-xl-4" key={name}>
              <label className="form-label" htmlFor={`${stage._id}-${name}`}>{label}</label>
              <input id={`${stage._id}-${name}`} type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.001" : undefined} className="form-control" value={fields[name] ?? ""} onChange={(event) => setFields((previous) => ({ ...previous, [name]: event.target.value }))} disabled={!canEdit || busy} />
            </div>
          ))}
        </div>
        {stage.kind === "receiver" && <p className="small text-muted mt-2 mb-0">Received CFT is recorded for traceability; differences between legs do not block verification. The chain ends only when receiver GST and PAN both match the shipping vendor.</p>}
        <div className="row g-3 mt-1">
          {DOCUMENTS[stage.kind].filter(([type]) => type !== "truck_registration" || stage.kind !== "transport" || fields.truck_registration_number || stage.documents.some((document) => document.type === type)).map(([type, label]) => {
            const document = stage.documents.find((entry) => entry.type === type);
            return (
              <div className="col-12 col-md-6 col-xl-4" key={type}>
                <label className="form-label" htmlFor={`${stage._id}-${type}`}>{label}</label>
                <input id={`${stage._id}-${type}`} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.csv" className="form-control" disabled={!canEdit || busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(type, file); }} />
                {selectedUploads[type]?.status === "uploading" && <div className="small text-muted mt-1">Uploading {selectedUploads[type].file.name}…</div>}
                {selectedUploads[type]?.status === "uploaded" && <div className="small text-success mt-1">Uploaded {selectedUploads[type].file.name}</div>}
                {selectedUploads[type]?.status === "failed" && <div className="small text-danger mt-1" role="alert">Upload failed: {selectedUploads[type].error} <button type="button" className="btn btn-link btn-sm p-0" disabled={busy} onClick={() => upload(type, selectedUploads[type].file)}>Retry upload</button></div>}
                {document && <button type="button" className="btn btn-link btn-sm px-0" onClick={() => openDocument(document)}>{document.name}</button>}
              </div>
            );
          })}
        </div>
        {canEdit && <div className="d-flex gap-2 mt-3">
          {FIELDS[stage.kind].length > 0 && <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={save}>Save step</button>}
          {isCurrent && <button type="button" className="btn btn-dark" disabled={busy || !canVerifyCft} onClick={verify}>{busy ? "Working…" : "Verify and continue"}</button>}
        </div>}
      </div>
    </section>
  );
};

const EudrTimber = () => {
  const role = normalizeUserRole(getUserFromToken()?.role);
  const allowed = ["admin", "super_admin", "manager"].includes(role);
  const [container, setContainer] = useState("");
  const [lookup, setLookup] = useState(null);
  const [list, setList] = useState([]);
  const [chain, setChain] = useState(null);
  const [declared, setDeclared] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadList = useCallback(async () => {
    try { const response = await api.get("/eudr"); setList(response.data.data || []); }
    catch (err) { setError(errorText(err)); }
  }, []);
  useEffect(() => { if (allowed) loadList(); }, [allowed, loadList]);
  if (!allowed) return <><Navbar /><div className="page-shell py-4">EUDR is restricted to admins and managers.</div></>;
  const search = async (value = container) => {
    try { setBusy(true); setError(""); const response = await api.get("/eudr/container", { params: { container: value.trim() } }); setLookup(response.data); setContainer(value.trim()); }
    catch (err) { setError(errorText(err)); setLookup(null); }
    finally { setBusy(false); }
  };
  const openChain = async (id) => {
    try { setBusy(true); setError(""); const response = await api.get(`/eudr/${id}`); setChain(response.data.data); setContainer(response.data.data.container); setDeclared(String(response.data.data.declared_milli_cft / 1000)); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const create = async (vendorId) => {
    try { setBusy(true); setError(""); const response = await api.post("/eudr", { container, vendor_id: vendorId, declared_cft: declared }); setChain(response.data.data); await loadList(); await search(container); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const saveDeclared = async () => {
    try { setBusy(true); setError(""); const response = await api.patch(`/eudr/${chain._id}/declared`, { declared_cft: declared }); setChain(response.data.data); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const activeGroup = lookup?.vendors?.find((entry) => entry.vendor._id === String(chain?.vendor?._id || chain?.vendor));
  const selectedGroup = chain ? { rows: chain.shipment_rows, excluded: chain.excluded, stuffed_cft: chain.stuffed_cft, vendor: chain.vendor } : activeGroup;
  const enteredMilliCft = declaredMilliCft(declared);
  const chainStuffedMilliCft = chain && chain.stuffed_cft != null ? Math.round(Number(chain.stuffed_cft) * 1000) : null;
  const savedChainMismatch = chain ? cftMismatchText(chain.declared_milli_cft, chainStuffedMilliCft) : "";
  const enteredChainMismatch = cftMismatchText(enteredMilliCft, chainStuffedMilliCft);
  return <>
    <Navbar />
    <main className="page-shell py-3" style={{ maxWidth: "none", width: "96%" }}>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><div><h1 className="h3 mb-1">EUDR Timber Management</h1><p className="text-muted mb-0">Verified timber chain by container and shipping vendor</p></div>{chain && <button className="btn btn-outline-secondary" onClick={() => { setChain(null); search(container); loadList(); }}>Back to containers</button>}</div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {!chain ? <>
        <form className="card om-card card-body mb-3" onSubmit={(event) => { event.preventDefault(); search(); }}><div className="row g-2 align-items-end"><div className="col-12 col-md-6"><label className="form-label" htmlFor="eudr-container">Container number</label><input id="eudr-container" className="form-control" required value={container} onChange={(event) => setContainer(event.target.value)} /></div><div className="col-auto"><button className="btn btn-dark" disabled={busy}>Find shipments</button></div></div></form>
        {lookup && <div className="card om-card card-body mb-3"><h2 className="h5">Vendors in {lookup.container}</h2>{lookup.unassigned?.length > 0 && <div className="alert alert-warning">{lookup.unassigned.length} shipment line(s) have no unambiguous vendor. Resolve their vendor assignment before final declaration.</div>}{lookup.vendors?.length ? lookup.vendors.map((group) => {
          const existing = lookup.chains?.find((entry) => entry.vendor_id === group.vendor._id);
          const stuffedMilliCft = Math.round(group.stuffed_cft * 1000);
          const mismatch = cftMismatchText(enteredMilliCft, stuffedMilliCft);
          return (
            <div className="border rounded p-3 mb-2" key={group.vendor._id}>
              <div className="d-flex flex-wrap justify-content-between gap-2">
                <div>
                  <strong>{group.vendor.name}</strong> · GST {group.vendor.gst || "missing"} · PAN {group.vendor.pan || "missing"}
                  <div className="small">Stuffed CFT: {group.stuffed_cft.toFixed(3)} · {group.rows.length} shipment lines</div>
                  {group.excluded.length > 0 && <div className="text-danger small">Warning: {group.excluded.length} line(s) missing Timber_CFT are excluded.</div>}
                  {(!group.vendor.gst || !group.vendor.pan) && <div className="text-danger small">Ask an admin to add both identifiers to this vendor before starting EUDR.</div>}
                </div>
                {existing ? (
                  <button className="btn btn-dark" onClick={() => openChain(existing._id)}>Open chain</button>
                ) : (
                  <div className="d-flex gap-2 align-items-end">
                    <div>
                      <label className="form-label" htmlFor={`declared-${group.vendor._id}`}>Declared CFT</label>
                      <input id={`declared-${group.vendor._id}`} type="number" min="0.001" step="0.001" className="form-control" value={declared} onChange={(event) => setDeclared(event.target.value)} />
                      {mismatch && <div className="text-danger small mt-1" role="alert">{mismatch}</div>}
                      {declared && enteredMilliCft == null && <div className="text-danger small mt-1" role="alert">Enter a positive CFT with at most three decimal places.</div>}
                    </div>
                    <button className="btn btn-dark" disabled={busy || enteredMilliCft !== stuffedMilliCft || !group.vendor.gst || !group.vendor.pan} onClick={() => create(group.vendor._id)}>Start chain</button>
                  </div>
                )}
              </div>
            </div>
          );
        }) : <p>No shipments found for this container.</p>}</div>}
        <div className="card om-card card-body"><h2 className="h5">Recent chains</h2>{list.length ? <div className="table-responsive"><table className="table"><thead><tr><th>Container</th><th>Vendor</th><th>Declared CFT</th><th>Status</th><th></th></tr></thead><tbody>{list.map((entry) => <tr key={entry._id}><td>{entry.container}</td><td>{entry.vendor?.name || "Unknown"}</td><td>{Number(entry.declared_cft).toFixed(3)}</td><td>{entry.complete ? "Verified" : "In progress"}</td><td><button className="btn btn-sm btn-outline-dark" onClick={() => openChain(entry._id)}>Open</button></td></tr>)}</tbody></table></div> : <p className="mb-0">No chains yet.</p>}</div>
      </> : <>
        <div className="card om-card card-body mb-3"><div className="row g-3 align-items-end"><div className="col-12 col-md-5"><strong>Container: {chain.container}</strong><div>Shipping vendor: {chain.vendor?.name}</div><div className="small text-muted">GST {chain.vendor?.gst} · PAN {chain.vendor?.pan}</div></div><div className="col-12 col-md-3"><label className="form-label" htmlFor="eudr-declared">Declared CFT</label><input id="eudr-declared" type="number" min="0.001" step="0.001" className="form-control" value={declared} onChange={(event) => setDeclared(event.target.value)} />{enteredChainMismatch && enteredMilliCft !== chain.declared_milli_cft && <div className="text-danger small mt-1" role="alert">{enteredChainMismatch}</div>}{declared && enteredMilliCft == null && <div className="text-danger small mt-1" role="alert">Enter a positive CFT with at most three decimal places.</div>}</div><div className="col-auto"><button className="btn btn-outline-dark" disabled={busy || enteredMilliCft !== chainStuffedMilliCft} onClick={saveDeclared}>Update declaration amount</button></div><div className="col-12">Calculated stuffed CFT: <strong>{Number(selectedGroup?.stuffed_cft || 0).toFixed(3)}</strong>{savedChainMismatch && <span className="text-danger ms-2" role="alert">{savedChainMismatch}</span>}</div></div></div>
        {selectedGroup?.excluded?.length > 0 && <div className="alert alert-warning" role="status"><strong>Partial CFT total:</strong> {selectedGroup.excluded.length} shipment line(s) have no Timber_CFT and are excluded. This can understate the true stuffed CFT.<ul className="mb-0 mt-1">{selectedGroup.excluded.map((row) => <li key={row.shipment_id}>{row.source} {row.code} — quantity {row.quantity}</li>)}</ul></div>}
        {chain.unassigned?.length > 0 && <div className="alert alert-warning">{chain.unassigned.length} unassigned shipment line(s) must be resolved before declaration.</div>}
        <div className="card om-card card-body mb-3"><h2 className="h5">Stuffed timber calculation</h2><div className="table-responsive"><table className="table table-sm"><thead><tr><th>PO / source</th><th>Shipment invoice</th><th>Item / sample</th><th>Quantity</th><th>CFT per unit</th><th>Line CFT</th></tr></thead><tbody>{(chain.shipment_rows || []).map((row) => <tr key={`${row.source}-${row.shipment_id}`}><td>{row.order_id}</td><td>{row.invoice_number || "—"}</td><td>{row.code}</td><td>{row.quantity}</td><td>{row.timber_cft == null ? "Missing" : Number(row.timber_cft).toFixed(3)}</td><td>{row.line_milli_cft == null ? "Excluded" : (row.line_milli_cft / 1000).toFixed(3)}</td></tr>)}</tbody></table></div></div>
        {chain.complete && <div className="alert alert-success">This chain is fully verified.</div>}
        {chain.stages.map((stage, index) => <StageCard key={stage._id} chain={chain} stage={stage} index={index} currentId={chain.current_stage_id} canVerifyCft={chainStuffedMilliCft != null && !savedChainMismatch} onChange={(next) => { setChain(next); setError(""); }} onError={setError} />)}
        {chain.history?.length > 0 && <div className="card om-card card-body"><h2 className="h5">Audit history</h2><ul className="mb-0">{chain.history.slice().reverse().map((entry, index) => <li key={`${entry._id || entry.at}-${index}`}>{new Date(entry.at).toLocaleString()} — {String(entry.event || "").replace(/_/g, " ")} — {entry.actor_name || String(entry.actor || "unknown")}</li>)}</ul></div>}
      </>}
    </main>
  </>;
};

export default EudrTimber;
