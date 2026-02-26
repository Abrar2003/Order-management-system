import axios from "axios";

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
});

// Add request interceptor to include token in headers.
instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Add response interceptor to handle 401 errors.
instance.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      console.warn("Unauthorized - token expired or invalid");
      localStorage.removeItem("token");
      window.location.href = "/signin";
    }
    return Promise.reject(err);
  },
);

export default instance;
