import { jwtDecode } from "jwt-decode";

export const getUserFromToken = () => {
  const token = localStorage.getItem("token");
  if (!token) return null;

  try {
    const payload = jwtDecode(token);
    const userId = payload.id || payload._id || payload.sub || "";
    return {
      ...payload,
      id: userId,
      _id: userId,
    };
  } catch {
    return null;
  }
};
