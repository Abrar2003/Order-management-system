import { Navigate, useLocation } from "react-router-dom";
import { isTokenExpired, logout, getToken } from "../auth/auth.service";
import { getUserFromToken as getUserFromPayload } from "../auth/auth.utils";

const ProtectedRoute = ({ children }) => {
  const location = useLocation();
  const token = getToken();
  
  // Check if token exists
  if (!token) {
    return <Navigate to="/signin" replace />;
  }
  
  // Check if token is expired
  if (isTokenExpired()) {
    logout();
    return <Navigate to="/signin" replace />;
  }

  const normalizedRole = String(getUserFromPayload()?.role || "")
    .trim()
    .toLowerCase();
  if (normalizedRole === "qc") {
    const currentPath = String(location?.pathname || "");
    if (!currentPath.startsWith("/qc")) {
      return <Navigate to="/qc" replace />;
    }
  }
  
  return children;
};

export default ProtectedRoute;
