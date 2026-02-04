import { useNavigate } from "react-router-dom";
import { logout, getToken, getUserFromToken } from "../auth/auth.service";
import "../App.css";
import { useEffect, useRef, useState } from "react";
import UploadOrdersModal from "./UploadOrdersModal";
import AllocateLabelsModal from "./AllocateLabelsModal";


const Navbar = () => {
  const token = getToken();
  const user = getUserFromToken();
  const role = user?.role;
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const getInitialTheme = () => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  };
  const [theme, setTheme] = useState(getInitialTheme);
  
  const canManageOrders = ["admin", "manager", "Dev"].includes(role);
  const canManageLabels = ["admin", "manager"].includes(role);
  const canCreateUsers = role === "admin";

  const navigate = useNavigate();
  if (!token) return null;

  const handleLogout = () => {
    logout();
    navigate("/signin");
  };

  useEffect(() => {
    if (theme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  };

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
          <button
            type="button"
            className="navPillButton"
            onClick={() => navigate("/qc")}
          >
            QC
          </button>
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
        <div className="userMenu" ref={userMenuRef}>
          <button
            className="userMenuButton"
            type="button"
            onClick={() => setShowUserMenu((prev) => !prev)}
          >
            {user?.name} ({role})
          </button>
          {showUserMenu && (
            <div className="userMenuDropdown">
              {canManageLabels && (
                <button
                  type="button"
                  className="userMenuItem"
                  onClick={() => {
                    setShowAllocateModal(true);
                    setShowUserMenu(false);
                  }}
                >
                  Allocate Labels
                </button>
              )}
              {canCreateUsers && (
                <button
                  type="button"
                  className="userMenuItem"
                  onClick={() => {
                    navigate("/users/new");
                    setShowUserMenu(false);
                  }}
                >
                  Create User
                </button>
              )}
              {canManageOrders && (
                <button
                  type="button"
                  className="userMenuItem"
                  onClick={() => {
                    setShowUploadModal(true);
                    setShowUserMenu(false);
                  }}
                >
                  Update Orders
                </button>
              )}
              <button
                type="button"
                className="userMenuItem danger"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          )}
        </div>
        <button className="themeToggle" type="button" onClick={toggleTheme} title="Toggle theme">
          {theme === "system"
            ? "Theme: System"
            : theme === "dark"
              ? "Theme: Dark"
              : "Theme: Light"}
        </button>

      </div>
      {showUploadModal && (
              <UploadOrdersModal
                onClose={() => setShowUploadModal(false)}
                onSuccess={() => {
                  setShowUploadModal(false);
                }}
              />
            )}
      {showAllocateModal && (
        <AllocateLabelsModal
          onClose={() => {
            setShowAllocateModal(false);
          }}
        />
      )}
    </nav>
  );
};

export default Navbar;
