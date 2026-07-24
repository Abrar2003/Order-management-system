import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import api from "../api/axios";
import { getSessionUser } from "./auth.service";
import { isAdminLikeRole, normalizeUserRole } from "./permissions";

const PermissionContext = createContext({
  permissions: {},
  permissionMeta: null,
  loading: true,
  error: "",
  isAdmin: false,
  canEditPis: false,
  hasPermission: () => false,
  refreshPermissions: async () => {},
});

const PUBLIC_AUTH_PATHS = new Set(["/signin"]);

export const PermissionProvider = ({ children }) => {
  const location = useLocation();
  const [permissions, setPermissions] = useState({});
  const [permissionMeta, setPermissionMeta] = useState(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshPermissions = useCallback(async () => {
    setLoading(true);
    let user = null;
    try {
      user = await getSessionUser();
    } catch {
      user = null;
    }
    const normalizedRole = normalizeUserRole(user?.role);
    setRole(normalizedRole);

    if (!user) {
      setPermissions({});
      setPermissionMeta(null);
      setError("");
      setLoading(false);
      return;
    }

    setError("");
    try {
      const response = await api.get("/permissions/me");
      setPermissions(response?.data?.permissions || {});
      setPermissionMeta(response?.data?.meta || null);
      setRole(normalizeUserRole(response?.data?.role || normalizedRole));
    } catch (fetchError) {
      setPermissions({});
      setPermissionMeta(null);
      setError(
        fetchError?.response?.data?.message ||
          fetchError?.message ||
          "Failed to load permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (PUBLIC_AUTH_PATHS.has(location.pathname)) {
      setPermissions({});
      setPermissionMeta(null);
      setRole("");
      setError("");
      setLoading(false);
      return;
    }

    refreshPermissions();
  }, [location.pathname, refreshPermissions]);

  const hasPermission = useCallback(
    (moduleName, action) => {
      const moduleKey = String(moduleName || "").trim();
      const actionKey = String(action || "").trim();
      if (!moduleKey || !actionKey) return false;
      return Boolean(permissions?.[moduleKey]?.[actionKey]);
    },
    [permissions],
  );

  const canEditPis = Boolean(
    permissions?.pis?.edit ||
    permissions?.pis?.upload,
  );

  const value = useMemo(
    () => ({
      permissions,
      permissionMeta,
      loading,
      error,
      role,
      isAdmin: isAdminLikeRole(role),
      canEditPis,
      hasPermission,
      refreshPermissions,
    }),
    [
      canEditPis,
      error,
      hasPermission,
      loading,
      permissionMeta,
      permissions,
      refreshPermissions,
      role,
    ],
  );

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
};

export const usePermissions = () => useContext(PermissionContext);
