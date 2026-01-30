import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import "./App.css";

import ProtectedRoute from "./routes/ProtectedRoute";


import SignIn from "./pages/Signin";
import Orders from "./pages/Orders";
import QCPage from "./pages/QcPage";
// import Users from "./pages/Users"; // later

const App = () => {
  return (
    <Router>
      <Routes>

        {/* Public */}
        <Route path="/signin" element={<SignIn />} />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/orders" replace />} />

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
  );
};

export default App;
