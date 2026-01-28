import axios from "../api/axios";

export const signin = async (credentials) => {
  const res = await axios.post("/auth/signin", credentials);
  return res.data;
};

export const getToken = () => localStorage.getItem("token");

export const logout = () => {
  localStorage.removeItem("token");
};

