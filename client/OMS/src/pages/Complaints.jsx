import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import ReportInfoBanner from "../components/ReportInfoBanner";
import AddComplaintModal from "../components/complaints/AddComplaintModal";
import AddCommentModal from "../components/complaints/AddCommentModal";
import ComplaintAccordionDetails from "../components/complaints/ComplaintAccordionDetails";
import EditComplaintModal from "../components/complaints/EditComplaintModal";
import UploadComplaintFilesModal from "../components/complaints/UploadComplaintFilesModal";
import { formatComplaintDateTime } from "../components/complaints/complaintConstants";
import { usePermissions } from "../auth/PermissionContext";
import { isManagerLikeRole, isStrictAdminRole, normalizeUserRole } from "../auth/permissions";
import {
  addComplaintComment,
  archiveComplaint,
  createComplaint,
  createComplaintCategory,
  getComplaintCategories,
  getComplaints,
  unarchiveComplaint,
  updateComplaint,
  uploadComplaintFiles,
} from "../services/complaints.service";
import api from "../api/axios";
import "../App.css";

const DEFAULT_FILTERS = {
  search: "",
  brand: "",
  vendor: "",
  category: "",
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
  const canArchive = hasPermission("complaints", "delete") && (isStrictAdminRole(role) || normalizeUserRole(role) === "inspection_manager");
  const canEditComplaint = hasPermission("complaints", "edit") && (isStrictAdminRole(role) || normalizeUserRole(role) === "inspection_manager");

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
  const [actionMenu, setActionMenu] = useState({ id: "", top: 0, left: 0 });
  const [modal, setModal] = useState({ type: "", complaint: null });
  const [brandOptions, setBrandOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [itemCodeOptions, setItemCodeOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);

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
      setError(loadError?.response?.data?.message || "Failed to load complains.");
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
        const [brandVendorResponse, categoryResponse, itemOptionsResponse] = await Promise.all([
          api.get("/orders/brands-and-vendors"),
          getComplaintCategories(),
          api.get("/items", { params: { page: 1, limit: 1 } }),
        ]);
        if (cancelled) return;
        setBrandOptions(normalizeTextOptions(brandVendorResponse?.data?.brands));
        setVendorOptions(normalizeTextOptions(brandVendorResponse?.data?.vendors));
        setItemCodeOptions(normalizeTextOptions(itemOptionsResponse?.data?.filters?.item_codes));
        setCategoryOptions(normalizeTextOptions(
          (Array.isArray(categoryResponse?.data?.data) ? categoryResponse.data.data : [])
            .map((category) => category?.name),
        ));
      } catch {
        if (!cancelled) {
          setBrandOptions([]);
          setVendorOptions([]);
          setItemCodeOptions([]);
          setCategoryOptions([]);
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
  const closeActionMenu = () => setActionMenu({ id: "", top: 0, left: 0 });

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
      showToast("Complain created successfully.");
      setPage(1);
      await loadComplaints();
    } catch (createError) {
      showToast(createError?.response?.data?.message || "Failed to create complain.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleEditComplaint = async (formData) => {
    try {
      setSaving(true);
      const response = await updateComplaint(modal.complaint._id, formData);
      replaceRow(response?.data?.data);
      closeModal();
      showToast("Complain updated successfully.");
    } catch (editError) {
      showToast(editError?.response?.data?.message || "Failed to update complain.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCategory = async (categoryName) => {
    try {
      setCreatingCategory(true);
      const response = await createComplaintCategory({ name: categoryName });
      const savedName = String(response?.data?.data?.name || categoryName || "").trim();
      if (savedName) {
        setCategoryOptions((prev) => normalizeTextOptions([...prev, savedName]));
        showToast("Complain category saved.");
      }
      return savedName;
    } finally {
      setCreatingCategory(false);
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
    if (complaint.archived && !window.confirm("Restore this complain?")) return;
    try {
      if (complaint.archived) {
        await unarchiveComplaint(complaint._id);
      } else {
        await archiveComplaint(complaint._id, reason);
      }
      showToast(complaint.archived ? "Complain restored." : "Complain archived.");
      await loadComplaints();
    } catch (archiveError) {
      showToast(archiveError?.response?.data?.message || "Failed to update archive state.", "danger");
    }
  };

  const tableRows = useMemo(() => rows, [rows]);
  const activeActionComplaint = useMemo(
    () => tableRows.find((complaint) => complaint._id === actionMenu.id) || null,
    [actionMenu.id, tableRows],
  );

  useEffect(() => {
    if (!actionMenu.id) return undefined;

    const handleViewportChange = () => closeActionMenu();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [actionMenu.id]);

  const handleActionButtonClick = (event, complaintId) => {
    if (actionMenu.id === complaintId) {
      closeActionMenu();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = 252;
    const viewportPadding = 12;
    const left = Math.min(
      Math.max(viewportPadding, rect.right - menuWidth),
      Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding),
    );
    const opensDown = rect.bottom + menuHeight + viewportPadding <= window.innerHeight;
    const top = opensDown
      ? rect.bottom + 8
      : Math.max(viewportPadding, rect.top - menuHeight - 8);

    setActionMenu({ id: complaintId, top, left });
  };

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
            <h2 className="h4 mb-1">Complains</h2>
            <div className="text-secondary small">
              {pagination.total} complain{pagination.total === 1 ? "" : "s"} found
            </div>
          </div>
          {canCreate && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModal({ type: "add", complaint: null })}
            >
              Add Complain
            </button>
          )}
        </div>

        <ReportInfoBanner
          description="Tracks client quality complaints, issues, and resolution communications."
          dataShown="Complaint category, item code, brand, vendor, creator details, dates, accordion comments log, attached proof files, and status."
          howItWorks="Displays a paginated log of complaints, filterable by search text, brand, vendor, category, archived/active status, and date range."
        />

        <div className="card om-card mb-3">
          <form className="card-body complaints-filter-form" onSubmit={applyFilters}>
            <div className="complaints-filter-field complaints-filter-field--wide">
              <label className="form-label">Search</label>
              <input
                name="search"
                className="form-control"
                value={draftFilters.search}
                onChange={handleDraftChange}
                placeholder="Complain no, item, brand, vendor, PO"
              />
            </div>
            <div className="complaints-filter-field">
              <label className="form-label">Brand</label>
              <input name="brand" className="form-control" value={draftFilters.brand} onChange={handleDraftChange} />
            </div>
            <div className="complaints-filter-field">
              <label className="form-label">Vendor</label>
              <input name="vendor" className="form-control" value={draftFilters.vendor} onChange={handleDraftChange} />
            </div>
            <div className="complaints-filter-field">
              <label className="form-label">Category</label>
              <input
                name="category"
                className="form-control"
                list="complaint-filter-category-options"
                value={draftFilters.category}
                onChange={handleDraftChange}
              />
              <datalist id="complaint-filter-category-options">
                {categoryOptions.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </div>
            <div className="complaints-filter-field complaints-filter-field--compact">
              <label className="form-label">Archived</label>
              <select name="archived" className="form-select" value={draftFilters.archived} onChange={handleDraftChange}>
                <option value="false">Active</option>
                <option value="true">Archived</option>
              </select>
            </div>
            <div className="complaints-filter-field">
              <label className="form-label">From</label>
              <input type="date" name="date_from" className="form-control" value={draftFilters.date_from} onChange={handleDraftChange} />
            </div>
            <div className="complaints-filter-field">
              <label className="form-label">To</label>
              <input type="date" name="date_to" className="form-control" value={draftFilters.date_to} onChange={handleDraftChange} />
            </div>
            <div className="complaints-filter-action">
              <button type="submit" className="btn btn-primary">Apply</button>
            </div>
            <div className="complaints-filter-action">
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
              <div className="text-center py-4">Loading complains...</div>
            ) : tableRows.length === 0 ? (
              <div className="text-center text-secondary py-4">No complains found.</div>
            ) : (
              <div className="table-responsive complaint-table-scroll">
                <table className="table table-striped table-hover align-middle om-table mb-0 complaints-table">
                  <thead className="table-primary">
                    <tr>
                      <th>Item Code</th>
                      <th>Brand</th>
                      <th>Vendor</th>
                      <th>Category</th>
                      <th>Creator</th>
                      <th>First Comment</th>
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
                          <td>{complaint.category || "N/A"}</td>
                          <td>
                            <div>{complaint.created_by?.name || "N/A"}</div>
                            <div className="small text-secondary">{formatComplaintDateTime(complaint.created_at)}</div>
                          </td>
                          <td className="complaint-comment-cell" title={complaint.first_comment}>
                            {truncate(complaint.first_comment)}
                          </td>
                          <td>
                            <div className="complaint-action-cell">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm complaint-action-trigger"
                                aria-expanded={actionMenu.id === complaint._id}
                                onClick={(event) => handleActionButtonClick(event, complaint._id)}
                              >
                                Action
                              </button>
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

      {activeActionComplaint && (
        <>
          <button
            type="button"
            className="complaint-action-backdrop"
            aria-label="Close complain actions"
            onClick={closeActionMenu}
          />
          <div
            className="complaint-action-menu shadow"
            style={{ top: `${actionMenu.top}px`, left: `${actionMenu.left}px` }}
          >
            <div className="complaint-action-menu-title">
              {activeActionComplaint.complaint_no || activeActionComplaint.item_code || "Complain"}
            </div>
            <button
              type="button"
              onClick={() => {
                setExpandedId((current) =>
                  current === activeActionComplaint._id ? "" : activeActionComplaint._id,
                );
                closeActionMenu();
              }}
            >
              View details
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setModal({ type: "comment", complaint: activeActionComplaint });
                  closeActionMenu();
                }}
              >
                Add comment
              </button>
            )}
            {canEditComplaint && (
              <button
                type="button"
                onClick={() => {
                  setModal({ type: "edit", complaint: activeActionComplaint });
                  closeActionMenu();
                }}
              >
                Edit complain
              </button>
            )}
            {canUpload && (
              <button
                type="button"
                onClick={() => {
                  setModal({ type: "files", complaint: activeActionComplaint });
                  closeActionMenu();
                }}
              >
                Upload files
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setExpandedId(activeActionComplaint._id);
                closeActionMenu();
              }}
            >
              View files
            </button>
            {canArchive && (
              <button
                type="button"
                className="text-danger"
                onClick={() => {
                  handleArchive(activeActionComplaint);
                  closeActionMenu();
                }}
              >
                {activeActionComplaint.archived ? "Unarchive" : "Archive"}
              </button>
            )}
          </div>
        </>
      )}

      {modal.type === "add" && (
        <AddComplaintModal
          brandOptions={brandOptions}
          categoryOptions={categoryOptions}
          creatingCategory={creatingCategory}
          itemCodeOptions={itemCodeOptions}
          loadingOptions={loadingOptions}
          onClose={closeModal}
          onCreateCategory={handleCreateCategory}
          onSubmit={handleCreateComplaint}
          saving={saving}
          vendorOptions={vendorOptions}
        />
      )}
      {modal.type === "edit" && (
        <EditComplaintModal
          brandOptions={brandOptions}
          categoryOptions={categoryOptions}
          complaint={modal.complaint}
          creatingCategory={creatingCategory}
          itemCodeOptions={itemCodeOptions}
          loadingOptions={loadingOptions}
          onClose={closeModal}
          onCreateCategory={handleCreateCategory}
          onSubmit={handleEditComplaint}
          saving={saving}
          vendorOptions={vendorOptions}
        />
      )}
      {modal.type === "comment" && (
        <AddCommentModal complaint={modal.complaint} onClose={closeModal} onSubmit={handleAddComment} saving={saving} />
      )}
      {modal.type === "files" && (
        <UploadComplaintFilesModal complaint={modal.complaint} onClose={closeModal} onSubmit={handleUploadFiles} saving={saving} />
      )}
    </>
  );
};

export default Complaints;
