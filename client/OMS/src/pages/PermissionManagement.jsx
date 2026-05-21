import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { isAdminLikeRole, ROLE_LABELS } from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";

const formatActionLabel = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const clonePermissions = (permissions = {}) =>
  JSON.parse(JSON.stringify(permissions || {}));

const ALL_VENDOR_TOKEN = "all";

const cloneAccess = (access = {}) => ({
  all_brands: Boolean(access?.all_brands ?? true),
  allowed_brand_ids: Array.isArray(access?.allowed_brand_ids)
    ? access.allowed_brand_ids.map((id) => String(id))
    : [],
  all_vendors: Boolean(access?.all_vendors ?? true),
  allowed_vendors: Array.isArray(access?.allowed_vendors)
    ? access.allowed_vendors.map((vendor) => String(vendor))
    : [ALL_VENDOR_TOKEN],
});

const ADMIN_PERMISSION_MIRROR_ROLES = new Set([
  "manager",
  "product_manager",
  "inspection_manager",
]);

const PermissionManagement = () => {
  const { isAdmin, refreshPermissions } = usePermissions();
  const [roles, setRoles] = useState([]);
  const [meta, setMeta] = useState({ modules: [], actions: [], locked: {} });
  const [selectedRole, setSelectedRole] = useState("admin");
  const [draftPermissions, setDraftPermissions] = useState({});
  const [moduleSearch, setModuleSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [accessUsers, setAccessUsers] = useState([]);
  const [brandOptions, setBrandOptions] = useState([]);
  const [vendorOptions, setVendorOptions] = useState([]);
  const [selectedAccessUserId, setSelectedAccessUserId] = useState("");
  const [accessDraft, setAccessDraft] = useState(cloneAccess());
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessSaving, setAccessSaving] = useState(false);

  const selectedRoleRecord = useMemo(
    () => roles.find((entry) => entry.role === selectedRole) || null,
    [roles, selectedRole],
  );
  const isAdminMirrorRole = ADMIN_PERMISSION_MIRROR_ROLES.has(selectedRole);
  const selectedRoleLabel = ROLE_LABELS[selectedRole] || selectedRole || "This role";
  const selectedAccessUser = useMemo(
    () => accessUsers.find((user) => user._id === selectedAccessUserId) || null,
    [accessUsers, selectedAccessUserId],
  );

  const filteredModules = useMemo(() => {
    const search = moduleSearch.trim().toLowerCase();
    const modules = Array.isArray(meta?.modules) ? meta.modules : [];
    if (!search) return modules;
    return modules.filter((module) =>
      `${module?.key || ""} ${module?.label || ""}`.toLowerCase().includes(search),
    );
  }, [meta?.modules, moduleSearch]);

  const isLockedCell = useCallback(
    (moduleKey, action) => {
      if (isAdminMirrorRole) return true;
      if (isAdminLikeRole(selectedRole)) return false;
      const lockMeta = meta?.locked?.[moduleKey];
      return Array.isArray(lockMeta?.actions) && lockMeta.actions.includes(action);
    },
    [isAdminMirrorRole, meta?.locked, selectedRole],
  );

  const getLockMessage = useCallback(
    (moduleKey) =>
      isAdminMirrorRole
        ? `${selectedRoleLabel} follows Admin permissions.`
        : meta?.locked?.[moduleKey]?.message || "",
    [isAdminMirrorRole, meta?.locked, selectedRoleLabel],
  );

  const loadPermissions = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await api.get("/permissions");
      const nextRoles = response?.data?.roles || [];
      setRoles(nextRoles);
      setMeta(response?.data?.meta || { modules: [], actions: [], locked: {} });
      const firstRole = nextRoles.find((entry) => entry.role === selectedRole)
        || nextRoles[0]
        || null;
      if (firstRole?.role) {
        setSelectedRole(firstRole.role);
        setDraftPermissions(clonePermissions(firstRole.permissions));
      }
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message ||
          loadError?.message ||
          "Failed to load permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin, selectedRole]);

  const loadUserAccess = useCallback(async () => {
    if (!isAdmin) {
      setAccessLoading(false);
      return;
    }

    setAccessLoading(true);
    setError("");
    try {
      const response = await api.get("/permissions/users/access");
      const users = response?.data?.users || [];
      setAccessUsers(users);
      setBrandOptions(response?.data?.brands || []);
      setVendorOptions(response?.data?.vendors || []);
      setSelectedAccessUserId((current) => {
        const nextSelected =
          users.find((user) => user._id === current) || users[0] || null;
        if (nextSelected?._id) {
          setAccessDraft(cloneAccess(nextSelected.data_access));
          return nextSelected._id;
        }
        setAccessDraft(cloneAccess());
        return "";
      });
    } catch (loadError) {
      setError(
        loadError?.response?.data?.message ||
          loadError?.message ||
          "Failed to load user data access.",
      );
    } finally {
      setAccessLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  useEffect(() => {
    loadUserAccess();
  }, [loadUserAccess]);

  useEffect(() => {
    if (selectedRoleRecord) {
      setDraftPermissions(clonePermissions(selectedRoleRecord.permissions));
    }
  }, [selectedRoleRecord]);

  useEffect(() => {
    if (selectedAccessUser) {
      setAccessDraft(cloneAccess(selectedAccessUser.data_access));
    }
  }, [selectedAccessUser]);

  const updateRoleRecord = useCallback((updatedRole) => {
    setRoles((prev) =>
      prev.map((entry) => (entry.role === updatedRole.role ? updatedRole : entry)),
    );
    setDraftPermissions(clonePermissions(updatedRole.permissions));
  }, []);

  const handleToggle = (moduleKey, action) => {
    if (isLockedCell(moduleKey, action)) return;
    setDraftPermissions((prev) => ({
      ...prev,
      [moduleKey]: {
        ...(prev?.[moduleKey] || {}),
        [action]: !Boolean(prev?.[moduleKey]?.[action]),
      },
    }));
  };

  const handleSave = async () => {
    if (!window.confirm(`Save permissions for ${ROLE_LABELS[selectedRole] || selectedRole}?`)) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.patch(`/permissions/${selectedRole}`, {
        permissions: draftPermissions,
      });
      updateRoleRecord(response?.data?.role);
      await refreshPermissions();
      setSuccess("Permissions saved successfully.");
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message ||
          saveError?.message ||
          "Failed to save permissions.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset ${ROLE_LABELS[selectedRole] || selectedRole} to default rights?`)) {
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(`/permissions/reset/${selectedRole}`);
      updateRoleRecord(response?.data?.role);
      await refreshPermissions();
      setSuccess("Permissions reset to defaults.");
    } catch (resetError) {
      setError(
        resetError?.response?.data?.message ||
          resetError?.message ||
          "Failed to reset permissions.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshAll = () => {
    loadPermissions();
    loadUserAccess();
  };

  const toggleBrandAccess = (brandId) => {
    setAccessDraft((prev) => {
      const current = new Set(prev.allowed_brand_ids || []);
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
    setAccessDraft((prev) => {
      const current = new Set(
        (prev.allowed_vendors || []).filter((vendor) => vendor !== ALL_VENDOR_TOKEN),
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

  const handleSaveUserAccess = async () => {
    if (!selectedAccessUserId) return;

    if (!accessDraft.all_brands && accessDraft.allowed_brand_ids.length === 0) {
      setError("Select at least one brand or keep All brands enabled.");
      return;
    }
    if (!accessDraft.all_vendors && accessDraft.allowed_vendors.length === 0) {
      setError("Select at least one vendor or keep All vendors enabled.");
      return;
    }

    setAccessSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.patch(`/permissions/users/${selectedAccessUserId}/access`, {
        all_brands: accessDraft.all_brands,
        allowed_brand_ids: accessDraft.all_brands ? [] : accessDraft.allowed_brand_ids,
        all_vendors: accessDraft.all_vendors,
        allowed_vendors: accessDraft.all_vendors
          ? [ALL_VENDOR_TOKEN]
          : accessDraft.allowed_vendors,
      });
      const updatedUser = response?.data?.user;
      setAccessUsers((prev) =>
        prev.map((user) => (user._id === updatedUser?._id ? updatedUser : user)),
      );
      if (updatedUser?._id) {
        setAccessDraft(cloneAccess(updatedUser.data_access));
      }
      setSuccess("User data access saved successfully.");
    } catch (saveError) {
      setError(
        saveError?.response?.data?.message ||
          saveError?.message ||
          "Failed to save user data access.",
      );
    } finally {
      setAccessSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="page-shell py-4">
        <div className="alert alert-danger">
          Permission management is admin-only.
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell py-4">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
        <div>
          <p className="text-uppercase text-secondary fw-semibold small mb-1">
            Settings
          </p>
          <h2 className="h4 mb-1">Rights Management</h2>
          <p className="text-secondary mb-0">
            Manage role-level access. Inspection Manager mirrors the current Admin
            rights, with PIS Diffs editing kept unavailable on that page.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={handleRefreshAll}
          disabled={loading || saving || accessLoading || accessSaving}
        >
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card om-card shadow-sm mb-3">
        <div className="card-body">
          <div className="d-flex flex-wrap justify-content-between gap-3">
            <div className="btn-group flex-wrap" role="group" aria-label="Role tabs">
              {roles.map((roleEntry) => (
                <button
                  key={roleEntry.role}
                  type="button"
                  className={`btn ${
                    selectedRole === roleEntry.role ? "btn-primary" : "btn-outline-primary"
                  }`}
                  onClick={() => setSelectedRole(roleEntry.role)}
                  disabled={saving}
                >
                  {ROLE_LABELS[roleEntry.role] || roleEntry.role}
                </button>
              ))}
            </div>

            <div className="rights-management-search">
              <input
                type="search"
                className="form-control"
                placeholder="Search module"
                value={moduleSearch}
                onChange={(event) => setModuleSearch(event.target.value)}
              />
            </div>
          </div>

          {selectedRoleRecord?.updated_at && (
            <div className="text-secondary small mt-3">
              Last updated by {selectedRoleRecord?.updated_by?.name || "N/A"} on{" "}
              {new Date(selectedRoleRecord.updated_at).toLocaleString()}
            </div>
          )}
          {isAdminMirrorRole ? (
            <div className="alert alert-info py-2 mt-3 mb-0">
              {selectedRoleLabel} follows Admin permissions. Update Admin rights to
              change this role.
            </div>
          ) : isAdminLikeRole(selectedRole) && (
            <div className="alert alert-warning py-2 mt-3 mb-0">
              Admin permission changes are powerful. If you disable an admin action here,
              backend permission checks can deny it even to admins.
            </div>
          )}
        </div>
      </div>

      <div className="card om-card shadow-sm">
        <div className="card-body p-0">
          {loading ? (
            <div className="p-4 text-center text-secondary">Loading permissions...</div>
          ) : filteredModules.length === 0 ? (
            <div className="p-4 text-center text-secondary">No permission modules found.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0 rights-management-table">
                <thead>
                  <tr>
                    <th className="text-nowrap">Module</th>
                    {(meta?.actions || []).map((action) => (
                      <th key={action} className="text-center text-nowrap">
                        {formatActionLabel(action)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredModules.map((module) => (
                    <tr key={module.key}>
                      <th scope="row">
                        <div>{module.label}</div>
                        {meta?.locked?.[module.key] &&
                          !isAdminLikeRole(selectedRole) && (
                            <div className="small text-secondary">
                              {getLockMessage(module.key)}
                            </div>
                          )}
                      </th>
                      {(meta?.actions || []).map((action) => {
                        const locked = isLockedCell(module.key, action);
                        const checked = Boolean(draftPermissions?.[module.key]?.[action]);
                        return (
                          <td key={`${module.key}-${action}`} className="text-center">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={checked}
                              disabled={saving || locked}
                              title={locked ? getLockMessage(module.key) : ""}
                              onChange={() => handleToggle(module.key, action)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card-footer d-flex flex-wrap justify-content-between gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={handleReset}
            disabled={loading || saving || !selectedRole || isAdminMirrorRole}
          >
            Reset to Default
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={loading || saving || !selectedRole || isAdminMirrorRole}
          >
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
      </div>

      <div className="card om-card shadow-sm mt-3">
        <div className="card-body">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
            <div>
              <h3 className="h5 mb-1">User Data Access</h3>
              <p className="text-secondary mb-0">
                Assign brand and vendor access for each user.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSaveUserAccess}
              disabled={accessLoading || accessSaving || !selectedAccessUserId}
            >
              {accessSaving ? "Saving..." : "Save User Access"}
            </button>
          </div>

          {accessLoading ? (
            <div className="text-center text-secondary py-3">Loading user access...</div>
          ) : accessUsers.length === 0 ? (
            <div className="text-center text-secondary py-3">No users found.</div>
          ) : (
            <>
              <div className="row g-3 align-items-end mb-3">
                <div className="col-md-6 col-lg-4">
                  <label className="form-label">User</label>
                  <select
                    className="form-select"
                    value={selectedAccessUserId}
                    onChange={(event) => setSelectedAccessUserId(event.target.value)}
                    disabled={accessSaving}
                  >
                    {accessUsers.map((user) => (
                      <option key={user._id} value={user._id}>
                        {user.name || user.username} ({ROLE_LABELS[user.role] || user.role})
                      </option>
                    ))}
                  </select>
                </div>
                {selectedAccessUser && (
                  <div className="col-md-6 text-secondary small">
                    {selectedAccessUser.email || selectedAccessUser.username}
                  </div>
                )}
              </div>

              <div className="row g-3">
                <div className="col-lg-6">
                  <div className="data-access-panel">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h4 className="h6 mb-0">Brands</h4>
                      <label className="form-check form-switch mb-0">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={accessDraft.all_brands}
                          onChange={(event) =>
                            setAccessDraft((prev) => ({
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
                      {brandOptions.length === 0 ? (
                        <div className="text-secondary small">No brands found.</div>
                      ) : (
                        brandOptions.map((brand) => (
                          <label key={brand._id} className="form-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={
                                accessDraft.all_brands ||
                                accessDraft.allowed_brand_ids.includes(String(brand._id))
                              }
                              disabled={accessDraft.all_brands || accessSaving}
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
                      <h4 className="h6 mb-0">Vendors</h4>
                      <label className="form-check form-switch mb-0">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={accessDraft.all_vendors}
                          onChange={(event) =>
                            setAccessDraft((prev) => ({
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
                      {vendorOptions.length === 0 ? (
                        <div className="text-secondary small">No vendors found.</div>
                      ) : (
                        vendorOptions.map((vendor) => (
                          <label key={vendor._id} className="form-check">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={
                                accessDraft.all_vendors ||
                                accessDraft.allowed_vendors.includes(vendor.name)
                              }
                              disabled={accessDraft.all_vendors || accessSaving}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PermissionManagement;
