import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getUserFromToken } from "../auth/auth.service";
import { isStrictAdminRole } from "../auth/permissions";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { usePermissions } from "../auth/PermissionContext";
import { getCountryOptions } from "../constants/countries";
import {
  emptyVendorCode,
  formatVendorCodes,
  getAvailableBrandOptions,
  getCompleteVendorCodes,
  getVendorCodeSearchValues,
  hasDuplicateVendorCodeRows,
  hasIncompleteVendorCodeRows,
  normalizeBrandOptions,
  normalizeVendorCodeDraftRows,
} from "../utils/vendorCodes";
import "../App.css";

const CONTACT_PERSON_TYPE_OPTIONS = [
  { value: "merchant", label: "Merchant" },
  { value: "shipment", label: "Shipment" },
];

const emptyContactPerson = { name: "", email: "", phone: "", type: "merchant" };

const normalizeContactPersonType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return CONTACT_PERSON_TYPE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : "merchant";
};

const getContactPersonTypeLabel = (value) =>
  CONTACT_PERSON_TYPE_OPTIONS.find((option) => option.value === normalizeContactPersonType(value))
    ?.label || "Merchant";

const normalizeContactPersons = (contacts = []) =>
  (Array.isArray(contacts) ? contacts : [])
    .map((contact) => ({
      name: String(contact?.name || "").trim(),
      email: String(contact?.email || "").trim(),
      phone: String(contact?.phone || "").trim(),
      type: normalizeContactPersonType(contact?.type),
    }))
    .filter((contact) => contact.name || contact.email || contact.phone);

const VendorDetails = () => {
  const { hasPermission, isAdmin, role: permissionRole } = usePermissions();
  const userRole = permissionRole || getUserFromToken()?.role;
  const isVendorAdmin = isStrictAdminRole(userRole) || isAdmin;
  const canViewVendors = hasPermission("vendors", "view");
  const canEditVendors = hasPermission("vendors", "edit");
  const canCreateVendors = hasPermission("vendors", "create");
  const navigate = useNavigate();

  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [brandOptions, setBrandOptions] = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(true);

  // Edit Modal State
  const [editingVendor, setEditingVendor] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const loadVendors = useCallback(async () => {
    if (!canViewVendors) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/vendors");
      setVendors(Array.isArray(response?.data?.data) ? response.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load vendor records.");
      setVendors([]);
    } finally {
      setLoading(false);
    }
  }, [canViewVendors]);

  const loadBrandOptions = useCallback(async () => {
    if (!canViewVendors) return;

    setLoadingBrands(true);
    try {
      const response = await api.get("/vendors/brand-options");
      setBrandOptions(normalizeBrandOptions(response?.data?.data));
    } catch {
      setBrandOptions([]);
    } finally {
      setLoadingBrands(false);
    }
  }, [canViewVendors]);

  useEffect(() => {
    loadVendors();
    loadBrandOptions();
  }, [loadBrandOptions, loadVendors]);

  // Extract all unique countries from vendor list
  const availableCountries = useMemo(() => {
    const set = new Set();
    vendors.forEach((v) => {
      const countryStr = String(v.country || "").trim();
      set.add(countryStr ? countryStr : "Unspecified");
    });
    return Array.from(set).sort((a, b) => {
      if (a === "Unspecified") return 1;
      if (b === "Unspecified") return -1;
      return a.localeCompare(b);
    });
  }, [vendors]);

  const toggleCountryFilter = (countryName) => {
    setSelectedCountries((prev) => {
      if (prev.includes(countryName)) {
        return prev.filter((c) => c !== countryName);
      } else {
        return [...prev, countryName];
      }
    });
  };

  const selectAllCountries = () => {
    setSelectedCountries([]);
  };

  const filteredVendors = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    return vendors.filter((vendor) => {
      const vendorCountry = String(vendor.country || "").trim() || "Unspecified";

      if (selectedCountries.length > 0 && !selectedCountries.includes(vendorCountry)) {
        return false;
      }

      if (!search) return true;

      const searchableString = [
        vendor?.name,
        vendor?.owner_name,
        ...getVendorCodeSearchValues(vendor?.vendor_code),
        vendor?.email,
        vendor?.phone,
        vendor?.country,
        vendor?.address,
        vendor?.is_active === false ? "inactive" : "active",
        ...(Array.isArray(vendor?.contact_person)
          ? vendor.contact_person.flatMap((contact) => [
              contact?.name,
              contact?.email,
              contact?.phone,
              contact?.type,
            ])
          : []),
      ]
        .map((val) => String(val || "").toLowerCase())
        .join(" ");

      return searchableString.includes(search);
    });
  }, [searchQuery, selectedCountries, vendors]);

  // Group vendors by country
  const groupedVendors = useMemo(() => {
    const groups = {};
    filteredVendors.forEach((vendor) => {
      const countryKey = String(vendor.country || "").trim() || "Unspecified";
      if (!groups[countryKey]) {
        groups[countryKey] = [];
      }
      groups[countryKey].push(vendor);
    });

    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === "Unspecified") return 1;
      if (b === "Unspecified") return -1;
      return a.localeCompare(b);
    });

    return sortedKeys.map((key) => ({
      country: key,
      vendors: groups[key],
    }));
  }, [filteredVendors]);
  const editCountryOptions = useMemo(
    () => getCountryOptions(editForm?.country),
    [editForm?.country],
  );

  const handleExportXls = async () => {
    try {
      setExporting(true);
      setError("");
      const params = new URLSearchParams();
      if (selectedCountries.length > 0) {
        params.append("countries", selectedCountries.join(","));
      }

      const response = await api.get(`/vendors/export?${params.toString()}`, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: "application/vnd.ms-excel",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const fileDate = new Date().toISOString().slice(0, 10);
      anchor.download = `vendors-export-${fileDate}.xls`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export Error:", err);
      setError("Failed to export vendor details in XLS format.");
    } finally {
      setExporting(false);
    }
  };

  const handleOpenEditModal = (vendor) => {
    setEditingVendor(vendor);
    setEditForm({
      _id: vendor._id,
      name: vendor.name || "",
      owner_name: vendor.owner_name || "",
      vendor_code: normalizeVendorCodeDraftRows(vendor.vendor_code),
      email: vendor.email || "",
      phone: vendor.phone || "",
      country: vendor.country || "",
      address: vendor.address || "",
      is_active: vendor.is_active !== false,
      contact_person:
        Array.isArray(vendor.contact_person) && vendor.contact_person.length > 0
          ? vendor.contact_person.map((c) => ({ ...c }))
          : [{ ...emptyContactPerson }],
    });
    setEditError("");
  };

  const handleCloseEditModal = () => {
    setEditingVendor(null);
    setEditForm(null);
    setEditError("");
  };

  const handleEditChange = (event) => {
    const { name, type, checked, value } = event.target;
    setEditForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleEditVendorCodeChange = (index, field, value) => {
    setEditForm((prev) => {
      const vendorCodes = normalizeVendorCodeDraftRows(prev.vendor_code).map((entry) => ({ ...entry }));
      vendorCodes[index] = {
        ...(vendorCodes[index] || emptyVendorCode),
        [field]: value,
      };
      return { ...prev, vendor_code: vendorCodes };
    });
  };

  const addEditVendorCode = () => {
    setEditForm((prev) => ({
      ...prev,
      vendor_code: [...normalizeVendorCodeDraftRows(prev.vendor_code), { ...emptyVendorCode }],
    }));
  };

  const removeEditVendorCode = (index) => {
    setEditForm((prev) => {
      const vendorCodes = normalizeVendorCodeDraftRows(prev.vendor_code).filter(
        (_, vendorCodeIndex) => vendorCodeIndex !== index,
      );
      return {
        ...prev,
        vendor_code: vendorCodes.length > 0 ? vendorCodes : [{ ...emptyVendorCode }],
      };
    });
  };

  const handleEditContactChange = (index, field, value) => {
    setEditForm((prev) => {
      const contacts = Array.isArray(prev.contact_person)
        ? [...prev.contact_person]
        : [{ ...emptyContactPerson }];
      contacts[index] = {
        ...(contacts[index] || emptyContactPerson),
        [field]: value,
      };
      return { ...prev, contact_person: contacts };
    });
  };

  const addEditContactPerson = () => {
    setEditForm((prev) => ({
      ...prev,
      contact_person: [
        ...(Array.isArray(prev.contact_person) ? prev.contact_person : []),
        { ...emptyContactPerson },
      ],
    }));
  };

  const removeEditContactPerson = (index) => {
    setEditForm((prev) => {
      const contacts = (Array.isArray(prev.contact_person) ? prev.contact_person : []).filter(
        (_, cIdx) => cIdx !== index
      );
      return {
        ...prev,
        contact_person: contacts.length > 0 ? contacts : [{ ...emptyContactPerson }],
      };
    });
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!editForm) return;

    setEditError("");
    const vendorCodePayload = getCompleteVendorCodes(editForm.vendor_code);

    if (!editForm.name.trim() || vendorCodePayload.length === 0) {
      setEditError("Name and at least one vendor code are required.");
      return;
    }
    if (hasIncompleteVendorCodeRows(editForm.vendor_code)) {
      setEditError("Select a brand and enter a code for every vendor code row.");
      return;
    }
    if (hasDuplicateVendorCodeRows(editForm.vendor_code)) {
      setEditError("Duplicate brand and vendor code rows are not allowed.");
      return;
    }

    const contactPersonPayload = normalizeContactPersons(editForm.contact_person);

    try {
      setSavingEdit(true);
      await api.put(`/vendors/${editForm._id}`, {
        name: editForm.name.trim(),
        owner_name: editForm.owner_name.trim() || undefined,
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
        country: editForm.country.trim() || undefined,
        address: editForm.address.trim() || undefined,
        vendor_code: vendorCodePayload,
        contact_person: contactPersonPayload,
        is_active: editForm.is_active,
      });

      setSuccess(`Vendor "${editForm.name}" updated successfully.`);
      handleCloseEditModal();
      await loadVendors();
    } catch (err) {
      setEditError(err.response?.data?.message || "Failed to update vendor details.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (!canViewVendors || !isVendorAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        {/* Header Card */}
        <div className="card om-card shadow-sm mb-4">
          <div className="card-body p-4">
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
              <div>
                <h1 className="h3 mb-1 fw-bold text-dark">Vendor Directory & Details</h1>
                <p className="text-secondary mb-0">
                  Manage vendor details, filter records by country, and export reports in XLS format.
                </p>
              </div>
              <div className="d-flex flex-wrap align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={loadVendors}
                  disabled={loading}
                >
                  Refresh
                </button>
                {canCreateVendors && (
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => navigate("/vendors/new")}
                  >
                    + Create Vendor
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-success btn-sm d-flex align-items-center gap-1"
                  onClick={handleExportXls}
                  disabled={exporting || loading || vendors.length === 0}
                >
                  <span>📥</span>
                  <span>{exporting ? "Exporting XLS..." : "Export XLS"}</span>
                </button>
              </div>
            </div>

            {error && <div className="alert alert-danger py-2 mb-3">{error}</div>}
            {success && <div className="alert alert-success py-2 mb-3" onClick={() => setSuccess("")}>{success}</div>}

            {/* Controls Row */}
            <div className="row g-3">
              <div className="col-md-5">
                <label className="form-label small fw-semibold text-secondary">Search Vendors</label>
                <input
                  type="search"
                  className="form-control"
                  placeholder="Search by name, owner, code, email, phone, address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="col-md-7">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <label className="form-label small fw-semibold text-secondary mb-0">
                    Filter by Country (Multiple selection allowed)
                  </label>
                  {selectedCountries.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 text-decoration-none"
                      onClick={selectAllCountries}
                    >
                      Show All ({availableCountries.length})
                    </button>
                  )}
                </div>
                <div className="d-flex flex-wrap gap-1 align-items-center p-2 rounded border bg-light" style={{ minHeight: "38px" }}>
                  <button
                    type="button"
                    className={`btn btn-xs rounded-pill px-2 py-1 ${
                      selectedCountries.length === 0 ? "btn-dark" : "btn-outline-secondary"
                    }`}
                    style={{ fontSize: "12px" }}
                    onClick={selectAllCountries}
                  >
                    All Countries
                  </button>
                  {availableCountries.map((country) => {
                    const isSelected = selectedCountries.includes(country);
                    return (
                      <button
                        key={country}
                        type="button"
                        className={`btn btn-xs rounded-pill px-2 py-1 ${
                          isSelected ? "btn-primary" : "btn-outline-secondary"
                        }`}
                        style={{ fontSize: "12px" }}
                        onClick={() => toggleCountryFilter(country)}
                      >
                        {country} {isSelected ? "✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Vendors Content by Country Sections */}
        {loading ? (
          <div className="card om-card shadow-sm p-5 text-center text-secondary">
            <div className="spinner-border spinner-border-sm text-primary me-2" role="status" />
            Loading vendor records...
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="card om-card shadow-sm p-5 text-center text-secondary">
            No vendors found matching your current filter criteria.
          </div>
        ) : (
          groupedVendors.map((group) => (
            <div className="card om-card shadow-sm mb-4" key={`country-group-${group.country}`}>
              <div className="card-header bg-body-tertiary border-bottom py-3 px-4 d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <span className="fs-5 me-1">🌐</span>
                  <h2 className="h5 mb-0 fw-bold text-dark">{group.country}</h2>
                </div>
                <span className="badge bg-primary rounded-pill">
                  {group.vendors.length} Vendor{group.vendors.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-4">Vendor Name</th>
                        <th>Owner Name</th>
                        <th>Vendor Codes</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Contact Persons</th>
                        <th>Status</th>
                        <th>Address</th>
                        {canEditVendors && <th className="pe-4 text-end">Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {group.vendors.map((vendor) => (
                        <tr key={vendor._id}>
                          <td className="ps-4 fw-bold text-dark">{vendor.name || "N/A"}</td>
                          <td>{vendor.owner_name || "N/A"}</td>
                          <td>
                            <code className="text-primary bg-light px-2 py-1 rounded">
                              {formatVendorCodes(vendor.vendor_code) || "N/A"}
                            </code>
                          </td>
                          <td>{vendor.email || "N/A"}</td>
                          <td>{vendor.phone || "N/A"}</td>
                          <td>
                            {Array.isArray(vendor.contact_person) && vendor.contact_person.length > 0 ? (
                              <div className="d-flex flex-column gap-1">
                                {vendor.contact_person.map((contact, idx) => (
                                  <div key={`cp-${idx}`} className="small">
                                    <span className="fw-semibold">{contact.name || "N/A"}</span>
                                    {contact.type && (
                                      <span className="badge bg-info text-dark ms-1" style={{ fontSize: "10px" }}>
                                        {getContactPersonTypeLabel(contact.type)}
                                      </span>
                                    )}
                                    <br />
                                    <span className="text-secondary">
                                      {[contact.email, contact.phone].filter(Boolean).join(" | ")}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-secondary small">N/A</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${vendor.is_active ? "bg-success" : "bg-secondary"}`}>
                              {vendor.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td style={{ maxWidth: "220px" }}>
                            <span className="text-truncate d-block" title={vendor.address}>
                              {vendor.address || "N/A"}
                            </span>
                          </td>
                          {canEditVendors && (
                            <td className="pe-4 text-end">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm px-3"
                                onClick={() => handleOpenEditModal(vendor)}
                              >
                                Edit
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit Vendor Modal */}
      {editingVendor && editForm && (
        <div
          className="modal show d-block"
          tabIndex="-1"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)", zIndex: 1055 }}
        >
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable vendor-edit-modal-dialog">
            <div className="modal-content shadow-lg border-0">
              <div className="modal-header bg-light">
                <h5 className="modal-title fw-bold">Edit Vendor Details</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={handleCloseEditModal}
                  disabled={savingEdit}
                />
              </div>

              <form className="vendor-edit-modal-form" onSubmit={handleSaveEdit}>
                <div className="modal-body vendor-edit-modal-body p-4">
                  {editError && <div className="alert alert-danger py-2">{editError}</div>}

                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Vendor Name *</label>
                      <input
                        name="name"
                        className="form-control"
                        value={editForm.name}
                        onChange={handleEditChange}
                        required
                      />
                    </div>

                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Owner Name</label>
                      <input
                        name="owner_name"
                        className="form-control"
                        value={editForm.owner_name}
                        onChange={handleEditChange}
                      />
                    </div>

                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Email</label>
                      <input
                        name="email"
                        type="email"
                        className="form-control"
                        value={editForm.email}
                        onChange={handleEditChange}
                      />
                    </div>

                    <div className="col-12 pt-2 border-top">
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <label className="form-label fw-semibold mb-0">Vendor Codes *</label>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={addEditVendorCode}
                        >
                          + Add Code
                        </button>
                      </div>

                      {normalizeVendorCodeDraftRows(editForm.vendor_code).map((vendorCode, idx) => {
                        const availableBrandOptions = getAvailableBrandOptions(
                          brandOptions,
                          vendorCode.brand,
                        );

                        return (
                          <div
                            className="row g-2 align-items-center mb-2 bg-light p-2 rounded border"
                            key={`edit-vendor-code-${idx}`}
                          >
                            <div className="col-md-5">
                              <select
                                className="form-select form-select-sm"
                                value={vendorCode.brand}
                                onChange={(event) =>
                                  handleEditVendorCodeChange(idx, "brand", event.target.value)
                                }
                                disabled={loadingBrands}
                                required
                              >
                                <option value="">
                                  {loadingBrands ? "Loading brands..." : "Select Brand"}
                                </option>
                                {availableBrandOptions.map((brand) => (
                                  <option key={brand} value={brand}>
                                    {brand}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-md-5">
                              <input
                                className="form-control form-control-sm"
                                value={vendorCode.code}
                                onChange={(event) =>
                                  handleEditVendorCodeChange(idx, "code", event.target.value)
                                }
                                placeholder="Vendor code"
                                required
                              />
                            </div>
                            <div className="col-md-2 text-end">
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm p-1 px-2"
                                onClick={() => removeEditVendorCode(idx)}
                                disabled={normalizeVendorCodeDraftRows(editForm.vendor_code).length <= 1}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Phone</label>
                      <input
                        name="phone"
                        className="form-control"
                        value={editForm.phone}
                        onChange={handleEditChange}
                      />
                    </div>

                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Country</label>
                      <select
                        name="country"
                        className="form-select"
                        value={editForm.country}
                        onChange={handleEditChange}
                      >
                        <option value="">Select country</option>
                        {editCountryOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-md-6 d-flex align-items-end">
                      <div className="form-check mb-2">
                        <input
                          className="form-check-input"
                          id="edit-vendor-active"
                          name="is_active"
                          type="checkbox"
                          checked={editForm.is_active}
                          onChange={handleEditChange}
                        />
                        <label className="form-check-label fw-semibold" htmlFor="edit-vendor-active">
                          Active Status
                        </label>
                      </div>
                    </div>

                    <div className="col-12">
                      <label className="form-label fw-semibold">Address</label>
                      <textarea
                        name="address"
                        rows="2"
                        className="form-control"
                        value={editForm.address}
                        onChange={handleEditChange}
                      />
                    </div>

                    {/* Contact Persons Section */}
                    <div className="col-12 pt-2 border-top">
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <label className="form-label fw-semibold mb-0">Contact Persons</label>
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={addEditContactPerson}
                        >
                          + Add Contact
                        </button>
                      </div>

                      {editForm.contact_person.map((contact, idx) => (
                        <div className="row g-2 align-items-center mb-2 bg-light p-2 rounded border" key={`edit-cp-${idx}`}>
                          <div className="col-md-3">
                            <input
                              className="form-control form-control-sm"
                              placeholder="Name"
                              value={contact.name}
                              onChange={(e) => handleEditContactChange(idx, "name", e.target.value)}
                            />
                          </div>
                          <div className="col-md-3">
                            <input
                              type="email"
                              className="form-control form-control-sm"
                              placeholder="Email"
                              value={contact.email}
                              onChange={(e) => handleEditContactChange(idx, "email", e.target.value)}
                            />
                          </div>
                          <div className="col-md-3">
                            <input
                              className="form-control form-control-sm"
                              placeholder="Phone"
                              value={contact.phone}
                              onChange={(e) => handleEditContactChange(idx, "phone", e.target.value)}
                            />
                          </div>
                          <div className="col-md-2">
                            <select
                              className="form-select form-select-sm"
                              value={normalizeContactPersonType(contact.type)}
                              onChange={(e) => handleEditContactChange(idx, "type", e.target.value)}
                            >
                              {CONTACT_PERSON_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-md-1 text-end">
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm p-1 px-2"
                              onClick={() => removeEditContactPerson(idx)}
                              disabled={editForm.contact_person.length <= 1}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="modal-footer bg-light">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCloseEditModal}
                    disabled={savingEdit}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                    {savingEdit ? "Saving Changes..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default VendorDetails;
