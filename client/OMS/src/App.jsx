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
import { PermissionProvider } from "./auth/PermissionContext";
import { getUserFromToken } from "./auth/auth.service";
import { normalizeUserRole } from "./auth/permissions";

import SignIn from "./pages/Signin";
import Home from "./pages/Home";
import Orders from "./pages/Orders";
import QCPage from "./pages/QcPage";
import QcDetails from "./pages/QcDetails";
import OrdersByBrand from "./pages/OrdersByBrand";
import Signup from "./pages/Signup";
import OpenOrders from "./pages/OpenOrders";
import PackedGoods from "./pages/PackedGoods";
import DailyReport from "./pages/DailyReport";
import Shipments from "./pages/Shipments";
import Container from "./pages/Container";
import Containers from "./pages/Containers";
import ShippedSamples from "./pages/ShippedSamples";
import Items from "./pages/Items";
import ItemFilesPage from "./pages/ItemFilesPage";
import ItemOrdersHistory from "./pages/ItemOrdersHistory";
import UploadLogs from "./pages/UploadLogs";
import OrderEditLogs from "./pages/OrderEditLogs";
import ArchivedOrders from "./pages/ArchivedOrders";
import InspectionReport from "./pages/inspection_report";
import InspectorReports from "./pages/InspectorReports";
import VendorReports from "./pages/VendorReports";
import VendorWiseQAReport from "./pages/VendorWiseQAReport";
import DelayedPoReports from "./pages/DelayedPoReports";
import UpcomingEtdReports from "./pages/UpcomingEtdReports";
import PoStatusReport from "./pages/PoStatusReport";
import PendingPoReport from "./pages/PendingPoReport";
import ProductAnalytics from "./pages/ProductAnalytics";
import QcReportMismatch from "./pages/QcReportMismatch";
import ProductDatabase from "./pages/ProductDatabase";
import ProductTypeTemplates from "./pages/ProductTypeTemplates";
import WorkflowBatches from "./pages/WorkflowBatches";
import WorkflowBatchDetail from "./pages/WorkflowBatchDetail";
import WorkflowTasks from "./pages/WorkflowTasks";
import WorkflowMyTasks from "./pages/WorkflowMyTasks";
import WorkflowTaskTypes from "./pages/WorkflowTaskTypes";
import WorkflowDepartments from "./pages/WorkflowDepartments";
import PermissionManagement from "./pages/PermissionManagement";
import PIS from "./pages/PIS";
import PISDiffs from "./pages/PISDiffs";
import FinalPISCheck from "./pages/FinalPISCheck";
import WeeklySummary from "./pages/WeeklySummary";
import DailySummary from "./pages/DailySummary";

// import Users from "./pages/Users"; // later
const clearStaleUiOverlays = ({ removeCustomModalRoots = false } = {}) => {
  document.body.classList.remove("modal-open");
  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("padding-right");
  document.documentElement.style.removeProperty("overflow");

  document
    .querySelectorAll(".modal-backdrop, .offcanvas-backdrop")
    .forEach((node) => node.remove());

  if (removeCustomModalRoots) {
    document.querySelectorAll(".om-modal-backdrop").forEach((node) => {
      if (node instanceof HTMLElement) {
        node.remove();
      }
    });
  }

  document.querySelectorAll(".modal.show, .offcanvas.show").forEach((node) => {
    node.classList.remove("show");
    if (node instanceof HTMLElement) {
      node.style.display = "none";
      node.setAttribute("aria-hidden", "true");
    }
  });

  document
    .querySelectorAll(".modal[style*='display: block'], .offcanvas[style*='visibility: visible']")
    .forEach((node) => {
      if (node instanceof HTMLElement) {
        node.style.display = "none";
        node.classList.remove("show");
        node.setAttribute("aria-hidden", "true");
      }
    });
};

const RouteUiCleanup = () => {
  const location = useLocation();

  useLayoutEffect(() => {
    const shouldClearCustomModalRoots =
      location.pathname === "/signin" || location.pathname === "/";
    const runCleanup = () =>
      clearStaleUiOverlays({ removeCustomModalRoots: shouldClearCustomModalRoots });

    runCleanup();

    // Some overlays are injected asynchronously by bootstrap plugins.
    const t1 = window.setTimeout(runCleanup, 0);
    const t2 = window.setTimeout(runCleanup, 250);
    const t3 = window.setTimeout(runCleanup, 750);
    const t4 = window.setTimeout(runCleanup, 1500);
    const t5 = window.setTimeout(runCleanup, 3000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
    };
  }, [location.pathname, location.search]);

  return null;
};

const RootRoute = () => {
  const role = normalizeUserRole(getUserFromToken()?.role);

  if (role === "qc") {
    return <Navigate to="/qc" replace />;
  }

  return <Home />;
};

const AppFallbackRoute = () => {
  const role = normalizeUserRole(getUserFromToken()?.role);

  return <Navigate to={role === "qc" ? "/qc" : "/orders"} replace />;
};

const App = () => {
  return (
    <div className="app-shell">
      <Router>
        <PermissionProvider>
          <RouteUiCleanup />
          <Routes>
          {/* Public */}
          <Route path="/signin" element={<SignIn />} />

          {/* Home Page */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RootRoute />
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
            path="/all-orders"
            element={
              <ProtectedRoute>
                <OpenOrders bucket="all" />
              </ProtectedRoute>
            }
          />

          <Route
            path="/open-orders"
            element={
              <ProtectedRoute>
                <OpenOrders bucket="open" />
              </ProtectedRoute>
            }
          />

          <Route
            path="/inspected-orders"
            element={
              <ProtectedRoute>
                <OpenOrders bucket="inspected" />
              </ProtectedRoute>
            }
          />

          <Route
            path="/shipped-orders"
            element={
              <ProtectedRoute>
                <OpenOrders bucket="shipped" />
              </ProtectedRoute>
            }
          />

          <Route
            path="/packed-goods"
            element={
              <ProtectedRoute>
                <PackedGoods />
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
            path="/reports/vendor-wise-qa"
            element={
              <ProtectedRoute>
                <VendorWiseQAReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/delayed-pos"
            element={
              <ProtectedRoute>
                <DelayedPoReports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/upcoming-etd"
            element={
              <ProtectedRoute>
                <UpcomingEtdReports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/po-status"
            element={
              <ProtectedRoute>
                <PoStatusReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/pending-po"
            element={
              <ProtectedRoute>
                <PendingPoReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/qc-report-mismatch"
            element={
              <ProtectedRoute>
                <QcReportMismatch />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/product-analytics"
            element={
              <ProtectedRoute>
                <ProductAnalytics />
              </ProtectedRoute>
            }
          />

          <Route
            path="/product-database"
            element={
              <ProtectedRoute>
                <ProductDatabase />
              </ProtectedRoute>
            }
          />

          <Route
            path="/summary/weekly"
            element={
              <ProtectedRoute>
                <WeeklySummary />
              </ProtectedRoute>
            }
          />
 
          <Route
            path="/summary/daily"
            element={
              <ProtectedRoute> 
                <DailySummary />
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
            path="/containers"
            element={
              <ProtectedRoute>
                <Containers />
              </ProtectedRoute>
            }
          />

          <Route
            path="/shipped-samples"
            element={
              <ProtectedRoute>
                <ShippedSamples />
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
            path="/item-files"
            element={
              <ProtectedRoute>
                <ItemFilesPage />
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
            path="/pis-diffs"
            element={
              <ProtectedRoute>
                <PISDiffs />
              </ProtectedRoute>
            }
          />

          <Route
            path="/final-pis-check"
            element={
              <ProtectedRoute>
                <FinalPISCheck />
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
            path="/order-edit-logs"
            element={
              <ProtectedRoute>
                <OrderEditLogs />
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

          <Route
            path="/settings/permissions"
            element={
              <ProtectedRoute>
                <PermissionManagement />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings/product-type-templates"
            element={
              <ProtectedRoute>
                <ProductTypeTemplates />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/batches"
            element={
              <ProtectedRoute>
                <WorkflowBatches />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/batches/:batchId"
            element={
              <ProtectedRoute>
                <WorkflowBatchDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/tasks"
            element={
              <ProtectedRoute>
                <WorkflowTasks />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/my-tasks"
            element={
              <ProtectedRoute>
                <WorkflowMyTasks />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/task-types"
            element={
              <ProtectedRoute>
                <WorkflowTaskTypes />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/departments"
            element={
              <ProtectedRoute>
                <WorkflowDepartments />
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
            <Route path="*" element={<AppFallbackRoute />} />
          </Routes>
        </PermissionProvider>
      </Router>
    </div>
  );
};

export default App;
