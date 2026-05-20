import { Navigate, useLocation } from "react-router-dom";
import { isTokenExpired, logout, getToken, getUserFromToken } from "../auth/auth.service";
import { isQcAllowedPagePath, normalizeUserRole } from "../auth/permissions";

const ProtectedRoute = ({ children }) => {
  const token = getToken();
  const location = useLocation();
  
  // Check if token exists
  if (!token) {
    return <Navigate to="/signin" replace />;
  }
  
  // Check if token is expired
  if (isTokenExpired()) {
    logout();
    return <Navigate to="/signin" replace />;
  }

  if (
    normalizeUserRole(getUserFromToken()?.role) === "qc" &&
    !isQcAllowedPagePath(location.pathname)
  ) {
    return <Navigate to="/qc" replace />;
  }

  return children;
};

export default ProtectedRoute;
