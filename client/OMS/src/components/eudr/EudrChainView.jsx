import { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import { STAGE_LABELS, STAGE_FIELDS, normalizeChainDocuments, missingStageDocuments, formatCft, formatDate, declaredMilliCft, cftMismatchText, requestError } from "../../utils/eudrDocuments";
import { createDocumentStore } from "./documentStore";
import { StageMetadata, DocumentGallery, AllDocumentsGallery, FullDocumentViewer } from "./DocumentWorkspace";
import StageEditor from "./StageEditor";
import EudrDialog from "./EudrDialog";
import "./eudr.css";

const ACTION_LABELS = { stage_edited: "Stage details updated", document_uploaded: "Document uploaded", stage_verified: "Stage manually verified", verification_invalidated: "Verification revoked", later_stages_superseded: "Later stages superseded", declared_cft_changed: "Declared timber updated" };

function AuditHistory({ chain }) {
  const [expanded, setExpanded] = useState(false);
  const events = [...(chain.history || [])].reverse();
  const findStage = (id) => chain.stages.find((stage) => String(stage._id) === id) || events.flatMap((entry) => entry.detail?.stages || []).find((stage) => String(stage._id) === id);
  return <section className="card om-card eudr-audit"><div className="card-body"><div className="eudr-section-heading"><div><span className="eudr-eyebrow">Traceable activity</span><h2>Audit history</h2></div><span>{events.length} recorded events</span></div>
    {!events.length ? <p className="text-muted mb-0">No activity has been recorded yet.</p> : <ol className="eudr-activity-list">{(expanded ? events : events.slice(0, 6)).map((entry, index) => {
      const stage = findStage(entry.stage_id);
      const detail = entry.detail || {};
      const changes = detail.before && detail.after && typeof detail.before === "object" && typeof detail.after === "object" ? [...new Set([...Object.keys(detail.before), ...Object.keys(detail.after)])].filter((field) => detail.before[field] !== detail.after[field]) : [];
      return <li key={entry._id || `${entry.at}-${index}`}><div className="eudr-activity-heading"><strong>{ACTION_LABELS[entry.event] || String(entry.event || "Activity").replace(/_/g, " ")}</strong><time dateTime={entry.at}>{formatDate(entry.at, true)}</time></div><p>{stage ? STAGE_LABELS[stage.kind] : entry.stage_id ? "Earlier stage" : "Chain"} <span aria-hidden="true">·</span> {entry.actor_name || String(entry.actor || "Unknown user")}</p>
        {detail.reason && <p>{detail.reason}</p>}{detail.name && <p>{detail.name}{detail.replaced?.name && ` · Replaced ${detail.replaced.name}`}</p>}
        {entry.event === "declared_cft_changed" && <p>{formatCft(detail.before)} → {formatCft(detail.after)} CFT</p>}
        {detail.stages?.length > 0 && <p>{detail.stages.length} later stage(s) preserved in the audit record.</p>}
        {changes.length > 0 && <details><summary>{changes.length} field change{changes.length === 1 ? "" : "s"}</summary><dl className="eudr-audit-changes">{changes.map((field) => <div key={field}><dt>{STAGE_FIELDS[stage?.kind]?.find(([name]) => name === field)?.[1] || field.replace(/_/g, " ")}</dt><dd>{String(detail.before[field] || "Not provided")} → {String(detail.after[field] || "Not provided")}</dd></div>)}</dl></details>}
      </li>;
    })}</ol>}
    {events.length > 6 && <button type="button" className="btn btn-outline-secondary" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show recent activity" : `View Full Audit History (${events.length})`}</button>}
  </div></section>;
}

export default function EudrChainView({ chain, onChange, onError, onBack }) {
  const documents = useMemo(() => normalizeChainDocuments(chain), [chain]);
  const [store, setStore] = useState(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [editingStageId, setEditingStageId] = useState(null);
  const [declaredOpen, setDeclaredOpen] = useState(false);
  const [declared, setDeclared] = useState(String(chain.declared_milli_cft / 1000));
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  useEffect(() => { const next = createDocumentStore(chain._id); setStore(next); return () => next.dispose(); }, [chain._id]);
  useEffect(() => setDeclared(String(chain.declared_milli_cft / 1000)), [chain.declared_milli_cft]);
  const rows = chain.shipment_rows || [];
  const excluded = chain.excluded || [];
  const verified = chain.stages.filter((stage) => stage.verified_at).length;
  const missing = chain.stages.reduce((count, stage) => count + missingStageDocuments(stage, chain).length, 0);
  const stuffedMilli = chain.stuffed_cft == null ? null : Math.round(Number(chain.stuffed_cft) * 1000);
  const mismatch = cftMismatchText(chain.declared_milli_cft, stuffedMilli);
  const enteredMilli = declaredMilliCft(declared);
  const enteredMismatch = cftMismatchText(enteredMilli, stuffedMilli);
  const canVerifyCft = stuffedMilli != null && !mismatch;
  const editingStage = chain.stages.find((stage) => String(stage._id) === editingStageId);
  const openPreview = (document, sequence) => setViewer({ initialId: document.id, documents: sequence });
  const verify = async (stage) => {
    try { setBusy(String(stage._id)); setActionError(""); const response = await api.post(`/eudr/${chain._id}/stages/${stage._id}/verify`); onChange(response.data.data); }
    catch (error) { const message = requestError(error); setActionError(message); onError(message); }
    finally { setBusy(""); }
  };
  const saveDeclared = async (event) => {
    event.preventDefault();
    try { setBusy("declared"); setActionError(""); const response = await api.patch(`/eudr/${chain._id}/declared`, { declared_cft: declared }); onChange(response.data.data); setDeclaredOpen(false); }
    catch (error) { const message = requestError(error); setActionError(message); onError(message); }
    finally { setBusy(""); }
  };
  return <div className="eudr-report">
    <header className="eudr-report-header"><div><span className="eudr-eyebrow">Timber traceability / Container {chain.container}</span><h1>EUDR Timber Chain</h1><p>Shipping vendor: <strong>{chain.vendor?.name || "Unknown vendor"}</strong> <span aria-hidden="true">·</span> Chain status: <span className={`eudr-status ${chain.complete ? "is-verified" : "is-pending"}`}>{chain.complete ? "Verified" : "Pending review"}</span></p><p className="small text-muted">GST {chain.vendor?.gst || "Not provided"} <span aria-hidden="true">·</span> PAN {chain.vendor?.pan || "Not provided"}</p></div><div className="eudr-header-actions"><button type="button" className="btn btn-dark" disabled={!store} onClick={() => setGalleryOpen(true)}>View All Documents ({documents.length})</button><button type="button" className="btn btn-outline-secondary" disabled={Boolean(busy)} onClick={onBack}>Back to Containers</button></div></header>

    <div className="eudr-summary-grid"><section><span>Declared timber CFT</span><strong>{formatCft(chain.declared_milli_cft / 1000)}</strong><button type="button" className="btn btn-link btn-sm p-0" onClick={() => { setActionError(""); setDeclaredOpen(true); }}>Update declaration amount</button></section><section><span>Calculated stuffed CFT</span><strong>{formatCft(chain.stuffed_cft)}</strong><small className={mismatch ? "text-danger" : "text-success"}>{stuffedMilli == null ? "Shipment total unavailable" : mismatch ? "Does not match declaration" : "Matches declared amount"}</small></section><section><span>Calculation coverage</span><strong>{rows.length - excluded.length}/{rows.length} <small>lines included</small></strong><small className={excluded.length ? "text-warning" : "text-muted"}>{excluded.length ? `${excluded.length} missing Timber_CFT · partial total` : rows.length ? "All shipment lines have Timber_CFT" : "No shipment lines available"}</small></section><section><span>Stage verification</span><strong>{verified}/{chain.stages.length} <small>saved stages</small></strong><small>{missing ? `${missing} required document(s) not uploaded` : chain.complete ? "Final manual review recorded" : "Awaiting manual review"}</small></section></div>
    <p className="eudr-evidence-note">These records document timber traceability and manual review. Administrative verification does not establish EUDR compliance.</p>
    {mismatch && <div className="alert alert-danger" role="alert">{mismatch}</div>}
    {excluded.length > 0 && <div className="alert alert-warning" role="status"><strong>Partial CFT total:</strong> {excluded.length} shipment line(s) have no Timber_CFT and are excluded. This can understate the true stuffed CFT.<ul className="mb-0 mt-1">{excluded.map((row) => <li key={`${row.source}-${row.shipment_id}`}>{row.source} {row.code} — quantity {row.quantity}</li>)}</ul></div>}
    {chain.unassigned?.length > 0 && <div className="alert alert-warning">{chain.unassigned.length} unassigned shipment line(s) must be resolved before declaration.</div>}

    <nav className="eudr-progress" aria-label="Chain progress">{chain.stages.map((stage, index) => <a key={stage._id} href={`#eudr-stage-${stage._id}`} className={stage.verified_at ? "is-verified" : String(stage._id) === chain.current_stage_id ? "is-current" : ""}><span className="eudr-step-number">{stage.verified_at ? "✓" : index + 1}</span><strong>{STAGE_LABELS[stage.kind]}</strong><span>{stage.verified_at ? "Verified" : String(stage._id) === chain.current_stage_id ? "Pending review" : "Locked"} · {stage.documents.length} document(s)</span>{stage.verified_at && <small>{stage.verified_by_name || "User"}<br />{formatDate(stage.verified_at, true)}</small>}</a>)}{Object.entries(STAGE_LABELS).filter(([kind]) => !chain.stages.some((stage) => stage.kind === kind)).map(([kind, label]) => <div key={kind} className="eudr-upcoming"><span className="eudr-step-number">○</span><strong>{label}</strong><span>Not yet reached · 0 documents</span></div>)}</nav>

    {store && chain.stages.map((stage, index) => {
      const stageDocuments = documents.filter((document) => document.stageId === String(stage._id));
      const missingDocuments = missingStageDocuments(stage, chain);
      const isCurrent = String(stage._id) === chain.current_stage_id;
      return <section id={`eudr-stage-${stage._id}`} className="card om-card eudr-stage" key={stage._id} aria-label={`${STAGE_LABELS[stage.kind]} step ${index + 1}`}><div className="card-body"><div className="eudr-section-heading"><div><span className="eudr-eyebrow">Chain stage {index + 1}</span><h2>{STAGE_LABELS[stage.kind]}</h2></div><div className="eudr-header-actions"><span className={`eudr-status ${stage.verified_at ? "is-verified" : "is-pending"}`}>{stage.verified_at ? "Stage verified" : isCurrent ? "Pending review" : "Locked"}</span>{(isCurrent || stage.verified_at) && <button type="button" className="btn btn-sm btn-outline-secondary" disabled={Boolean(busy)} onClick={() => setEditingStageId(String(stage._id))}>Edit Details</button>}</div></div><div className="eudr-stage-layout"><StageMetadata stage={stage} chain={chain} /><div className="eudr-stage-documents"><div className="eudr-section-heading"><h3>Documents</h3><span>{stageDocuments.length} uploaded</span></div><DocumentGallery documents={stageDocuments} chainId={chain._id} store={store} onPreview={(document) => openPreview(document, documents)} />{missingDocuments.length > 0 && <p className="eudr-missing-documents"><strong>Not uploaded:</strong> {missingDocuments.map(([, label]) => label).join(" · ")}</p>}</div></div>{isCurrent && <footer className="eudr-stage-footer"><p className="small text-muted mb-0">Complete the details and required uploads before manual verification.</p><button type="button" className="btn btn-dark" disabled={Boolean(busy) || !canVerifyCft} onClick={() => verify(stage)}>{busy === String(stage._id) ? "Verifying…" : "Verify and continue"}</button></footer>}{actionError && isCurrent && <p className="text-danger mt-2" role="alert">{actionError}</p>}</div></section>;
    })}

    <section className="card om-card eudr-calculation"><div className="card-body"><div className="eudr-section-heading"><div><span className="eudr-eyebrow">Shipment quantities × per-unit Timber_CFT</span><h2>Stuffed timber calculation</h2></div><span>Declared: {formatCft(chain.declared_milli_cft / 1000)} CFT</span></div><div className="table-responsive"><table className="table align-middle"><thead><tr><th>PO / source</th><th>Shipment invoice</th><th>Item / sample</th><th className="text-end">Quantity</th><th className="text-end">CFT per unit</th><th className="text-end">Line CFT</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.source}-${row.shipment_id}`} className={row.timber_cft == null ? "eudr-excluded-row" : ""}><td>{row.order_id || row.source}</td><td>{row.invoice_number || "—"}</td><td>{row.code}</td><td className="text-end">{row.quantity}</td><td className="text-end">{row.timber_cft == null ? <span className="text-danger">Missing Timber_CFT</span> : formatCft(row.timber_cft)}</td><td className="text-end">{row.line_milli_cft == null ? <span className="text-warning">Excluded</span> : formatCft(row.line_milli_cft / 1000)}</td></tr>)}</tbody><tfoot><tr><th colSpan="5">Calculated stuffed CFT{excluded.length > 0 && " (partial total)"}</th><th className="text-end">{formatCft(chain.stuffed_cft)}</th></tr></tfoot></table></div></div></section>
    <AuditHistory chain={chain} />
    {editingStage && <StageEditor chain={chain} stage={editingStage} canVerifyCft={canVerifyCft} onChange={onChange} onError={onError} onClose={() => setEditingStageId(null)} />}
    {declaredOpen && <EudrDialog titleId="eudr-declared-title" className="eudr-small-dialog" onClose={() => { if (!busy) setDeclaredOpen(false); }}><header className="eudr-dialog-header"><h2 id="eudr-declared-title">Update declared timber CFT</h2><button type="button" className="btn btn-outline-secondary" disabled={Boolean(busy)} onClick={() => setDeclaredOpen(false)}>Close</button></header><form onSubmit={saveDeclared} className="eudr-dialog-body"><p>Calculated stuffed timber: <strong>{formatCft(chain.stuffed_cft)} CFT</strong></p><label className="form-label" htmlFor="eudr-declared">Declared CFT</label><input id="eudr-declared" type="number" min="0.001" step="0.001" className="form-control" value={declared} onChange={(event) => setDeclared(event.target.value)} />{enteredMismatch && <p className="text-danger mt-2" role="alert">{enteredMismatch}</p>}{declared && enteredMilli == null && <p className="text-danger mt-2">Enter a positive CFT with at most three decimal places.</p>}{actionError && <p className="text-danger mt-2" role="alert">{actionError}</p>}<button className="btn btn-dark mt-3" disabled={Boolean(busy) || enteredMilli !== stuffedMilli}>Update declaration amount</button></form></EudrDialog>}
    {galleryOpen && store && <AllDocumentsGallery chain={chain} documents={documents} store={store} onPreview={openPreview} onClose={() => setGalleryOpen(false)} />}
    {viewer && store && <FullDocumentViewer chain={chain} {...viewer} store={store} onClose={() => setViewer(null)} />}
  </div>;
}
