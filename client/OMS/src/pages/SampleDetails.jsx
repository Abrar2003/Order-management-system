import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import SampleCreateModal from "../components/samples/SampleCreateModal";
import { usePermissions } from "../auth/PermissionContext";
import { normalizeUserRole } from "../auth/permissions";
import {
  SAMPLE_STATUSES,
  SAMPLE_WORKFLOW_STEPS,
  addSampleTimeline,
  archiveSample,
  getSample,
  sampleStatusLabel,
  unarchiveSample,
  updateSampleStatus,
  updateSampleVendor,
  uploadSampleFiles,
} from "../services/samples.service";
import { formatDateDDMMYYYY } from "../utils/date";
import "../App.css";

const MUTATION_ROLES = new Set(["admin", "super_admin", "inspection_manager", "product_manager"]);
const MANUFACTURING_STATUSES = ["not_started", "manufacturing", "ready", "delayed", "cancelled"];
const INSPECTION_STATUSES = ["not_requested", "requested", "inspected", "failed", "cancelled"];
const FILE_TYPES = [
  { value: "initial_sketch", label: "Sketch" },
  { value: "cad", label: "CAD" },
  { value: "sample_image", label: "Sample Image" },
  { value: "inspection", label: "Inspection" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other" },
];

const blankAction = () => ({
  type: "",
  title: "",
  vendor: null,
  status: "",
  file_type: "other",
});

const text = (value, fallback = "-") => String(value || "").trim() || fallback;
const isImageFile = (file = {}) => String(file?.contentType || "").toLowerCase().startsWith("image/");
const toDateInputValue = (value) => (value ? String(value).slice(0, 10) : "");
const statusClass = (status = "") => {
  if (["completed", "shipped", "client_approved", "inspected"].includes(status)) return "text-bg-success";
  if (status === "cancelled") return "text-bg-danger";
  if (["on_hold", "client_revision_requested"].includes(status)) return "text-bg-warning";
  return "text-bg-primary";
};
const makeVendorShipmentRows = (vendors = []) =>
  (Array.isArray(vendors) ? vendors : []).map((vendor) => ({
    vendor_entry_id: String(vendor?._id || "").trim(),
    vendor_name: String(vendor?.vendor_name || "").trim(),
    container: String(vendor?.container || "").trim(),
    shipped_at: toDateInputValue(vendor?.shipped_at),
    invoice_number: String(vendor?.invoice_number || "").trim(),
    quantity: vendor?.quantity ? String(vendor.quantity) : "",
  }));

const FileList = ({ title, files = [] }) => (
  <section className="sample-detail-section">
    <h5>{title}</h5>
    {files.length === 0 ? (
      <div className="text-secondary small">No files uploaded.</div>
    ) : (
      <div className="sample-file-grid">
        {files.map((file, index) => (
          <a
            key={file._id || `${title}-${index}`}
            className="sample-file-card"
            href={file.link || "#"}
            target="_blank"
            rel="noreferrer"
          >
            {isImageFile(file) ? (
              <img src={file.link} alt={file.originalName || "Sample file"} />
            ) : (
              <span className="sample-file-icon">{String(file.originalName || "File").split(".").pop()?.toUpperCase() || "FILE"}</span>
            )}
            <span>{file.originalName || "File"}</span>
          </a>
        ))}
      </div>
    )}
  </section>
);

const SizeRows = ({ title, rows = [], weightLabel }) => (
  <section className="sample-detail-section">
    <h5>{title}</h5>
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0">
        <thead>
          <tr>
            <th>Remark</th>
            <th>L</th>
            <th>B</th>
            <th>H</th>
            <th>{weightLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan="5" className="text-secondary">Not Set</td></tr>
          ) : rows.map((row, index) => (
            <tr key={row._id || index}>
              <td>{sampleStatusLabel(row.remark || row.box_type || `row_${index + 1}`)}</td>
              <td>{row.L || "-"}</td>
              <td>{row.B || "-"}</td>
              <td>{row.H || "-"}</td>
              <td>{row.net_weight ?? row.gross_weight ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

const WorkflowStepper = ({ currentStatus }) => {
  const currentIndex = SAMPLE_WORKFLOW_STEPS.indexOf(currentStatus);
  return (
    <div className="sample-workflow-stepper">
      {SAMPLE_WORKFLOW_STEPS.map((status, index) => (
        <div
          key={status}
          className={`sample-workflow-step ${index <= currentIndex ? "is-complete" : ""} ${status === currentStatus ? "is-current" : ""}`}
        >
          <span>{index + 1}</span>
          <strong>{sampleStatusLabel(status)}</strong>
        </div>
      ))}
    </div>
  );
};

const ActionModal = ({ action, sample, onClose, onSubmit, saving }) => {
  const [modalError, setModalError] = useState("");
  const [form, setForm] = useState({
    current_status: action.status || "",
    comment: "",
    stage: action.status || "comment",
    file_type: action.file_type || "other",
    files: [],
    vendor_name: action.vendor?.vendor_name || "",
    contact_name: action.vendor?.contact_name || "",
    expected_manufacturing_date: action.vendor?.expected_manufacturing_date ? String(action.vendor.expected_manufacturing_date).slice(0, 10) : "",
    manufacturing_status: action.vendor?.manufacturing_status || "not_started",
    inspection_requested_at: action.vendor?.inspection_requested_at ? String(action.vendor.inspection_requested_at).slice(0, 10) : "",
    inspection_status: action.vendor?.inspection_status || "not_requested",
    inspected_at: action.vendor?.inspected_at ? String(action.vendor.inspected_at).slice(0, 10) : "",
    estimated_shipping_date: action.vendor?.estimated_shipping_date ? String(action.vendor.estimated_shipping_date).slice(0, 10) : "",
    shipped_at: action.vendor?.shipped_at ? String(action.vendor.shipped_at).slice(0, 10) : "",
    tracking: action.vendor?.tracking || "",
    container: action.vendor?.container || "",
    invoice_number: action.vendor?.invoice_number || "",
    quantity: action.vendor?.quantity ? String(action.vendor.quantity) : "",
    shipment_remarks: action.vendor?.shipment_remarks || "",
    vendor_shipments: makeVendorShipmentRows(sample?.vendor_entries),
  });
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setVendorShipmentField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      vendor_shipments: prev.vendor_shipments.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    }));
  };
  const validateVendorShipments = () => {
    if (!form.vendor_shipments.length) {
      return "Assign at least one vendor before marking this sample as shipped.";
    }

    for (let index = 0; index < form.vendor_shipments.length; index += 1) {
      const row = form.vendor_shipments[index] || {};
      const label = row.vendor_name || `Vendor ${index + 1}`;
      const quantity = Number(row.quantity);
      if (!String(row.container || "").trim()) return `${label}: container is required.`;
      if (!String(row.shipped_at || "").trim()) return `${label}: shipped date is required.`;
      if (!String(row.invoice_number || "").trim()) return `${label}: invoice number is required.`;
      if (!Number.isFinite(quantity) || quantity <= 0) return `${label}: quantity must be a positive number.`;
    }

    return "";
  };
  const handleSubmit = (event) => {
    event.preventDefault();
    setModalError("");
    const nextForm = { ...form };

    if (action.type === "status" && form.current_status === "shipped") {
      const validationError = validateVendorShipments();
      if (validationError) {
        setModalError(validationError);
        return;
      }

      nextForm.vendor_shipments = form.vendor_shipments.map((row) => ({
        vendor_entry_id: row.vendor_entry_id,
        container: String(row.container || "").trim(),
        shipped_at: row.shipped_at,
        invoice_number: String(row.invoice_number || "").trim(),
        quantity: Number(row.quantity),
      }));
    }

    onSubmit(nextForm);
  };

  return (
    <div className="modal d-block om-modal-backdrop" tabIndex="-1" role="dialog">
      <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
        <form className="modal-content" onSubmit={handleSubmit}>
          <div className="modal-header">
            <h5 className="modal-title">{action.title}</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>
          <div className="modal-body">
            {modalError && <div className="alert alert-danger">{modalError}</div>}
            {action.type === "status" && (
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.current_status} onChange={(e) => setField("current_status", e.target.value)}>
                    {SAMPLE_STATUSES.map((status) => <option key={status} value={status}>{sampleStatusLabel(status)}</option>)}
                  </select>
                </div>
                {form.current_status === "shipped" && (
                  <div className="col-12">
                    <div className="table-responsive">
                      <table className="table table-sm align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Vendor</th>
                            <th>Container</th>
                            <th>Shipped Date</th>
                            <th>Invoice Number</th>
                            <th>Quantity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.vendor_shipments.length === 0 ? (
                            <tr><td colSpan="5" className="text-secondary">No vendors assigned.</td></tr>
                          ) : form.vendor_shipments.map((row, index) => (
                            <tr key={row.vendor_entry_id || index}>
                              <td>{text(row.vendor_name)}</td>
                              <td><input className="form-control form-control-sm" value={row.container} onChange={(e) => setVendorShipmentField(index, "container", e.target.value)} /></td>
                              <td><input type="date" className="form-control form-control-sm" value={row.shipped_at} onChange={(e) => setVendorShipmentField(index, "shipped_at", e.target.value)} /></td>
                              <td><input className="form-control form-control-sm" value={row.invoice_number} onChange={(e) => setVendorShipmentField(index, "invoice_number", e.target.value)} /></td>
                              <td><input type="number" min="0" className="form-control form-control-sm" value={row.quantity} onChange={(e) => setVendorShipmentField(index, "quantity", e.target.value)} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
            {action.type === "files" && (
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label">File Type</label>
                  <select className="form-select" value={form.file_type} onChange={(e) => setField("file_type", e.target.value)}>
                    {FILE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                <div className="col-md-8">
                  <label className="form-label">Files</label>
                  <input type="file" className="form-control" multiple onChange={(e) => setField("files", Array.from(e.target.files || []))} />
                </div>
              </div>
            )}
            {action.type === "vendor" && (
              <div className="row g-3">
                <div className="col-md-4"><label className="form-label">Vendor</label><input className="form-control" value={form.vendor_name} onChange={(e) => setField("vendor_name", e.target.value)} required /></div>
                <div className="col-md-4"><label className="form-label">Contact</label><input className="form-control" value={form.contact_name} onChange={(e) => setField("contact_name", e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Manufacturing Date</label><input type="date" className="form-control" value={form.expected_manufacturing_date} onChange={(e) => setField("expected_manufacturing_date", e.target.value)} /></div>
                <div className="col-md-4">
                  <label className="form-label">Manufacturing Status</label>
                  <select className="form-select" value={form.manufacturing_status} onChange={(e) => setField("manufacturing_status", e.target.value)}>
                    {MANUFACTURING_STATUSES.map((status) => <option key={status} value={status}>{sampleStatusLabel(status)}</option>)}
                  </select>
                </div>
                <div className="col-md-4"><label className="form-label">Inspection Requested</label><input type="date" className="form-control" value={form.inspection_requested_at} onChange={(e) => setField("inspection_requested_at", e.target.value)} /></div>
                <div className="col-md-4">
                  <label className="form-label">Inspection Status</label>
                  <select className="form-select" value={form.inspection_status} onChange={(e) => setField("inspection_status", e.target.value)}>
                    {INSPECTION_STATUSES.map((status) => <option key={status} value={status}>{sampleStatusLabel(status)}</option>)}
                  </select>
                </div>
                <div className="col-md-4"><label className="form-label">Inspected Date</label><input type="date" className="form-control" value={form.inspected_at} onChange={(e) => setField("inspected_at", e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Estimated Shipping</label><input type="date" className="form-control" value={form.estimated_shipping_date} onChange={(e) => setField("estimated_shipping_date", e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Shipped Date</label><input type="date" className="form-control" value={form.shipped_at} onChange={(e) => setField("shipped_at", e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Tracking</label><input className="form-control" value={form.tracking} onChange={(e) => setField("tracking", e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Container</label><input className="form-control" value={form.container} onChange={(e) => setField("container", e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Invoice Number</label><input className="form-control" value={form.invoice_number} onChange={(e) => setField("invoice_number", e.target.value)} /></div>
                <div className="col-md-4"><label className="form-label">Quantity</label><input type="number" min="0" className="form-control" value={form.quantity} onChange={(e) => setField("quantity", e.target.value)} /></div>
                <div className="col-md-8"><label className="form-label">Vendor Files</label><input type="file" className="form-control" multiple onChange={(e) => setField("files", Array.from(e.target.files || []))} /></div>
              </div>
            )}
            <div className="mt-3">
              <label className="form-label">Comment</label>
              <textarea className="form-control" rows="3" value={form.comment} onChange={(e) => setField("comment", e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const SampleDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = usePermissions();
  const canMutate = MUTATION_ROLES.has(normalizeUserRole(role));
  const [sample, setSample] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState(blankAction);
  const [showEdit, setShowEdit] = useState(false);

  const fetchSample = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await getSample(id);
      setSample(response?.data?.data || null);
    } catch (fetchError) {
      setError(fetchError?.response?.data?.message || "Failed to load sample.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSample();
  }, [fetchSample]);

  const allInspectionFiles = useMemo(() => [
    ...(Array.isArray(sample?.qc_images) ? sample.qc_images : []),
    ...(Array.isArray(sample?.vendor_entries) ? sample.vendor_entries.flatMap((entry) => entry.files || []) : []),
  ], [sample]);

  const handleActionSubmit = async (form) => {
    try {
      setSaving(true);
      if (action.type === "status") {
        const payload = {
          current_status: form.current_status,
          comment: form.comment,
        };
        if (form.current_status === "shipped") {
          payload.vendor_shipments = form.vendor_shipments;
        }
        await updateSampleStatus(id, payload);
      } else if (action.type === "files") {
        const formData = new FormData();
        formData.append("file_type", form.file_type);
        formData.append("comment", form.comment);
        form.files.forEach((file) => formData.append("files", file));
        await uploadSampleFiles(id, formData);
      } else if (action.type === "vendor") {
        const formData = new FormData();
        [
          "vendor_name",
          "contact_name",
          "expected_manufacturing_date",
          "manufacturing_status",
          "inspection_requested_at",
          "inspection_status",
          "inspected_at",
          "estimated_shipping_date",
          "shipped_at",
          "tracking",
          "container",
          "invoice_number",
          "quantity",
          "shipment_remarks",
          "comment",
        ].forEach((field) => formData.append(field, form[field] || ""));
        form.files.forEach((file) => formData.append("files", file));
        await updateSampleVendor(id, action.vendor?._id || "new", formData);
      } else if (action.type === "comment") {
        await addSampleTimeline(id, {
          stage: form.stage || sample?.current_status || "comment",
          action: "comment",
          comment: form.comment,
        });
      }
      setAction(blankAction());
      await fetchSample();
    } catch (submitError) {
      setError(
        submitError?.response?.data?.message
          || submitError?.message
          || "Failed to update sample.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    const comment = window.prompt(sample?.archived ? "Reason to unarchive sample?" : "Reason to archive sample?");
    if (comment === null) return;
    try {
      setSaving(true);
      if (sample?.archived) await unarchiveSample(id, comment);
      else await archiveSample(id, comment);
      await fetchSample();
    } catch (archiveError) {
      setError(archiveError?.response?.data?.message || "Failed to update archive state.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="container-fluid py-3 sample-detail-page">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <div className="d-flex align-items-center gap-2">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate(-1)}>Back</button>
            <h2 className="mb-0">Sample Details</h2>
          </div>
          {canMutate && sample && (
            <div className="d-flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setShowEdit(true)}>Edit</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setAction({ type: "comment", title: "Add Comment" })}>Add Comment</button>
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setAction({ type: "files", title: "Upload Files", file_type: "cad" })}>Upload CAD / Files</button>
              <button type="button" className="btn btn-outline-success btn-sm" onClick={() => setAction({ type: "vendor", title: "Add Vendor" })}>Add Vendor</button>
              <button type="button" className="btn btn-outline-warning btn-sm" onClick={() => setAction({ type: "status", title: "Update Status", status: sample.current_status })}>Update Status</button>
              <button type="button" className="btn btn-outline-danger btn-sm" onClick={handleArchive} disabled={saving}>{sample.archived ? "Unarchive" : "Archive"}</button>
            </div>
          )}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {loading ? (
          <div className="card om-card"><div className="card-body text-center">Loading sample...</div></div>
        ) : !sample ? (
          <div className="card om-card"><div className="card-body text-center text-secondary">Sample not found.</div></div>
        ) : (
          <div className="d-grid gap-3">
            <section className="card om-card sample-summary-card">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between gap-3">
                  <div>
                    <div className="text-secondary small">Sample</div>
                    <h3 className="mb-1">{text(sample.code)}</h3>
                    <div>{text(sample.name)} {sample.description ? `| ${sample.description}` : ""}</div>
                  </div>
                  <div className="sample-summary-meta">
                    <span className={`badge ${statusClass(sample.current_status)}`}>{sampleStatusLabel(sample.current_status)}</span>
                  </div>
                </div>
                <div className="sample-summary-grid mt-3">
                  <div><span>Brand</span><strong>{text(sample.brand)}</strong></div>
                  <div><span>CAD Artist</span><strong>{text(sample.assigned_cad_artist)}</strong></div>
                  <div><span>Created By</span><strong>{text(sample.created_by?.name)}</strong></div>
                  <div><span>Last Updated</span><strong>{formatDateDDMMYYYY(sample.updatedAt, "-")}</strong></div>
                </div>
              </div>
            </section>

            <section className="card om-card">
              <div className="card-body">
                <h5>Workflow</h5>
                <WorkflowStepper currentStatus={sample.current_status} />
              </div>
            </section>

            <section className="card om-card">
              <div className="card-body">
                <h5>Vendor Progress</h5>
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Manufacturing Date</th>
                        <th>Manufacturing Status</th>
                        <th>Inspection Requested</th>
                        <th>Inspection Status</th>
                        <th>Inspected Date</th>
                        <th>Estimated Shipping</th>
                        <th>Shipped Date</th>
                        <th>Container</th>
                        <th>Invoice</th>
                        <th>Quantity</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sample.vendor_entries || []).length === 0 ? (
                        <tr><td colSpan="12" className="text-secondary">No vendors added.</td></tr>
                      ) : sample.vendor_entries.map((vendor) => (
                        <tr key={vendor._id}>
                          <td>{text(vendor.vendor_name)}</td>
                          <td>{formatDateDDMMYYYY(vendor.expected_manufacturing_date, "-")}</td>
                          <td>{sampleStatusLabel(vendor.manufacturing_status)}</td>
                          <td>{formatDateDDMMYYYY(vendor.inspection_requested_at, "-")}</td>
                          <td>{sampleStatusLabel(vendor.inspection_status)}</td>
                          <td>{formatDateDDMMYYYY(vendor.inspected_at, "-")}</td>
                          <td>{formatDateDDMMYYYY(vendor.estimated_shipping_date, "-")}</td>
                          <td>{formatDateDDMMYYYY(vendor.shipped_at, "-")}</td>
                          <td>{text(vendor.container)}</td>
                          <td>{text(vendor.invoice_number)}</td>
                          <td>{vendor.quantity ? Number(vendor.quantity) : "-"}</td>
                          <td>
                            {canMutate ? (
                              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setAction({ type: "vendor", title: `Update ${vendor.vendor_name}`, vendor })}>
                                Update
                              </button>
                            ) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <div className="sample-detail-two-col">
              <FileList title="Sketch Files" files={sample.initial_sketch_files || []} />
              <FileList title="CAD Files" files={sample.cad_files || []} />
              <FileList title="Sample Images" files={sample.sample_images || []} />
              <FileList title="Inspection / Vendor Files" files={allInspectionFiles} />
              <FileList title="Other Files" files={sample.other_files || []} />
            </div>

            <div className="sample-detail-two-col">
              <SizeRows title="Item Sizes" rows={sample.item_sizes || []} weightLabel="Net Weight" />
              <SizeRows title="Box Sizes" rows={sample.box_sizes || []} weightLabel="Gross Weight" />
            </div>

            <section className="card om-card">
              <div className="card-body">
                <h5>Timeline</h5>
                <div className="sample-timeline">
                  {(sample.timeline || []).length === 0 ? (
                    <div className="text-secondary small">No timeline entries yet.</div>
                  ) : [...sample.timeline].reverse().map((entry) => (
                    <article className="sample-timeline-entry" key={entry._id}>
                      <div className="sample-timeline-dot" />
                      <div>
                        <div className="d-flex flex-wrap gap-2 align-items-center">
                          <strong>{sampleStatusLabel(entry.action || entry.stage)}</strong>
                          {entry.status_to && <span className="badge text-bg-light border">{sampleStatusLabel(entry.status_to)}</span>}
                          {entry.vendor_name && <span className="badge text-bg-info">{entry.vendor_name}</span>}
                        </div>
                        <div className="small text-secondary">{text(entry.created_by?.name)} | {formatDateDDMMYYYY(entry.created_at, "-")}</div>
                        {entry.comment && <div className="mt-2">{entry.comment}</div>}
                        {Array.isArray(entry.changed_fields) && entry.changed_fields.length > 0 && (
                          <div className="sample-changes mt-2">
                            {entry.changed_fields.map((change, index) => (
                              <span key={`${entry._id}-change-${index}`}>{change.field}</span>
                            ))}
                          </div>
                        )}
                        {Array.isArray(entry.files) && entry.files.length > 0 && (
                          <div className="sample-timeline-files mt-2">
                            {entry.files.map((file, index) => (
                              <a key={file._id || index} href={file.link || "#"} target="_blank" rel="noreferrer">{file.originalName || "File"}</a>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
      {showEdit && sample && (
        <SampleCreateModal
          sample={sample}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            fetchSample();
          }}
        />
      )}
      {action.type && (
        <ActionModal
          action={action}
          sample={sample}
          saving={saving}
          onClose={() => setAction(blankAction())}
          onSubmit={handleActionSubmit}
        />
      )}
    </>
  );
};

export default SampleDetails;
