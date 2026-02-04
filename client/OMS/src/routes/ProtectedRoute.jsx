import { Navigate } from "react-router-dom";
import { isTokenExpired, logout, getToken } from "../auth/auth.service";

const ProtectedRoute = ({ children }) => {
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
  
  return children;
};

export default ProtectedRoute;
