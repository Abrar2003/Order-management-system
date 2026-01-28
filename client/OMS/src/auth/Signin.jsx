import { useState } from "react";
import { signin } from "./auth.service";
import { useNavigate } from "react-router-dom";

const SignIn = () => {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
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

    localStorage.setItem("token", res.token);
    navigate("/orders");
  } catch (err) {
    console.error(err);
    setError("Invalid credentials");
  }
};


  return (
    <div className="authContainer">
      <h2>Sign In</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <form className="signinform" onSubmit={handleSubmit}>
        <input
          name="username"
          placeholder="Username"
          onChange={handleChange}
          required
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          onChange={handleChange}
          required
        />
        <button type="submit">Login</button>
      </form>
    </div>
  );
};

export default SignIn;
