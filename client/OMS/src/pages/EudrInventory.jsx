import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import { normalizeUserRole } from "../auth/permissions";

const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-GB") : "—";
const errorMessage = (error) => error?.response?.data?.message || error?.message || "Something went wrong.";
const statusClass = (status) => ({ CONFIRMED: "text-bg-success", DRAFT: "text-bg-secondary", REVERSED: "text-bg-warning" }[status] || "text-bg-secondary");

const EudrInventory = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission, loading: permissionsLoading, role } = usePermissions();
  const canAccess = ["admin", "super_admin", "manager"].includes(normalizeUserRole(role));
  const canView = canAccess && hasPermission("eudr_timber", "view");
  const canCreate = canAccess && hasPermission("eudr_timber", "create");
  const canConfirm = canAccess && hasPermission("eudr_timber", "approve");
  const canManage = canAccess && hasPermission("eudr_timber", "manage");
  const canExport = canAccess && hasPermission("eudr_timber", "export");

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("");
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [selectedManufacturer, setSelectedManufacturer] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsTab, setDetailsTab] = useState("purchases");
  const [candidateSearch, setCandidateSearch] = useState(searchParams.get("container") || "");
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [consumptionForm, setConsumptionForm] = useState({ reported_cft: "", remarks: "" });
  const [busy, setBusy] = useState(false);

  const showMessage = useCallback((type, message) => setAlert({ type, message }), []);

  const loadInventory = useCallback(async () => {
    if (!canView) return;
    try {
      setLoading(true);
      const response = await api.get("/eudr/inventory", { params: { search, availability } });
      setRows(response.data?.data || []);
      setSummary(response.data?.summary || {});
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [availability, canView, search, showMessage]);

  const openManufacturer = useCallback(async (manufacturer) => {
    try {
      setSelectedManufacturer(manufacturer);
      setDetails(null);
      const response = await api.get(`/eudr/inventory/${manufacturer.manufacturer_vendor_id}`);
      setDetails(response.data?.data || null);
      setDetailsTab("purchases");
    } catch (error) {
      showMessage("danger", errorMessage(error));
    }
  }, [showMessage]);

  const loadCandidates = useCallback(async () => {
    try {
      const response = await api.get("/eudr/container-candidates", { params: { container: candidateSearch } });
      setCandidates(response.data?.data || []);
      setSelectedCandidate(null);
    } catch (error) {
      showMessage("danger", errorMessage(error));
    }
  }, [candidateSearch, showMessage]);

  useEffect(() => { loadInventory(); }, [loadInventory]);
  useEffect(() => { if (canView && candidateSearch) loadCandidates(); }, [canView, candidateSearch, loadCandidates]);

  const createConsumptionDraft = async (event) => {
    event.preventDefault();
    if (!selectedCandidate) return;
    try {
      setBusy(true);
      const response = await api.post("/eudr/consumptions", {
        oms_shipment_ref_keys: selectedCandidate.shipment_refs.map((reference) => reference.ref_key),
        reported_cft: consumptionForm.reported_cft,
        remarks: consumptionForm.remarks,
      });
      showMessage("success", `Draft saved for ${response.data?.data?.container_number || "the selected container"}.`);
      setConsumptionForm({ reported_cft: "", remarks: "" });
      await Promise.all([loadInventory(), selectedManufacturer ? openManufacturer(selectedManufacturer) : Promise.resolve(), loadCandidates()]);
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmConsumption = async (consumption) => {
    try {
      setBusy(true);
      await api.post(`/eudr/consumptions/${consumption._id}/confirm`);
      showMessage("success", "Timber consumption confirmed and deducted once from the accounting balance.");
      await Promise.all([loadInventory(), openManufacturer(selectedManufacturer)]);
    } catch (error) {
      const details = error?.response?.data?.details;
      const shortfall = details ? ` Available: ${details.available_cft} CFT; requested: ${details.requested_cft} CFT; shortfall: ${details.shortfall_cft} CFT.` : "";
      showMessage("danger", `${errorMessage(error)}${shortfall}`);
    } finally {
      setBusy(false);
    }
  };

  const reverseConsumption = async (consumption) => {
    const reason = window.prompt(`Reason for reversing ${consumption.container_number}:`);
    if (!reason?.trim()) return;
    try {
      setBusy(true);
      await api.post(`/eudr/consumptions/${consumption._id}/reverse`, { reason });
      showMessage("success", "Consumption reversed and a compensating ledger credit was posted.");
      await Promise.all([loadInventory(), openManufacturer(selectedManufacturer)]);
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const runBackfill = async () => {
    if (!window.confirm("Post credits for all currently approved Phase 1 receipts that are not already in the ledger?")) return;
    try {
      setBusy(true);
      const response = await api.post("/eudr/inventory/reconciliation/backfill", { confirm: true });
      showMessage("success", `${response.data?.posted_count || 0} historical receipt credit(s) posted.`);
      await loadInventory();
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const exportSummary = async () => {
    try {
      const response = await api.get("/eudr/inventory/export", { params: { search, availability }, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "timber-inventory-summary.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showMessage("danger", errorMessage(error));
    }
  };

  const selectedCandidateLabel = useMemo(
    () => selectedCandidate ? `${selectedCandidate.container_number} · ${selectedCandidate.manufacturer?.name}` : "",
    [selectedCandidate],
  );

  if (!permissionsLoading && !canView) return <Navigate to="/" replace />;

  return (
    <>
      <Navbar />
      <main className="page-shell py-4">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
          <div>
            <h1 className="h3 mb-1">Timber Inventory</h1>
          <p className="text-secondary mb-0">Manufacturer-level accounting only. A positive balance is not proof of physical source attribution or EUDR compliance.</p>
          </div>
          <div className="d-flex gap-2">
            {canManage && <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={runBackfill}>Backfill Approved Receipts</button>}
            {canExport && <button type="button" className="btn btn-outline-primary" onClick={exportSummary}>Export CSV</button>}
            <button type="button" className="btn btn-primary" disabled={loading} onClick={loadInventory}>Refresh</button>
          </div>
        </div>

        {alert && <div className={`alert alert-${alert.type} alert-dismissible`} role="alert">{alert.message}<button type="button" className="btn-close" aria-label="Close" onClick={() => setAlert(null)} /></div>}

        <div className="row g-3 mb-4">
          {[
            ["Total Approved Received", summary.total_approved_received_cft],
            ["Total Confirmed Consumed", summary.total_confirmed_consumed_cft],
            ["Remaining Unallocated", summary.remaining_unallocated_cft],
            ["Pending Purchase Verification", summary.pending_purchase_verification_count],
          ].map(([label, value]) => <div className="col-sm-6 col-xl-3" key={label}><div className="card om-card h-100"><div className="card-body"><div className="small text-secondary">{label}</div><div className="h3 mb-0">{value ?? 0}{label.includes("CFT") || !label.includes("Verification") ? (label.includes("Verification") ? "" : " CFT") : ""}</div></div></div></div>)}
        </div>

        <div className="card om-card mb-4"><div className="card-body"><div className="row g-2 align-items-end"><div className="col-md-5"><label className="form-label">Manufacturer</label><input className="form-control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search manufacturer" /></div><div className="col-md-3"><label className="form-label">Balance availability</label><select className="form-select" value={availability} onChange={(event) => setAvailability(event.target.value)}><option value="">All balances</option><option value="positive">Positive balance</option><option value="zero">Zero balance</option></select></div><div className="col-md-2"><button type="button" className="btn btn-outline-secondary w-100" onClick={loadInventory}>Apply</button></div></div></div></div>

        <div className="card om-card mb-4"><div className="table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Manufacturer</th><th>Approved Received CFT</th><th>Consumed CFT</th><th>Adjustment CFT</th><th>Available CFT</th><th>Last Purchase</th><th>Last Consumption</th><th /></tr></thead><tbody>{loading ? <tr><td colSpan="8" className="text-center py-4">Loading inventory…</td></tr> : rows.length === 0 ? <tr><td colSpan="8" className="text-center py-4 text-secondary">No manufacturer inventory found.</td></tr> : rows.map((row) => <tr key={row.manufacturer_vendor_id}><td>{row.manufacturer?.name || "—"}</td><td>{row.approved_received_cft}</td><td>{row.consumed_cft}</td><td>{row.net_adjustment_cft}</td><td className={row.available_units > 0 ? "text-success fw-semibold" : ""}>{row.available_cft}</td><td>{formatDate(row.last_purchase_date)}</td><td>{formatDate(row.last_consumption_date)}</td><td><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openManufacturer(row)}>Open</button></td></tr>)}</tbody></table></div></div>

        {canCreate && <section className="card om-card mb-4"><div className="card-header"><strong>Record Timber Usage from OMS Container</strong></div><div className="card-body"><div className="row g-2 align-items-end mb-3"><div className="col-md-7"><label className="form-label">Container number</label><input className="form-control" value={candidateSearch} onChange={(event) => { setCandidateSearch(event.target.value); setSearchParams(event.target.value ? { container: event.target.value } : {}); }} placeholder="Search an existing OMS container" /></div><div className="col-md-2"><button type="button" className="btn btn-outline-primary w-100" onClick={loadCandidates}>Find shipments</button></div></div>{candidates.length > 0 && <div className="list-group mb-3">{candidates.map((candidate) => { const key = `${candidate.manufacturer_vendor_id}:${candidate.container_number}:${candidate.stuffing_date || ""}`; return <label className="list-group-item" key={key}><input className="form-check-input me-2" type="radio" name="timber-container-candidate" checked={selectedCandidate === candidate} onChange={() => setSelectedCandidate(candidate)} /> <strong>{candidate.container_number}</strong> · {candidate.manufacturer?.name} · {formatDate(candidate.stuffing_date)} <span className="text-secondary">({candidate.shipment_refs.length} OMS shipment row(s))</span>{candidate.ambiguous_container && <span className="text-warning-emphasis ms-2">Confirm this stuffing-date group</span>}</label>; })}</div>}{selectedCandidate && <form className="border rounded p-3" onSubmit={createConsumptionDraft}><div className="mb-3"><strong>{selectedCandidateLabel}</strong><div className="small text-secondary">Associated orders/items: {selectedCandidate.shipment_refs.map((reference) => `${reference.order_number || "Order"} · ${reference.item_code || "Item"}`).join(", ")}</div></div><div className="row g-3"><div className="col-md-4"><label className="form-label">Reported Timber Consumption (CFT)</label><input className="form-control" required inputMode="decimal" pattern="\d+(\.\d{1,3})?" value={consumptionForm.reported_cft} onChange={(event) => setConsumptionForm((current) => ({ ...current, reported_cft: event.target.value }))} placeholder="30" /></div><div className="col-md-8"><label className="form-label">Remarks (optional)</label><input className="form-control" value={consumptionForm.remarks} onChange={(event) => setConsumptionForm((current) => ({ ...current, remarks: event.target.value }))} /></div><div className="col-12"><button type="submit" className="btn btn-primary" disabled={busy}>Save Draft</button></div></div></form>}{candidateSearch && candidates.length === 0 && <div className="text-secondary">No eligible OMS shipment rows found for this container.</div>}</div></section>}

        {selectedManufacturer && <section className="card om-card"><div className="card-header d-flex justify-content-between align-items-center"><strong>{selectedManufacturer.manufacturer?.name || "Manufacturer"} Inventory Details</strong><button type="button" className="btn-close" aria-label="Close details" onClick={() => { setSelectedManufacturer(null); setDetails(null); }} /></div>{!details ? <div className="card-body">Loading details…</div> : <div className="card-body"><div className="row g-3 mb-3"><div className="col-md-4"><strong>{details.balance?.approved_received_cft} CFT</strong><div className="small text-secondary">Approved received</div></div><div className="col-md-4"><strong>{details.balance?.consumed_cft} CFT</strong><div className="small text-secondary">Confirmed consumed</div></div><div className="col-md-4"><strong>{details.balance?.available_cft} CFT</strong><div className="small text-secondary">Remaining unallocated</div></div></div><div className="btn-group mb-3" role="group" aria-label="Inventory detail sections">{[["purchases", "Purchases / Receipts"], ["consumptions", "Container Consumption"], ["ledger", "Transaction History"]].map(([key, label]) => <button key={key} type="button" className={`btn ${detailsTab === key ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setDetailsTab(key)}>{label}</button>)}</div>{detailsTab === "purchases" && <><p className="small text-secondary">Potential Source Purchases — Not Confirmed Physical Attribution</p><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Purchase</th><th>Invoice</th><th>Supplier</th><th>Invoiced</th><th>Approved Received</th><th>Status</th></tr></thead><tbody>{details.purchases.length === 0 ? <tr><td colSpan="6" className="text-center text-secondary">No purchases.</td></tr> : details.purchases.map((purchase) => <tr key={purchase._id}><td>{purchase.purchase_number}</td><td>{purchase.invoice_number || "—"}</td><td>{purchase.supplier?.name || "—"}</td><td>{purchase.invoiced_cft}</td><td>{purchase.approved_received_cft}</td><td>{purchase.verification_status}</td></tr>)}</tbody></table></div></>}{detailsTab === "consumptions" && <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Container</th><th>Stuffing Date</th><th>Reported</th><th>Confirmed</th><th>Accounting</th><th>EUDR Evidence</th><th>Status</th><th>Recorded By</th><th /></tr></thead><tbody>{details.consumptions.length === 0 ? <tr><td colSpan="9" className="text-center text-secondary">No container consumption records.</td></tr> : details.consumptions.map((consumption) => <tr key={consumption._id}><td>{consumption.container_number}{consumption.reconciliation_required && <div className="small text-warning-emphasis">Shipment changed: reconciliation needed</div>}</td><td>{formatDate(consumption.stuffing_date)}</td><td>{consumption.reported_cft}</td><td>{consumption.confirmed_cft}</td><td>{consumption.inventory_accounting_status}</td><td>{consumption.eudr_evidence_status}</td><td><span className={`badge ${statusClass(consumption.status)}`}>{consumption.status}</span></td><td>{consumption.reported_by?.name || "—"}</td><td className="text-end">{consumption.status === "DRAFT" && canConfirm && <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={() => confirmConsumption(consumption)}>Confirm</button>}{consumption.status === "CONFIRMED" && canManage && <button type="button" className="btn btn-outline-warning btn-sm" disabled={busy} onClick={() => reverseConsumption(consumption)}>Reverse</button>}</td></tr>)}</tbody></table></div>}{detailsTab === "ledger" && <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Date</th><th>Type</th><th>Credit</th><th>Debit</th><th>Balance After</th><th>User</th><th>Remarks</th></tr></thead><tbody>{details.ledger.length === 0 ? <tr><td colSpan="7" className="text-center text-secondary">No ledger entries.</td></tr> : details.ledger.map((entry) => <tr key={entry._id}><td>{formatDate(entry.created_at)}</td><td>{entry.transaction_type}</td><td>{entry.credit_cft}</td><td>{entry.debit_cft}</td><td>{entry.balance_after_cft}</td><td>{entry.created_by?.name || "—"}</td><td>{entry.remarks || "—"}</td></tr>)}</tbody></table></div>}</div>}</section>}
      </main>
    </>
  );
};

export default EudrInventory;
