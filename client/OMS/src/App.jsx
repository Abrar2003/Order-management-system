import { useLayoutEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import "./App.css";

import ProtectedRoute from "./routes/ProtectedRoute";

import SignIn from "./pages/Signin";
import Home from "./pages/Home";
import Orders from "./pages/Orders";
import QCPage from "./pages/QcPage";
import QcDetails from "./pages/QcDetails";
import OrdersByBrand from "./pages/OrdersByBrand";
import Signup from "./pages/Signup";
import OpenOrders from "./pages/OpenOrders";
import DailyReport from "./pages/DailyReport";
import Shipments from "./pages/Shipments";
import Container from "./pages/Container";
import Items from "./pages/Items";
import ItemOrdersHistory from "./pages/ItemOrdersHistory";
import UploadLogs from "./pages/UploadLogs";
import ArchivedOrders from "./pages/ArchivedOrders";
import InspectionReport from "./pages/inspection_report";
import InspectorReports from "./pages/InspectorReports";
import VendorReports from "./pages/VendorReports";
import PIS from "./pages/PIS";

// import Users from "./pages/Users"; // later
const clearStaleUiOverlays = () => {
  document.body.classList.remove("modal-open");
  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("padding-right");

  document
    .querySelectorAll(".modal-backdrop, .offcanvas-backdrop")
    .forEach((node) => node.remove());

  // Defensive cleanup for stale custom modal roots left in DOM.
  document.querySelectorAll(".om-modal-backdrop").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.remove();
    }
  });

  document.querySelectorAll(".modal.show, .offcanvas.show").forEach((node) => {
    node.classList.remove("show");
    if (node instanceof HTMLElement) {
      node.style.display = "none";
    }
  });
};

const RouteUiCleanup = () => {
  const location = useLocation();

  useLayoutEffect(() => {
    clearStaleUiOverlays();

    // Some overlays are injected asynchronously by bootstrap plugins.
    const t1 = window.setTimeout(clearStaleUiOverlays, 0);
    const t2 = window.setTimeout(clearStaleUiOverlays, 250);
    const t3 = window.setTimeout(clearStaleUiOverlays, 750);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [location.pathname, location.search]);

  return null;
};

const App = () => {
  return (
    <div className="app-shell">
      <Router>
        <RouteUiCleanup />
        <Routes>
          {/* Public */}
          <Route path="/signin" element={<SignIn />} />

          {/* Home Page */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />

          {/* Protected Routes */}
          <Route
            path="/orders"
            element={
              <ProtectedRoute>
                <Orders />
              </ProtectedRoute>
            }
          />

          <Route
            path="/open-orders"
            element={
              <ProtectedRoute>
                <OpenOrders />
              </ProtectedRoute>
            }
          />

          <Route
            path="/daily-reports"
            element={
              <ProtectedRoute>
                <DailyReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/inspectors"
            element={
              <ProtectedRoute>
                <InspectorReports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/vendors"
            element={
              <ProtectedRoute>
                <VendorReports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/shipments"
            element={
              <ProtectedRoute>
                <Shipments />
              </ProtectedRoute>
            }
          />

          <Route
            path="/container"
            element={
              <ProtectedRoute>
                <Container />
              </ProtectedRoute>
            }
          />

          <Route
            path="/items"
            element={
              <ProtectedRoute>
                <Items />
              </ProtectedRoute>
            }
          />

          <Route
            path="/items/:itemCode/orders-history"
            element={
              <ProtectedRoute>
                <ItemOrdersHistory />
              </ProtectedRoute>
            }
          />

          <Route
            path="/pis"
            element={
              <ProtectedRoute>
                <PIS />
              </ProtectedRoute>
            }
          />

          <Route
            path="/upload-logs"
            element={
              <ProtectedRoute>
                <UploadLogs />
              </ProtectedRoute>
            }
          />

          <Route
            path="/archived-orders"
            element={
              <ProtectedRoute>
                <ArchivedOrders />
              </ProtectedRoute>
            }
          />

          <Route
            path="/qc"
            element={
              <ProtectedRoute>
                <QCPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/qc/:id"
            element={
              <ProtectedRoute>
                <QcDetails />
              </ProtectedRoute>
            }
          />

          <Route
            path="/qc/:id/inspection-report"
            element={
              <ProtectedRoute>
                <InspectionReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/orders/:brand/:vendor/:status"
            element={
              <ProtectedRoute>
                <OrdersByBrand />
              </ProtectedRoute>
            }
          />

          <Route
            path="/users/new"
            element={
              <ProtectedRoute>
                <Signup />
              </ProtectedRoute>
            }
          />

          {/* Optional future */}
          {/* 
        <Route
          path="/users"
          element={
            <ProtectedRoute>
              <Users />
            </ProtectedRoute>
          }
        />
        */}

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
      </Router>
    </div>
  );
};

export default App;
