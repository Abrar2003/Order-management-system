import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import { isManagerLikeRole } from "../auth/permissions";

const emptyTemplate = {
  name: "Drop Test",
  version: "1",
  description: "ISTA 3B six-drop carton and furniture protection test.",
  instructions: `After the six drops:
PASS
- Carton remains structurally intact.
- No opening of carton seams.
- No product exposure.
- No major crushing affecting protection.
- Furniture has no structural damage.
- No broken/loose component.
- No finish damage that would make the product unacceptable to a customer.
- Product remains properly protected inside the carton.
FAIL
- Carton opens or tears through.
- Product contacts/exposes through carton.
- Furniture is broken, bent or structurally compromised.
- Important hardware/components become loose or damaged.
- Surface/finish damage caused by inadequate packaging.
- Internal protection has collapsed sufficiently to allow product movement/damage.`,
  is_active: true,
  guide: null,
};

const Tests = () => {
  const [tests, setTests] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyTemplate);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isManager = isManagerLikeRole(getUserFromToken()?.role);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get("/tests?include_inactive=true");
      setTests(response.data?.data || []);
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to load test templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openForm = (test = null) => {
    setEditing(test || {});
    setForm(test ? { ...emptyTemplate, ...test, guide: null } : emptyTemplate);
  };
  const closeForm = () => { setEditing(null); setForm(emptyTemplate); };

  const save = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      const body = new FormData();
      ["name", "version", "description", "instructions"].forEach((key) => body.append(key, form[key] || ""));
      body.append("is_active", String(Boolean(form.is_active)));
      if (form.guide) body.append("testing_guide", form.guide);
      if (editing?._id) await api.patch(`/tests/${editing._id}`, body);
      else await api.post("/tests", body);
      closeForm();
      await load();
    } catch (error) {
      alert(error?.response?.data?.message || "Failed to save test template.");
    } finally {
      setSaving(false);
    }
  };

  if (!isManager) return <><Navbar /><main className="container py-4"><div className="alert alert-danger">Test templates are available to managers only.</div></main></>;

  return <>
    <Navbar />
    <main className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3"><div><h2 className="mb-0">Tests</h2><p className="text-muted mb-0">Manage the Drop Test template used by QC inspections.</p></div><button className="btn btn-primary" onClick={() => openForm()}>Create Drop Test</button></div>
      {loading ? <div className="text-secondary">Loading…</div> : <div className="table-responsive"><table className="table align-middle"><thead><tr><th>Name</th><th>Version</th><th>Status</th><th>Guide</th><th /></tr></thead><tbody>{tests.map((test) => <tr key={test._id}><td>{test.name}<div className="small text-muted">{test.description}</div></td><td>{test.version}</td><td><span className={`badge text-bg-${test.is_active ? "success" : "secondary"}`}>{test.is_active ? "Active" : "Inactive"}</span></td><td>{test.testing_guide?.url ? <a href={test.testing_guide.url} target="_blank" rel="noreferrer">View guide</a> : "—"}</td><td className="text-end"><button className="btn btn-sm btn-outline-primary" onClick={() => openForm(test)}>Edit</button></td></tr>)}</tbody></table></div>}
    </main>
    {editing !== null && <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog"><div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"><form className="modal-content" onSubmit={save}><div className="modal-header"><h5 className="modal-title">{editing?._id ? "Edit Drop Test" : "Create Drop Test"}</h5><button className="btn-close" type="button" onClick={closeForm} disabled={saving} /></div><div className="modal-body"><div className="row g-3"><div className="col-md-8"><label className="form-label">Name</label><input required className="form-control" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="col-md-4"><label className="form-label">Version</label><input required className="form-control" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} /></div><div className="col-12"><label className="form-label">Description</label><input className="form-control" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div><div className="col-12"><label className="form-label">PASS / FAIL instructions</label><textarea className="form-control" rows="10" value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></div><div className="col-md-8"><label className="form-label">Guide image</label><input className="form-control" type="file" accept="image/*" onChange={(event) => setForm({ ...form, guide: event.target.files?.[0] || null })} /></div><div className="col-md-4 d-flex align-items-end"><label className="form-check mb-2"><input className="form-check-input" type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /><span className="form-check-label">Active</span></label></div></div></div><div className="modal-footer"><button className="btn btn-outline-secondary" type="button" onClick={closeForm} disabled={saving}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button></div></form></div></div>}
  </>;
};

export default Tests;
