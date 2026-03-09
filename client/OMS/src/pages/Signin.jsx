import { useEffect, useState } from "react";
import { signin } from "../auth/auth.service";
import { useNavigate } from "react-router-dom";
import "../App.css";

const clearSigninOverlays = () => {
  document.body.classList.remove("modal-open");
  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("padding-right");
  document.documentElement.style.removeProperty("overflow");
  document
    .querySelectorAll(
      ".modal-backdrop, .offcanvas-backdrop, .om-modal-backdrop, .modal.show, .offcanvas.show",
    )
    .forEach((node) => {
      if (node instanceof HTMLElement) {
        node.remove();
      }
    });
};

const SignIn = () => {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    clearSigninOverlays();
    const t1 = window.setTimeout(clearSigninOverlays, 0);
    const t2 = window.setTimeout(clearSigninOverlays, 250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const res = await signin(form);

      if (!res.token) {
        throw new Error("Token missing");
      }

      clearSigninOverlays();
      const cleanupTimers = [0, 80, 250, 600, 1200].map((delay) =>
        window.setTimeout(clearSigninOverlays, delay),
      );

      navigate("/", { replace: true });
      window.setTimeout(() => {
        cleanupTimers.forEach((timerId) => window.clearTimeout(timerId));
      }, 2000);
    } catch (err) {
      console.error(err);
      setError("Invalid credentials");
    }
  };

  return (
    <div className="page-shell d-flex justify-content-center py-5">
      <div className="card om-card shadow-sm w-100 auth-card">
        <div className="card-body p-4 p-md-5">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => navigate(-1)}
            >
              Back
            </button>
            <h2 className="h4 mb-0">Sign In</h2>
          </div>

          {error && <div className="alert alert-danger py-2">{error}</div>}

          <form onSubmit={handleSubmit} className="d-grid gap-3">
            <div>
              <label className="form-label">Username</label>
              <input
                name="username"
                className="form-control"
                placeholder="Username"
                onChange={handleChange}
                required
              />
            </div>

            <div>
              <label className="form-label">Password</label>
              <div className="input-group">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  className="form-control"
                  placeholder="Password"
                  onChange={handleChange}
                  required
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary">
              Login
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
