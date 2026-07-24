import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSessionUser } from "../auth/auth.service";
import { isQcAllowedPagePath, normalizeUserRole } from "../auth/permissions";
import { usePermissions } from "../auth/PermissionContext";

const BRAND_SCOPE_CHOICE_PATH = "/choose-brand-scope";

const ProtectedRoute = ({
  children,
  permissionModule = "",
  permissionAction = "view",
}) => {
  const location = useLocation();
  const {
    hasPermission,
    loading: permissionsLoading,
  } = usePermissions();
  const [state, setState] = useState({
    loading: true,
    user: null,
  });

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      try {
        const user = await getSessionUser();
        if (!cancelled) {
          setState({ loading: false, user });
        }
      } catch {
        if (!cancelled) {
          setState({ loading: false, user: null });
        }
      }
    };

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (state.loading) {
    return <div className="page-shell py-5 text-center">Loading...</div>;
  }

  if (!state.user) {
    return <Navigate to="/signin" replace />;
  }

  const isBrandScopeChoicePath = location.pathname === BRAND_SCOPE_CHOICE_PATH;

  if (
    normalizeUserRole(state.user?.role) === "qc" &&
    !isQcAllowedPagePath(location.pathname)
  ) {
    return <Navigate to="/qc" replace />;
  }

  if (state.user?.requires_brand_scope_choice && !isBrandScopeChoicePath) {
    return <Navigate to={BRAND_SCOPE_CHOICE_PATH} replace />;
  }

  if (!state.user?.requires_brand_scope_choice && isBrandScopeChoicePath) {
    return <Navigate to="/" replace />;
  }

  if (permissionModule && permissionsLoading) {
    return <div className="page-shell py-5 text-center">Loading...</div>;
  }

  if (
    permissionModule &&
    !hasPermission(permissionModule, permissionAction)
  ) {
    return (
      <Navigate
        to={normalizeUserRole(state.user?.role) === "qc" ? "/qc" : "/"}
        replace
      />
    );
  }

  return children;
};

export default ProtectedRoute;
