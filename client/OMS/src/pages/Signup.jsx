import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { USER_ROLE_OPTIONS } from "../auth/permissions";
import Navbar from "../components/Navbar";
import { usePermissions } from "../auth/PermissionContext";
import "../App.css";

const ALL_VENDOR_TOKEN = "all";

const Signup = () => {
  const { hasPermission } = usePermissions();
  const canCreateUsers = hasPermission("users", "create");
  const navigate = useNavigate();
  const roles = useMemo(() => USER_ROLE_OPTIONS, []);

  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
    phone: "",
    role: "user",
  });

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [brandOptions, setBrandOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [access, setAccess] = useState({
    all_brands: true,
    allowed_brand_ids: [],
    all_vendors: true,
    allowed_vendors: [ALL_VENDOR_TOKEN],
  });

  useEffect(() => {
    if (!canCreateUsers) return;

    let cancelled = false;
    const loadAccessOptions = async () => {
      setOptionsLoading(true);
      try {
        const response = await api.get("/permissions/users/access");
        if (cancelled) return;
        setBrandOptions(response?.data?.brands || []);
        setVendorOptions(response?.data?.vendors || []);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError?.response?.data?.message ||
              loadError?.message ||
              "Failed to load brand and vendor access options.",
          );
        }
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    };

    loadAccessOptions();

    return () => {
      cancelled = true;
    };
  }, [canCreateUsers]);

  if (!canCreateUsers) {
    return <Navigate to="/" replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.username || !form.password || !form.name || !form.email) {
      setError("Please fill all required fields.");
      return;
    }

    if (!access.all_brands && access.allowed_brand_ids.length === 0) {
      setError("Select at least one brand or keep All brands enabled.");
      return;
    }

    if (!access.all_vendors && access.allowed_vendors.length === 0) {
      setError("Select at least one vendor or keep All vendors enabled.");
      return;
    }

    try {
      setSaving(true);
      await api.post("/users", {
        username: form.username.trim(),
        password: form.password,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        role: form.role,
        all_brands: access.all_brands,
        allowed_brand_ids: access.all_brands ? [] : access.allowed_brand_ids,
        all_vendors: access.all_vendors,
        allowed_vendors: access.all_vendors ? [ALL_VENDOR_TOKEN] : access.allowed_vendors,
      });

      setSuccess("User created successfully.");
      setForm({
        username: "",
        password: "",
        name: "",
        email: "",
        phone: "",
        role: "user",
      });
      setAccess({
        all_brands: true,
        allowed_brand_ids: [],
        all_vendors: true,
        allowed_vendors: [ALL_VENDOR_TOKEN],
      });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  };

  const toggleBrandAccess = (brandId) => {
    setAccess((prev) => {
      const current = new Set(prev.allowed_brand_ids);
      if (current.has(brandId)) current.delete(brandId);
      else current.add(brandId);
      return {
        ...prev,
        all_brands: false,
        allowed_brand_ids: Array.from(current),
      };
    });
  };

  const toggleVendorAccess = (vendorName) => {
    setAccess((prev) => {
      const current = new Set(
        prev.allowed_vendors.filter((vendor) => vendor !== ALL_VENDOR_TOKEN),
      );
      if (current.has(vendorName)) current.delete(vendorName);
      else current.add(vendorName);
      return {
        ...prev,
        all_vendors: false,
        allowed_vendors: Array.from(current),
      };
    });
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
              <h2 className="h4 mb-0">Create User</h2>
            </div>

            <p className="text-secondary mb-4">Admin-only user creation</p>

            {error && <div className="alert alert-danger py-2">{error}</div>}
            {success && <div className="alert alert-success py-2">{success}</div>}

            <form className="row g-3" onSubmit={handleSubmit}>
              <div className="col-md-6">
                <label className="form-label">Username *</label>
                <input
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Username"
                  required
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Password *</label>
                <input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Password"
                  required
                />
              </div>

              <div className="col-md-6">
                <label className="form-label">Name *</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Full name"
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
                <label className="form-label">Role</label>
                <select name="role" value={form.role} onChange={handleChange} className="form-select">
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-12">
                <div className="row g-3">
                  <div className="col-lg-6">
                    <div className="data-access-panel">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h3 className="h6 mb-0">Allowed Brands</h3>
                        <label className="form-check form-switch mb-0">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={access.all_brands}
                            disabled={optionsLoading || saving}
                            onChange={(event) =>
                              setAccess((prev) => ({
                                ...prev,
                                all_brands: event.target.checked,
                                allowed_brand_ids: event.target.checked
                                  ? []
                                  : prev.allowed_brand_ids,
                              }))
                            }
                          />
                          <span className="form-check-label">All</span>
                        </label>
                      </div>
                      <div className="data-access-options">
                        {optionsLoading ? (
                          <div className="text-secondary small">Loading brands...</div>
                        ) : brandOptions.length === 0 ? (
                          <div className="text-secondary small">No brands found.</div>
                        ) : (
                          brandOptions.map((brand) => (
                            <label key={brand._id} className="form-check">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={
                                  access.all_brands ||
                                  access.allowed_brand_ids.includes(String(brand._id))
                                }
                                disabled={access.all_brands || saving}
                                onChange={() => toggleBrandAccess(String(brand._id))}
                              />
                              <span className="form-check-label">{brand.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="col-lg-6">
                    <div className="data-access-panel">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h3 className="h6 mb-0">Allowed Vendors</h3>
                        <label className="form-check form-switch mb-0">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={access.all_vendors}
                            disabled={optionsLoading || saving}
                            onChange={(event) =>
                              setAccess((prev) => ({
                                ...prev,
                                all_vendors: event.target.checked,
                                allowed_vendors: event.target.checked
                                  ? [ALL_VENDOR_TOKEN]
                                  : prev.allowed_vendors.filter(
                                      (vendor) => vendor !== ALL_VENDOR_TOKEN,
                                    ),
                              }))
                            }
                          />
                          <span className="form-check-label">All</span>
                        </label>
                      </div>
                      <div className="data-access-options">
                        {optionsLoading ? (
                          <div className="text-secondary small">Loading vendors...</div>
                        ) : vendorOptions.length === 0 ? (
                          <div className="text-secondary small">No vendors found.</div>
                        ) : (
                          vendorOptions.map((vendor) => (
                            <label key={vendor._id} className="form-check">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={
                                  access.all_vendors ||
                                  access.allowed_vendors.includes(vendor.name)
                                }
                                disabled={access.all_vendors || saving}
                                onChange={() => toggleVendorAccess(vendor.name)}
                              />
                              <span className="form-check-label">{vendor.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 d-flex justify-content-end">
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? "Creating..." : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};

export default Signup;
