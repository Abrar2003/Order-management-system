import { useEffect, useId, useState } from "react";
import api from "../api/axios";
import { CFT_TO_M3 } from "../utils/woodMetadata";

export default function ProductWoodFields({ value, onChange, disabled = false }) {
  const id = useId(), [query, setQuery] = useState(""), [species, setSpecies] = useState([]), [error, setError] = useState("");
  const selectedIds = value.parts.map(row => row.species).filter(Boolean).join(",");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const responses = await Promise.all([api.get("/wood-species", { params: { query, limit: 100 } }),
          ...(selectedIds ? [api.get("/wood-species", { params: { ids: selectedIds, includeInactive: true, limit: 100 } })] : [])]);
        if (live) { setSpecies([...new Map(responses.flatMap(r => r.data.data).map(row => [row._id, row])).values()]); setError(""); }
      } catch { if (live) setError("Wood species could not be loaded. Existing selections are preserved."); }
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query, selectedIds]);
  const patch = values => onChange({ ...value, ...values });
  const total = value.parts.reduce((sum, row) => sum + Math.round((Number(row.percent) || 0) * 100), 0);
  const noWood = String(value.value).trim() !== "" && Number(value.value) === 0 && !value.parts.length;
  const converted = Number(value.value) * (value.unit === "cft" ? CFT_TO_M3 : 1 / CFT_TO_M3);
  return <fieldset className="border rounded p-3" disabled={disabled}>
    <legend className="float-none w-auto fs-6">Wood composition and finished volume</legend>
    {error && <div className="alert alert-warning" role="alert">{error}</div>}
    <label className="form-check mb-3"><input type="checkbox" className="form-check-input" checked={noWood} onChange={e => patch({ value: e.target.checked ? "0" : "", parts: [] })} />No wood content</label>
    <div className="row g-2 mb-3">
      <div className="col-md-5"><label htmlFor={id + "volume"} className="form-label">Finished wood volume in one product (CFT / m³)</label><input id={id + "volume"} className="form-control" type="number" min="0" step={value.unit === "cft" ? "0.000001" : "0.000000000001"} value={value.value} onChange={e => patch({ value: e.target.value })} /></div>
      <div className="col-md-3"><label htmlFor={id + "unit"} className="form-label">Volume unit</label><select id={id + "unit"} className="form-select" value={value.unit} onChange={e => patch({ unit: e.target.value, value: String(value.value).trim() ? converted.toFixed(e.target.value === "cft" ? 6 : 12) : "" })}><option value="cft">CFT</option><option value="m3">m³</option></select></div>
      <div className="col-md-4"><label htmlFor={id + "hs"} className="form-label">HSN / HS code</label><input id={id + "hs"} className="form-control" value={value.hs_code} onChange={e => patch({ hs_code: e.target.value })} placeholder="9403 60" /></div>
    </div>
    <p className="small text-muted">{String(value.value).trim() && Number.isFinite(converted) ? `Equivalent: ${converted.toFixed(value.unit === "cft" ? 12 : 6)} ${value.unit === "cft" ? "m³" : "CFT"}. ` : ""}Finished wood only; manufacturing wastage is configured in EUDR. Blank volume means unknown.</p>
    <label htmlFor={id + "search"} className="form-label">Search wood type / species</label><input id={id + "search"} className="form-control mb-2" value={query} onChange={e => setQuery(e.target.value)} type="search" disabled={noWood || disabled} />
    {value.parts.map((row, index) => <div className="row g-2 mb-2 align-items-end" key={index}>
      <div className="col"><label htmlFor={id + "species" + index} className="form-label">Species</label><select id={id + "species" + index} className="form-select" value={row.species} onChange={e => patch({ parts: value.parts.map((part, i) => i === index ? { ...part, species: e.target.value } : part) })}><option value="">Select a species</option>{row.species && !species.some(s => s._id === row.species) && <option value={row.species}>Existing species {row.species}</option>}{species.filter(s => s.active || s._id === row.species).map(s => <option key={s._id} value={s._id}>{s.name} · {s.scientific_name}{s.active ? "" : " (inactive)"}</option>)}</select></div>
      <div className="col-3"><label htmlFor={id + "share" + index} className="form-label">Share %</label><input id={id + "share" + index} className="form-control" type="number" min="0.01" max="100" step="0.01" value={row.percent} onChange={e => patch({ parts: value.parts.map((part, i) => i === index ? { ...part, percent: e.target.value } : part) })} /></div>
      <div className="col-auto"><button className="btn btn-outline-secondary" type="button" onClick={() => patch({ parts: value.parts.filter((_, i) => i !== index) })}>Remove</button></div>
    </div>)}
    <button className="btn btn-outline-primary btn-sm" type="button" disabled={noWood || disabled || value.parts.length >= 100} onClick={() => patch({ parts: [...value.parts, { species: "", percent: value.parts.length ? "" : "100" }] })}>Add species</button>
    <span role="status" className={`ms-3 ${value.parts.length && total !== 10000 ? "text-danger" : "text-muted"}`}>{value.parts.length ? `Total: ${(total / 100).toFixed(2)}%${total !== 10000 ? " — must total 100%" : ""}` : noWood ? "No wood" : "Composition not recorded"}</span>
  </fieldset>;
}
