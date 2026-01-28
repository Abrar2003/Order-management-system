import { useNavigate } from "react-router-dom";
import { logout, getToken } from "../auth/auth.service";

const Navbar = () => {
const token = getToken();
  const navigate = useNavigate();

  if (!token) return null; // 🔥 KEY FIX

  const handleLogout = () => {
    logout();
    navigate("/signin");
  };

  return (
    <nav
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 24px",
        backgroundColor: "#1f2937",
        color: "#fff",
      }}
    >
      <h2 style={{ margin: 0, cursor: "pointer" }} onClick={() => navigate("/orders")}>
        Order Management System
      </h2>

      <div>
        <button
          onClick={handleLogout}
          style={{
            padding: "6px 14px",
            backgroundColor: "#ef4444",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            borderRadius: "4px",
          }}
        >
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
