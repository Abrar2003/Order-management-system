import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.service";
import { normalizeUserRole } from "../auth/permissions";
import EudrChainView from "../components/eudr/EudrChainView";
import { requestError, declaredMilliCft, cftMismatchText } from "../utils/eudrDocuments";

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
    catch (err) { setError(requestError(err)); }
  }, []);
  useEffect(() => { if (allowed) loadList(); }, [allowed, loadList]);
  if (!allowed) return <><Navbar /><div className="page-shell py-4">EUDR is restricted to admins and managers.</div></>;
  const search = async (value = container) => {
    try { setBusy(true); setError(""); const response = await api.get("/eudr/container", { params: { container: value.trim() } }); setLookup(response.data); setContainer(value.trim()); }
    catch (err) { setError(requestError(err)); setLookup(null); }
    finally { setBusy(false); }
  };
  const openChain = async (id) => {
    try { setBusy(true); setError(""); const response = await api.get(`/eudr/${id}`); setChain(response.data.data); setContainer(response.data.data.container); setDeclared(String(response.data.data.declared_milli_cft / 1000)); }
    catch (err) { setError(requestError(err)); }
    finally { setBusy(false); }
  };
  const create = async (vendorId) => {
    try { setBusy(true); setError(""); const response = await api.post("/eudr", { container, vendor_id: vendorId, declared_cft: declared }); setChain(response.data.data); await loadList(); await search(container); }
    catch (err) { setError(requestError(err)); }
    finally { setBusy(false); }
  };
  const enteredMilliCft = declaredMilliCft(declared);
  return <>
    <Navbar />
    <main className="page-shell py-3" style={{ maxWidth: "none", width: "96%" }}>
      {!chain && <div className="mb-3"><h1 className="h3 mb-1">EUDR Timber Management</h1><p className="text-muted mb-0">Verified timber chain by container and shipping vendor</p></div>}
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
      </> : <EudrChainView key={chain._id} chain={chain} onChange={(next) => { setChain(next); setError(""); }} onError={setError} onBack={() => { setChain(null); search(container); loadList(); }} />}
    </main>
  </>;
};

export default EudrTimber;
