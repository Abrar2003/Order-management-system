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
import { getToken, getUserFromToken } from "./auth.service";
import { isAdminLikeRole, normalizeUserRole } from "./permissions";

const PermissionContext = createContext({
  permissions: {},
  permissionMeta: null,
  loading: false,
  error: "",
  isAdmin: false,
  canEditPis: false,
  hasPermission: () => false,
  refreshPermissions: async () => {},
});

const isPisMutation = (action) =>
  ["create", "edit", "delete", "approve", "upload", "sync", "manage"].includes(action);

export const PermissionProvider = ({ children }) => {
  const location = useLocation();
  const [permissions, setPermissions] = useState({});
  const [permissionMeta, setPermissionMeta] = useState(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshPermissions = useCallback(async () => {
    const token = getToken();
    const user = getUserFromToken();
    const normalizedRole = normalizeUserRole(user?.role);
    setRole(normalizedRole);

    if (!token) {
      setPermissions({});
      setPermissionMeta(null);
      setError("");
      return;
    }

    setLoading(true);
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
    refreshPermissions();
  }, [location.pathname, refreshPermissions]);

  const hasPermission = useCallback(
    (moduleName, action) => {
      const moduleKey = String(moduleName || "").trim();
      const actionKey = String(action || "").trim();
      if (!moduleKey || !actionKey) return false;
      if (moduleKey === "pis" && isPisMutation(actionKey)) {
        return isAdminLikeRole(role);
      }
      return Boolean(permissions?.[moduleKey]?.[actionKey]);
    },
    [permissions, role],
  );

  const value = useMemo(
    () => ({
      permissions,
      permissionMeta,
      loading,
      error,
      role,
      isAdmin: isAdminLikeRole(role),
      canEditPis: isAdminLikeRole(role),
      hasPermission,
      refreshPermissions,
    }),
    [
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
