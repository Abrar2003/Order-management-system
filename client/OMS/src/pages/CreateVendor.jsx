import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { usePermissions } from "../auth/PermissionContext";
import "../App.css";

const initialForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
  vendor_code: "",
  contact_person: [{ name: "", email: "", phone: "" }],
  is_active: true,
};

const emptyContactPerson = { name: "", email: "", phone: "" };

const normalizeContactPersons = (contacts = []) =>
  (Array.isArray(contacts) ? contacts : [])
    .map((contact) => ({
      name: String(contact?.name || "").trim(),
      email: String(contact?.email || "").trim(),
      phone: String(contact?.phone || "").trim(),
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

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  const filteredVendors = useMemo(() => {
    const search = vendorSearch.trim().toLowerCase();
    if (!search) return vendors;

    return vendors.filter((vendor) =>
      [
        vendor?.name,
        vendor?.vendor_code,
        vendor?.email,
        vendor?.phone,
        vendor?.address,
        vendor?.is_active === false ? "inactive" : "active",
        ...(Array.isArray(vendor?.contact_person)
          ? vendor.contact_person.flatMap((contact) => [
              contact?.name,
              contact?.email,
              contact?.phone,
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

    if (
      !form.name.trim() ||
      !form.email.trim() ||
      !form.phone.trim() ||
      !form.vendor_code.trim()
    ) {
      setError("Name, email, phone, and vendor code are required.");
      return;
    }

    const contactPersonPayload = normalizeContactPersons(form.contact_person);

    try {
      setSaving(true);
      await api.post("/vendors", {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim() || undefined,
        vendor_code: form.vendor_code.trim(),
        contact_person: contactPersonPayload,
        is_active: form.is_active,
      });
      setSuccess("Vendor created successfully.");
      setForm({
        ...initialForm,
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
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => navigate(-1)}
              >
                Back
              </button>
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
                <label className="form-label">Email *</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Email address"
                  required
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Vendor Code *</label>
                <input
                  name="vendor_code"
                  value={form.vendor_code}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Vendor code"
                  required
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Phone *</label>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Phone number"
                  required
                />
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
                      <div className="col-md-4">
                        <input
                          className="form-control"
                          value={contact.name}
                          onChange={(event) =>
                            handleContactChange(index, "name", event.target.value)
                          }
                          placeholder="Contact name"
                        />
                      </div>
                      <div className="col-md-4">
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
                      <div className="col-md-3">
                        <input
                          className="form-control"
                          value={contact.phone}
                          onChange={(event) =>
                            handleContactChange(index, "phone", event.target.value)
                          }
                          placeholder="Contact phone"
                        />
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
                      <th>Vendor Code</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Contact Persons</th>
                      <th>Status</th>
                      <th>Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendors.map((vendor) => (
                      <tr key={vendor._id || `${vendor.name}-${vendor.email}`}>
                        <td className="fw-semibold">{vendor.name || "N/A"}</td>
                        <td>{vendor.vendor_code || "N/A"}</td>
                        <td>{vendor.email || "N/A"}</td>
                        <td>{vendor.phone || "N/A"}</td>
                        <td>
                          {Array.isArray(vendor.contact_person) &&
                          vendor.contact_person.length > 0
                            ? vendor.contact_person
                                .map((contact) =>
                                  [
                                    contact?.name,
                                    contact?.email,
                                    contact?.phone,
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
