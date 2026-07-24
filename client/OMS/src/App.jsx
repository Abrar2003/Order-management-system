import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
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
import useMobileKeyboardHandler from "./hooks/useMobileKeyboardHandler";

const SignIn = lazy(() => import("./pages/Signin"));
const BrandScopeChoice = lazy(() => import("./pages/BrandScopeChoice"));
const Home = lazy(() => import("./pages/Home"));
const Orders = lazy(() => import("./pages/Orders"));
const QCPage = lazy(() => import("./pages/QcPage"));
const QcDetails = lazy(() => import("./pages/QcDetails"));
const OrdersByBrand = lazy(() => import("./pages/OrdersByBrand"));
const Signup = lazy(() => import("./pages/Signup"));
const CreateVendor = lazy(() => import("./pages/CreateVendor"));
const VendorDetails = lazy(() => import("./pages/VendorDetails"));
const OpenOrders = lazy(() => import("./pages/OpenOrders"));
const PackedGoods = lazy(() => import("./pages/PackedGoods"));
const DailyReport = lazy(() => import("./pages/DailyReport"));
const Shipments = lazy(() => import("./pages/Shipments"));
const Container = lazy(() => import("./pages/Container"));
const Samples = lazy(() => import("./pages/Samples"));
const SampleWorkflow = lazy(() => import("./pages/SampleWorkflow"));
const Containers = lazy(() => import("./pages/Containers"));
const ShippedSamples = lazy(() => import("./pages/ShippedSamples"));
const Items = lazy(() => import("./pages/Items"));
const ItemMasters = lazy(() => import("./pages/ItemMasters"));
const ItemFilesPage = lazy(() => import("./pages/ItemFilesPage"));
const ItemDetails = lazy(() => import("./pages/ItemDetails"));
const ItemOrdersHistory = lazy(() => import("./pages/ItemOrdersHistory"));
const UploadLogs = lazy(() => import("./pages/UploadLogs"));
const OrderEditLogs = lazy(() => import("./pages/OrderEditLogs"));
const ArchivedOrders = lazy(() => import("./pages/ArchivedOrders"));
const InspectionReport = lazy(() => import("./pages/inspection_report"));
const InspectorReports = lazy(() => import("./pages/InspectorReports"));
const VendorReports = lazy(() => import("./pages/VendorReports"));
const VendorWiseQAReport = lazy(() => import("./pages/VendorWiseQAReport"));
const MonthlyShipmentsReport = lazy(() => import("./pages/MonthlyShipmentsReport"));
const DelayedPoReports = lazy(() => import("./pages/DelayedPoReports"));
const UpcomingEtdReports = lazy(() => import("./pages/UpcomingEtdReports"));
const ShippingDelayReports = lazy(() => import("./pages/ShippingDelayReports"));
const CommonErrorsReport = lazy(() => import("./pages/CommonErrorsReport"));
const PoStatusReport = lazy(() => import("./pages/PoStatusReport"));
const PendingPoReport = lazy(() => import("./pages/PendingPoReport"));
const ProductAnalytics = lazy(() => import("./pages/ProductAnalytics"));
const QcReportMismatch = lazy(() => import("./pages/QcReportMismatch"));
const InspectedItemsReport = lazy(() => import("./pages/InspectedItemsReport"));
const PisInspectionMasterComparison = lazy(() => import("./pages/PisInspectionMasterComparison"));
const ProductDatabase = lazy(() => import("./pages/ProductDatabase"));
const ItemDatabase = lazy(() => import("./pages/ItemDatabase"));
const ProductDatabaseDetails = lazy(() => import("./pages/ProductDatabaseDetails"));
const ProductTypeTemplates = lazy(() => import("./pages/ProductTypeTemplates"));
const WorkflowDashboard = lazy(() => import("./pages/WorkflowDashboard"));
const WorkflowTasks = lazy(() => import("./pages/WorkflowTasks"));
const WorkflowMyTasks = lazy(() => import("./pages/WorkflowMyTasks"));
const WorkflowUploadPending = lazy(() => import("./pages/WorkflowUploadPending"));
const WorkflowTaskTypes = lazy(() => import("./pages/WorkflowTaskTypes"));
const WorkflowDepartments = lazy(() => import("./pages/WorkflowDepartments"));
const PermissionManagement = lazy(() => import("./pages/PermissionManagement"));
const PIS = lazy(() => import("./pages/PIS"));
const Finishes = lazy(() => import("./pages/Finishes"));
const PISDiffs = lazy(() => import("./pages/PISDiffs"));
const FinalPISCheck = lazy(() => import("./pages/FinalPISCheck"));
const PisUpdateLogs = lazy(() => import("./pages/PisUpdateLogs"));
const WeeklySummary = lazy(() => import("./pages/WeeklySummary"));
const DailySummary = lazy(() => import("./pages/DailySummary"));
const Complaints = lazy(() => import("./pages/Complaints"));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard"));
const OmsAssistant = lazy(() => import("./pages/OmsAssistant"));

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

const isModalNumberInput = (element) =>
  element instanceof HTMLInputElement &&
  element.type === "number" &&
  Boolean(element.closest(".modal, .om-modal-backdrop"));

const ModalNumberInputGuard = () => {
  useEffect(() => {
    const handleWheel = (event) => {
      const target = event.target;
      if (!isModalNumberInput(target) || document.activeElement !== target) {
        return;
      }

      event.preventDefault();
    };

    const handleKeyDown = (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }

      if (!isModalNumberInput(event.target)) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("wheel", handleWheel, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return null;
};

const RouteUiCleanup = () => {
  const location = useLocation();

  useLayoutEffect(() => {
    const shouldClearCustomModalRoots =
      location.pathname === "/signin" ||
      location.pathname === "/choose-brand-scope" ||
      location.pathname === "/";
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

const PageFallback = () => (
  <div className="d-flex align-items-center justify-content-center min-vh-100 text-secondary">
    Loading...
  </div>
);

const MobileKeyboardGuard = () => {
  useMobileKeyboardHandler();
  return null;
};

const App = () => {
  return (
    <div className="app-shell">
      <Router>
        <PermissionProvider>
          <ModalNumberInputGuard />
          <MobileKeyboardGuard />
          <RouteUiCleanup />
          <Suspense fallback={<PageFallback />}>
          <Routes>
          {/* Public */}
          <Route path="/signin" element={<SignIn />} />

          <Route
            path="/choose-brand-scope"
            element={
              <ProtectedRoute>
                <BrandScopeChoice />
              </ProtectedRoute>
            }
          />

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
            path="/reports/monthly-shipments"
            element={
              <ProtectedRoute>
                <MonthlyShipmentsReport />
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
            path="/reports/common-errors"
            element={
              <ProtectedRoute>
                <CommonErrorsReport />
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
            path="/reports/inspected-items"
            element={
              <ProtectedRoute>
                <InspectedItemsReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/pis-inspection-master-comparison"
            element={
              <ProtectedRoute>
                <PisInspectionMasterComparison />
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
            path="/item-database"
            element={
              <ProtectedRoute>
                <ItemDatabase />
              </ProtectedRoute>
            }
          />

          <Route
            path="/product-database-details/:id"
            element={
              <ProtectedRoute>
                <ProductDatabaseDetails />
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
            path="/samples"
            element={
              <ProtectedRoute>
                <Samples />
              </ProtectedRoute>
            }
          />

          <Route
            path="/samples/workflow"
            element={
              <ProtectedRoute>
                <SampleWorkflow />
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
            path="/item-masters"
            element={
              <ProtectedRoute>
                <ItemMasters />
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
            path="/items/:itemCode/details"
            element={
              <ProtectedRoute>
                <ItemDetails />
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
            path="/finishes"
            element={
              <ProtectedRoute>
                <Finishes />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports/shipping-delay"
            element={
              <ProtectedRoute>
                <ShippingDelayReports />
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
            path="/pis-update-logs"
            element={
              <ProtectedRoute>
                <PisUpdateLogs />
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
            path="/vendors"
            element={
              <ProtectedRoute>
                <VendorDetails />
              </ProtectedRoute>
            }
          />

          <Route
            path="/vendors/new"
            element={
              <ProtectedRoute>
                <CreateVendor />
              </ProtectedRoute>
            }
          />

          <Route
            path="/complaints"
            element={
              <ProtectedRoute>
                <Complaints />
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
            path="/security"
            element={
              <ProtectedRoute>
                <SecurityDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/oms-assistant"
            element={
              <ProtectedRoute permissionModule="oms_assistant">
                <OmsAssistant />
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
            path="/workflow/dashboard"
            element={
              <ProtectedRoute>
                <WorkflowDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/batches"
            element={
              <ProtectedRoute>
                <Navigate to="/workflow/tasks" replace />
              </ProtectedRoute>
            }
          />

          <Route
            path="/workflow/batches/:batchId"
            element={
              <ProtectedRoute>
                <Navigate to="/workflow/tasks" replace />
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
            path="/workflow/upload-pending"
            element={
              <ProtectedRoute>
                <WorkflowUploadPending />
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
          </Suspense>
        </PermissionProvider>
      </Router>
    </div>
  );
};

export default App;
