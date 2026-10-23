import { useEffect, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";

export default function WoodSpecies() {
  const [rows, setRows] = useState([]), [query, setQuery] = useState(""), [form, setForm] = useState({ name: "", scientific_name: "", active: true }), [error, setError] = useState(""), [saving, setSaving] = useState(false), [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => api.get("/wood-species", { params: { query, includeInactive: true, limit: 100 } }).then(r => { if (live) { setRows(r.data.data); setError(""); } }).catch(() => { if (live) setError("Species could not be loaded."); }), 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query, version]);
  async function save(event) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const body = { name: form.name, scientific_name: form.scientific_name, active: form.active };
      if (form._id) await api.patch(`/wood-species/${form._id}`, body); else await api.post("/wood-species", body);
      setForm({ name: "", scientific_name: "", active: true }); setVersion(v => v + 1);
    } catch (e) { setError(e.response?.data?.message || "Species could not be saved."); }
    finally { setSaving(false); }
  }
  return <><Navbar /><main className="page-shell py-4"><h1 className="h3">Wood species</h1><p>Product identities shared by OMS items. Referenced species can be deactivated and remain in product history.</p>
    {error && <div role="alert" className="alert alert-danger">{error}</div>}
    <form onSubmit={save} className="card om-card p-3 mb-4"><h2 className="h5">{form._id ? "Edit species" : "Add species"}</h2><div className="row g-3">
      <div className="col-md-4"><label htmlFor="wood-common" className="form-label">Common name</label><input id="wood-common" className="form-control" required maxLength="160" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div className="col-md-4"><label htmlFor="wood-scientific" className="form-label">Scientific name</label><input id="wood-scientific" className="form-control" required maxLength="160" value={form.scientific_name} onChange={e => setForm({ ...form, scientific_name: e.target.value })} /></div>
      <div className="col-md-4 d-flex align-items-end gap-2"><label className="form-check"><input className="form-check-input" type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Active</label><button className="btn btn-primary" disabled={saving}>Save species</button>{form._id && <button type="button" className="btn btn-outline-secondary" onClick={() => setForm({ name: "", scientific_name: "", active: true })}>Cancel</button>}</div>
    </div></form>
    <label htmlFor="wood-query" className="form-label">Search common or scientific name</label><input id="wood-query" className="form-control mb-3" type="search" maxLength="80" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="table-responsive"><table className="table"><thead><tr><th>Common name</th><th>Scientific name</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(row => <tr key={row._id}><td>{row.name}</td><td>{row.scientific_name}</td><td>{row.active ? "Active" : "Inactive"}</td><td><button className="btn btn-sm btn-outline-primary" onClick={() => setForm(row)}>Edit</button></td></tr>)}</tbody></table></div>
  </main></>;
}
