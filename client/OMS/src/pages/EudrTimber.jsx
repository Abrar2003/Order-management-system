import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";
import { normalizeUserRole } from "../auth/permissions";

const SUPPLIER_TYPES = [
  ["TIMBER_TRADER", "Timber Trader"],
  ["SAWMILL", "Sawmill"],
  ["DIRECT_PRODUCER", "Direct Producer"],
  ["OTHER", "Other"],
];
const DOCUMENT_TYPES = [
  ["TIMBER_PURCHASE_INVOICE", "Timber Purchase Invoice"],
  ["TRANSPORT_RECEIPT", "Transport Receipt / LR"],
  ["DELIVERY_CHALLAN", "Delivery Challan"],
  ["EWAY_BILL", "E-Way Bill"],
  ["TIMBER_ORIGIN_DOCUMENT", "Timber Origin Document"],
  ["OTHER_SUPPORTING_DOCUMENT", "Other Supporting Document"],
];
const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "NEEDS_INFORMATION", "APPROVED", "REJECTED"];

const blankSupplier = () => ({
  name: "", gstin: "", contact_person: "", mobile_number: "", email: "", address: "", city: "", state: "", country: "India", supplier_type: "TIMBER_TRADER", remarks: "", is_active: true,
});

const blankPurchase = () => ({
  manufacturer_vendor_id: "", timber_supplier_id: "", invoice_number: "", invoice_date: "", financial_year: "", species: "", purchased_cft: "", initial_received_cft: "", delivery_entries: [],
  transport_details: { transporter_name: "", transporter_contact_number: "", vehicle_number: "", transport_date: "", delivery_challan_number: "", e_way_bill_number: "", delivery_remarks: "" },
  purchase_remarks: "",
  origin_information: { harvesting_country: "", scientific_species_name: "", origin_document_reference: "", remarks: "" },
  document_check: { invoice_quantity_cft: "", invoice_supplier_name: "", invoice_gstin: "", invoice_quantity_confirmed: false },
});

const asDateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-GB") : "—";
const errorMessage = (error) => error?.response?.data?.message || error?.message || "Something went wrong.";
const statusClass = (status) => ({ APPROVED: "text-bg-success", REJECTED: "text-bg-danger", SUBMITTED: "text-bg-primary", NEEDS_INFORMATION: "text-bg-warning" }[status] || "text-bg-secondary");

const EudrTimber = ({ initialTab = "purchases" }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, loading: permissionsLoading, role } = usePermissions();
  const [tab, setTab] = useState(initialTab);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierRows, setSupplierRows] = useState([]);
  const [supplierActiveFilter, setSupplierActiveFilter] = useState("true");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [manufacturers, setManufacturers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [purchasePagination, setPurchasePagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filters, setFilters] = useState({ search: "", status: "", manufacturer_vendor_id: "", timber_supplier_id: "", duplicates: false });
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [editingPurchaseId, setEditingPurchaseId] = useState("");
  const [purchaseForm, setPurchaseForm] = useState(blankPurchase);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState(blankSupplier);
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierHistory, setSupplierHistory] = useState(null);
  const [quickSupplier, setQuickSupplier] = useState(false);
  const [files, setFiles] = useState([]);
  const [fileCategory, setFileCategory] = useState("TIMBER_PURCHASE_INVOICE");
  const [replaceDocumentId, setReplaceDocumentId] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [invoiceQuantityConfirmed, setInvoiceQuantityConfirmed] = useState(false);
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);

  const canAccessEudrTimber = ["admin", "super_admin", "manager"].includes(normalizeUserRole(role));
  const canView = canAccessEudrTimber && hasPermission("eudr_timber", "view");
  const canCreate = hasPermission("eudr_timber", "create");
  const canEdit = hasPermission("eudr_timber", "edit");
  const canUpload = hasPermission("eudr_timber", "upload");
  const canReview = hasPermission("eudr_timber", "approve");
  const canManageSuppliers = hasPermission("eudr_timber", "manage");

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, location.pathname]);

  const showMessage = useCallback((type, message) => setAlert({ type, message }), []);

  const loadReferenceData = useCallback(async () => {
    const [supplierResponse, manufacturerResponse] = await Promise.all([
      api.get("/eudr/timber-suppliers", { params: { limit: 100, active: "true" } }),
      api.get("/eudr/manufacturers"),
    ]);
    setSuppliers(supplierResponse.data?.data || []);
    setManufacturers(manufacturerResponse.data?.data || []);
  }, []);

  const loadPurchases = useCallback(async (page = 1) => {
    const response = await api.get("/eudr/timber-purchases", {
      params: { ...filters, duplicates: filters.duplicates || undefined, page, limit: 25 },
    });
    setPurchases(response.data?.data || []);
    setPurchasePagination(response.data?.pagination || { page: 1, totalPages: 1, total: 0 });
  }, [filters]);

  const loadSupplierList = useCallback(async () => {
    const response = await api.get("/eudr/timber-suppliers", {
      params: { limit: 100, active: supplierActiveFilter || undefined, search: supplierSearch || undefined },
    });
    setSupplierRows(response.data?.data || []);
  }, [supplierActiveFilter, supplierSearch]);

  useEffect(() => {
    if (!canView) return;
    loadReferenceData().catch((error) => showMessage("danger", errorMessage(error)));
  }, [canView, loadReferenceData, showMessage]);

  useEffect(() => {
    if (!canView || tab !== "purchases") return;
    loadPurchases().catch((error) => showMessage("danger", errorMessage(error)));
  }, [canView, loadPurchases, showMessage, tab]);

  useEffect(() => {
    if (!canView || tab !== "suppliers") return;
    loadSupplierList().catch((error) => showMessage("danger", errorMessage(error)));
  }, [canView, loadSupplierList, showMessage, tab]);

  const selectedDocument = useMemo(
    () => selectedPurchase?.documents?.find((document) => document._id === selectedDocumentId)
      || selectedPurchase?.documents?.find((document) => document.category === "TIMBER_PURCHASE_INVOICE" && !document.replaced_at)
      || selectedPurchase?.documents?.[0]
      || null,
    [selectedDocumentId, selectedPurchase],
  );

  const openPurchase = useCallback(async (id) => {
    try {
      const response = await api.get(`/eudr/timber-purchases/${id}`);
      const purchase = response.data?.data;
      setSelectedPurchase(purchase);
      setSelectedDocumentId(purchase?.documents?.find((document) => document.category === "TIMBER_PURCHASE_INVOICE" && !document.replaced_at)?._id || "");
      setReviewerNotes(purchase?.reviewer_notes || "");
      setInvoiceQuantityConfirmed(Boolean(purchase?.document_check?.invoice_quantity_confirmed));
    } catch (error) {
      showMessage("danger", errorMessage(error));
    }
  }, [showMessage]);

  const switchTab = (nextTab) => {
    setTab(nextTab);
    navigate(nextTab === "suppliers" ? "/eudr/timber-suppliers" : nextTab === "inventory" ? "/eudr/timber-inventory" : "/eudr/timber-purchases");
    setSelectedPurchase(null);
    setSupplierHistory(null);
  };

  const startPurchase = (purchase = null) => {
    if (purchase) {
      setEditingPurchaseId(purchase._id);
      setPurchaseForm({
        manufacturer_vendor_id: purchase.manufacturer_vendor_id || "",
        timber_supplier_id: purchase.timber_supplier_id || "",
        invoice_number: purchase.invoice_number || "",
        invoice_date: asDateInput(purchase.invoice_date),
        financial_year: purchase.financial_year || "",
        species: purchase.species || "",
        purchased_cft: purchase.purchased_cft || "",
        initial_received_cft: "",
        delivery_entries: (purchase.delivery_entries || []).map((entry) => ({ ...entry, delivery_date: asDateInput(entry.delivery_date), received_cft: entry.received_cft || "" })),
        transport_details: { ...blankPurchase().transport_details, ...(purchase.transport_details || {}), transport_date: asDateInput(purchase.transport_details?.transport_date) },
        purchase_remarks: purchase.purchase_remarks || "",
        origin_information: { ...blankPurchase().origin_information, ...(purchase.origin_information || {}) },
        document_check: { ...blankPurchase().document_check, ...(purchase.document_check || {}) },
      });
    } else {
      setEditingPurchaseId("");
      setPurchaseForm(blankPurchase());
    }
    setFiles([]);
    setReplaceDocumentId("");
    setQuickSupplier(false);
    setShowPurchaseForm(true);
  };

  const uploadSelectedFiles = async (purchaseId) => {
    if (files.length === 0) return;
    const payload = new FormData();
    payload.append("category", fileCategory);
    if (replaceDocumentId) payload.append("replace_document_id", replaceDocumentId);
    files.forEach((file) => payload.append("files", file));
    setUploadProgress(0);
    await api.post(`/eudr/timber-purchases/${purchaseId}/documents`, payload, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (event) => {
        if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
  };

  const savePurchase = async (submit = false) => {
    setBusy(true);
    try {
      const request = editingPurchaseId
        ? api.patch(`/eudr/timber-purchases/${editingPurchaseId}`, purchaseForm)
        : api.post("/eudr/timber-purchases", purchaseForm);
      const response = await request;
      const id = response.data?.data?._id;
      await uploadSelectedFiles(id);
      if (submit) await api.post(`/eudr/timber-purchases/${id}/submit`);
      await loadPurchases();
      await openPurchase(id);
      setShowPurchaseForm(false);
      setFiles([]);
      showMessage("success", submit ? "Timber purchase submitted for review." : "Timber purchase draft saved.");
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
      setUploadProgress(0);
    }
  };

  const saveQuickSupplier = async () => {
    try {
      const response = await api.post("/eudr/timber-suppliers", supplierForm);
      const supplier = response.data?.data;
      await loadReferenceData();
      await loadSupplierList();
      setPurchaseForm((current) => ({ ...current, timber_supplier_id: supplier?._id || "" }));
      setSupplierForm(blankSupplier());
      setQuickSupplier(false);
      showMessage("success", "Timber supplier added.");
    } catch (error) {
      showMessage("danger", errorMessage(error));
    }
  };

  const saveSupplier = async () => {
    setBusy(true);
    try {
      const response = editingSupplierId
        ? await api.patch(`/eudr/timber-suppliers/${editingSupplierId}`, supplierForm)
        : await api.post("/eudr/timber-suppliers", supplierForm);
      await loadReferenceData();
      await loadSupplierList();
      setShowSupplierForm(false);
      setEditingSupplierId("");
      setSupplierForm(blankSupplier());
      const warnings = response.data?.warnings || [];
      showMessage(warnings.length ? "warning" : "success", warnings.length ? `Supplier saved. Similar active names: ${warnings.map((warning) => warning.supplier_name).join(", ")}.` : "Timber supplier saved.");
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openSupplierHistory = async (id) => {
    try {
      const response = await api.get(`/eudr/timber-suppliers/${id}`);
      setSupplierHistory(response.data?.data || null);
    } catch (error) {
      showMessage("danger", errorMessage(error));
    }
  };

  const runReviewAction = async (action) => {
    if (!selectedPurchase) return;
    setBusy(true);
    try {
      const body = action === "approve"
        ? { reviewer_notes: reviewerNotes, invoice_quantity_confirmed: invoiceQuantityConfirmed }
        : { reviewer_notes: reviewerNotes };
      await api.post(`/eudr/timber-purchases/${selectedPurchase._id}/${action}`, body);
      await openPurchase(selectedPurchase._id);
      await loadPurchases(purchasePagination.page);
      showMessage("success", `Purchase ${action === "request-info" ? "moved to Needs Information" : `${action}d`}.`);
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const submitExisting = async () => {
    if (!selectedPurchase) return;
    setBusy(true);
    try {
      await api.post(`/eudr/timber-purchases/${selectedPurchase._id}/submit`);
      await openPurchase(selectedPurchase._id);
      await loadPurchases(purchasePagination.page);
      showMessage("success", "Purchase submitted for review.");
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const reopenSelected = async () => {
    if (!selectedPurchase) return;
    const reason = window.prompt("Reason for reopening this locked purchase:");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await api.post(`/eudr/timber-purchases/${selectedPurchase._id}/reopen`, { reason });
      await openPurchase(selectedPurchase._id);
      await loadPurchases(purchasePagination.page);
      showMessage("success", "Purchase reopened as Needs Information.");
    } catch (error) {
      showMessage("danger", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!permissionsLoading && !canView) return <Navigate to="/" replace />;

  const updatePurchaseField = (field, value) => setPurchaseForm((current) => ({ ...current, [field]: value }));
  const updateNestedPurchaseField = (section, field, value) => setPurchaseForm((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));

  return (
    <>
      <Navbar />
      <main className="page-shell py-4">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
          <div>
            <h1 className="h3 mb-1">EUDR Timber Management</h1>
            <p className="text-secondary mb-0">Purchase-document verification only. No timber inventory movement is created in Phase 1.</p>
          </div>
          <div className="btn-group" role="group" aria-label="EUDR Timber pages">
            <button type="button" className={`btn ${tab === "purchases" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => switchTab("purchases")}>Timber Purchases</button>
            <button type="button" className={`btn ${tab === "suppliers" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => switchTab("suppliers")}>Timber Suppliers</button>
            <button type="button" className="btn btn-outline-primary" onClick={() => switchTab("inventory")}>Timber Inventory</button>
          </div>
        </div>

        {alert && <div className={`alert alert-${alert.type} alert-dismissible`} role="alert">{alert.message}<button type="button" className="btn-close" aria-label="Close" onClick={() => setAlert(null)} /></div>}

        {tab === "purchases" && <>
          <div className="card om-card mb-3"><div className="card-body">
            <div className="d-flex flex-wrap align-items-end gap-2">
              <div><label className="form-label small mb-1">Search</label><input className="form-control" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Purchase, invoice, supplier" /></div>
              <div><label className="form-label small mb-1">Status</label><select className="form-select" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></div>
              <div><label className="form-label small mb-1">Manufacturer</label><select className="form-select" value={filters.manufacturer_vendor_id} onChange={(event) => setFilters((current) => ({ ...current, manufacturer_vendor_id: event.target.value }))}><option value="">All</option>{manufacturers.map((manufacturer) => <option key={manufacturer._id} value={manufacturer._id}>{manufacturer.name}</option>)}</select></div>
              <div><label className="form-label small mb-1">Timber supplier</label><select className="form-select" value={filters.timber_supplier_id} onChange={(event) => setFilters((current) => ({ ...current, timber_supplier_id: event.target.value }))}><option value="">All</option>{suppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.name}</option>)}</select></div>
              <div className="form-check mb-2"><input id="eudr-duplicates" className="form-check-input" type="checkbox" checked={filters.duplicates} onChange={(event) => setFilters((current) => ({ ...current, duplicates: event.target.checked }))} /><label className="form-check-label" htmlFor="eudr-duplicates">Warnings only</label></div>
              <button type="button" className="btn btn-outline-secondary" onClick={() => loadPurchases().catch((error) => showMessage("danger", errorMessage(error)))}>Apply</button>
              {canCreate && <button type="button" className="btn btn-primary ms-auto" onClick={() => startPurchase()}>New Timber Purchase</button>}
            </div>
          </div></div>

          {showPurchaseForm && <section className="card om-card mb-4"><div className="card-header d-flex justify-content-between align-items-center"><strong>{editingPurchaseId ? "Edit Timber Purchase" : "New Timber Purchase"}</strong><button type="button" className="btn-close" aria-label="Close" onClick={() => setShowPurchaseForm(false)} /></div><div className="card-body">
            <div className="row g-3">
              <div className="col-md-6"><label className="form-label">Furniture Manufacturer</label><select className="form-select" value={purchaseForm.manufacturer_vendor_id} onChange={(event) => updatePurchaseField("manufacturer_vendor_id", event.target.value)}><option value="">Select manufacturer</option>{manufacturers.map((manufacturer) => <option key={manufacturer._id} value={manufacturer._id}>{manufacturer.name}</option>)}</select></div>
              <div className="col-md-6"><label className="form-label">Timber Supplier</label><div className="input-group"><select className="form-select" value={purchaseForm.timber_supplier_id} onChange={(event) => updatePurchaseField("timber_supplier_id", event.target.value)}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.name}</option>)}</select>{canManageSuppliers && <button type="button" className="btn btn-outline-secondary" onClick={() => { setQuickSupplier((current) => !current); setSupplierForm(blankSupplier()); }}>Quick add</button>}</div></div>
              {quickSupplier && <div className="col-12 border rounded p-3 bg-body-tertiary"><div className="row g-2 align-items-end"><div className="col-md-4"><label className="form-label">Supplier Name</label><input className="form-control" value={supplierForm.name} onChange={(event) => setSupplierForm((current) => ({ ...current, name: event.target.value }))} /></div><div className="col-md-3"><label className="form-label">GSTIN</label><input className="form-control" value={supplierForm.gstin} onChange={(event) => setSupplierForm((current) => ({ ...current, gstin: event.target.value }))} /></div><div className="col-md-3"><label className="form-label">Mobile</label><input className="form-control" value={supplierForm.mobile_number} onChange={(event) => setSupplierForm((current) => ({ ...current, mobile_number: event.target.value }))} /></div><div className="col-md-2"><button type="button" className="btn btn-outline-primary w-100" onClick={saveQuickSupplier}>Save supplier</button></div></div></div>}
              <div className="col-md-4"><label className="form-label">Invoice Number</label><input className="form-control" value={purchaseForm.invoice_number} onChange={(event) => updatePurchaseField("invoice_number", event.target.value)} /></div>
              <div className="col-md-4"><label className="form-label">Invoice Date</label><input type="date" className="form-control" value={purchaseForm.invoice_date} onChange={(event) => updatePurchaseField("invoice_date", event.target.value)} /></div>
              <div className="col-md-4"><label className="form-label">Financial Year</label><input className="form-control" value={purchaseForm.financial_year} onChange={(event) => updatePurchaseField("financial_year", event.target.value)} placeholder="2026-27" /></div>
              <div className="col-md-4"><label className="form-label">Timber / Wood Species</label><input className="form-control" value={purchaseForm.species} onChange={(event) => updatePurchaseField("species", event.target.value)} /></div>
              <div className="col-md-4"><label className="form-label">Purchased CFT</label><input type="number" min="0" step="0.001" className="form-control" value={purchaseForm.purchased_cft} onChange={(event) => updatePurchaseField("purchased_cft", event.target.value)} /></div>
              <div className="col-md-4"><label className="form-label">Initial Received CFT</label><input type="number" min="0" step="0.001" className="form-control" value={purchaseForm.initial_received_cft} onChange={(event) => updatePurchaseField("initial_received_cft", event.target.value)} disabled={purchaseForm.delivery_entries.length > 0} /><div className="form-text">Use delivery rows when there is more than one receipt.</div></div>
              <div className="col-12"><div className="d-flex justify-content-between align-items-center mb-2"><strong className="small">Subsequent receipts / deliveries</strong><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => updatePurchaseField("delivery_entries", [...purchaseForm.delivery_entries, { received_cft: "", delivery_date: "", vehicle_number: "", delivery_challan_number: "", e_way_bill_number: "", remarks: "" }])}>Add delivery</button></div>{purchaseForm.delivery_entries.map((entry, index) => <div className="row g-2 mb-2" key={entry._id || index}><div className="col-md-3"><input type="number" min="0" step="0.001" className="form-control" placeholder="Received CFT" value={entry.received_cft} onChange={(event) => updatePurchaseField("delivery_entries", purchaseForm.delivery_entries.map((item, itemIndex) => itemIndex === index ? { ...item, received_cft: event.target.value } : item))} /></div><div className="col-md-3"><input type="date" className="form-control" value={entry.delivery_date || ""} onChange={(event) => updatePurchaseField("delivery_entries", purchaseForm.delivery_entries.map((item, itemIndex) => itemIndex === index ? { ...item, delivery_date: event.target.value } : item))} /></div><div className="col-md-2"><input className="form-control" placeholder="Vehicle" value={entry.vehicle_number || ""} onChange={(event) => updatePurchaseField("delivery_entries", purchaseForm.delivery_entries.map((item, itemIndex) => itemIndex === index ? { ...item, vehicle_number: event.target.value } : item))} /></div><div className="col-md-3"><input className="form-control" placeholder="Challan / E-Way Bill" value={entry.delivery_challan_number || ""} onChange={(event) => updatePurchaseField("delivery_entries", purchaseForm.delivery_entries.map((item, itemIndex) => itemIndex === index ? { ...item, delivery_challan_number: event.target.value } : item))} /></div><div className="col-md-1"><button type="button" className="btn btn-outline-danger w-100" aria-label="Remove delivery" onClick={() => updatePurchaseField("delivery_entries", purchaseForm.delivery_entries.filter((_item, itemIndex) => itemIndex !== index))}>×</button></div></div>)}</div>
              <div className="col-12"><strong className="small">Transport details</strong></div>
              {[['transporter_name', 'Transporter Name'], ['transporter_contact_number', 'Transporter Contact'], ['vehicle_number', 'Vehicle Number'], ['delivery_challan_number', 'Delivery Challan'], ['e_way_bill_number', 'E-Way Bill']].map(([field, label]) => <div className="col-md-4" key={field}><label className="form-label">{label}</label><input className="form-control" value={purchaseForm.transport_details[field] || ""} onChange={(event) => updateNestedPurchaseField("transport_details", field, event.target.value)} /></div>)}
              <div className="col-md-4"><label className="form-label">Transport Date</label><input type="date" className="form-control" value={purchaseForm.transport_details.transport_date || ""} onChange={(event) => updateNestedPurchaseField("transport_details", "transport_date", event.target.value)} /></div>
              <div className="col-12"><label className="form-label">Purchase Remarks</label><textarea className="form-control" rows="2" value={purchaseForm.purchase_remarks} onChange={(event) => updatePurchaseField("purchase_remarks", event.target.value)} /></div>
              <div className="col-12"><strong className="small">Optional EUDR origin information</strong></div>
              {[['harvesting_country', 'Harvesting Country'], ['scientific_species_name', 'Wood Scientific Species Name'], ['origin_document_reference', 'Origin Document Reference']].map(([field, label]) => <div className="col-md-4" key={field}><label className="form-label">{label}</label><input className="form-control" value={purchaseForm.origin_information[field] || ""} onChange={(event) => updateNestedPurchaseField("origin_information", field, event.target.value)} /></div>)}
              <div className="col-12"><label className="form-label">Origin Remarks</label><textarea className="form-control" rows="2" value={purchaseForm.origin_information.remarks || ""} onChange={(event) => updateNestedPurchaseField("origin_information", "remarks", event.target.value)} /></div>
              <div className="col-12"><strong className="small">Manual document check (optional before review)</strong></div>
              {[['invoice_quantity_cft', 'Quantity on Invoice (CFT)'], ['invoice_supplier_name', 'Supplier Name on Invoice'], ['invoice_gstin', 'GSTIN on Invoice']].map(([field, label]) => <div className="col-md-4" key={field}><label className="form-label">{label}</label><input type={field === 'invoice_quantity_cft' ? 'number' : 'text'} step={field === 'invoice_quantity_cft' ? '0.001' : undefined} className="form-control" value={purchaseForm.document_check[field] || ""} onChange={(event) => updateNestedPurchaseField("document_check", field, event.target.value)} /></div>)}
              {canUpload && <div className="col-12 border-top pt-3"><div className="row g-2 align-items-end"><div className="col-md-3"><label className="form-label">Document Type</label><select className="form-select" value={fileCategory} onChange={(event) => setFileCategory(event.target.value)}>{DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="col-md-5"><label className="form-label">Documents</label><input className="form-control" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /></div>{editingPurchaseId && selectedPurchase?.documents?.length > 0 && <div className="col-md-3"><label className="form-label">Replace existing version</label><select className="form-select" value={replaceDocumentId} onChange={(event) => setReplaceDocumentId(event.target.value)}><option value="">Add documents</option>{selectedPurchase.documents.filter((document) => !document.replaced_at).map((document) => <option key={document._id} value={document._id}>{document.original_name}</option>)}</select></div>}<div className="col-md-1"><span className="small text-secondary">{files.length ? `${files.length} file(s)` : ""}</span></div></div>{uploadProgress > 0 && <div className="progress mt-2" aria-label="Upload progress"><div className="progress-bar" style={{ width: `${uploadProgress}%` }}>{uploadProgress}%</div></div>}</div>}
            </div>
            <div className="d-flex flex-wrap justify-content-end gap-2 mt-4"><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={() => setShowPurchaseForm(false)}>Cancel</button><button type="button" className="btn btn-outline-primary" disabled={busy} onClick={() => savePurchase(false)}>Save Draft</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => savePurchase(true)}>Save & Submit</button></div>
          </div></section>}

          <div className="card om-card"><div className="table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Purchase ID</th><th>Invoice</th><th>Manufacturer</th><th>Timber Supplier</th><th>Species</th><th>Purchased CFT</th><th>Received CFT</th><th>Status</th><th>Warnings</th><th>Submitted</th><th /></tr></thead><tbody>{purchases.length === 0 ? <tr><td colSpan="11" className="text-center py-4 text-secondary">No timber purchases found.</td></tr> : purchases.map((purchase) => <tr key={purchase._id}><td>{purchase.purchase_number}</td><td><div>{purchase.invoice_number || "—"}</div><small className="text-secondary">{formatDate(purchase.invoice_date)}</small></td><td>{purchase.manufacturer?.name || "—"}</td><td>{purchase.supplier?.name || "—"}</td><td>{purchase.species || "—"}</td><td>{purchase.purchased_cft}</td><td>{purchase.received_cft}</td><td><span className={`badge ${statusClass(purchase.verification_status)}`}>{purchase.verification_status.replaceAll("_", " ")}</span></td><td>{purchase.duplicate_warning ? <span className="text-warning-emphasis">Review</span> : "—"}</td><td>{formatDate(purchase.submitted_at)}</td><td><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openPurchase(purchase._id)}>Open</button></td></tr>)}</tbody></table></div><div className="card-footer d-flex justify-content-between align-items-center"><span className="small text-secondary">{purchasePagination.total} purchase(s)</span><div className="btn-group"><button type="button" className="btn btn-outline-secondary btn-sm" disabled={purchasePagination.page <= 1} onClick={() => loadPurchases(purchasePagination.page - 1)}>Previous</button><button type="button" className="btn btn-outline-secondary btn-sm" disabled={purchasePagination.page >= purchasePagination.totalPages} onClick={() => loadPurchases(purchasePagination.page + 1)}>Next</button></div></div></div>

          {selectedPurchase && <section className="card om-card mt-4"><div className="card-header d-flex justify-content-between align-items-center"><div><strong>{selectedPurchase.purchase_number}</strong><span className={`badge ms-2 ${statusClass(selectedPurchase.verification_status)}`}>{selectedPurchase.verification_status.replaceAll("_", " ")}</span></div><button type="button" className="btn-close" aria-label="Close details" onClick={() => setSelectedPurchase(null)} /></div><div className="card-body"><div className="row g-4"><div className="col-lg-6"><div className="border rounded p-2 bg-body-tertiary min-vh-50">{selectedDocument?.preview_url ? <iframe title={selectedDocument.original_name} src={selectedDocument.preview_url} className="w-100 border-0" style={{ minHeight: 480 }} /> : <div className="p-5 text-center text-secondary">Select a document to preview.</div>}</div><div className="list-group mt-2">{selectedPurchase.documents?.map((document) => <div className={`list-group-item d-flex justify-content-between align-items-center ${document._id === selectedDocument?._id ? "active" : ""}`} key={document._id}><button type="button" className="btn btn-link p-0 text-start text-decoration-none" onClick={() => setSelectedDocumentId(document._id)}>{document.original_name}{document.replaced_at && " (replaced version)"}</button><a className="btn btn-sm btn-outline-secondary" href={document.preview_url || `/api/eudr/documents/${document._id}/download`} target="_blank" rel="noreferrer">Open</a></div>)}</div></div><div className="col-lg-6"><dl className="row mb-3"><dt className="col-sm-4">Manufacturer</dt><dd className="col-sm-8">{selectedPurchase.manufacturer?.name}</dd><dt className="col-sm-4">Supplier</dt><dd className="col-sm-8">{selectedPurchase.supplier?.name}</dd><dt className="col-sm-4">Invoice</dt><dd className="col-sm-8">{selectedPurchase.invoice_number} · {selectedPurchase.financial_year}</dd><dt className="col-sm-4">CFT</dt><dd className="col-sm-8">{selectedPurchase.purchased_cft} purchased / {selectedPurchase.received_cft} received</dd></dl><h2 className="h6">Validation results</h2><div className="list-group mb-3">{selectedPurchase.validation_flags?.length ? selectedPurchase.validation_flags.map((flag) => <div key={flag._id} className="list-group-item"><div className="d-flex justify-content-between gap-2"><strong>{flag.severity}</strong><small>{flag.code}</small></div><div>{flag.message}</div>{flag.matched_purchase_ids?.length > 0 && <div className="mt-2 d-flex flex-wrap gap-1">{flag.matched_purchase_ids.map((id) => <button type="button" key={id} className="btn btn-sm btn-outline-secondary" onClick={() => openPurchase(id)}>Open matched purchase</button>)}</div>}</div>) : <div className="list-group-item text-success">No current validation warnings.</div>}</div>{selectedPurchase.verification_status === "SUBMITTED" && canReview && <div className="border rounded p-3"><label className="form-label">Reviewer Notes</label><textarea className="form-control mb-2" rows="3" value={reviewerNotes} onChange={(event) => setReviewerNotes(event.target.value)} placeholder="Required for rejection or information request" /><div className="form-check mb-3"><input id="invoice-quantity-confirmed" className="form-check-input" type="checkbox" checked={invoiceQuantityConfirmed} onChange={(event) => setInvoiceQuantityConfirmed(event.target.checked)} /><label className="form-check-label" htmlFor="invoice-quantity-confirmed">I manually checked the original invoice quantity.</label></div><div className="d-flex flex-wrap gap-2"><button type="button" className="btn btn-success" disabled={busy} onClick={() => runReviewAction("approve")}>Approve</button><button type="button" className="btn btn-outline-warning" disabled={busy} onClick={() => runReviewAction("request-info")}>Request Information</button><button type="button" className="btn btn-outline-danger" disabled={busy} onClick={() => runReviewAction("reject")}>Reject</button></div></div>}<div className="d-flex flex-wrap gap-2 mt-3">{["DRAFT", "NEEDS_INFORMATION"].includes(selectedPurchase.verification_status) && canEdit && <><button type="button" className="btn btn-outline-primary" onClick={() => startPurchase(selectedPurchase)}>Edit</button><button type="button" className="btn btn-primary" disabled={busy} onClick={submitExisting}>Submit</button></>}{["APPROVED", "REJECTED"].includes(selectedPurchase.verification_status) && canManageSuppliers && <button type="button" className="btn btn-outline-warning" disabled={busy} onClick={reopenSelected}>Reopen with audit reason</button>}</div><h2 className="h6 mt-4">History</h2><ul className="list-group">{selectedPurchase.audit_history?.map((entry) => <li className="list-group-item" key={entry._id}><strong>{entry.action.replaceAll("_", " ")}</strong><span className="text-secondary"> · {entry.actor?.name || "Unknown"} · {formatDate(entry.timestamp)}</span>{entry.details?.reviewer_notes && <div>{entry.details.reviewer_notes}</div>}</li>)}</ul></div></div></div></section>}
        </>}

        {tab === "suppliers" && <>
          <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><div className="d-flex flex-wrap align-items-center gap-2"><input className="form-control" value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} placeholder="Search supplier" aria-label="Search timber suppliers" /><label className="small mb-0" htmlFor="supplier-status-filter">Status</label><select id="supplier-status-filter" className="form-select" value={supplierActiveFilter} onChange={(event) => setSupplierActiveFilter(event.target.value)}><option value="">All</option><option value="true">Active</option><option value="false">Inactive</option></select></div>{canManageSuppliers && <button type="button" className="btn btn-primary" onClick={() => { setSupplierForm(blankSupplier()); setEditingSupplierId(""); setShowSupplierForm(true); }}>Add Timber Supplier</button>}</div>
          {showSupplierForm && <section className="card om-card mb-4"><div className="card-header d-flex justify-content-between"><strong>{editingSupplierId ? "Edit Timber Supplier" : "Add Timber Supplier"}</strong><button type="button" className="btn-close" aria-label="Close" onClick={() => setShowSupplierForm(false)} /></div><div className="card-body"><div className="row g-3">{[['name', 'Supplier Name'], ['gstin', 'GSTIN'], ['contact_person', 'Contact Person'], ['mobile_number', 'Mobile Number'], ['email', 'Email'], ['city', 'City'], ['state', 'State'], ['country', 'Country']].map(([field, label]) => <div className="col-md-4" key={field}><label className="form-label">{label}{field === 'name' && ' *'}</label><input type={field === 'email' ? 'email' : 'text'} className="form-control" value={supplierForm[field] || ""} onChange={(event) => setSupplierForm((current) => ({ ...current, [field]: event.target.value }))} /></div>)}<div className="col-md-4"><label className="form-label">Supplier Type</label><select className="form-select" value={supplierForm.supplier_type} onChange={(event) => setSupplierForm((current) => ({ ...current, supplier_type: event.target.value }))}>{SUPPLIER_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="col-12"><label className="form-label">Address</label><textarea className="form-control" rows="2" value={supplierForm.address} onChange={(event) => setSupplierForm((current) => ({ ...current, address: event.target.value }))} /></div><div className="col-12"><label className="form-label">Remarks</label><textarea className="form-control" rows="2" value={supplierForm.remarks} onChange={(event) => setSupplierForm((current) => ({ ...current, remarks: event.target.value }))} /></div><div className="col-12 form-check ms-2"><input id="supplier-active" className="form-check-input" type="checkbox" checked={supplierForm.is_active} onChange={(event) => setSupplierForm((current) => ({ ...current, is_active: event.target.checked }))} /><label className="form-check-label" htmlFor="supplier-active">Supplier is active</label></div></div><div className="d-flex justify-content-end gap-2 mt-4"><button type="button" className="btn btn-outline-secondary" onClick={() => setShowSupplierForm(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={saveSupplier}>Save Supplier</button></div></div></section>}
          <div className="card om-card"><div className="table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Name</th><th>GSTIN</th><th>Contact</th><th>Location</th><th>Type</th><th>Status</th><th /></tr></thead><tbody>{supplierRows.length === 0 ? <tr><td colSpan="7" className="text-center py-4 text-secondary">No timber suppliers found.</td></tr> : supplierRows.map((supplier) => <tr key={supplier._id}><td>{supplier.name}</td><td>{supplier.gstin || "—"}</td><td>{supplier.contact_person || "—"}<br /><small className="text-secondary">{supplier.mobile_number || supplier.email || ""}</small></td><td>{[supplier.city, supplier.state, supplier.country].filter(Boolean).join(", ")}</td><td>{SUPPLIER_TYPES.find(([value]) => value === supplier.supplier_type)?.[1] || supplier.supplier_type}</td><td>{supplier.is_active ? "Active" : "Inactive"}</td><td className="text-end"><div className="btn-group"><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openSupplierHistory(supplier._id)}>History</button>{canManageSuppliers && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setEditingSupplierId(supplier._id); setSupplierForm({ ...supplier }); setShowSupplierForm(true); }}>Edit</button>}</div></td></tr>)}</tbody></table></div></div>
          {supplierHistory && <section className="card om-card mt-4"><div className="card-header d-flex justify-content-between"><strong>{supplierHistory.name} purchase history</strong><button type="button" className="btn-close" aria-label="Close" onClick={() => setSupplierHistory(null)} /></div><div className="card-body">{supplierHistory.purchases?.length ? <div className="list-group">{supplierHistory.purchases.map((purchase) => <button type="button" key={purchase._id} className="list-group-item list-group-item-action" onClick={() => { switchTab("purchases"); openPurchase(purchase._id); }}><strong>{purchase.purchase_number}</strong> · {purchase.invoice_number || "No invoice"} · {purchase.manufacturer?.name || "—"} · {purchase.purchased_cft} CFT</button>)}</div> : <p className="text-secondary mb-0">No accessible purchases for this supplier.</p>}</div></section>}
        </>}
      </main>
    </>
  );
};

export default EudrTimber;
