import { useNavigate, useLocation } from "react-router-dom";
import { logout, getToken, getUserFromToken } from "../auth/auth.service";
import "../App.css";
import { useState } from "react";
import UploadOrdersModal from "./UploadOrdersModal";


const Navbar = () => {
  const token = getToken();
  const user = getUserFromToken();
  const role = user?.role;
    const [showUploadModal, setShowUploadModal] = useState(false);
  
 const canManageOrders = ["admin", "manager", "Dev"].includes(role);

  const navigate = useNavigate();
  const location = useLocation();

  if (!token) return null;

  const spanStyle = {
    cursor: "pointer",
    marginRight: "20px",
    fontSize: "16px",
    fontWeight: "bold"
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
        width: "90%",
        display: "flex",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 1000,
        alignItems: "center",
        padding: "1 rem 2rem",
        backgroundColor: "#1f2937",
        color: "#fff",
        borderRadius: "0 16px 0 16px",
      }}
      className="Navbar"
    >
      {/* Left: Brand */}
      <h2
        style={{ margin: 0, cursor: "pointer", paddingRight: "20px" }}
        onClick={() => navigate("/")}
      >
        Order Management System
      </h2>

      {/* Middle: Navigation Links */}
      <div style={{ display: "flex", width: "50%", justifyContent: "right" }}>
        {/* <span
          style={spanStyle}
          onClick={() => navigate("/orders")}
        >
          Orders
        </span> */}

        {["QC", "admin", "manager", "Dev"].includes(role) && (
          <span
            style={{...spanStyle,  border: "1px solid #aba7a7", padding: "6px 12px", borderRadius: "4px"}}
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
      <div style={{ display: "flex", alignItems: "center", width: "40%", justifyContent: "space-evenly" }}>
        <span style={spanStyle}>
          {user?.name} ({role})
        </span>

        {canManageOrders && (
        <div style={{ margin: "10px 0", textAlign: "right"}}>
          <button
            // className="primaryButton"
            onClick={() => {
              setShowUploadModal(true)
            }}
            style={{
              padding: "6px 14px",
              backgroundColor: "#2563eb",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              borderRadius: "4px",
              width: "100%"
          }}
          >
            Upload Orders
          </button>
        </div>
      )}
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
      {showUploadModal && (
              <UploadOrdersModal
                onClose={() => setShowUploadModal(false)}
                onSuccess={() => {
                  // reload first page after upload
                  setPage(1);
                }}
              />
            )}
    </nav>
  );
};

export default Navbar;
