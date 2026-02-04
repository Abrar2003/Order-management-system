import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../api/axios";
import Navbar from "../components/Navbar";
import { getUserFromToken } from "../auth/auth.utils";
import "../App.css";

const Signup = () => {
  const user = getUserFromToken();
  const isAdmin = user?.role === "admin";
  const roles = useMemo(
    () => ["admin", "manager", "QC", "Dev", "user"],
    []
  );
  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
    phone: "",
    role: "user",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.username || !form.password || !form.name || !form.email) {
      setError("Please fill all required fields.");
      return;
    }

    try {
      setSaving(true);
      await api.post("/users", {
        username: form.username.trim(),
        password: form.password,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        role: form.role,
      });
      setSuccess("User created successfully.");
      setForm({
        username: "",
        password: "",
        name: "",
        email: "",
        phone: "",
        role: "user",
      });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="authContainer signupContainer">
        <h2>Create User</h2>
        <p className="authSubtitle">Admin-only user creation</p>

        {error && <div className="authError">{error}</div>}
        {success && <div className="authSuccess">{success}</div>}

        <form className="signupForm" onSubmit={handleSubmit}>
          <div className="signupField">
            <label>Username *</label>
            <input
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Username"
              required
            />
          </div>
          <div className="signupField">
            <label>Password *</label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Password"
              required
            />
          </div>
          <div className="signupField">
            <label>Name *</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Full name"
              required
            />
          </div>
          <div className="signupField">
            <label>Email *</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Email address"
              required
            />
          </div>
          <div className="signupField">
            <label>Phone</label>
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="Phone number"
            />
          </div>
          <div className="signupField">
            <label>Role</label>
            <select name="role" value={form.role} onChange={handleChange}>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <button className="primaryButton" type="submit" disabled={saving}>
            {saving ? "Creating..." : "Create User"}
          </button>
        </form>
      </div>
    </>
  );
};

export default Signup;
