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
  const [showMobileMenu, setShowMobileMenu] = useState(false);
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

  const handleNavigate = (path) => {
    navigate(path);
    setShowMobileMenu(false);
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
      className="Navbar"
    >
      {/* Left: Brand */}
      <div className="navBrand">
        <h2 className="navTitle" onClick={() => handleNavigate("/")}>
          Order Management System
        </h2>
        <button
          type="button"
          className="navHamburger"
          onClick={() => setShowMobileMenu((prev) => !prev)}
          aria-label="Toggle navigation"
          aria-expanded={showMobileMenu}
        >
          {showMobileMenu ? "✕" : "☰"}
        </button>
      </div>

      <div className="navRight">
        {/* Middle: Navigation Links */}
        <div className="navLinks">
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
              onClick={() => handleNavigate("/qc")}
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
        <div className="navActions">
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
                      handleNavigate("/users/new");
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
      </div>

      {showMobileMenu && (
        <div className="navMobileMenu">
          <div className="navMobileUser">
            {user?.name} ({role})
          </div>
          {["QC", "admin", "manager", "Dev"].includes(role) && (
            <button
              type="button"
              className="userMenuItem navMobileButton"
              onClick={() => handleNavigate("/qc")}
            >
              QC
            </button>
          )}
          {canManageLabels && (
            <button
              type="button"
              className="userMenuItem navMobileButton"
              onClick={() => {
                setShowAllocateModal(true);
                setShowMobileMenu(false);
              }}
            >
              Allocate Labels
            </button>
          )}
          {canCreateUsers && (
            <button
              type="button"
              className="userMenuItem navMobileButton"
              onClick={() => handleNavigate("/users/new")}
            >
              Create User
            </button>
          )}
          {canManageOrders && (
            <button
              type="button"
              className="userMenuItem navMobileButton"
              onClick={() => {
                setShowUploadModal(true);
                setShowMobileMenu(false);
              }}
            >
              Update Orders
            </button>
          )}
          <button
            className="themeToggle navMobileButton"
            type="button"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {theme === "system"
              ? "Theme: System"
              : theme === "dark"
                ? "Theme: Dark"
                : "Theme: Light"}
          </button>
          <button
            type="button"
            className="userMenuItem danger navMobileButton"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      )}
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
