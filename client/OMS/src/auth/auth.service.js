import axios from "../api/axios";
import { jwtDecode } from "jwt-decode";

const TOKEN_KEY = "token";

/**
 * Sign in user
 */
export const signin = async (credentials) => {
  const res = await axios.post("/auth/signin", credentials);

  // assuming backend returns { token: "..." }
  if (res.data?.token) {
    localStorage.setItem("token", res.data.token);
  }

  return res.data;
};

/**
 * Get token from localStorage
 */
export const getToken = () => {
  return localStorage.getItem(TOKEN_KEY);
};

/**
 * Check if token is expired
 */
export const isTokenExpired = () => {
  try {
    const token = getToken();
    if (!token) return true;

    const decoded = jwtDecode(token);
    const currentTime = Date.now() / 1000;

    // Check if token exp exists and if it's less than current time
    if (decoded.exp && decoded.exp < currentTime) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking token expiry:", error);
    return true; // treat invalid token as expired
  }
};

/**
 * Decode user from JWT token
 */
export const getUserFromToken = () => {
  try {
    const token = getToken();
    if (!token) return null;

    // Check if token is expired
    if (isTokenExpired()) {
      logout();
      return null;
    }

    const decoded = jwtDecode(token);

    return {
      _id: decoded._id,
      name: decoded.name,
      role: decoded.role,
      email: decoded.email,
    };
  } catch (error) {
    console.error("Invalid token:", error);
    logout(); // clear broken token
    return null;
  }
};

/**
 * Logout user
 */
export const logout = () => {
  localStorage.removeItem(TOKEN_KEY);
};
