import axios from "axios";

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
});

let refreshRequest = null;

const redirectToSignin = () => {
  if (window.location.pathname !== "/signin") {
    window.location.assign("/signin");
  }
};

instance.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config || {};

    if (
      err.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.skipAuthRefresh
    ) {
      originalRequest._retry = true;
      try {
        refreshRequest =
          refreshRequest ||
          instance.post("/auth/refresh", null, { skipAuthRefresh: true });
        await refreshRequest;
        refreshRequest = null;
        return instance(originalRequest);
      } catch (refreshError) {
        refreshRequest = null;
        redirectToSignin();
        return Promise.reject(refreshError);
      }
    }

    if (err.response?.status === 401 && !originalRequest.skipAuthRefresh) {
      redirectToSignin();
    }
    return Promise.reject(err);
  },
);

export default instance;
