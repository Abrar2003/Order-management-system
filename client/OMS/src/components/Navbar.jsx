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
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return "system";
  };

  const [theme, setTheme] = useState(getInitialTheme);

  const canAccessQc = ["QC", "admin", "manager", "dev", "Dev"].includes(role);
  const canManageOrders = ["admin", "manager", "dev", "Dev"].includes(role);
  const canManageLabels = ["admin", "manager"].includes(role);
  const canCreateUsers = role === "admin";

  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/signin");
  };

  const handleNavigate = (path) => {
    navigate(path);
    setShowMobileMenu(false);
    setShowUserMenu(false);
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

  if (!token) return null;

  return (
    <>
      <div className="page-shell pt-3">
        <nav className="navbar navbar-expand-lg bg-body-tertiary rounded-4 px-3 py-2 om-navbar om-card">
          <div className="container-fluid px-0">
            <button
              type="button"
              className="om-nav-brand h5 mb-0 me-3"
              onClick={() => handleNavigate("/")}
            >
              Order Management System
            </button>

            <button
              className="navbar-toggler"
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={showMobileMenu}
              onClick={() => setShowMobileMenu((prev) => !prev)}
            >
              <span className="navbar-toggler-icon" />
            </button>

            <div className={`collapse navbar-collapse ${showMobileMenu ? "show" : ""}`}>
              <ul className="navbar-nav me-auto mb-2 mb-lg-0 gap-lg-2">
                {canAccessQc && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm rounded-pill"
                      onClick={() => handleNavigate("/qc")}
                    >
                      QC
                    </button>
                  </li>
                )}
                {canAccessQc && (
                  <li className="nav-item">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm rounded-pill"
                      onClick={() => handleNavigate("/open-orders")}
                    >
                      Open Orders
                    </button>
                  </li>
                )}
              </ul>

              <div className="d-flex flex-column flex-lg-row align-items-start align-items-lg-center gap-2 ms-lg-auto">
                <div className="position-relative" ref={userMenuRef}>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm rounded-pill"
                    onClick={() => setShowUserMenu((prev) => !prev)}
                  >
                    {user?.name || "User"} ({role})
                  </button>

                  {showUserMenu && (
                    <div className="card om-user-dropdown shadow-sm">
                      <div className="list-group list-group-flush">
                        {canManageLabels && (
                          <button
                            type="button"
                            className="list-group-item list-group-item-action text-start"
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
                            className="list-group-item list-group-item-action text-start"
                            onClick={() => handleNavigate("/users/new")}
                          >
                            Create User
                          </button>
                        )}

                        {canManageOrders && (
                          <button
                            type="button"
                            className="list-group-item list-group-item-action text-start"
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
                          className="list-group-item list-group-item-action text-start text-danger"
                          onClick={handleLogout}
                        >
                          Logout
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm rounded-pill"
                  onClick={toggleTheme}
                  title="Toggle theme"
                >
                  {theme === "system"
                    ? "Theme: System"
                    : theme === "dark"
                      ? "Theme: Dark"
                      : "Theme: Light"}
                </button>
              </div>
            </div>
          </div>
        </nav>
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
    </>
  );
};

export default Navbar;
