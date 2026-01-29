import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./auth/Signin";
import Orders from "./pages/Orders";
import ProtectedRoute from "./routes/ProtectedRoute";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/signin" element={<SignIn />} />

        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <Orders />
            </ProtectedRoute>
          }
        />  

        {/* default redirect */}
        <Route path="*" element={<Navigate to="/orders" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
