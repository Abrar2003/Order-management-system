import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout, getToken, getUserFromToken } from "../auth/auth.service";
import UploadOrdersModal from "./UploadOrdersModal";
import RectifyPdfModal from "./RectifyPdfModal";
import AllocateLabelsModal from "./AllocateLabelsModal";
import ChangePasswordModal from "./ChangePasswordModal";
import CheckLabelsModal from "./CheckLabelsModal";
import {
  buildItemFilesPagePath,
  ITEM_FILE_OPTIONS,
} from "../constants/itemFiles";
import "../App.css";

const routeMenuItem = (key, label, path) => ({
  key,
  label,
  kind: "route",
  path,
});

const actionMenuItem = (key, label, action, tone = "default") => ({
  key,
  label,
  kind: "action",
  action,
  tone,
});

const Navbar = () => {
  const token = getToken();
  const user = getUserFromToken();
  const role = user?.role;
  const normalizedRole = String(role || "").trim().toLowerCase();

  const navigate = useNavigate();
  const navShellRef = useRef(null);

  const [showUploadExcelModal, setShowUploadExcelModal] = useState(false);
  const [showManualUpdateModal, setShowManualUpdateModal] = useState(false);
  const [showUpdatePdfModal, setShowUpdatePdfModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [showCheckLabelsModal, setShowCheckLabelsModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [openMobileSection, setOpenMobileSection] = useState("");
  const [openDesktopDropdown, setOpenDesktopDropdown] = useState("");
  const [openDesktopMenuSection, setOpenDesktopMenuSection] = useState("");

  const getInitialTheme = () => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    return "system";
  };

  const [theme, setTheme] = useState(getInitialTheme);

  const canAccessQc = ["qc", "admin", "manager", "dev", "user"].includes(normalizedRole);
  const isQcOnlyRole = normalizedRole === "qc";
  const canManageOrders = ["admin", "manager", "dev"].includes(normalizedRole);
  const canEditPis = ["admin", "manager", "dev"].includes(normalizedRole);
  const canViewOrderPages = ["admin", "manager", "dev", "user"].includes(normalizedRole);
  const canManageLabels = ["admin", "manager"].includes(normalizedRole);
  const canCreateUsers = normalizedRole === "admin";
  const canAccessAnalytics = ["admin", "manager", "user"].includes(normalizedRole);

  const closeAllMenus = useCallback(() => {
    setShowMobileMenu(false);
    setOpenMobileSection("");
    setOpenDesktopDropdown("");
    setOpenDesktopMenuSection("");
  }, []);

  const themeLabel = useMemo(() => {
    if (theme === "system") return "Theme: System";
    if (theme === "dark") return "Theme: Dark";
    return "Theme: Light";
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  }, []);

  const handleLogout = useCallback(() => {
    closeAllMenus();
    logout();
    navigate("/signin");
  }, [closeAllMenus, navigate]);

  const handleNavigate = useCallback(
    (path) => {
      closeAllMenus();
      navigate(path);
    },
    [closeAllMenus, navigate],
  );

  const runMenuAction = useCallback(
    (action) => {
      closeAllMenus();

      if (action === "toggle-theme") {
        toggleTheme();
        return;
      }

      if (action === "change-password") {
        setShowChangePasswordModal(true);
        return;
      }

      if (action === "allocate-labels") {
        setShowAllocateModal(true);
        return;
      }

      if (action === "check-labels") {
        setShowCheckLabelsModal(true);
        return;
      }

      if (action === "update-orders-excel") {
        setShowUploadExcelModal(true);
        return;
      }

      if (action === "update-orders-pdf") {
        setShowUpdatePdfModal(true);
        return;
      }

      if (action === "update-orders-manual") {
        setShowManualUpdateModal(true);
        return;
      }

      if (action === "logout") {
        handleLogout();
      }
    },
    [closeAllMenus, handleLogout, toggleTheme],
  );

  const desktopDirectLinks = useMemo(() => {
    if (isQcOnlyRole) {
      return [routeMenuItem("qc", "QC", "/qc")];
    }

    const links = [];

    if (canAccessQc) {
      links.push(
        routeMenuItem("qc", "QC", "/qc"),
        routeMenuItem("shipments", "Shipments", "/shipments"),
        routeMenuItem("containers", "Containers", "/containers"),
      );
    }

    return links;
  }, [canAccessQc, isQcOnlyRole]);

  const generalMenuItems = useMemo(() => [routeMenuItem("home", "Home", "/")], []);

  const itemMenuItems = useMemo(() => {
    if (!canAccessQc || isQcOnlyRole) return [];

    return [
      routeMenuItem("items-all", "View Items", "/items"),
      routeMenuItem(
        "items-qc-report-mismatch",
        "QC Report Mismatch",
        "/reports/qc-report-mismatch",
      ),
      ...ITEM_FILE_OPTIONS.map((option) =>
        routeMenuItem(
          `items-file-${option.value}`,
          option.label,
          buildItemFilesPagePath(option.value),
        )
      ),
    ];
  }, [canAccessQc, isQcOnlyRole]);

  const orderMenuItems = useMemo(() => {
    if (!canAccessQc || isQcOnlyRole) return [];

    return [
      routeMenuItem("all-orders", "All Orders", "/all-orders"),
      routeMenuItem("open-orders", "Open Orders", "/open-orders"),
      routeMenuItem("inspected-orders", "Inspected Orders", "/inspected-orders"),
      routeMenuItem("shipped-orders", "Shipped Orders", "/shipped-orders"),
    ];
  }, [canAccessQc, isQcOnlyRole]);

  const reportMenuItems = useMemo(() => {
    if (!canAccessQc || isQcOnlyRole) return [];

    const links = [
      routeMenuItem("daily-reports", "Daily Inspection Reports", "/daily-reports"),
      routeMenuItem("inspector-reports", "Inspector Performance Reports", "/reports/inspectors"),
      routeMenuItem("vendor-reports", "Vendor Performance Reports", "/reports/vendors"),
      routeMenuItem("vendor-wise-qa", "Vendor Wise QA Report", "/reports/vendor-wise-qa"),
      routeMenuItem("qc-report-mismatch", "QC Report Mismatch", "/reports/qc-report-mismatch"),
      routeMenuItem("delayed-pos", "Delayed PO Reports", "/reports/delayed-pos"),
      routeMenuItem("upcoming-etd", "Upcoming ETD Reports", "/reports/upcoming-etd"),
      routeMenuItem("po-status", "PO Status Report", "/reports/po-status"),
      routeMenuItem("pending-po", "Pending PO Report", "/reports/pending-po"),
      routeMenuItem("weekly-summary", "Weekly Order Summary", "/summary/weekly"),
      routeMenuItem("daily-summary", "Daily Summary", "/summary/daily"),
      routeMenuItem("packed-goods", "Packed Goods", "/packed-goods"),
      routeMenuItem("archived-orders", "Archived Orders", "/archived-orders"),
      routeMenuItem("samples", "Shipped Samples", "/shipped-samples"),
    ];

    if (canAccessAnalytics) {
      links.push(
        routeMenuItem("product-analytics", "Product Analytics", "/reports/product-analytics"),
      );
    }

    if (canManageLabels) {
      links.push(actionMenuItem("check-labels", "Check Labels", "check-labels"));
    }

    return links;
  }, [canAccessAnalytics, canAccessQc, canManageLabels, isQcOnlyRole]);

  const processMenuItems = useMemo(() => {
    if (isQcOnlyRole) return [];

    const items = [];

    if (canAccessQc) {
      items.push(routeMenuItem("bulk-shipping", "Bulk Shipping", "/container"));
    }

    if (canManageLabels) {
      items.push(actionMenuItem("allocate-labels", "Allocate Labels", "allocate-labels"));
    }

    return items;
  }, [canAccessQc, canManageLabels, isQcOnlyRole]);

  const updateOrdersMenuItems = useMemo(() => {
    if (!canManageOrders || isQcOnlyRole) return [];

    return [
      actionMenuItem(
        "update-orders-excel",
        "Update Orders by Excel",
        "update-orders-excel",
      ),
      actionMenuItem(
        "update-orders-pdf",
        "Update Orders by PDF",
        "update-orders-pdf",
      ),
      actionMenuItem(
        "update-orders-manual",
        "Update Orders Manually",
        "update-orders-manual",
      ),
    ];
  }, [canManageOrders, isQcOnlyRole]);

  const uploadAddMenuItems = useMemo(() => {
    if (!canViewOrderPages || isQcOnlyRole) return [];

    const items = [];

    if (canEditPis) {
      items.push(routeMenuItem("upload-finish", "Upload Finish", "/pis?open_finish=1"));
    }

    items.push(
      routeMenuItem("pis", "PIS", "/pis"),
      routeMenuItem("pis-diffs", "Update PIS / QC Reports", "/pis-diffs"),
      routeMenuItem("final-pis-check", "Final PIS Check", "/final-pis-check"),
    );

    return items;
  }, [canEditPis, canViewOrderPages, isQcOnlyRole]);

  const logMenuItems = useMemo(() => {
    if (!canViewOrderPages || isQcOnlyRole) return [];

    return [
      routeMenuItem("upload-logs", "Upload Logs", "/upload-logs"),
      routeMenuItem("order-edit-logs", "Order Edit Logs", "/order-edit-logs"),
    ];
  }, [canViewOrderPages, isQcOnlyRole]);

  const settingsMenuItems = useMemo(
    () => {
      const items = [];

      if (canCreateUsers) {
        items.push(routeMenuItem("create-users", "Create User", "/users/new"));
      }

      items.push(
        actionMenuItem("theme", themeLabel, "toggle-theme"),
        actionMenuItem("change-password", "Change Password", "change-password"),
        actionMenuItem("logout", "Logout", "logout", "danger"),
      );

      return items;
    },
    [canCreateUsers, themeLabel],
  );

  const menuSections = useMemo(
    () =>
      [
        { key: "items", label: "Items", items: itemMenuItems },
        { key: "orders", label: "Orders", items: orderMenuItems },
        { key: "reports", label: "Reports", items: reportMenuItems },
        { key: "process", label: "Process", items: processMenuItems },
        { key: "update-orders", label: "Update Orders", items: updateOrdersMenuItems },
        { key: "upload-add", label: "Upload - Add", items: uploadAddMenuItems },
        { key: "logs", label: "Logs", items: logMenuItems },
        { key: "settings", label: "Settings", items: settingsMenuItems },
      ].filter((section) => Array.isArray(section.items) && section.items.length > 0),
    [
      itemMenuItems,
      logMenuItems,
      orderMenuItems,
      processMenuItems,
      reportMenuItems,
      settingsMenuItems,
      updateOrdersMenuItems,
      uploadAddMenuItems,
    ],
  );

  const desktopPrimaryDropdownSections = useMemo(
    () =>
      menuSections.filter(
        (section) =>
          section.key === "items" || section.key === "orders" || section.key === "reports",
      ),
    [menuSections],
  );

  const desktopOverflowSections = useMemo(
    () =>
      menuSections.filter(
        (section) =>
          section.key !== "items" && section.key !== "orders" && section.key !== "reports",
      ),
    [menuSections],
  );

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
      if (navShellRef.current && !navShellRef.current.contains(event.target)) {
        closeAllMenus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeAllMenus]);

  const toggleMobileSection = (sectionKey) => {
    setOpenMobileSection((prev) => (prev === sectionKey ? "" : sectionKey));
  };

  const toggleDesktopDropdown = (sectionKey) => {
    setOpenDesktopDropdown((prev) => (prev === sectionKey ? "" : sectionKey));
    setShowMobileMenu(false);
    setOpenMobileSection("");
    setOpenDesktopMenuSection("");
  };

  const toggleDesktopMenuSection = (sectionKey) => {
    setOpenDesktopMenuSection((prev) => (prev === sectionKey ? "" : sectionKey));
  };

  const renderMenuItem = (item, className = "") => {
    const buttonClassName = [
      "list-group-item",
      "list-group-item-action",
      "text-start",
      item.tone === "danger" ? "text-danger" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const handleSelect =
      item.kind === "route"
        ? () => handleNavigate(item.path)
        : () => runMenuAction(item.action);

    return (
      <button
        key={item.key}
        type="button"
        className={buttonClassName}
        onClick={handleSelect}
      >
        {item.label}
      </button>
    );
  };

  if (!token) return null;

  return (
    <>
      <div className="page-shell pt-3">
        <div className="om-navbar-stack" ref={navShellRef}>
          <nav className="navbar bg-body-tertiary rounded-4 px-3 py-2 om-navbar om-card">
            <div className="container-fluid px-0 d-flex align-items-center gap-2">
              <button
                type="button"
                className="om-nav-brand h5 mb-0 me-2"
                onClick={() => handleNavigate("/")}
              >
                Order Management System
              </button>

              <div className="d-none d-lg-flex ms-auto align-items-center small text-secondary">
                {user?.name || "User"} ({role || "N/A"})
              </div>

              <div className="position-relative d-lg-none ms-auto">
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm rounded-pill om-hamburger-btn"
                  aria-expanded={showMobileMenu}
                  onClick={() => {
                    setShowMobileMenu((prev) => !prev);
                    setOpenDesktopDropdown("");
                  }}
                  title="Menu"
                >
                  <span aria-hidden="true">&#9776;</span>
                  <span>Menu</span>
                </button>

                {showMobileMenu && (
                  <div className="card om-main-menu-dropdown shadow-sm">
                    <div className="list-group list-group-flush">
                      <div className="list-group-item text-secondary small">
                        {user?.name || "User"} ({role || "N/A"})
                      </div>

                      {generalMenuItems.map((item) => renderMenuItem(item))}

                      {desktopDirectLinks.map((item) => renderMenuItem(item))}

                      {menuSections.map((section) => (
                        <div key={`mobile-section-${section.key}`}>
                          <button
                            type="button"
                            className="list-group-item list-group-item-action text-start d-flex justify-content-between align-items-center"
                            aria-expanded={openMobileSection === section.key}
                            onClick={() => toggleMobileSection(section.key)}
                          >
                            <span>{section.label}</span>
                            <span className="small text-secondary">
                              {openMobileSection === section.key ? "Hide" : "Show"}
                            </span>
                          </button>

                          {openMobileSection === section.key &&
                            section.items.map((item) => renderMenuItem(item, "ps-4"))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </nav>

          <div className="om-route-bar rounded-4 px-2 py-2 d-none d-lg-flex flex-wrap gap-2 mt-2">
            {desktopDirectLinks.map((item) => (
              <button
                key={item.key}
                type="button"
                className="btn btn-outline-primary btn-sm rounded-pill"
                onClick={() => handleNavigate(item.path)}
              >
                {item.label}
              </button>
            ))}

            {desktopPrimaryDropdownSections.map((section) => (
              <div key={`desktop-section-${section.key}`} className="position-relative">
                <button
                  type="button"
                  className={`btn btn-sm rounded-pill ${openDesktopDropdown === section.key ? "btn-primary" : "btn-outline-primary"}`}
                  aria-expanded={openDesktopDropdown === section.key}
                  onClick={() => toggleDesktopDropdown(section.key)}
                >
                  {section.label}
                </button>

                {openDesktopDropdown === section.key && (
                  <div
                    className="card om-main-menu-dropdown shadow-sm"
                    style={{ left: 0, right: "auto" }}
                  >
                    <div className="list-group list-group-flush">
                      {section.items.map((item) => renderMenuItem(item))}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {(generalMenuItems.length > 0 || desktopOverflowSections.length > 0) && (
              <div className="position-relative ms-auto">
                <button
                  type="button"
                  className={`btn btn-sm rounded-pill ${openDesktopDropdown === "menu" ? "btn-primary" : "btn-outline-primary"}`}
                  aria-expanded={openDesktopDropdown === "menu"}
                  onClick={() => toggleDesktopDropdown("menu")}
                >
                  Menu
                </button>

                {openDesktopDropdown === "menu" && (
                  <div
                    className="card om-main-menu-dropdown shadow-sm"
                    style={{ left: "auto", right: 0 }}
                  >
                    <div className="list-group list-group-flush">
                      {generalMenuItems.map((item) => renderMenuItem(item))}

                      {desktopOverflowSections.map((section) => (
                        <div key={`desktop-overflow-${section.key}`}>
                          <button
                            type="button"
                            className="list-group-item list-group-item-action text-start d-flex justify-content-between align-items-center"
                            aria-expanded={openDesktopMenuSection === section.key}
                            onClick={() => toggleDesktopMenuSection(section.key)}
                          >
                            <span>{section.label}</span>
                            <span className="small text-secondary">
                              {openDesktopMenuSection === section.key ? "Hide" : "Show"}
                            </span>
                          </button>
                          {openDesktopMenuSection === section.key &&
                            section.items.map((item) => renderMenuItem(item, "ps-4"))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showUploadExcelModal && (
        <UploadOrdersModal
          title="Update Orders by Excel"
          initialMode="upload"
          allowedModes={["upload"]}
          onClose={() => setShowUploadExcelModal(false)}
          onSuccess={() => {
            setShowUploadExcelModal(false);
          }}
        />
      )}

      {showUpdatePdfModal && (
        <RectifyPdfModal
          title="Update Orders by PDF"
          onClose={() => setShowUpdatePdfModal(false)}
          onSuccess={() => {}}
        />
      )}

      {showManualUpdateModal && (
        <UploadOrdersModal
          title="Update Orders Manually"
          initialMode="manual"
          allowedModes={["manual"]}
          onClose={() => setShowManualUpdateModal(false)}
          onSuccess={() => {
            setShowManualUpdateModal(false);
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
