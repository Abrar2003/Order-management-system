import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api/axios";
import Navbar from "./Navbar";
import { usePermissions } from "../auth/PermissionContext";
import { getUserFromToken } from "../auth/auth.service";
import { useRememberSearchParams } from "../hooks/useRememberSearchParams";
import { exportElementToPdf } from "../services/pdfExport.service";
import { STAGE_LABELS, NEXT_STAGE_LABELS, BOX_MODES, masterForm, blankSize, formFromInspection, changeBoxMode } from "../utils/masterWorkflow";
import "./MasterWorkflowPage.css";

const PAGES = {
  "pis-diffs": { title: "PIS Diffs", description: "Review an approved inspection to create Master 1. Existing masters remain available until this review is saved." },
  "final-pis-check": { title: "Final PIS Check", description: "Review three additional approved POs after Master 1 to create Master 2." },
  "final-masters": { title: "Final Master", description: "Review three more approved POs after Master 2, then compare the Final Master against Product Database." },
  "master-vs-pd": { title: "Master vs PD", description: "Review sizes, correct differences or accept them with a reason, then finalize and permanently lock Final Master." },
};
const display = (value) => value === null || value === undefined || value === "" ? "Not set" : String(value);
const date = (value) => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";
const errorMessage = (error) => error?.response?.data?.message || error.message || "Request failed.";
const fieldLabel = (field) => ({ L: "L (cm)", B: "B (cm)", H: "H (cm)", net_weight: "Net weight (kg)", gross_weight: "Gross weight (kg)", item_count_in_inner: "Pieces / inner", box_count_in_master: "Boxes or pieces / master" }[field] || field);

function Measurements({ source, title }) {
  const groups = [{ key: "item", label: "Item", weight: "net_weight" }, { key: "box", label: "Box", weight: "gross_weight" }];
  return <section className="mw-source">
    <h4 className="h6">{title}</h4>
    <div className="small text-secondary mb-2">{BOX_MODES[source.box_mode] || "Packaging not set"}</div>
    <table className="table table-sm mb-0"><caption className="visually-hidden">{title} measurements</caption>
      <thead><tr><th>Part</th><th>L × B × H (cm)</th><th>Weight (kg)</th><th>Counts</th></tr></thead>
      <tbody>{groups.map(({ key, label, weight }) => {
        const entries = source[`${key}_sizes`] || [];
        return entries.length ? entries.map((entry, index) => <tr key={`${key}-${index}`}>
          <td>{label} · {entry.remark || index + 1}</td><td>{[entry.L, entry.B, entry.H].map(display).join(" × ")}</td>
          <td>{display(entry[weight])}</td><td>{Number(entry.item_count_in_inner) > 0 && `Inner: ${entry.item_count_in_inner} `}{Number(entry.box_count_in_master) > 0 && `Master: ${entry.box_count_in_master}`}</td>
        </tr>) : <tr key={key}><td>{label}</td><td colSpan={3} className="text-secondary">Measurements not set</td></tr>;
      })}</tbody>
    </table>
    {source.master_barcode !== undefined && <div className="small mt-2">Master barcode: {display(source.master_barcode)} · Inner barcode: {display(source.inner_barcode)}</div>}
    {source.country_of_origin !== undefined && <div className="small mt-1">Origin: {display(source.country_of_origin)}</div>}
    {source.cbm !== undefined && <div className="small mt-1">Master CBM (m³ per item): {display(source.cbm)}</div>}
  </section>;
}
const itemSource = (item, prefix) => ({
  item_sizes: item[`${prefix}_item_sizes`], box_sizes: item[`${prefix}_box_sizes`], box_mode: item[`${prefix}_box_mode`],
  master_barcode: item[`${prefix}_master_barcode`] || item[`${prefix}_barcode`], inner_barcode: item[`${prefix}_inner_barcode`],
  country_of_origin: prefix === "master" ? item.master_country_of_origin : prefix === "pis" ? item.country_of_origin : undefined,
  cbm: prefix === "master" ? item.cbm?.calculated_master_total ?? item.calculated_master_total : undefined,
});

function SizeEditor({ group, form, setForm }) {
  const path = `master_${group}_sizes`;
  const entries = form[path];
  const limit = group === "item" ? 5 : 4;
  const fixedBoxes = group === "box" && form.master_box_mode !== "individual";
  const fields = ["L", "B", "H", group === "item" ? "net_weight" : "gross_weight"];
  const update = (index, field, value) => setForm((previous) => ({ ...previous, [path]: previous[path].map((entry, i) => i === index ? { ...entry, [field]: value } : entry) }));
  return <fieldset className="mw-editor-section">
    <legend className="h6">{group === "item" ? "Master item sizes" : "Master box sizes"}</legend>
    {entries.map((entry, index) => <div className="mw-size-inputs" key={`${group}-${index}`}>
      <label>Part / remark<input className="form-control form-control-sm" aria-label={`${group} ${index + 1} remark`} value={entry.remark || ""} disabled={fixedBoxes} list={`mw-${group}-remarks`} onChange={(event) => update(index, "remark", event.target.value)} /></label>
      {fields.map((field) => <label key={field}>{fieldLabel(field)}<input type="number" min="0" step="any" className="form-control form-control-sm" aria-label={`${group} ${index + 1} ${fieldLabel(field)}`} value={entry[field] ?? ""} onChange={(event) => update(index, field, event.target.value)} /></label>)}
      {group === "box" && entry.box_type === "inner" && <label>Pieces / inner<input type="number" min="0" step="any" className="form-control form-control-sm" value={entry.item_count_in_inner ?? ""} onChange={(event) => update(index, "item_count_in_inner", event.target.value)} /></label>}
      {group === "box" && entry.box_type === "master" && <label>Boxes or pieces / master<input type="number" min="0" step="any" className="form-control form-control-sm" value={entry.box_count_in_master ?? ""} onChange={(event) => update(index, "box_count_in_master", event.target.value)} /></label>}
      {!fixedBoxes && <button type="button" className="btn btn-outline-danger btn-sm" aria-label={`Remove ${group} row ${index + 1}`} onClick={() => setForm((previous) => ({ ...previous, [path]: previous[path].filter((_, i) => i !== index) }))}>Remove</button>}
    </div>)}
    <datalist id={`mw-${group}-remarks`}>{(group === "item" ? ["item", "top", "base", "base2", "pedestal", "stretcher", "item1", "item2", "item3"] : ["box", "top", "base", "box1", "box2", "box3"]).map((remark) => <option value={remark} key={remark} />)}</datalist>
    {!fixedBoxes && <button type="button" className="btn btn-outline-secondary btn-sm mt-2" disabled={entries.length >= limit} onClick={() => setForm((previous) => ({ ...previous, [path]: [...previous[path], blankSize(group)] }))}>Add {group} row</button>}
  </fieldset>;
}

function ReviewEditor({ row, onSave, busy }) {
  const [form, setForm] = useState(() => masterForm(row));
  const [confirmed, setConfirmed] = useState(false);
  const target = NEXT_STAGE_LABELS[row.master_workflow.stage];
  const save = (unchanged) => onSave(target ? "review" : "final-master", { values: unchanged ? masterForm(row) : form, evidence_token: row.evidence.token });
  return <form className="mw-editor" onSubmit={(event) => { event.preventDefault(); save(false); }}>
    <h4 className="h5">{target ? `Review and save ${target}` : "Correct Final Master"}</h4>
    <div className="d-flex gap-2 flex-wrap mb-3">
      {row.evidence.inspections.map((inspection) => <button type="button" key={inspection.inspection_id} className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => { setForm((previous) => formFromInspection(previous, inspection)); setConfirmed(false); }}>Use measurements from {inspection.po}</button>)}
    </div>
    <fieldset disabled={busy}>
      <div className="mw-size-inputs mb-3">
        <label>Packaging<select className="form-select form-select-sm" value={form.master_box_mode} onChange={(event) => { setForm(changeBoxMode(form, event.target.value)); setConfirmed(false); }}>{Object.entries(BOX_MODES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Master country of origin<input className="form-control form-control-sm" value={form.master_country_of_origin} onChange={(event) => setForm({ ...form, master_country_of_origin: event.target.value })} /></label>
        <label>Master barcode<input className="form-control form-control-sm" value={form.master_master_barcode} onChange={(event) => setForm({ ...form, master_master_barcode: event.target.value, master_barcode: event.target.value })} /></label>
        <label>Master inner barcode<input className="form-control form-control-sm" value={form.master_inner_barcode} onChange={(event) => setForm({ ...form, master_inner_barcode: event.target.value })} /></label>
      </div>
      <SizeEditor group="item" form={form} setForm={setForm} />
      <SizeEditor group="box" form={form} setForm={setForm} />
      <label className="d-flex align-items-start gap-2 mt-3"><input type="checkbox" className="form-check-input" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I have reviewed {target ? "the displayed PO evidence and master values" : "these corrections"}, including any missing measurements.</span></label>
      <div className="d-flex gap-2 mt-3"><button className="btn btn-primary" disabled={!confirmed}>{busy ? "Saving…" : target ? `Save ${target}` : "Save corrections"}</button>
        {target && <button type="button" className="btn btn-outline-primary" disabled={!confirmed} onClick={() => save(true)}>Confirm unchanged as {target}</button>}
      </div>
    </fieldset>
  </form>;
}

function PdReview({ row, onSave, busy, canOpenPd }) {
  const comparison = row.comparison;
  const [reasons, setReasons] = useState(() => comparison.reviewed ? comparison.review?.reasons || {} : {});
  const [confirmed, setConfirmed] = useState(false);
  const [lockConfirmed, setLockConfirmed] = useState(false);
  const issues = comparison.rows.filter((entry) => entry.status !== "match");
  const accepted = issues.every((entry) => String(reasons[entry.key] || "").trim());
  const locked = row.master_workflow.stage === "finalized";
  return <section className="mt-3">
    <div className="d-flex justify-content-between align-items-center gap-2"><h4 className="h5">Master vs Product Database</h4>{canOpenPd && <Link className="btn btn-outline-primary btn-sm" to={`/product-database?search=${encodeURIComponent(row.code)}`}>Open Product Database</Link>}</div>
    <p className="small text-secondary">Allowed variance: item dimensions 0.5 cm · box dimensions 1 cm · weights 10% of Final Master. Packaging and counts must match exactly.</p>
    <div className="table-responsive"><table className="table table-sm align-middle"><thead><tr><th>Part / field</th><th>Final Master</th><th>Product Database</th><th>Result</th><th>Acceptance reason</th></tr></thead><tbody>
      {comparison.rows.map((entry) => <tr key={entry.key} className={entry.status !== "match" ? "table-warning" : ""}>
        <th scope="row">{entry.group} {entry.part} · {fieldLabel(entry.field)}</th><td>{display(entry.master)}</td><td>{display(entry.other)}</td><td>{entry.status === "match" ? "Within tolerance" : entry.status === "missing" ? "Missing data" : "Difference"}</td>
        <td>{entry.status !== "match" && (row.actions.pd_review ? <textarea rows={2} maxLength={2000} className="form-control form-control-sm" aria-label={`Acceptance reason for ${entry.group} ${entry.part} ${entry.field}`} value={reasons[entry.key] || ""} disabled={busy} onChange={(event) => { setReasons({ ...reasons, [entry.key]: event.target.value }); setConfirmed(false); }} /> : display(comparison.review?.token === comparison.token ? comparison.review.reasons?.[entry.key] : null))}</td>
      </tr>)}
    </tbody></table></div>
    <div className={`alert ${comparison.reviewed ? "alert-success" : "alert-warning"}`}>
      {comparison.reviewed ? `Comparison signed off by ${comparison.review.reviewed_by.name} on ${date(comparison.review.reviewed_at)}.` : locked ? "Product Database has changed since finalization. Final Master remains locked; its original comparison is retained in history." : "This comparison requires sign-off. Changes to Final Master or PD invalidate an earlier sign-off."}
    </div>
    {row.actions.pd_review && <div className="mw-no-print">
      <label className="d-flex gap-2 align-items-start"><input type="checkbox" className="form-check-input" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>I have reviewed all comparison rows and accepted any remaining issues with the reasons entered.</span></label>
      <button className="btn btn-primary mt-2" disabled={busy || !confirmed || !accepted} onClick={() => onSave("pd-review", { comparison_token: comparison.token, reasons })}>Sign off comparison</button>
    </div>}
    {row.actions.finalize && <div className="mw-finalize mw-no-print">
      <label className="d-flex gap-2 align-items-start"><input type="checkbox" className="form-check-input" checked={lockConfirmed} disabled={busy} onChange={(event) => setLockConfirmed(event.target.checked)} /><span>I confirm Final Master is ready to become permanently read-only. This action cannot be undone.</span></label>
      <button className="btn btn-success mt-2" disabled={busy || !lockConfirmed} onClick={() => onSave("finalize", { comparison_token: comparison.token })}>Finalize PIS — lock Final Master</button>
    </div>}
  </section>;
}

function Comments({ row, onRefresh }) {
  const { role } = usePermissions();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const userId = String(getUserFromToken()?.id || "");
  const canCreate = ["manager", "product_manager", "inspection_manager"].includes(String(role).replace(/\s+/g, "_"));
  const comments = row.pis_update_comments || [];
  const submit = async (id, remove = false) => {
    setBusy(true); setError("");
    try {
      const url = `/items/final-pis-check/${encodeURIComponent(row.code)}/comments${id ? `/${id}` : ""}`;
      if (remove) await api.delete(url); else if (id) await api.put(url, { comment: draft }); else await api.post(url, { comment: draft });
      setDraft(""); setEditing(null); await onRefresh();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return <details className="mt-3"><summary>Comments ({comments.length})</summary>
    {error && <p className="text-danger" role="alert">{error}</p>}
    {comments.map((comment) => <div key={comment._id} className="border-bottom py-2"><div className="small text-secondary">{comment.created_by_name} · {date(comment.created_at)}</div><p className="mb-1">{comment.comment}</p>
      {userId === String(comment.created_by) && <div className="mw-no-print d-flex gap-2"><button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => { setEditing(comment._id); setDraft(comment.comment); }}>Edit</button><button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => submit(comment._id, true)}>Delete</button></div>}
    </div>)}
    {(canCreate || editing) && <form className="mt-2 mw-no-print" onSubmit={(event) => { event.preventDefault(); submit(editing); }}><label className="w-100">{editing ? "Edit comment" : "Add comment"}<textarea className="form-control" maxLength={1000} required value={draft} onChange={(event) => setDraft(event.target.value)} /></label><button className="btn btn-outline-primary btn-sm mt-2" disabled={busy || !draft.trim()}>Save comment</button>{editing && <button type="button" className="btn btn-link btn-sm" onClick={() => { setEditing(null); setDraft(""); }}>Cancel</button>}</form>}
  </details>;
}

function ItemReview({ row, view, onSave, onRefresh, busy, canOpenPd }) {
  const workflow = row.master_workflow;
  return <div className="mw-review">
    <div className="mw-sources">
      <Measurements source={itemSource(row, "pis")} title="Vendor PIS" />
      <Measurements source={itemSource(row, "master")} title={workflow.stage === "awaiting_master_1" ? "Existing master" : STAGE_LABELS[workflow.stage]} />
      {workflow.stage === "final_master" && workflow.reviews.find((entry) => entry.stage === "master_2") && <Measurements source={itemSource(workflow.reviews.find((entry) => entry.stage === "master_2").master, "master")} title="Master 2 at review" />}
      {row.evidence.inspections.map((inspection) => <div key={inspection.inspection_id}><Measurements source={inspection} title={`${inspection.po} · ${inspection.inspection_date}`} /><div className="small text-secondary mt-1">Approved inspection · Recorded {date(inspection.created_at)}</div></div>)}
    </div>
    {row.inspection_comparisons?.length > 0 && <details className="mt-3"><summary>Inspection differences against current master</summary>{row.inspection_comparisons.map((comparison, index) => {
      const issues = comparison.rows.filter((entry) => entry.status !== "match");
      return <div key={comparison.inspection_id} className="mt-2"><strong>{row.evidence.inspections[index].po}</strong>{issues.length ? <ul>{issues.map((entry) => <li key={entry.key}>{entry.group} {entry.part} {fieldLabel(entry.field)}: master {display(entry.master)}, inspected {display(entry.other)} ({entry.status})</li>)}</ul> : <p className="text-success">All measurements are within tolerance.</p>}</div>;
    })}</details>}
    {row.status === "waiting" && <div className="alert alert-info mt-3">{row.evidence.count} / {row.evidence.required} qualifying approved POs. Previously used POs and visits recorded before the last review cannot count.</div>}
    {(row.actions.review || row.actions.correct) && <div className="mw-no-print mt-3"><ReviewEditor key={`${row.id}-${workflow.revision}`} row={row} onSave={onSave} busy={busy} /></div>}
    {row.comparison && view === "master-vs-pd" && <PdReview key={`${row.id}-${workflow.revision}-${row.comparison.token}`} row={row} onSave={onSave} busy={busy} canOpenPd={canOpenPd} />}
    {row.comparison && view !== "master-vs-pd" && <Link className="btn btn-outline-primary mt-3 mw-no-print" to={`/master-vs-pd?search=${encodeURIComponent(row.code)}`}>Review Master vs PD</Link>}
    {workflow.stage === "finalized" && <p className="alert alert-success mt-3">Final Master locked by {workflow.finalized_by.name} on {date(workflow.finalized_at)}.</p>}
    <details className="mt-3"><summary>Review history ({workflow.events?.length || 0})</summary>
      {workflow.legacy_master && <Measurements source={itemSource(workflow.legacy_master, "master")} title="Legacy master preserved before this cycle" />}
      {(workflow.reviews || []).map((review) => <details key={review.stage} className="mt-2"><summary>{STAGE_LABELS[review.stage]} · {review.reviewed_by.name} · {date(review.reviewed_at)} · {review.evidence.map((entry) => entry.po).join(", ")}</summary><div className="mw-sources mt-2"><Measurements source={itemSource(review.master, "master")} title={`Saved ${STAGE_LABELS[review.stage]}`} />{review.evidence.map((inspection) => <Measurements key={inspection.inspection_id} source={inspection} title={`${inspection.po} · ${inspection.inspection_date}`} />)}</div></details>)}
      {(workflow.events || []).filter((event) => event.action !== "review").map((event) => <details key={event.revision} className="mt-2"><summary>{event.action} · {event.actor.name} · {date(event.at)}</summary><Measurements source={itemSource(event.master, "master")} title="Master at this action" />{event.pd_review && <><Measurements source={itemSource(event.pd_review.snapshots.pd, "pd")} title="PD at sign-off" /><ul>{Object.entries(event.pd_review.reasons || {}).map(([field, reason]) => <li key={field}>{field}: {reason}</li>)}</ul></>}</details>)}
    </details>
    <Comments row={row} onRefresh={onRefresh} />
  </div>;
}

export default function MasterWorkflowPage({ view }) {
  const pageInfo = PAGES[view];
  const { hasPermission } = usePermissions();
  const [params, setParams] = useSearchParams();
  useRememberSearchParams(params, setParams, view);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ totalPages: 1, totalRecords: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reportRows, setReportRows] = useState([]);
  const reportRef = useRef(null);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const query = params.toString();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const fetchRows = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true); setError("");
    try {
      const response = await api.get(`/items/${view}?${query}`);
      if (sequence !== request.current) return;
      setRows(response.data.data || []); setPagination(response.data.pagination);
    } catch (err) { if (sequence === request.current) { setError(errorMessage(err)); setRows([]); } }
    finally { if (sequence === request.current) setLoading(false); }
  }, [query, view]);
  useEffect(() => { fetchRows(); return () => { request.current += 1; }; }, [fetchRows]);
  const save = async (row, action, payload) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const method = action === "final-master" ? "patch" : "post";
      const response = await api[method](`/items/${row.id}/master-workflow/${action}`, { revision: row.master_workflow.revision, ...payload });
      setMessage(response.data.message); await fetchRows();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const exportReport = async () => {
    setExporting(true); setError("");
    try {
      const response = await api.get(`/items/${view}/export?${query}`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data); const link = document.createElement("a");
      link.href = url; link.download = `${view}.xlsx`; link.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(errorMessage(err)); } finally { setExporting(false); }
  };
  const exportPdf = async () => {
    setExporting(true); setError("");
    try {
      const response = await api.get(`/items/${view}/export-preview?${query}`);
      if (!response.data.data.rows.length) throw new Error("No items match these filters to export.");
      flushSync(() => setReportRows(response.data.data.rows));
      await exportElementToPdf({ element: reportRef.current, endpoint: "/items/pdf/render", reportKey: view, filename: `${view}.pdf`, repeatHeader: { title: pageInfo.title, subtitle: "Data sanity workflow · Cycle 3 October 2026" } });
    } catch (err) { setError(errorMessage(err)); }
    finally { setExporting(false); setReportRows([]); }
  };
  const setPage = (value) => { const next = new URLSearchParams(params); next.set("page", String(value)); setParams(next); };
  return <><Navbar /><main className="page-shell py-3 mw-page">
    <div className="d-flex justify-content-between align-items-start flex-wrap gap-3"><div><h1 className="h4">{pageInfo.title}</h1><p className="text-secondary mb-1">{pageInfo.description}</p><p className="small text-secondary">Cycle started 3 October 2026 · 1 + 3 + 3 distinct POs · Super Admin review</p></div>
      <div className="d-flex gap-2 mw-no-print"><button className="btn btn-outline-secondary btn-sm" onClick={fetchRows} disabled={busy || loading}>Refresh</button>{hasPermission("pis", "export") && <><button className="btn btn-outline-primary btn-sm" onClick={exportReport} disabled={exporting || loading}>{exporting ? "Exporting…" : "Export Excel"}</button><button className="btn btn-outline-secondary btn-sm" disabled={exporting || loading} onClick={exportPdf}>Export PDF</button></>}</div>
    </div>
    <nav aria-label="Master workflow pages" className="nav nav-pills gap-1 mb-3 mw-no-print">{Object.entries(PAGES).map(([route, info]) => <Link key={route} className={`nav-link ${route === view ? "active" : ""}`} to={`/${route}`}>{info.title}</Link>)}</nav>
    <form key={query} className="mw-filters mw-no-print card p-3 mb-3" onSubmit={(event) => { event.preventDefault(); const next = new URLSearchParams(new FormData(event.currentTarget)); next.set("page", "1"); setParams(next); }}>
      <label>Search<input name="search" className="form-control form-control-sm" placeholder="Item code, name or barcode" defaultValue={params.get("search") || ""} /></label>
      <label>Brand<input name="brand" className="form-control form-control-sm" defaultValue={params.get("brand") || ""} placeholder="All brands" /></label>
      <label>Vendor<input name="vendor" className="form-control form-control-sm" defaultValue={params.get("vendor") || ""} placeholder="All vendors" /></label>
      <label>Country<input name="country" className="form-control form-control-sm" defaultValue={params.get("country") || ""} placeholder="All countries" /></label>
      <label>Status<select name="status" className="form-select form-select-sm" defaultValue={params.get("status") || "all"}><option value="all">All</option><option value="waiting">Waiting for POs</option><option value="ready">Ready for review</option><option value="created">Final Master created</option><option value="finalized">Finalized</option></select></label>
      <label>Rows<select name="limit" className="form-select form-select-sm" defaultValue={params.get("limit") || "20"}>{[10, 20, 50, 100].map((value) => <option key={value}>{value}</option>)}</select></label>
      <button className="btn btn-primary btn-sm" disabled={busy}>Apply</button><button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setParams({})}>Clear</button>
    </form>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}{message && <div className="alert alert-success" role="status">{message}</div>}
    {loading ? <p role="status">Loading workflow…</p> : rows.length === 0 ? <div className="card p-4 text-secondary">No items in this stage match these filters.</div> : <div className="mw-items">{rows.map((row) => <article className="card mw-item" key={row.id}>
      <div className="mw-item-heading"><div><h2 className="h6 mb-1">{row.code} · {row.description || row.name}</h2><div className="small text-secondary">{row.brand_label} · {row.vendor_labels.join(", ")}</div></div>
        <div className="d-flex gap-2 align-items-center flex-wrap"><span className={`badge ${row.status === "finalized" ? "text-bg-success" : row.status === "ready" ? "text-bg-primary" : "text-bg-light"}`}>{STAGE_LABELS[row.master_workflow.stage]}</span>{row.evidence.required > 0 && <span className="small">{Math.min(row.evidence.count, row.evidence.required)} / {row.evidence.required} approved POs</span>}<button className="btn btn-outline-primary btn-sm mw-no-print" aria-expanded={expanded === row.id} disabled={busy} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Close" : row.status === "finalized" ? "View" : "Review"}</button></div>
      </div>
      {expanded === row.id && <ItemReview row={row} view={view} onSave={(action, payload) => save(row, action, payload)} onRefresh={fetchRows} busy={busy} canOpenPd={hasPermission("product_database", "view")} />}
    </article>)}</div>}
    <div className="d-flex justify-content-between align-items-center mt-3 mw-no-print"><span className="small text-secondary">{pagination.totalRecords} items · Page {page} of {pagination.totalPages}</span><div className="d-flex gap-2"><button className="btn btn-outline-secondary btn-sm" disabled={page <= 1 || busy || loading} onClick={() => setPage(page - 1)}>Previous</button><button className="btn btn-outline-secondary btn-sm" disabled={page >= pagination.totalPages || busy || loading} onClick={() => setPage(page + 1)}>Next</button></div></div>
    {reportRows.length > 0 && <div ref={reportRef} aria-hidden="true" className="mw-page" style={{ position: "fixed", left: "-10000px", top: 0, width: "1100px", background: "white" }}>
      {reportRows.map((row) => <section key={row.id} className="mb-4">
        <h2 className="h5">{row.code} · {row.description || row.name}</h2>
        <p>{row.brand_label} · {row.vendor_labels.join(", ")} · {STAGE_LABELS[row.master_workflow.stage]} · {row.status}</p>
        <div className="mw-sources"><Measurements source={itemSource(row, "pis")} title="Vendor PIS" /><Measurements source={itemSource(row, "master")} title="Current master" />{row.evidence.inspections.map((inspection) => <Measurements source={inspection} key={inspection.inspection_id} title={`${inspection.po} · ${inspection.inspection_date}`} />)}</div>
        {row.comparison && <><h3 className="h6 mt-3">Master vs PD</h3><Measurements source={itemSource(row, "pd")} title="Product Database" /><table className="table table-sm"><thead><tr><th>Field</th><th>Master</th><th>PD</th><th>Result</th><th>Acceptance reason</th></tr></thead><tbody>{row.comparison.rows.map((entry) => <tr key={entry.key}><td>{entry.group} {entry.part} {fieldLabel(entry.field)}</td><td>{display(entry.master)}</td><td>{display(entry.other)}</td><td>{entry.status}</td><td>{row.comparison.reviewed ? row.comparison.review?.reasons?.[entry.key] || "" : ""}</td></tr>)}</tbody></table></>}
        <ul>{row.master_workflow.reviews.map((review) => <li key={review.stage}>{STAGE_LABELS[review.stage]} · {review.evidence.map((entry) => entry.po).join(", ")} · {review.reviewed_by.name} · {date(review.reviewed_at)}</li>)}</ul>
        {row.master_workflow.finalized_at && <p>Finalized by {row.master_workflow.finalized_by.name} · {date(row.master_workflow.finalized_at)}</p>}
      </section>)}
    </div>}
  </main></>;
}
