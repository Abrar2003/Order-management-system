import { useState } from "react";
import { signin } from "../auth/auth.service";
import { useNavigate } from "react-router-dom";

const SignIn = () => {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
  e.preventDefault();

  try {
    const res = await signin(form);

    if (!res.token) {
      throw new Error("Token missing");
    }

    navigate("/");
  } catch (err) {
    console.error(err);
    setError("Invalid credentials");
  }
};


  return (
    <div className="authContainer">
      <div className="qc-details-header">
        <button onClick={() => navigate(-1)} className="backButton">
          ← Back
        </button>
        <h2 className="qc-details-title">Sign In</h2>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <form className="signinform" onSubmit={handleSubmit}>
        <input
          name="username"
          placeholder="Username"
          onChange={handleChange}
          required
        />
        <div className="authPasswordRow">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            onChange={handleChange}
            required
          />
          <button
            type="button"
            className="authPasswordToggle"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <button type="submit">Login</button>
      </form>
    </div>
  );
};

export default SignIn;
