import { useNavigate } from "react-router-dom";
import { logout, getToken, getUserFromToken } from "../auth/auth.service";
import "../App.css";
import { useEffect, useMemo, useRef, useState } from "react";
import UploadOrdersModal from "./UploadOrdersModal";
import RectifyPdfModal from "./RectifyPdfModal";
import AllocateLabelsModal from "./AllocateLabelsModal";
import ChangePasswordModal from "./ChangePasswordModal";
import CheckLabelsModal from "./CheckLabelsModal";

const Navbar = () => {
  const token = getToken();
  const user = getUserFromToken();
  const role = user?.role;
  const normalizedRole = String(role || "").trim().toLowerCase();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showRectifyPdfModal, setShowRectifyPdfModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [showCheckLabelsModal, setShowCheckLabelsModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showMainMenu, setShowMainMenu] = useState(false);
  const [showReportsMenu, setShowReportsMenu] = useState(false);
  const [showSummaryMenu, setShowSummaryMenu] = useState(false);
  const mainMenuRef = useRef(null);

  const getInitialTheme = () => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return "system";
  };

  const [theme, setTheme] = useState(getInitialTheme);

  const canAccessQc = ["qc", "admin", "manager", "dev"].includes(normalizedRole);
  const isQcOnlyRole = normalizedRole === "qc";
  const canManageOrders = ["admin", "manager", "dev"].includes(normalizedRole);
  const canManageLabels = ["admin", "manager"].includes(normalizedRole);
  const canCreateUsers = normalizedRole === "admin";

  const navigate = useNavigate();

  const primaryRouteLinks = useMemo(() => {
    if (isQcOnlyRole) {
      return [{ label: "QC", path: "/qc" }];
    }

    const links = [];

    if (canAccessQc) {
      links.push(
        { label: "QC", path: "/qc" },
        { label: "Open Orders", path: "/open-orders" },
        { label: "Shipments", path: "/shipments" },
        { label: "Bulk Shipping", path: "/container" },
        { label: "Daily Reports", path: "/daily-reports" },
        { label: "Items", path: "/items" },
      );
    }

    if (canManageOrders) {
      links.push({ label: "PIS", path: "/pis" });
    }

    return links;
  }, [canAccessQc, canManageOrders, isQcOnlyRole]);

  const secondaryRouteLinks = useMemo(() => {
    if (isQcOnlyRole) {
      return [];
    }

    const links = [{ label: "Home", path: "/" }];

    if (canAccessQc) {
      links.push({ label: "Items", path: "/items" });
    }

    if (canManageOrders) {
      links.push({ label: "PIS", path: "/pis" });
      links.push({ label: "Upload Logs", path: "/upload-logs" });
      links.push({ label: "Order Edit Logs", path: "/order-edit-logs" });
    }

    if (canCreateUsers) {
      links.push({ label: "Archived Orders", path: "/archived-orders" });
    }

    return links;
  }, [canAccessQc, canManageOrders, canCreateUsers, isQcOnlyRole]);

  const reportRouteLinks = useMemo(() => {
    if (!canAccessQc || isQcOnlyRole) return [];
    return [
      { label: "Inspector Reports", path: "/reports/inspectors" },
      { label: "Vendor Reports", path: "/reports/vendors" },
    ];
  }, [canAccessQc, isQcOnlyRole]);

  const summaryRouteLinks = useMemo(() => {
    if (!canAccessQc || isQcOnlyRole) return [];
    return [
      { label: "Weekly Summary", path: "/summary/weekly" },
      { label: "Daily Summary", path: "/summary/daily" },
    ];
  }, [canAccessQc, isQcOnlyRole]);

  const handleLogout = () => {
    logout();
    navigate("/signin");
  };

  const handleNavigate = (path) => {
    navigate(path);
    setShowMainMenu(false);
    setShowReportsMenu(false);
    setShowSummaryMenu(false);
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
      if (mainMenuRef.current && !mainMenuRef.current.contains(event.target)) {
        setShowMainMenu(false);
        setShowReportsMenu(false);
        setShowSummaryMenu(false);
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
        <div className="om-navbar-stack">
          <nav className="navbar bg-body-tertiary rounded-4 px-3 py-2 om-navbar om-card">
            <div className="container-fluid px-0 d-flex align-items-center gap-2">
              <button
                type="button"
                className="om-nav-brand h5 mb-0 me-2"
                onClick={() => handleNavigate("/")}
              >
                Order Management System
              </button>

              <div className="d-flex align-items-center gap-2 ms-auto">
                <div className="position-relative" ref={mainMenuRef}>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm rounded-pill om-hamburger-btn"
                    aria-expanded={showMainMenu}
                    onClick={() => setShowMainMenu((prev) => !prev)}
                    title="Menu"
                  >
                    <span aria-hidden="true">&#9776;</span>
                    <span>Menu</span>
                  </button>

                  {showMainMenu && (
                    <div className="card om-main-menu-dropdown shadow-sm">
                      <div className="list-group list-group-flush">
                        <div className="list-group-item text-secondary small">
                          {user?.name || "User"} ({role || "N/A"})
                        </div>

                        {secondaryRouteLinks.map((link) => (
                          <button
                            key={link.path}
                            type="button"
                            className="list-group-item list-group-item-action text-start"
                            onClick={() => handleNavigate(link.path)}
                          >
                            {link.label}
                          </button>
                        ))}

                        {reportRouteLinks.length > 0 && (
                          <>
                            <button
                              type="button"
                              className="list-group-item list-group-item-action text-start d-flex justify-content-between align-items-center"
                              aria-expanded={showReportsMenu}
                              onClick={() => {
                                setShowReportsMenu((prev) => !prev);
                                setShowSummaryMenu(false);
                              }}
                            >
                              <span>Reports</span>
                              <span className="small text-secondary">
                                {showReportsMenu ? "Hide" : "Show"}
                              </span>
                            </button>
                            {showReportsMenu && reportRouteLinks.map((link) => (
                              <button
                                key={link.path}
                                type="button"
                                className="list-group-item list-group-item-action text-start ps-4"
                                onClick={() => handleNavigate(link.path)}
                              >
                                {link.label}
                              </button>
                            ))}
                          </>
                        )}

                        {summaryRouteLinks.length > 0 && (
                          <>
                            <button
                              type="button"
                              className="list-group-item list-group-item-action text-start d-flex justify-content-between align-items-center"
                              aria-expanded={showSummaryMenu}
                              onClick={() => {
                                setShowSummaryMenu((prev) => !prev);
                                setShowReportsMenu(false);
                              }}
                            >
                              <span>Summary</span>
                              <span className="small text-secondary">
                                {showSummaryMenu ? "Hide" : "Show"}
                              </span>
                            </button>
                            {showSummaryMenu && summaryRouteLinks.map((link) => (
                              <button
                                key={link.path}
                                type="button"
                                className="list-group-item list-group-item-action text-start ps-4"
                                onClick={() => handleNavigate(link.path)}
                              >
                                {link.label}
                              </button>
                            ))}
                          </>
                        )}

                        {primaryRouteLinks.map((link) => (
                          <button
                            key={`mobile-${link.path}`}
                            type="button"
                            className="list-group-item list-group-item-action text-start om-menu-mobile-only"
                            onClick={() => handleNavigate(link.path)}
                          >
                            {link.label}
                          </button>
                        ))}

                        <button
                          type="button"
                          className="list-group-item list-group-item-action text-start"
                          onClick={() => {
                            toggleTheme();
                            setShowMainMenu(false);
                            setShowReportsMenu(false);
                            setShowSummaryMenu(false);
                          }}
                        >
                          {theme === "system"
                            ? "Theme: System"
                            : theme === "dark"
                              ? "Theme: Dark"
                              : "Theme: Light"}
                        </button>

                        <button
                          type="button"
                          className="list-group-item list-group-item-action text-start"
                          onClick={() => {
                            setShowChangePasswordModal(true);
                            setShowMainMenu(false);
                          }}
                        >
                          Change Password
                        </button>

                        {canManageLabels && (
                          <button
                            type="button"
                            className="list-group-item list-group-item-action text-start"
                            onClick={() => {
                              setShowCheckLabelsModal(true);
                              setShowMainMenu(false);
                            }}
                          >
                            Check Labels
                          </button>
                        )}

                        {canManageLabels && (
                          <button
                            type="button"
                            className="list-group-item list-group-item-action text-start"
                            onClick={() => {
                              setShowAllocateModal(true);
                              setShowMainMenu(false);
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
                              setShowMainMenu(false);
                            }}
                          >
                            Update Orders
                          </button>
                        )}

                        {canManageOrders && (
                          <button
                            type="button"
                            className="list-group-item list-group-item-action text-start"
                            onClick={() => {
                              setShowRectifyPdfModal(true);
                              setShowMainMenu(false);
                            }}
                          >
                            Rectify PDF
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
              </div>
            </div>
          </nav>

          {primaryRouteLinks.length > 0 && (
            <div className="om-route-bar rounded-4 px-2 py-2 d-none d-lg-flex flex-wrap gap-2 mt-2">
              {primaryRouteLinks.map((link) => (
                <button
                  key={link.path}
                  type="button"
                  className="btn btn-outline-primary btn-sm rounded-pill"
                  onClick={() => handleNavigate(link.path)}
                >
                  {link.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showUploadModal && (
        <UploadOrdersModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            setShowUploadModal(false);
          }}
        />
      )}

      {showRectifyPdfModal && (
        <RectifyPdfModal
          onClose={() => setShowRectifyPdfModal(false)}
          onSuccess={() => {}}
        />
      )}

      {showAllocateModal && (
        <AllocateLabelsModal
          onClose={() => {
            setShowAllocateModal(false);
          }}
        />
      )}

      {showCheckLabelsModal && (
        <CheckLabelsModal
          onClose={() => {
            setShowCheckLabelsModal(false);
          }}
        />
      )}

      {showChangePasswordModal && (
        <ChangePasswordModal
          onClose={() => {
            setShowChangePasswordModal(false);
          }}
          onSuccess={() => {
            setShowChangePasswordModal(false);
          }}
        />
      )}
    </>
  );
};

export default Navbar;
