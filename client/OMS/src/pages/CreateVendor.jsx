import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
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

const initialForm = {
  name: "",
  owner_name: "",
  email: "",
  phone: "",
  country: "",
  address: "",
  vendor_code: [{ ...emptyVendorCode }],
  contact_person: [{ name: "", email: "", phone: "", type: "merchant" }],
  is_active: true,
};

const CONTACT_PERSON_TYPE_OPTIONS = [
  { value: "merchant", label: "Merchant" },
  { value: "shipment", label: "Shipment" },
];
const VENDOR_COUNTRY_OPTIONS = getCountryOptions();

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

const CreateVendor = () => {
  const { hasPermission } = usePermissions();
  const canCreateVendors = hasPermission("vendors", "create");
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [loadingVendors, setLoadingVendors] = useState(true);
  const [vendorSearch, setVendorSearch] = useState("");
  const [brandOptions, setBrandOptions] = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(true);

  const loadVendors = useCallback(async () => {
    if (!canCreateVendors) return;

    setLoadingVendors(true);
    try {
      const response = await api.get("/vendors");
      setVendors(Array.isArray(response?.data?.data) ? response.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load vendors.");
      setVendors([]);
    } finally {
      setLoadingVendors(false);
    }
  }, [canCreateVendors]);

  const loadBrandOptions = useCallback(async () => {
    if (!canCreateVendors) return;

    setLoadingBrands(true);
    try {
      const response = await api.get("/vendors/brand-options");
      setBrandOptions(normalizeBrandOptions(response?.data?.data));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load brand options.");
      setBrandOptions([]);
    } finally {
      setLoadingBrands(false);
    }
  }, [canCreateVendors]);

  useEffect(() => {
    loadVendors();
    loadBrandOptions();
  }, [loadBrandOptions, loadVendors]);

  const filteredVendors = useMemo(() => {
    const search = vendorSearch.trim().toLowerCase();
    if (!search) return vendors;

    return vendors.filter((vendor) =>
      [
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
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(search)),
    );
  }, [vendorSearch, vendors]);

  if (!canCreateVendors) {
    return <Navigate to="/" replace />;
  }

  const handleChange = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleVendorCodeChange = (index, field, value) => {
    setForm((prev) => {
      const vendorCodes = normalizeVendorCodeDraftRows(prev.vendor_code).map((entry) => ({ ...entry }));
      vendorCodes[index] = {
        ...(vendorCodes[index] || emptyVendorCode),
        [field]: value,
      };
      return { ...prev, vendor_code: vendorCodes };
    });
  };

  const addVendorCode = () => {
    setForm((prev) => ({
      ...prev,
      vendor_code: [...normalizeVendorCodeDraftRows(prev.vendor_code), { ...emptyVendorCode }],
    }));
  };

  const removeVendorCode = (index) => {
    setForm((prev) => {
      const vendorCodes = normalizeVendorCodeDraftRows(prev.vendor_code).filter(
        (_, vendorCodeIndex) => vendorCodeIndex !== index,
      );
      return {
        ...prev,
        vendor_code: vendorCodes.length > 0 ? vendorCodes : [{ ...emptyVendorCode }],
      };
    });
  };

  const handleContactChange = (index, field, value) => {
    setForm((prev) => {
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

  const addContactPerson = () => {
    setForm((prev) => ({
      ...prev,
      contact_person: [
        ...(Array.isArray(prev.contact_person) ? prev.contact_person : []),
        { ...emptyContactPerson },
      ],
    }));
  };

  const removeContactPerson = (index) => {
    setForm((prev) => {
      const contacts = (Array.isArray(prev.contact_person) ? prev.contact_person : [])
        .filter((_, contactIndex) => contactIndex !== index);
      return {
        ...prev,
        contact_person: contacts.length > 0 ? contacts : [{ ...emptyContactPerson }],
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const vendorCodePayload = getCompleteVendorCodes(form.vendor_code);

    if (!form.name.trim() || vendorCodePayload.length === 0) {
      setError("Name and at least one vendor code are required.");
      return;
    }
    if (hasIncompleteVendorCodeRows(form.vendor_code)) {
      setError("Select a brand and enter a code for every vendor code row.");
      return;
    }
    if (hasDuplicateVendorCodeRows(form.vendor_code)) {
      setError("Duplicate brand and vendor code rows are not allowed.");
      return;
    }

    const contactPersonPayload = normalizeContactPersons(form.contact_person);

    try {
      setSaving(true);
      await api.post("/vendors", {
        name: form.name.trim(),
        owner_name: form.owner_name.trim() || undefined,
        email: form.email.trim(),
        phone: form.phone.trim(),
        country: form.country.trim() || undefined,
        address: form.address.trim() || undefined,
        vendor_code: vendorCodePayload,
        contact_person: contactPersonPayload,
        is_active: form.is_active,
      });
      setSuccess("Vendor created successfully.");
      setForm({
        ...initialForm,
        vendor_code: [{ ...emptyVendorCode }],
        contact_person: [{ ...emptyContactPerson }],
      });
      await loadVendors();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create vendor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Navbar />

      <div className="page-shell py-3">
        <div className="card om-card shadow-sm">
          <div className="card-body p-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => navigate(-1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => navigate("/vendors")}
                >
                  View Vendor Details
                </button>
              </div>
              <h2 className="h4 mb-0">Create Vendor</h2>
            </div>

            <p className="text-secondary mb-4">Create a vendor master record</p>

            {error && <div className="alert alert-danger py-2">{error}</div>}
            {success && <div className="alert alert-success py-2">{success}</div>}

            <form className="row g-3" onSubmit={handleSubmit}>
              <div className="col-md-6">
                <label className="form-label">Name *</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Vendor name"
                  required
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Owner Name</label>
                <input
                  name="owner_name"
                  value={form.owner_name}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Owner name"
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Email</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Email address"
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Phone</label>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Phone number"
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Country</label>
                <select
                  name="country"
                  value={form.country}
                  onChange={handleChange}
                  className="form-select"
                >
                  <option value="">Select country</option>
                  {VENDOR_COUNTRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-12">
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                  <label className="form-label mb-0">Vendor Codes *</label>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={addVendorCode}
                  >
                    Add Code
                  </button>
                </div>

                {normalizeVendorCodeDraftRows(form.vendor_code).map((vendorCode, index) => {
                  const availableBrandOptions = getAvailableBrandOptions(
                    brandOptions,
                    vendorCode.brand,
                  );

                  return (
                    <div className="row g-2 align-items-end mb-2" key={`vendor-code-${index}`}>
                      <div className="col-md-5">
                        <select
                          className="form-select"
                          value={vendorCode.brand}
                          onChange={(event) =>
                            handleVendorCodeChange(index, "brand", event.target.value)
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
                          className="form-control"
                          value={vendorCode.code}
                          onChange={(event) =>
                            handleVendorCodeChange(index, "code", event.target.value)
                          }
                          placeholder="Vendor code"
                          required
                        />
                      </div>
                      <div className="col-md-auto d-grid">
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => removeVendorCode(index)}
                          disabled={normalizeVendorCodeDraftRows(form.vendor_code).length <= 1}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="col-md-6">
                <label className="form-label">Address</label>
                <textarea
                  name="address"
                  rows="3"
                  value={form.address}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Vendor address"
                />
              </div>

              <div className="col-md-6 d-flex align-items-end">
                <div className="form-check mb-2">
                  <input
                    className="form-check-input"
                    id="vendor-is-active"
                    name="is_active"
                    type="checkbox"
                    checked={form.is_active}
                    onChange={handleChange}
                  />
                  <label className="form-check-label" htmlFor="vendor-is-active">
                    Active vendor
                  </label>
                </div>
              </div>

              <div className="col-12">
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                  <label className="form-label mb-0">Contact Persons</label>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={addContactPerson}
                  >
                    Add Contact
                  </button>
                </div>

                {(Array.isArray(form.contact_person) ? form.contact_person : []).map(
                  (contact, index) => (
                    <div className="row g-2 align-items-end mb-2" key={`contact-${index}`}>
                      <div className="col-md-3">
                        <input
                          className="form-control"
                          value={contact.name}
                          onChange={(event) =>
                            handleContactChange(index, "name", event.target.value)
                          }
                          placeholder="Contact name"
                        />
                      </div>
                      <div className="col-md-3">
                        <input
                          className="form-control"
                          type="email"
                          value={contact.email}
                          onChange={(event) =>
                            handleContactChange(index, "email", event.target.value)
                          }
                          placeholder="Contact email"
                        />
                      </div>
                      <div className="col-md-2">
                        <input
                          className="form-control"
                          value={contact.phone}
                          onChange={(event) =>
                            handleContactChange(index, "phone", event.target.value)
                          }
                          placeholder="Contact phone"
                        />
                      </div>
                      <div className="col-md-2">
                        <select
                          className="form-select"
                          value={normalizeContactPersonType(contact.type)}
                          onChange={(event) =>
                            handleContactChange(index, "type", event.target.value)
                          }
                        >
                          {CONTACT_PERSON_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-md-auto d-grid">
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => removeContactPerson(index)}
                          disabled={
                            !Array.isArray(form.contact_person) ||
                            form.contact_person.length <= 1
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>

              <div className="col-12 d-flex justify-content-end">
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? "Creating..." : "Create Vendor"}
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="card om-card shadow-sm mt-3">
          <div className="card-body p-4">
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
              <div>
                <h3 className="h5 mb-1">Current Vendors</h3>
                <p className="text-secondary mb-0">
                  {vendors.length} vendor{vendors.length === 1 ? "" : "s"} available.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={loadVendors}
                disabled={loadingVendors}
              >
                Refresh
              </button>
            </div>

            <div className="row g-3 mb-3">
              <div className="col-md-5">
                <input
                  type="search"
                  className="form-control"
                  placeholder="Search vendors"
                  value={vendorSearch}
                  onChange={(event) => setVendorSearch(event.target.value)}
                />
              </div>
            </div>

            {loadingVendors ? (
              <div className="text-center text-secondary py-3">Loading vendors...</div>
            ) : filteredVendors.length === 0 ? (
              <div className="text-center text-secondary py-3">No vendors found.</div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Owner Name</th>
                      <th>Vendor Codes</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Country</th>
                      <th>Contact Persons</th>
                      <th>Status</th>
                      <th>Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendors.map((vendor) => (
                      <tr key={vendor._id || `${vendor.name}-${vendor.email}`}>
                        <td className="fw-semibold">{vendor.name || "N/A"}</td>
                        <td>{vendor.owner_name || "N/A"}</td>
                        <td>{formatVendorCodes(vendor.vendor_code) || "N/A"}</td>
                        <td>{vendor.email || "N/A"}</td>
                        <td>{vendor.phone || "N/A"}</td>
                        <td>
                          <span className="badge bg-light text-dark border">
                            {vendor.country || "Unspecified"}
                          </span>
                        </td>
                        <td>
                          {Array.isArray(vendor.contact_person) &&
                          vendor.contact_person.length > 0
                            ? vendor.contact_person
                                .map((contact) =>
                                  [
                                    contact?.name,
                                    contact?.email,
                                    contact?.phone,
                                    contact?.type
                                      ? `Type: ${getContactPersonTypeLabel(contact.type)}`
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" / "),
                                )
                                .filter(Boolean)
                                .join(", ")
                            : "N/A"}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              vendor.is_active === false ? "bg-secondary" : "bg-success"
                            }`}
                          >
                            {vendor.is_active === false ? "Inactive" : "Active"}
                          </span>
                        </td>
                        <td>{vendor.address || "N/A"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default CreateVendor;
