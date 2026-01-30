import { useNavigate, useLocation } from "react-router-dom";
import { logout, getToken, getUserFromToken } from "../auth/auth.service";
import "../App.css";

const Navbar = () => {
  const token = getToken();
  const user = getUserFromToken();
  const role = user?.role;

  const navigate = useNavigate();
  const location = useLocation();

  if (!token) return null;

  const spanStyle = {
    cursor: "pointer",
    marginRight: "20px",
    fontSize: "16px",
    fontWeight: "bold",
  };

  const handleLogout = () => {
    logout();
    navigate("/signin");
  };

  const isActive = (path) =>
    location.pathname === path ? { textDecoration: "underline" } : {};

  return (
    <nav
      style={{
        display: "flex",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 1000,
        alignItems: "center",
        padding: "12px 24px",
        backgroundColor: "#1f2937",
        color: "#fff",
        borderRadius: "0 16px 0 16px",
      }}
      className="Navbar"
    >
      {/* Left: Brand */}
      <h2
        style={{ margin: 0, cursor: "pointer" }}
        onClick={() => navigate("/orders")}
      >
        Order Management System
      </h2>

      {/* Middle: Navigation Links */}
      <div style={{ display: "flex", gap: "20px", width: "50%"}}>
        <span
          style={spanStyle}
          onClick={() => navigate("/orders")}
        >
          Orders
        </span>

        {["QC", "admin", "manager", "Dev"].includes(role) && (
          <span
            style={spanStyle}
            onClick={() => navigate("/qc")}
          >
            QC
          </span>
        )}

        {/* {["admin", "manager", "Dev"].includes(role) && (
          <span
            style={{ cursor: "pointer", ...isActive("/users") }}
            onClick={() => navigate("/users")}
          >
            Users
          </span>
        )} */}
      </div>

      {/* Right: User + Logout */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={spanStyle}>
          {user?.name} ({role})
        </span>

        <button
          onClick={handleLogout}
          style={{
            padding: "6px 14px",
            backgroundColor: "#ef4444",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            borderRadius: "4px",
          }}
        >
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
