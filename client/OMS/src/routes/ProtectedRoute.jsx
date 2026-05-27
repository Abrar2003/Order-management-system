import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSessionUser } from "../auth/auth.service";
import { isQcAllowedPagePath, normalizeUserRole } from "../auth/permissions";

const ProtectedRoute = ({ children }) => {
  const location = useLocation();
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

  if (
    normalizeUserRole(state.user?.role) === "qc" &&
    !isQcAllowedPagePath(location.pathname)
  ) {
    return <Navigate to="/qc" replace />;
  }

  return children;
};

export default ProtectedRoute;
