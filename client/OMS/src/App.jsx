import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import "./App.css";

import ProtectedRoute from "./routes/ProtectedRoute";

import SignIn from "./pages/Signin";
import Home from "./pages/Home";
import Orders from "./pages/Orders";
import QCPage from "./pages/QcPage";
import QcDetails from "./pages/QcDetails";
import OrdersByBrand from "./pages/OrdersByBrand";

// import Users from "./pages/Users"; // later

const App = () => {
  return (
    <div className="App">
      <Router>
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
            path="/orders/:brand/:vendor/:status"
            element={
              <ProtectedRoute>
                <OrdersByBrand />
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
