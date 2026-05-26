import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import AddComplaintModal from "../components/complaints/AddComplaintModal";
import AddCommentModal from "../components/complaints/AddCommentModal";
import ChangeStatusModal from "../components/complaints/ChangeStatusModal";
import ComplaintAccordionDetails from "../components/complaints/ComplaintAccordionDetails";
import UploadComplaintFilesModal from "../components/complaints/UploadComplaintFilesModal";
import {
  COMPLAINT_STATUS_OPTIONS,
  formatComplaintDateTime,
  getComplaintStatusBadgeClass,
  getComplaintStatusLabel,
} from "../components/complaints/complaintConstants";
import { usePermissions } from "../auth/PermissionContext";
import { isManagerLikeRole, isStrictAdminRole } from "../auth/permissions";
import {
  addComplaintComment,
  archiveComplaint,
  createComplaint,
  getComplaints,
  unarchiveComplaint,
  updateComplaintStatus,
  uploadComplaintFiles,
} from "../services/complaints.service";
import api from "../api/axios";
import "../App.css";

const DEFAULT_FILTERS = {
  search: "",
  brand: "",
  vendor: "",
  status: "all",
  archived: "false",
  date_from: "",
  date_to: "",
};

const truncate = (value = "", limit = 90) => {
  const text = String(value || "").trim();
  if (text.length <= limit) return text || "N/A";
  return `${text.slice(0, limit - 1)}...`;
};
const normalizeTextOptions = (values = []) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

const Complaints = () => {
  const { hasPermission, role } = usePermissions();
  const canRead = hasPermission("complaints", "view") && isManagerLikeRole(role);
  const canCreate = hasPermission("complaints", "create") && isManagerLikeRole(role);
  const canManage = hasPermission("complaints", "edit") && isManagerLikeRole(role);
  const canUpload = hasPermission("complaints", "upload") && isManagerLikeRole(role);
  const canArchive = hasPermission("complaints", "delete") && isStrictAdminRole(role);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [expandedId, setExpandedId] = useState("");
  const [actionMenuId, setActionMenuId] = useState("");
  const [modal, setModal] = useState({ type: "", complaint: null });
  const [brandOptions, setBrandOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const showToast = useCallback((message, tone = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const loadComplaints = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError("");
    try {
      const response = await getComplaints({
        ...filters,
        page,
        limit: pagination.limit,
      });
      setRows(Array.isArray(response?.data?.data) ? response.data.data : []);
      setPagination(response?.data?.pagination || { page, limit: 20, total: 0, totalPages: 1 });
    } catch (loadError) {
      setRows([]);
      setError(loadError?.response?.data?.message || "Failed to load complaints.");
    } finally {
      setLoading(false);
    }
  }, [canRead, filters, page, pagination.limit]);

  useEffect(() => {
    loadComplaints();
  }, [loadComplaints]);

  useEffect(() => {
    if (!canRead) return undefined;
    let cancelled = false;

    const loadOptions = async () => {
      try {
        setLoadingOptions(true);
        const response = await api.get("/orders/brands-and-vendors");
        if (cancelled) return;
        setBrandOptions(normalizeTextOptions(response?.data?.brands));
        setVendorOptions(normalizeTextOptions(response?.data?.vendors));
      } catch {
        if (!cancelled) {
          setBrandOptions([]);
          setVendorOptions([]);
        }
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    };

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [canRead]);

  const handleDraftChange = (event) => {
    const { name, value } = event.target;
    setDraftFilters((prev) => ({ ...prev, [name]: value }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setFilters(draftFilters);
  };

  const resetFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const closeModal = () => setModal({ type: "", complaint: null });

  const replaceRow = (updatedComplaint) => {
    setRows((prev) =>
      prev.map((row) => (row._id === updatedComplaint._id ? updatedComplaint : row)),
    );
  };

  const handleCreateComplaint = async (formData) => {
    try {
      setSaving(true);
      await createComplaint(formData);
      closeModal();
      showToast("Complaint created successfully.");
      setPage(1);
      await loadComplaints();
    } catch (createError) {
      showToast(createError?.response?.data?.message || "Failed to create complaint.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleAddComment = async (payload) => {
    try {
      setSaving(true);
      const response = await addComplaintComment(modal.complaint._id, payload);
      replaceRow(response?.data?.data);
      closeModal();
      showToast("Comment added successfully.");
    } catch (commentError) {
      showToast(commentError?.response?.data?.message || "Failed to add comment.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleChangeStatus = async (payload) => {
    try {
      setSaving(true);
      const response = await updateComplaintStatus(modal.complaint._id, payload);
      replaceRow(response?.data?.data);
      closeModal();
      showToast("Complaint status updated.");
    } catch (statusError) {
      showToast(statusError?.response?.data?.message || "Failed to update status.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFiles = async (formData) => {
    try {
      setSaving(true);
      const response = await uploadComplaintFiles(modal.complaint._id, formData);
      replaceRow(response?.data?.data);
      closeModal();
      showToast("Files uploaded successfully.");
    } catch (uploadError) {
      showToast(uploadError?.response?.data?.message || "Failed to upload files.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (complaint) => {
    const reason = complaint.archived
      ? ""
      : window.prompt("Archive reason");
    if (!complaint.archived && reason === null) return;
    if (complaint.archived && !window.confirm("Restore this complaint?")) return;
    try {
      if (complaint.archived) {
        await unarchiveComplaint(complaint._id);
      } else {
        await archiveComplaint(complaint._id, reason);
      }
      showToast(complaint.archived ? "Complaint restored." : "Complaint archived.");
      await loadComplaints();
    } catch (archiveError) {
      showToast(archiveError?.response?.data?.message || "Failed to update archive status.", "danger");
    }
  };

  const tableRows = useMemo(() => rows, [rows]);

  if (!canRead) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <Navbar />
      <div className="page-shell py-3 complaints-page">
        {toast && (
          <div className={`complaint-toast complaint-toast--${toast.tone}`}>
            {toast.message}
          </div>
        )}

        <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
          <div>
            <h2 className="h4 mb-1">Complaints</h2>
            <div className="text-secondary small">
              {pagination.total} complaint{pagination.total === 1 ? "" : "s"} found
            </div>
          </div>
          {canCreate && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModal({ type: "add", complaint: null })}
            >
              Add Complaint
            </button>
          )}
        </div>

        <div className="card om-card mb-3">
          <form className="card-body row g-3 align-items-end" onSubmit={applyFilters}>
            <div className="col-lg-3 col-md-6">
              <label className="form-label">Search</label>
              <input
                name="search"
                className="form-control"
                value={draftFilters.search}
                onChange={handleDraftChange}
                placeholder="Complaint no, item, brand, vendor, PO"
              />
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label">Brand</label>
              <input name="brand" className="form-control" value={draftFilters.brand} onChange={handleDraftChange} />
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label">Vendor</label>
              <input name="vendor" className="form-control" value={draftFilters.vendor} onChange={handleDraftChange} />
            </div>
            <div className="col-lg-2 col-md-6">
              <label className="form-label">Status</label>
              <select name="status" className="form-select" value={draftFilters.status} onChange={handleDraftChange}>
                <option value="all">All</option>
                {COMPLAINT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="col-lg-1 col-md-4">
              <label className="form-label">Archived</label>
              <select name="archived" className="form-select" value={draftFilters.archived} onChange={handleDraftChange}>
                <option value="false">Active</option>
                <option value="true">Archived</option>
              </select>
            </div>
            <div className="col-lg-2 col-md-4">
              <label className="form-label">From</label>
              <input type="date" name="date_from" className="form-control" value={draftFilters.date_from} onChange={handleDraftChange} />
            </div>
            <div className="col-lg-2 col-md-4">
              <label className="form-label">To</label>
              <input type="date" name="date_to" className="form-control" value={draftFilters.date_to} onChange={handleDraftChange} />
            </div>
            <div className="col-md-auto d-grid">
              <button type="submit" className="btn btn-primary">Apply</button>
            </div>
            <div className="col-md-auto d-grid">
              <button type="button" className="btn btn-outline-secondary" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </form>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="card om-card">
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">Loading complaints...</div>
            ) : tableRows.length === 0 ? (
              <div className="text-center text-secondary py-4">No complaints found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-striped table-hover align-middle om-table mb-0 complaints-table">
                  <thead className="table-primary">
                    <tr>
                      <th>Item Code</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Creator</th>
                      <th>First Comment</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((complaint) => (
                      <Fragment key={complaint._id}>
                        <tr
                          className={complaint.archived ? "complaint-row-muted" : ""}
                        >
                          <td className="fw-semibold">{complaint.item_code || "N/A"}</td>
                          <td>{complaint.brand || "N/A"}</td>
                          <td>{complaint.vendor || "N/A"}</td>
                          <td>
                            <div>{complaint.created_by?.name || "N/A"}</div>
                            <div className="small text-secondary">{formatComplaintDateTime(complaint.created_at)}</div>
                          </td>
                          <td className="complaint-comment-cell" title={complaint.first_comment}>
                            {truncate(complaint.first_comment)}
                          </td>
                          <td>
                            <span className={`badge ${getComplaintStatusBadgeClass(complaint.status)}`}>
                              {getComplaintStatusLabel(complaint.status)}
                            </span>
                          </td>
                          <td>
                            <div className="position-relative d-inline-block">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                onClick={() =>
                                  setActionMenuId((current) =>
                                    current === complaint._id ? "" : complaint._id
                                  )
                                }
                              >
                                Action
                              </button>
                              {actionMenuId === complaint._id && (
                                <div className="complaint-action-menu shadow-sm">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedId((current) => current === complaint._id ? "" : complaint._id);
                                      setActionMenuId("");
                                    }}
                                  >
                                    View / Expand details
                                  </button>
                                  {canManage && (
                                    <button type="button" onClick={() => { setModal({ type: "comment", complaint }); setActionMenuId(""); }}>
                                      Add comment
                                    </button>
                                  )}
                                  {canManage && (
                                    <button type="button" onClick={() => { setModal({ type: "status", complaint }); setActionMenuId(""); }}>
                                      Change status
                                    </button>
                                  )}
                                  {canUpload && (
                                    <button type="button" onClick={() => { setModal({ type: "files", complaint }); setActionMenuId(""); }}>
                                      Upload files
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedId(complaint._id);
                                      setActionMenuId("");
                                    }}
                                  >
                                    View files
                                  </button>
                                  {canArchive && (
                                    <button type="button" className="text-danger" onClick={() => { handleArchive(complaint); setActionMenuId(""); }}>
                                      {complaint.archived ? "Unarchive" : "Archive"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedId === complaint._id && (
                          <tr>
                            <td colSpan={7} className="p-0">
                              <ComplaintAccordionDetails complaint={complaint} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center mt-3">
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span className="small text-secondary">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={page >= pagination.totalPages || loading}
            onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {modal.type === "add" && (
        <AddComplaintModal
          brandOptions={brandOptions}
          loadingOptions={loadingOptions}
          onClose={closeModal}
          onSubmit={handleCreateComplaint}
          saving={saving}
          vendorOptions={vendorOptions}
        />
      )}
      {modal.type === "comment" && (
        <AddCommentModal complaint={modal.complaint} onClose={closeModal} onSubmit={handleAddComment} saving={saving} />
      )}
      {modal.type === "status" && (
        <ChangeStatusModal complaint={modal.complaint} onClose={closeModal} onSubmit={handleChangeStatus} saving={saving} />
      )}
      {modal.type === "files" && (
        <UploadComplaintFilesModal complaint={modal.complaint} onClose={closeModal} onSubmit={handleUploadFiles} saving={saving} />
      )}
    </>
  );
};

export default Complaints;
