import api from "../api/axios";
import { TASK_POPUP_LOGIN_KEY } from "../utils/loginTaskPopup";

let currentUser = null;

const normalizeUser = (user = null) => {
  if (!user) return null;
  const userId = user.id || user._id || user.sub || "";
  return {
    ...user,
    id: userId,
    _id: userId,
  };
};

export const signin = async (credentials) => {
  const res = await api.post("/auth/signin", credentials, {
    skipAuthRefresh: true,
  });
  currentUser = normalizeUser(res.data?.user || null);
  try {
    if (currentUser?.id) sessionStorage.setItem(TASK_POPUP_LOGIN_KEY, currentUser.id);
  } catch {
    // Browser storage restrictions must not prevent sign-in.
  }
  return res.data;
};

export const updateBrandScope = async (brandScope) => {
  const res = await api.post("/auth/brand-scope", {
    brand_scope: brandScope,
  });
  currentUser = normalizeUser(res.data?.user || null);
  return currentUser;
};

export const refreshSession = async () => {
  const res = await api.post("/auth/refresh", null, {
    skipAuthRefresh: true,
  });
  currentUser = normalizeUser(res.data?.user || null);
  return currentUser;
};

export const getSessionUser = async () => {
  const res = await api.get("/auth/me");
  currentUser = normalizeUser(res.data?.user || null);
  return currentUser;
};

export const changePassword = async (payload) => {
  const res = await api.patch("/auth/change-password", payload);
  return res.data;
};

export const getToken = () => null;

export const isTokenExpired = () => false;

export const getUserFromToken = () => currentUser;

export const logout = async () => {
  currentUser = null;
  try {
    sessionStorage.removeItem(TASK_POPUP_LOGIN_KEY);
  } catch {
    // Sign-out must also work when browser storage is unavailable.
  }
  try {
    await api.post("/auth/logout", null, {
      skipAuthRefresh: true,
    });
  } catch {
    // Session is already gone or unreachable; local state is cleared either way.
  }
};
