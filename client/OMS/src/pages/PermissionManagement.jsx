import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/axios";
import { usePermissions } from "../auth/PermissionContext";

const ROLE_LABELS = {
  admin: "Admin",
  manager: "Manager",
  user: "User",
  qc: "QC",
  dev: "Dev",
};

const formatActionLabel = (value = "") =>
  String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const clonePermissions = (permissions = {}) =>
  JSON.parse(JSON.stringify(permissions || {}));

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

  const selectedRoleRecord = useMemo(
    () => roles.find((entry) => entry.role === selectedRole) || null,
    [roles, selectedRole],
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
      if (selectedRole === "admin") return false;

      const pisLock = meta?.locked?.pis;
      const permissionsLock = meta?.locked?.permissions;

      if (
        moduleKey === "pis" &&
        Array.isArray(pisLock?.actions) &&
        pisLock.actions.includes(action)
      ) {
        return true;
      }

      if (
        moduleKey === "permissions" &&
        Array.isArray(permissionsLock?.actions) &&
        permissionsLock.actions.includes(action)
      ) {
        return true;
      }

      return false;
    },
    [meta?.locked, selectedRole],
  );

  const getLockMessage = useCallback(
    (moduleKey) => {
      if (moduleKey === "pis") {
        return meta?.locked?.pis?.message || "PIS mutation rights are admin-only.";
      }
      if (moduleKey === "permissions") {
        return meta?.locked?.permissions?.message || "Permission management is admin-only.";
      }
      return "";
    },
    [meta?.locked],
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

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  useEffect(() => {
    if (selectedRoleRecord) {
      setDraftPermissions(clonePermissions(selectedRoleRecord.permissions));
    }
  }, [selectedRoleRecord]);

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
            Manage role-level access. PIS mutation and permission-management stay admin-only.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={loadPermissions}
          disabled={loading || saving}
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
          {selectedRole === "admin" && (
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
                        {(module.key === "pis" || module.key === "permissions") &&
                          selectedRole !== "admin" && (
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
            disabled={loading || saving || !selectedRole}
          >
            Reset to Default
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={loading || saving || !selectedRole}
          >
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionManagement;
